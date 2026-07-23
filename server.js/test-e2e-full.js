/**
 * Full customer-journey E2E tests — run with server up:
 *   TEST_BASE=http://127.0.0.1:3100 node server.js/test-e2e-full.js
 */
const db = require('./db');
const http = require('http');
const appConfig = require('./config');

const BASE = appConfig.resolveTestBase();
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQwAHZwZ2hFBOwAAAABJRU5ErkJggg==';

const results = { passed: [], failed: [], orders: [] };

function ok(wf, step) { results.passed.push(`${wf}: ${step}`); console.log(`  ✓ [${wf}] ${step}`); }
function fail(wf, step, err) { results.failed.push({ wf, step, err: String(err) }); console.log(`  ✗ [${wf}] ${step}: ${err}`); }

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
        resolve({ status: res.statusCode, json, headers: res.headers, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function cookieFrom(res) {
  return (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}

async function loginAdmin() {
  const passwords = [appConfig.adminPassword, process.env.TEST_ADMIN_PASSWORD, 'changeme-local-only'].filter(Boolean);
  const emails = db.prepare('SELECT email FROM users WHERE is_admin = 1').all().map((r) => r.email.toLowerCase());
  for (const email of emails) {
    for (const password of passwords) {
      const res = await request('POST', '/auth/login', { email, password });
      const c = cookieFrom(res);
      if (res.status === 200 && c) return c;
    }
  }
  throw new Error('admin login failed');
}

async function registerBuyer(prefix) {
  const email = `${prefix}-${Date.now()}@e2e.test`;
  const res = await request('POST', '/auth/register', {
    email, password: 'E2eTestPass123!', name: `E2E ${prefix}`
  });
  return { email, cookie: cookieFrom(res), status: res.status };
}

async function seedStock(variantId, count, tag) {
  for (let i = 0; i < count; i++) {
    const stock = await request('POST', '/admin/inventory', {
      variant_id: variantId,
      email: `${tag}-${Date.now()}-${i}@stock.test`,
      password: 'pass123',
      profiles: ['Profile 1']
    }, global.__adminCookie);
    if (stock.status !== 201) {
      throw new Error(`seedStock failed: ${stock.json?.error || stock.status}`);
    }
  }
}

async function workflowShop(adminCookie) {
  const WF = 'SHOP';
  console.log(`\n=== ${WF} ===`);
  global.__adminCookie = adminCookie;

  const products = await request('GET', '/products');
  if (products.status !== 200 || !products.json.length) { fail(WF, 'browse products', products.status); return; }
  ok(WF, `browse products (${products.json.length} items)`);

  const product = products.json[0];
  const detail = await request('GET', `/products/${product.id}`);
  if (detail.status !== 200) { fail(WF, 'product page API', detail.status); return; }
  ok(WF, `product page: ${product.name}`);

  const buyer = await registerBuyer('shop');
  if (buyer.status !== 201 && buyer.status !== 200) { fail(WF, 'register buyer', buyer.status); return; }
  ok(WF, 'register buyer');

  const add = await request('POST', '/cart', { productId: product.id, quantity: 1 }, buyer.cookie);
  if (add.status !== 200) { fail(WF, 'add to cart', add.json?.error); return; }
  ok(WF, 'add to cart');

  const inc = await request('PUT', `/cart/${product.id}`, { quantity: 3 }, buyer.cookie);
  if (inc.json?.items?.[0]?.quantity === 3) ok(WF, 'increase qty to 3');
  else fail(WF, 'increase qty', inc.json?.items?.[0]?.quantity);

  const dec = await request('PUT', `/cart/${product.id}`, { quantity: 2 }, buyer.cookie);
  if (dec.json?.items?.[0]?.quantity === 2) ok(WF, 'decrease qty to 2');
  else fail(WF, 'decrease qty', dec.json?.items?.[0]?.quantity);

  const pm = await request('GET', '/payment-methods');
  const paymentId = pm.json?.methods?.[0]?.id || pm.json?.[0]?.id;
  if (!paymentId) { fail(WF, 'payment methods', 'none'); return; }
  ok(WF, 'payment method available');

  const variantId = product.variants?.[0]?.id || null;
  if (variantId) await seedStock(variantId, 2, 'shop');

  const orderRes = await request('POST', '/orders', {
    email: buyer.email,
    paymentMethodId: paymentId,
    productId: product.id,
    variantId,
    quantity: 2
  }, buyer.cookie);

  if (orderRes.status !== 201) {
    fail(WF, 'create order', `${orderRes.status} ${orderRes.json?.error} ${orderRes.json?.detail || ''}`);
    return;
  }
  const orderNumber = orderRes.json.orderNumber;
  results.orders.push({ wf: WF, orderNumber, email: buyer.email });
  ok(WF, `order created #${orderNumber}`);

  const receipt = await request('POST', `/orders/${orderNumber}/receipt`, { receiptImage: TINY_PNG }, buyer.cookie);
  if (receipt.status === 200 && receipt.json.status === 'pending') ok(WF, 'receipt uploaded');
  else fail(WF, 'receipt upload', receipt.json?.error || receipt.status);

  const approve = await request('POST', `/admin/orders/${orderNumber}/approve`, {}, adminCookie);
  if (approve.status === 200) ok(WF, 'admin approved');
  else fail(WF, 'admin approve', approve.json?.error);

  const cred = await request('GET', `/account/orders/${orderNumber}/credentials`, null, buyer.cookie);
  if (cred.status === 200) ok(WF, 'buyer credentials delivered');
  else fail(WF, 'credentials', cred.status);

  const notif = await request('GET', '/account/notifications', null, buyer.cookie);
  if (notif.status === 200) ok(WF, 'buyer notifications');
  else fail(WF, 'notifications', notif.status);

  const hist = await request('GET', '/account/orders', null, buyer.cookie);
  if (hist.status === 200 && (hist.json?.orders || []).some((o) => o.orderNumber === orderNumber)) ok(WF, 'order history');
  else fail(WF, 'order history', 'missing');

  await request('DELETE', `/cart/${product.id}`, null, buyer.cookie);
  ok(WF, 'remove from cart (cleanup)');

  // Production-matching scenario: Netflix 1 Month Shared (₱85), preorder, no stock required
  const netflix = products.json.find((p) => p.id === 1) || products.json[0];
  const netflixVariant = netflix.variants?.find((v) => v.price === 85) || netflix.variants?.[0];
  if (netflixVariant) {
    const pre = await request('POST', '/orders', {
      email: buyer.email,
      paymentMethodId: paymentId,
      productId: netflix.id,
      variantId: netflixVariant.id,
      quantity: 1
    }, buyer.cookie);
    if (pre.status === 201 && pre.json?.orderNumber) {
      results.orders.push({ wf: WF, orderNumber: pre.json.orderNumber, note: 'netflix-85-preorder' });
      ok(WF, `preorder ₱85 order #${pre.json.orderNumber}`);
    } else {
      fail(WF, 'preorder ₱85 order', `${pre.status} ${pre.json?.error || ''}`);
    }
  }
}

async function workflowTingi(adminCookie) {
  const WF = 'TINGI';
  console.log(`\n=== ${WF} ===`);
  const cfg = await request('GET', '/tingi-drop');
  const minQty = cfg.json?.minQty || 2;

  const buyer = await registerBuyer('tingi');
  const product = db.prepare('SELECT id FROM products WHERE is_enabled != 0 ORDER BY id LIMIT 1').get();
  const variant = db.prepare('SELECT id FROM product_variants WHERE product_id = ? LIMIT 1').get(product.id);
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();

  await seedStock(variant.id, (minQty + 1) * 2 + 2, 'tingi');

  for (const qty of [minQty, minQty + 1]) {
    const res = await request('POST', '/orders', {
      email: buyer.email,
      paymentMethodId: pm.id,
      productId: product.id,
      variantId: variant.id,
      quantity: qty,
      tingiDrop: true
    }, buyer.cookie);
    if (res.status !== 201) {
      fail(WF, `order qty=${qty}`, `${res.json?.error} ${res.json?.detail || ''}`);
      continue;
    }
    results.orders.push({ wf: WF, orderNumber: res.json.orderNumber, qty });
    ok(WF, `tingi order qty=${qty} #${res.json.orderNumber}`);

    await request('POST', `/orders/${res.json.orderNumber}/receipt`, { receiptImage: TINY_PNG }, buyer.cookie);
    await request('POST', `/admin/orders/${res.json.orderNumber}/approve`, {}, adminCookie);
    const claim = await request('POST', `/account/orders/${res.json.orderNumber}/claim`, {}, buyer.cookie);
    if (claim.status === 200) ok(WF, `claim unit on #${res.json.orderNumber}`);
    else fail(WF, `claim #${res.json.orderNumber}`, claim.json?.error);
  }
}

async function workflowReport(adminCookie, shopOrder) {
  const WF = 'REPORT';
  console.log(`\n=== ${WF} ===`);
  if (!shopOrder) { fail(WF, 'setup', 'no shop order'); return; }

  const buyer = await registerBuyer('report');
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  const product = db.prepare('SELECT id FROM products WHERE is_enabled != 0 LIMIT 1').get();
  const variant = db.prepare('SELECT id FROM product_variants WHERE product_id = ? LIMIT 1').get(product.id);
  await seedStock(variant.id, 1, 'report');

  const ord = await request('POST', '/orders', {
    email: buyer.email, paymentMethodId: pm.id, productId: product.id, variantId: variant.id, quantity: 1
  }, buyer.cookie);
  if (ord.status !== 201) { fail(WF, 'setup order', ord.json?.error); return; }
  const on = ord.json.orderNumber;
  await request('POST', `/orders/${on}/receipt`, { receiptImage: TINY_PNG }, buyer.cookie);
  await request('POST', `/admin/orders/${on}/approve`, {}, adminCookie);

  const targets = await request('GET', `/account/orders/${on}/report-targets`, null, buyer.cookie);
  const stockItemId = targets.json?.targets?.[0]?.stockItemId;
  if (!stockItemId) { fail(WF, 'report targets', 'empty'); return; }

  const sub = await request('POST', '/reports', {
    orderNumber: on,
    name: 'E2E Reporter',
    issue: 'Login failed E2E test',
    remainingDays: '10',
    subscription: 'Test',
    selections: [{ stockItemId, profileIndex: 0 }],
    vouchImage: TINY_PNG,
    proofImages: [TINY_PNG]
  }, buyer.cookie);
  if (sub.status !== 201) { fail(WF, 'submit report', sub.json?.error); return; }
  ok(WF, 'submit report');
  const reportId = sub.json.id;

  const detail = await request('GET', `/admin/reports/${reportId}/detail`, null, adminCookie);
  if (detail.status !== 200) { fail(WF, 'admin open report', detail.status); return; }
  ok(WF, 'admin opens report');

  const newEmail = `replaced-${Date.now()}@e2e.test`;
  const fix = await request('POST', `/admin/reports/${reportId}/action`, {
    action: 'fix_active',
    email: newEmail,
    password: 'newpass123',
    emailAccessEmail: newEmail,
    emailAccessPassword: 'newpass123',
    adminNotes: 'E2E replacement'
  }, adminCookie);
  if (fix.status !== 200) { fail(WF, 'admin replace', fix.json?.error); return; }
  ok(WF, 'admin replaces account');

  const access = db.prepare('SELECT email FROM email_access_credentials WHERE stock_item_id = ?').get(stockItemId);
  if (access?.email === newEmail) ok(WF, 'gmail/email access synced');
  else fail(WF, 'email access sync', access?.email);

  const notif = await request('GET', '/account/notifications', null, buyer.cookie);
  if (notif.status === 200) ok(WF, 'buyer notification');
  else fail(WF, 'buyer notification', notif.status);
}

async function workflowPlugging(adminCookie) {
  const WF = 'PLUGGING';
  console.log(`\n=== ${WF} ===`);
  const plan = db.prepare('SELECT id FROM plugging_plans WHERE is_enabled = 1 LIMIT 1').get();
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  if (!plan) { fail(WF, 'setup', 'no plan'); return; }

  const buyer = await registerBuyer('plug');
  const sub = await request('POST', '/api/plugging/subscribe', {
    planId: plan.id,
    name: 'E2E Plug',
    email: buyer.email
  });
  if (sub.status !== 201) { fail(WF, 'subscribe', sub.json?.error); return; }
  const orderRef = sub.json.orderRef;
  ok(WF, `plugging order ${orderRef}`);

  const pay = await request('POST', `/api/plugging/orders/${orderRef}/payment`, {
    paymentMethodId: pm.id,
    receiptImage: TINY_PNG
  });
  if (pay.status === 200) ok(WF, 'receipt uploaded');
  else fail(WF, 'receipt', pay.json?.error);

  const row = db.prepare('SELECT id FROM plugging_orders WHERE order_ref = ?').get(orderRef);
  if (!row) { fail(WF, 'admin approve', 'plugging order row missing'); return; }
  db.prepare(`
    INSERT INTO plugging_access_keys (plan_id, access_key, status)
    VALUES (?, ?, 'available')
  `).run(plan.id, `PLG-E2E-${Date.now().toString(36).toUpperCase()}-QA`);
  const approve = await request('PUT', `/admin/plugging/orders/${row.id}`, { status: 'approved' }, adminCookie);
  if (approve.status === 200 && approve.json.accessKey) ok(WF, `access key: ${approve.json.accessKey.slice(0, 8)}...`);
  else fail(WF, 'admin approve', approve.json?.error);
}

async function workflowWebsiteMaking() {
  const WF = 'WEBSITE';
  console.log(`\n=== ${WF} ===`);
  const list = await request('GET', '/api/website-making');
  if (list.status !== 200 || !list.json.packages?.length) { fail(WF, 'packages list', list.status); return; }
  ok(WF, `${list.json.packages.length} packages`);

  for (const pkg of list.json.packages.slice(0, 3)) {
    const det = await request('GET', `/api/website-making/packages/${pkg.slug}`);
    if (det.status !== 200) { fail(WF, `package ${pkg.slug}`, det.status); continue; }
    if (det.json.name && (det.json.description || det.json.longDescription)) {
      ok(WF, `package detail: ${pkg.slug}`);
    } else fail(WF, `package content ${pkg.slug}`, 'incomplete');
  }

  const pkg = list.json.packages[0];
  const buyerEmail = `web-${Date.now()}@e2e.test`;
  const inq = await request('POST', '/api/website-making/inquiry', {
    packageId: pkg.id,
    name: 'E2E Web Client',
    email: buyerEmail,
    message: 'E2E inquiry test'
  });
  if (inq.status !== 201 || !inq.json?.inquiryRef) { fail(WF, 'inquiry', inq.status); return; }
  ok(WF, `inquiry ${inq.json.inquiryRef}`);

  const thread = await request('GET', `/api/website-making/inquiry/${inq.json.inquiryRef}?email=${encodeURIComponent(buyerEmail)}`);
  if (thread.status === 200 && thread.json?.inquiry) ok(WF, 'inquiry thread accessible');
  else fail(WF, 'inquiry thread', thread.status);
}

async function main() {
  console.log(`E2E full test @ ${BASE}`);
  try {
    const ping = await request('GET', '/products');
    if (ping.status !== 200) throw new Error(`Server not reachable (${ping.status})`);
  } catch (e) {
    console.error('FATAL: Start server first. Example: PORT=3100 node server.js/server.js');
    process.exit(1);
  }

  const adminCookie = await loginAdmin();
  ok('SETUP', 'admin login');

  await workflowShop(adminCookie);
  const shopOrder = results.orders.find((o) => o.wf === 'SHOP');
  await workflowTingi(adminCookie);
  await workflowReport(adminCookie, shopOrder);
  await workflowPlugging(adminCookie);
  await workflowWebsiteMaking();

  console.log('\n========== E2E REPORT ==========');
  console.log(`Passed: ${results.passed.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`Orders created: ${results.orders.length}`);
  results.orders.forEach((o) => console.log(`  - ${o.wf} #${o.orderNumber}${o.qty ? ` qty=${o.qty}` : ''}`));
  if (results.failed.length) {
    console.log('\nFailures:');
    results.failed.forEach((f) => console.log(`  [${f.wf}] ${f.step}: ${f.err}`));
    process.exit(1);
  }
  console.log('\nAll E2E workflows passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
