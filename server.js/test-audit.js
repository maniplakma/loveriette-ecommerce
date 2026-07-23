/**
 * Full platform audit — shop, payment, reports, inquiry, plugging.
 * Run with server up: node server.js/test-audit.js
 */
const db = require('./db');
const http = require('http');
const appConfig = require('./config');

const BASE = appConfig.resolveTestBase();
let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, err) { failed++; console.log(`  ✗ ${name}: ${err}`); }

function request(method, urlPath, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const req = http.request(`${BASE}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie || '',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = raw ? JSON.parse(raw) : {}; } catch (_) { json = { raw }; }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function loginAdmin() {
  const candidates = [appConfig.adminPassword, process.env.TEST_ADMIN_PASSWORD, 'changeme-local-only'].filter(Boolean);
  const admins = db.prepare('SELECT email FROM users WHERE is_admin = 1 ORDER BY id ASC').all();
  const emails = [...new Set([appConfig.adminEmail?.toLowerCase(), ...admins.map((a) => String(a.email).toLowerCase())].filter(Boolean))];
  for (const email of emails) {
    for (const password of candidates) {
      const res = await request('POST', '/auth/login', { email, password });
      const cookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
      if (res.status === 200 && cookie) return cookie;
    }
  }
  throw new Error('admin login failed');
}

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQwAHZwZ2hFBOwAAAABJRU5ErkJggg==';

async function runShopOrderFlow(adminCookie) {
  console.log('\nShop: signup → order → receipt → approve');
  const email = `audit-shop-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', { email, password: 'auditpass123', name: 'Audit Buyer' });
  const buyerCookie = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (reg.status !== 201 && reg.status !== 200) { fail('register buyer', reg.status); return; }
  ok('buyer registration');

  const product = db.prepare('SELECT id, price FROM products WHERE is_enabled != 0 ORDER BY id LIMIT 1').get();
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  const variant = product
    ? db.prepare('SELECT id FROM product_variants WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(product.id)
    : null;
  if (!product || !pm) { fail('shop seed data', 'missing product/pm'); return; }

  if (variant) {
    const stock = await request('POST', '/admin/inventory', {
      variant_id: variant.id,
      email: `audit-stock-${Date.now()}@test.local`,
      password: 'auditpass',
      profiles: ['Profile 1']
    }, adminCookie);
    if (stock.status !== 201) { fail('seed inventory', stock.status); return; }
    ok('inventory seeded for fulfillment');
  }

  await request('POST', '/cart', { productId: product.id, quantity: 1 }, buyerCookie);
  const orderRes = await request('POST', '/orders', {
    email,
    paymentMethodId: pm.id,
    items: [{ productId: product.id, quantity: 1 }]
  }, buyerCookie);
  if (orderRes.status !== 201 && orderRes.status !== 200) {
    fail('POST /orders', orderRes.json?.error || orderRes.status);
    return;
  }
  const orderNumber = orderRes.json.orderNumber;
  ok(`order placed #${orderNumber}`);

  const receipt = await request('POST', `/orders/${orderNumber}/receipt`, { receiptImage: TINY_PNG }, buyerCookie);
  if (receipt.status === 200 && receipt.json.status === 'pending') ok('receipt upload → pending');
  else fail('receipt upload', receipt.json?.status || receipt.status);

  const approve = await request('POST', `/admin/orders/${orderNumber}/approve`, {}, adminCookie);
  if (approve.status === 200 && approve.json.status === 'approved') ok('admin approve order');
  else fail('admin approve', approve.json?.error || approve.status);

  const cred = await request('GET', `/account/orders/${orderNumber}/credentials`, null, buyerCookie);
  const phase = cred.json?.buyerPhase;
  if (cred.status === 200 && (phase === 'approved' || phase === 'delivered')) ok('buyer sees fulfilled credentials');
  else fail('buyer credentials', phase || cred.status);

  return { buyerCookie, orderNumber, email };
}

async function runReportResolveFlow(adminCookie, ctx) {
  console.log('\nReports: submit → admin resolve (fix_active)');
  if (!ctx?.buyerCookie || !ctx?.orderNumber) { fail('report flow setup', 'no order'); return; }

  const targets = await request('GET', `/account/orders/${ctx.orderNumber}/report-targets`, null, ctx.buyerCookie);
  const list = targets.json?.targets || [];
  if (targets.status !== 200 || !list.length) {
    fail('report targets', list.length || targets.status);
    return;
  }
  ok('report targets available');

  const stockItemId = list[0].stockItemId;
  const submit = await request('POST', '/reports', {
    orderNumber: ctx.orderNumber,
    name: 'Audit Buyer',
    issue: 'Account login failed during audit test',
    remainingDays: '15 days',
    subscription: 'Test Product',
    selections: [{ stockItemId, profileIndex: 0 }],
    vouchImage: TINY_PNG,
    proofImages: [TINY_PNG]
  }, ctx.buyerCookie);
  if (submit.status !== 201) { fail('submit report', submit.json?.error || submit.status); return; }
  ok('buyer submits report');
  const reportId = submit.json.id;

  const detail = await request('GET', `/admin/reports/${reportId}/detail`, null, adminCookie);
  if (detail.status !== 200) { fail('admin report detail', detail.status); return; }
  ok('admin opens report detail');
  if (!detail.json?.stockItem && !(detail.json?.credentialGroups || []).length) {
    fail('report detail missing credentials', 'no stockItem or groups');
    return;
  }

  const stock = detail.json.stockItem || detail.json.credentialGroups?.[0] || {};
  const replacementEmail = `replaced-${Date.now()}@audit.test`;
  const resolve = await request('POST', `/admin/reports/${reportId}/action`, {
    action: 'fix_active',
    adminNotes: 'Audit test — credentials replaced',
    stockDescription: 'Replacement stock',
    email: replacementEmail,
    password: 'newpass123',
    emailAccessEmail: replacementEmail,
    emailAccessPassword: 'newpass123',
    profiles: 'Profile 1'
  }, adminCookie);
  if (resolve.status === 200 && resolve.json.ok) ok('admin resolves report (fix_active)');
  else fail('admin resolve fix_active', resolve.json?.error || resolve.status);

  const accessRow = db.prepare(
    'SELECT email, password FROM email_access_credentials WHERE stock_item_id = ?'
  ).get(stockItemId);
  if (accessRow?.email === replacementEmail) ok('replacement syncs email_access Gmail');
  else fail('replacement email_access sync', accessRow?.email || 'missing');

  const stockRow = db.prepare('SELECT email FROM stock_items WHERE id = ?').get(stockItemId);
  if (stockRow?.email === replacementEmail) ok('replacement syncs stock_item email');
  else fail('replacement stock email sync', stockRow?.email || 'missing');

  const history = await request('GET', '/admin/reports?tab=history', null, adminCookie);
  const rows = Array.isArray(history.json) ? history.json : [];
  const row = rows.find((r) => r.id === reportId);
  if (row?.status === 'resolved') ok('report appears in history as resolved');
  else fail('report history', row?.status || 'missing');
}

async function runInquiryAndMessaging(adminCookie) {
  console.log('\nWebsite inquiry + support ticket');
  const pkg = db.prepare('SELECT id FROM website_packages WHERE is_enabled = 1 LIMIT 1').get();
  if (!pkg) { fail('website package', 'none'); return; }
  const inq = await request('POST', '/api/website-making/inquiry', {
    packageId: pkg.id,
    name: 'Audit Client',
    email: `audit-web-${Date.now()}@test.local`,
    message: 'Need ecommerce site audit test'
  });
  if (inq.status !== 201 || !inq.json.inquiryRef) { fail('website inquiry', inq.status); return; }
  ok('website inquiry created');

  const adminWeb = await request('GET', '/admin/website-making', null, adminCookie);
  const inquiries = adminWeb.json?.inquiries || [];
  if (adminWeb.status === 200 && inquiries.length) ok('admin lists website inquiries');
  else fail('admin website inquiries', adminWeb.status);
}

async function runIntegrations(adminCookie) {
  console.log('\nAdmin integrations & buttons (API)');
  const intg = await request('GET', '/admin/integrations', null, adminCookie);
  if (intg.status === 200) ok('GET /admin/integrations');
  else fail('GET /admin/integrations', intg.status);

  if (intg.json?.gmail != null) ok('Gmail integration config present');
  else fail('Gmail integration config', 'missing');

  const plugging = await request('GET', '/admin/plugging', null, adminCookie);
  if (plugging.status === 200) ok('GET /admin/plugging');
  else fail('GET /admin/plugging', plugging.status);

  const modules = await request('GET', '/admin/modules', null, adminCookie);
  if (modules.status === 200 && typeof modules.json.plugging === 'boolean') ok('GET /admin/modules');
  else fail('GET /admin/modules', modules.status);
}

async function runSecurityChecks() {
  console.log('\nSecurity & auth guards');
  const adminOnly = await request('GET', '/admin/overview');
  if (adminOnly.status === 401 || adminOnly.status === 403) ok('admin routes require auth');
  else fail('admin auth guard', adminOnly.status);

  const account = await request('GET', '/account/dashboard');
  if (account.status === 401) ok('buyer dashboard requires auth');
  else fail('buyer auth guard', account.status);

  const plugging = await request('GET', '/api/plugging');
  if (plugging.status === 200) ok('public plugging API readable');
  else fail('GET /api/plugging public', plugging.status);
}

async function runSeoPages() {
  console.log('\nSEO & static pages');
  for (const path of [
    '/terms.html', '/privacy.html', '/faqs.html', '/contact.html', '/about.html',
    '/cart.html', '/checkout.html', '/payment.html', '/order-thanks.html', '/guide.html'
  ]) {
    const res = await request('GET', path);
    if (res.status === 200) ok(`GET ${path}`);
    else fail(`GET ${path}`, res.status);
  }
}

async function runCartFlow() {
  console.log('\nCart: add → increase → decrease → remove');
  const email = `audit-cart-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', { email, password: 'auditpass123', name: 'Cart Tester' });
  const buyerCookie = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (reg.status !== 201 && reg.status !== 200) { fail('cart buyer register', reg.status); return null; }
  ok('cart buyer registered');

  const product = db.prepare('SELECT id FROM products WHERE is_enabled != 0 ORDER BY id LIMIT 1').get();
  if (!product) { fail('cart product seed', 'none'); return buyerCookie; }

  const add = await request('POST', '/cart', { productId: product.id, quantity: 1 }, buyerCookie);
  if (add.status === 200 && add.json.count === 1) ok('add to cart');
  else fail('POST /cart', add.json?.error || add.status);

  const inc = await request('PUT', `/cart/${product.id}`, { quantity: 3 }, buyerCookie);
  if (inc.status === 200 && inc.json.items?.[0]?.quantity === 3) ok('increase quantity to 3');
  else fail('PUT /cart qty+', inc.status);

  const dec = await request('PUT', `/cart/${product.id}`, { quantity: 2 }, buyerCookie);
  if (dec.status === 200 && dec.json.items?.[0]?.quantity === 2) ok('decrease quantity to 2');
  else fail('PUT /cart qty-', dec.status);

  const del = await request('DELETE', `/cart/${product.id}`, null, buyerCookie);
  if (del.status === 200 && del.json.count === 0) ok('remove from cart');
  else fail('DELETE /cart', del.status);

  return buyerCookie;
}

async function runCheckoutQuantityOverride(buyerCookie) {
  console.log('\nCheckout: direct quantity overrides cart');
  if (!buyerCookie) { fail('checkout qty', 'no session'); return; }
  const product = db.prepare('SELECT id FROM products WHERE is_enabled != 0 ORDER BY id LIMIT 1').get();
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  if (!product || !pm) { fail('checkout qty seed', 'missing'); return; }

  await request('POST', '/cart', { productId: product.id, quantity: 1 }, buyerCookie);
  const orderRes = await request('POST', '/orders', {
    email: `qty-override-${Date.now()}@test.local`,
    paymentMethodId: pm.id,
    productId: product.id,
    quantity: 5,
    tingiDrop: false
  }, buyerCookie);
  if (orderRes.status !== 201) {
    fail('checkout qty order', orderRes.json?.error || orderRes.status);
    return;
  }
  const orderNumber = orderRes.json.orderNumber;
  const row = db.prepare(`
    SELECT oi.quantity FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.order_number = ?
  `).get(orderNumber);
  if (row?.quantity === 5) ok('direct checkout quantity honors POST (not stale cart)');
  else fail('direct checkout quantity', String(row?.quantity));
}

async function runWebsitePackageDetail() {
  console.log('\nWebsite making: package detail API');
  const pkg = db.prepare('SELECT slug FROM website_packages WHERE is_enabled = 1 ORDER BY id LIMIT 1').get();
  if (!pkg) { fail('website package slug', 'none'); return; }
  const res = await request('GET', `/api/website-making/packages/${pkg.slug}`);
  if (res.status !== 200 || !res.json.name) { fail('GET package detail', res.status); return; }
  ok('GET /api/website-making/packages/:slug');
  if (Array.isArray(res.json.features)) ok('package detail includes features');
  else fail('package detail features', 'missing');
  if (res.json.longDescription || res.json.description) ok('package detail includes description');
  else fail('package detail description', 'empty');
}

async function runPluggingOrderFlow(adminCookie) {
  console.log('\nPlugging: subscribe → receipt → approve → access key');
  const plan = db.prepare('SELECT id, price FROM plugging_plans WHERE is_enabled = 1 ORDER BY id LIMIT 1').get();
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  if (!plan || !pm) { fail('plugging seed', 'missing plan/pm'); return; }

  const plugEmail = `plug-qa-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', { email: plugEmail, password: 'testpass123', name: 'Plug QA Buyer' });
  const buyerCookie = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (reg.status !== 201 && reg.status !== 200) { fail('plugging buyer register', reg.status); return; }
  const buyerBefore = db.prepare('SELECT id, wallet_balance FROM users WHERE LOWER(email) = ?').get(plugEmail.toLowerCase());

  const sub = await request('POST', '/api/plugging/subscribe', {
    planId: plan.id,
    name: 'Plug QA Buyer',
    email: plugEmail
  }, buyerCookie);
  if (sub.status !== 201 || !sub.json.orderRef) {
    fail('POST /api/plugging/subscribe', sub.json?.error || sub.status);
    return;
  }
  const orderRef = sub.json.orderRef;
  ok('plugging order created');

  const pay = await request('POST', `/api/plugging/orders/${orderRef}/payment`, {
    paymentMethodId: pm.id,
    receiptImage: TINY_PNG
  });
  if (pay.status === 200 && pay.json.ok) ok('plugging receipt uploaded');
  else fail('plugging receipt', pay.json?.error || pay.status);

  const pending = await request('GET', `/api/plugging/orders/${orderRef}`);
  if (pending.status === 200 && pending.json.status === 'pending_approval') ok('status → pending_approval');
  else fail('plugging pending status', pending.json?.status || pending.status);

  const row = db.prepare('SELECT id FROM plugging_orders WHERE order_ref = ?').get(orderRef);
  db.prepare(`
    INSERT INTO plugging_access_keys (plan_id, access_key, status)
    VALUES (?, ?, 'available')
  `).run(plan.id, `PLG-TEST-${Date.now().toString(36).toUpperCase()}-QA`);
  const approve = await request('PUT', `/admin/plugging/orders/${row.id}`, { status: 'approved' }, adminCookie);
  if (approve.status === 200 && approve.json.accessKey?.startsWith('PLG-')) ok('admin approve → access key');
  else fail('plugging approve', approve.json?.error || approve.status);

  const approved = await request('GET', `/api/plugging/orders/${orderRef}`);
  if (approved.status === 200 && approved.json.accessKey) ok('buyer sees access key');
  else fail('plugging access key delivery', approved.status);

  const unlock = await request('POST', '/api/plugging/workspace/unlock', { accessKey: approved.json.accessKey });
  if (unlock.status === 200 && unlock.json.ok) ok('workspace unlock with access key');
  else fail('workspace unlock', unlock.json?.error || unlock.status);

  const plugCookie = (unlock.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const wsPersist = await request('GET', '/api/plugging/workspace', null, plugCookie);
  if (wsPersist.status === 200 && wsPersist.json.orderRef === orderRef) ok('workspace session persists via cookie');
  else fail('workspace session persist', wsPersist.status);

  if (plan.price >= 200 && buyerBefore?.id) {
    const buyerAfter = db.prepare('SELECT wallet_balance FROM users WHERE id = ?').get(buyerBefore.id);
    const expected = Math.floor(plan.price / 200);
    const gained = (buyerAfter?.wallet_balance || 0) - (buyerBefore.wallet_balance || 0);
    if (gained === expected) ok(`plugging loyalty credit ₱${expected}`);
    else fail('plugging loyalty credit', `expected +${expected}, got +${gained}`);
  }
}

async function runBuyerAccountFlow() {
  console.log('\nBuyer account: settings → profile → password → notifications');
  const email = `audit-acct-${Date.now()}@test.local`;
  const password = 'auditpass123';
  const reg = await request('POST', '/auth/register', { email, password, name: 'Account QA' });
  const buyerCookie = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (reg.status !== 201 && reg.status !== 200) { fail('account register', reg.status); return; }
  ok('account buyer registered');

  const settings = await request('GET', '/account/settings', null, buyerCookie);
  if (settings.status === 200 && settings.json.profile?.email === email) ok('GET /account/settings');
  else fail('GET /account/settings', settings.status);

  const profile = await request('PUT', '/account/settings/profile', {
    name: 'Account QA Updated',
    phone: '09171234567'
  }, buyerCookie);
  if (profile.status === 200 && profile.json.profile?.name === 'Account QA Updated') ok('profile update');
  else fail('PUT profile', profile.status);

  const newPass = 'newaudit456';
  const pwd = await request('POST', '/account/settings/password', {
    currentPassword: password,
    newPassword: newPass,
    confirmPassword: newPass
  }, buyerCookie);
  if (pwd.status === 200) ok('change password');
  else fail('change password', pwd.json?.error || pwd.status);

  const loginNew = await request('POST', '/auth/login', { email, password: newPass });
  if (loginNew.status === 200) ok('login with new password');
  else fail('login new password', loginNew.status);

  const notifs = await request('GET', '/account/notifications', null, buyerCookie);
  if (notifs.status === 200 && Array.isArray(notifs.json.notifications)) ok('GET notifications');
  else fail('GET notifications', notifs.status);

  const wallet = await request('GET', '/account/wallet', null, buyerCookie);
  if (wallet.status === 200 && Array.isArray(wallet.json.purchasedOrders)) ok('transaction history');
  else fail('GET wallet/transactions', wallet.status);

  const vouch = await request('GET', '/vouch-settings');
  if (vouch.status === 200 && vouch.json.telegramLabel) ok('GET /vouch-settings');
  else fail('GET /vouch-settings', vouch.status);
}

async function runBulkOrderPricing() {
  console.log('\nBulk order: tier pricing');
  const product = db.prepare(`
    SELECT id FROM products WHERE bulk_pricing_enabled = 1 LIMIT 1
  `).get();
  if (!product) {
    ok('bulk pricing (skipped — no bulk product)');
    return;
  }
  const tiers = db.prepare('SELECT bulk_tiers FROM products WHERE id = ?').get(product.id);
  let parsed = [];
  try { parsed = JSON.parse(tiers.bulk_tiers || '[]'); } catch (_) { parsed = []; }
  if (parsed.length >= 1) ok('bulk tiers configured on product');
  else fail('bulk tiers', 'empty');
}

async function runShopBrowseApi() {
  console.log('\nShop browse: products, categories, search, product detail');
  const products = await request('GET', '/products');
  if (products.status === 200 && Array.isArray(products.json) && products.json.length) ok('GET /products');
  else fail('GET /products', products.status);

  const cats = await request('GET', '/categories');
  if (cats.status === 200 && Array.isArray(cats.json)) ok('GET /categories');
  else fail('GET /categories', cats.status);

  const search = await request('GET', '/products?search=net');
  if (search.status === 200 && Array.isArray(search.json)) ok('GET /products?search=');
  else fail('GET /products search', search.status);

  const sample = products.json[0];
  if (sample?.id) {
    const detail = await request('GET', `/products/${sample.id}`);
    if (detail.status === 200 && detail.json?.name) ok('GET /products/:id');
    else fail('GET /products/:id', detail.status);
  }
}

async function runRedeemCodeFlow(adminCookie) {
  console.log('\nRedeem codes: validate → order → exhausted');
  const code = `AUDIT${Date.now().toString(36).toUpperCase()}`;
  const create = await request('POST', '/admin/redeem-codes', {
    code,
    discount_type: 'fixed',
    discount_value: 15,
    max_uses: 1
  }, adminCookie);
  if (create.status !== 201) { fail('admin create redeem code', create.json?.error || create.status); return; }
  ok('admin creates redeem code');

  const invalid = await request('POST', '/redeem/validate', { code: 'NOTREALCODE99', subtotal: 200 });
  if (invalid.status === 400) ok('invalid redeem code rejected');
  else fail('invalid redeem code', invalid.status);

  const valid = await request('POST', '/redeem/validate', { code, subtotal: 200 });
  if (valid.status === 200 && valid.json.discount === 15) ok('valid redeem returns discount');
  else fail('valid redeem validate', valid.json?.error || valid.status);

  const email = `redeem-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', { email, password: 'redeempass123', name: 'Redeem QA' });
  const buyerCookie = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (!buyerCookie) { fail('redeem buyer register', 'no cookie'); return; }

  const product = db.prepare('SELECT id FROM products WHERE is_enabled != 0 ORDER BY id LIMIT 1').get();
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  if (!product || !pm) { fail('redeem seed', 'missing product/pm'); return; }

  const orderRes = await request('POST', '/orders', {
    email,
    paymentMethodId: pm.id,
    productId: product.id,
    quantity: 1,
    redeemCode: code
  }, buyerCookie);
  if (orderRes.status !== 201 && orderRes.status !== 200) {
    fail('order with redeem code', orderRes.json?.error || orderRes.status);
    return;
  }
  ok('order applies redeem code');

  const exhausted = await request('POST', '/redeem/validate', { code, subtotal: 200 });
  if (exhausted.status === 400 && /expired|invalid/i.test(String(exhausted.json?.error || ''))) {
    ok('exhausted redeem code rejected');
  } else fail('exhausted redeem code', exhausted.json?.error || exhausted.status);

  const adminList = await request('GET', '/admin/redeem-codes', null, adminCookie);
  const row = (adminList.json || []).find((r) => String(r.code).toUpperCase() === code.toUpperCase());
  if (row && Number(row.used_count) >= 1) ok('redeem used_count incremented');
  else fail('redeem used_count', row?.used_count);

  if (row?.id) await request('DELETE', `/admin/redeem-codes/${row.id}`, null, adminCookie);
}

async function runTingiDropFlow(adminCookie) {
  console.log('\nTingi Drop: order → approve → manual claim');
  const tingiCfg = await request('GET', '/tingi-drop');
  if (tingiCfg.status !== 200 || !tingiCfg.json.checkoutEnabled) {
    fail('GET /tingi-drop', tingiCfg.status);
    return;
  }
  ok('GET /tingi-drop config');

  const email = `tingi-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', { email, password: 'tingipass123', name: 'Tingi QA' });
  const buyerCookie = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (!buyerCookie) { fail('tingi buyer register', 'no cookie'); return; }
  ok('tingi buyer registered');

  const variant = db.prepare(`
    SELECT v.id AS variantId, v.product_id AS productId, p.price
    FROM product_variants v JOIN products p ON p.id = v.product_id
    ORDER BY v.id LIMIT 1
  `).get();
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  if (!variant || !pm) { fail('tingi seed', 'missing variant/pm'); return; }

  const qty = Math.max(Number(tingiCfg.json.minQty) || 2, 2);
  for (let i = 0; i < qty + 1; i++) {
    const stock = await request('POST', '/admin/inventory', {
      variant_id: variant.variantId,
      email: `tingi-stock-${Date.now()}-${i}@test.local`,
      password: 'pass123',
      profiles: ['Profile 1']
    }, adminCookie);
    if (stock.status !== 201) { fail('tingi stock seed', stock.status); return; }
  }
  ok('tingi stock seeded');

  await request('POST', '/cart', { productId: variant.productId, variantId: variant.variantId, quantity: qty }, buyerCookie);
  const orderRes = await request('POST', '/orders', {
    email,
    paymentMethodId: pm.id,
    tingiDrop: true
  }, buyerCookie);
  if (orderRes.status !== 201 && orderRes.status !== 200) {
    fail('tingi order create', orderRes.json?.error || orderRes.status);
    return;
  }
  const orderNumber = orderRes.json.orderNumber;
  ok(`tingi order placed #${orderNumber}`);

  const receipt = await request('POST', `/orders/${orderNumber}/receipt`, { receiptImage: TINY_PNG }, buyerCookie);
  if (receipt.status === 200 && receipt.json.status === 'pending') ok('tingi receipt → pending');
  else fail('tingi receipt', receipt.json?.status || receipt.status);

  const approve = await request('POST', `/admin/orders/${orderNumber}/approve`, {}, adminCookie);
  if (approve.status === 200) ok('tingi order approved');
  else fail('tingi approve', approve.json?.error || approve.status);

  const orderRow = db.prepare('SELECT tingi_drop_enabled, fulfillment_mode FROM orders WHERE order_number = ?').get(orderNumber);
  if (orderRow?.tingi_drop_enabled && orderRow.fulfillment_mode === 'manual') ok('tingi order flagged manual');
  else fail('tingi order flags', JSON.stringify(orderRow));

  const claim1 = await request('POST', `/account/orders/${orderNumber}/claim`, {}, buyerCookie);
  if (claim1.status === 200 && claim1.json.summary?.remaining === qty - 1) ok('tingi claim 1 of N');
  else fail('tingi claim 1', claim1.json?.error || claim1.status);

  const claim2 = await request('POST', `/account/orders/${orderNumber}/claim`, {}, buyerCookie);
  if (claim2.status === 200 && claim2.json.summary?.remaining === qty - 2) ok('tingi claim 2 of N');
  else fail('tingi claim 2', claim2.json?.error || claim2.status);

  for (let i = 2; i < qty; i++) {
    await request('POST', `/account/orders/${orderNumber}/claim`, {}, buyerCookie);
  }
  const finalClaim = await request('POST', `/account/orders/${orderNumber}/claim`, {}, buyerCookie);
  if (finalClaim.status === 400 && /already been claimed|nothing left/i.test(String(finalClaim.json?.error || ''))) {
    ok('tingi all-units-claimed guard');
  } else if (finalClaim.json?.summary?.remaining === 0) {
    ok('tingi all units claimed');
  } else fail('tingi final claim', finalClaim.json?.error || finalClaim.status);
}

async function main() {
  console.log('Full platform audit');
  try {
    const adminCookie = await loginAdmin();
    ok('admin login');
    await runSecurityChecks();
    await runSeoPages();
    await runShopBrowseApi();
    await runCartFlow().then(async (cartCookie) => {
      if (cartCookie) await runCheckoutQuantityOverride(cartCookie);
    });
    const shopCtx = await runShopOrderFlow(adminCookie);
    await runReportResolveFlow(adminCookie, shopCtx);
    await runRedeemCodeFlow(adminCookie);
    await runTingiDropFlow(adminCookie);
    await runPluggingOrderFlow(adminCookie);
    await runBuyerAccountFlow();
    await runBulkOrderPricing();
    await runWebsitePackageDetail();
    await runInquiryAndMessaging(adminCookie);
    await runIntegrations(adminCookie);
  } catch (err) {
    fail('audit runner', err.message);
  }
  console.log(`\nAudit results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
