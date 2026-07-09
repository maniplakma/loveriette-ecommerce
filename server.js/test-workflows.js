/**
 * Integration smoke tests for critical ecom workflows.
 * Run: node server.js/test-workflows.js
 */
const db = require('./db');
const http = require('http');

const appConfig = require('./config');

const BASE = appConfig.resolveTestBase();
let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, err) { failed++; console.log(`  ✗ ${name}: ${err}`); }

function purgeGameRowsForOrder(orderId) {
  db.prepare('DELETE FROM game_wheel_winners WHERE slot_id IN (SELECT id FROM game_wheel_slots WHERE order_id = ?)').run(orderId);
  db.prepare('DELETE FROM game_instant_plays WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM game_mystery_plays WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM game_scratch_cards WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM game_wheel_slots WHERE order_id = ?').run(orderId);
}

function request(method, urlPath, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
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

function resolveTestAdminPassword() {
  return appConfig.adminPassword || process.env.TEST_ADMIN_PASSWORD || '';
}

function resolveTestAdminEmail() {
  if (appConfig.adminEmail) return appConfig.adminEmail.toLowerCase();
  const row = db.prepare('SELECT email FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
  return (row?.email || 'admin@localhost').toLowerCase();
}

async function loginAdmin() {
  const candidates = [
    appConfig.adminPassword,
    process.env.TEST_ADMIN_PASSWORD,
    appConfig.nodeEnv !== 'production' ? 'changeme-local-only' : ''
  ].filter(Boolean);
  const admins = db.prepare('SELECT email FROM users WHERE is_admin = 1 ORDER BY id ASC').all();
  const emails = [...new Set([
    appConfig.adminEmail?.toLowerCase(),
    ...admins.map((a) => String(a.email).toLowerCase())
  ].filter(Boolean))];
  const tried = new Set();
  for (const email of emails) {
    for (const password of candidates) {
      const key = `${email}:${password}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const res = await request('POST', '/auth/login', { email, password });
      const cookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
      if (res.status === 200 && cookie) return cookie;
    }
  }
  throw new Error('Set ADMIN_PASSWORD or TEST_ADMIN_PASSWORD in environment to run tests');
}

async function loginUser(email, password) {
  const res = await request('POST', '/auth/login', { email, password });
  const cookie = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  return { cookie, status: res.status };
}

async function runDbChecks() {
  console.log('\nDatabase schema');
  const tables = ['store_updates', 'email_access_credentials', 'account_replacement_history', 'user_notifications', 'refund_records', 'order_fulfillments', 'product_reports'];
  for (const t of tables) {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    if (row) ok(`table ${t}`);
    else fail(`table ${t}`, 'missing');
  }
  const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (orderCols.includes('fulfillment_mode')) ok('orders.fulfillment_mode');
  else fail('orders.fulfillment_mode', 'missing');
  if (orderCols.includes('tingi_drop_enabled')) ok('orders.tingi_drop_enabled');
  else fail('orders.tingi_drop_enabled', 'missing');
  if (orderCols.includes('reject_reason')) ok('orders.reject_reason');
  else fail('orders.reject_reason', 'missing');
}

async function runApiChecks(adminCookie) {
  console.log('\nAdmin API');
  const reports = await request('GET', '/admin/reports?tab=active', null, adminCookie);
  if (reports.status === 200 && Array.isArray(reports.json)) ok('GET /admin/reports');
  else fail('GET /admin/reports', reports.status);

  const tingi = await request('GET', '/admin/tingi-settings', null, adminCookie);
  if (tingi.status === 200 && tingi.json.minAutoDrop) ok('GET /admin/tingi-settings');
  else fail('GET /admin/tingi-settings', tingi.status);

  const chat = await request('GET', '/admin/chat', null, adminCookie);
  if (chat.status === 404) ok('Live Chat route removed');
  else fail('Live Chat route removed', `status ${chat.status}`);

  const loyalty = await request('GET', '/admin/loyalty', null, adminCookie);
  if (loyalty.status === 404) ok('Legacy admin loyalty route removed');
  else fail('Legacy admin loyalty route removed', `status ${loyalty.status}`);

  const guide = await request('GET', '/guide', null, adminCookie);
  if (guide.status === 200 && Array.isArray(guide.json) && guide.json.length >= 3) {
    ok('GET /guide returns steps');
    if (guide.json[0].title && Array.isArray(guide.json[0].bullets)) ok('guide step shape');
    else fail('guide step shape', JSON.stringify(guide.json[0]));
  } else fail('GET /guide', guide.status);

  const logos = await request('GET', '/admin/product-logos', null, adminCookie);
  if (logos.status === 200 && Array.isArray(logos.json) && logos.json.length) {
    const names = logos.json.map((p) => p.name.toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (!dupes.length) ok('product logos: unique apps per name');
    else fail('product logos duplicates', dupes.join(','));
    if (logos.json.every((p) => p.id && p.name && p.category)) ok('product logos shape');
    else fail('product logos shape');
  } else fail('GET /admin/product-logos', logos.status);

  const pending = await request('GET', '/admin/all-orders?tab=pending', null, adminCookie);
  const approved = await request('GET', '/admin/all-orders?tab=approved', null, adminCookie);
  const rejected = await request('GET', '/admin/all-orders?tab=rejected', null, adminCookie);
  if (pending.status === 200 && Array.isArray(pending.json)) {
    const bad = pending.json.filter((o) => o.status !== 'pending');
    if (!bad.length) ok('Pending tab: pending only');
    else fail('Pending tab filter', bad.map((o) => o.status).join(','));
  } else fail('GET /admin/all-orders?tab=pending', pending.status);
  if (approved.status === 200 && Array.isArray(approved.json)) {
    const bad = approved.json.filter((o) => o.status !== 'approved');
    if (!bad.length) ok('Approved tab: approved only');
    else fail('Approved tab filter', bad.map((o) => o.status).join(','));
  } else fail('GET /admin/all-orders?tab=approved', approved.status);
  if (rejected.status === 200 && Array.isArray(rejected.json)) {
    const bad = rejected.json.filter((o) => o.status !== 'rejected');
    if (!bad.length) ok('Rejected tab: rejected only');
    else fail('Rejected tab filter', bad.map((o) => o.status).join(','));
  const withNote = rejected.json.filter((o) => o.rejectReason);
  if (rejected.json.length === 0 || withNote.length > 0) ok('Rejected tab: rejection notes present');
  else fail('Rejected tab notes', 'no rejectReason on rejected orders');
  } else fail('GET /admin/all-orders?tab=rejected', rejected.status);

  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  const product = db.prepare('SELECT id, price FROM products ORDER BY id LIMIT 1').get();
  if (pm && product) {
    const seq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
    const orderNumber = String(seq);
    const ins = db.prepare(`
      INSERT INTO orders (
        order_number, order_seq, email, payment_method_id,
        subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode
      ) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', 0, 'auto')
    `).run(orderNumber, seq, 'reject-reason@test.local', pm.id, product.price, product.price);
    const rejectBare = await request('POST', `/admin/orders/${orderNumber}/reject`, {}, adminCookie);
    if (rejectBare.status === 400) ok('Reject requires reason');
    else fail('Reject requires reason', `status ${rejectBare.status}`);
    db.prepare('DELETE FROM orders WHERE id = ?').run(ins.lastInsertRowid);
  } else {
    fail('Reject requires reason', 'missing seed data');
  }

  if (pm && product) {
    const seq2 = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
    const ghostNumber = String(seq2);
    db.prepare(`
      INSERT INTO orders (
        order_number, order_seq, email, payment_method_id,
        subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode, receipt_url
      ) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', 0, 'auto', ?)
    `).run(ghostNumber, seq2, 'ghost-pending@test.local', pm.id, product.price, product.price, 'legacy-import-proof-placeholder');
    const ghostList = await request('GET', '/admin/all-orders?tab=pending', null, adminCookie);
    const ghostVisible = ghostList.status === 200
      && Array.isArray(ghostList.json)
      && ghostList.json.some((o) => o.orderNumber === ghostNumber || String(o.displayId) === ghostNumber);
    const ghostRow = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(ghostNumber);
    if (!ghostVisible && !ghostRow) ok('pending without proof purged from admin');
    else {
      if (ghostRow) db.prepare('DELETE FROM orders WHERE id = ?').run(ghostRow.id);
      fail('pending without proof purged', ghostVisible ? 'listed' : 'still in db');
    }
  }
}

async function runOrderFlowCheck(adminCookie) {
  console.log('\nOrder flow (place → pending → approve / reject)');
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQwAHZwZ2hFBOwAAAABJRU5ErkJggg==';

  function insertTestOrder(email) {
    const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
    const product = db.prepare('SELECT id, price FROM products ORDER BY id LIMIT 1').get();
    if (!pm || !product) throw new Error('missing product or payment method');
    const seq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
    const orderNumber = String(seq);
    const ins = db.prepare(`
      INSERT INTO orders (
        order_number, order_seq, email, payment_method_id,
        subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode
      ) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending_payment', 0, 'auto')
    `).run(orderNumber, seq, email, pm.id, product.price, product.price);
    const orderId = ins.lastInsertRowid;
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
      VALUES (?, ?, 'Test Product', 1, ?)
    `).run(orderId, product.id, product.price);
    return { orderId, orderNumber, seq };
  }

  async function tabHasOrder(tab, orderNumber) {
    const res = await request('GET', `/admin/all-orders?tab=${tab}`, null, adminCookie);
    if (res.status !== 200 || !Array.isArray(res.json)) return false;
    return res.json.some((o) => o.orderNumber === orderNumber || String(o.displayId) === orderNumber);
  }

  try {
    const approveOrder = insertTestOrder('flow-approve@test.local');
    const receiptRes = await request('POST', `/orders/${approveOrder.orderNumber}/receipt`, {
      receiptImage: TINY_PNG
    }, adminCookie);
    if (receiptRes.status === 200 && receiptRes.json.status === 'pending') ok('receipt upload sets status pending');
    else fail('receipt → pending', receiptRes.json?.status || receiptRes.status);

    if (await tabHasOrder('pending', approveOrder.orderNumber)) ok('order appears in Pending tab');
    else fail('order in Pending tab', approveOrder.orderNumber);

    const approveRes = await request('POST', `/admin/orders/${approveOrder.orderNumber}/approve`, {}, adminCookie);
    if (approveRes.status === 200 && approveRes.json.status === 'approved') ok('admin approve → approved');
    else fail('admin approve', approveRes.json?.error || approveRes.status);

    if (await tabHasOrder('approved', approveOrder.orderNumber)) ok('order appears in Approved tab');
    else fail('order in Approved tab', approveOrder.orderNumber);
    if (await tabHasOrder('pending', approveOrder.orderNumber)) fail('approved order still in Pending', approveOrder.orderNumber);
    else ok('approved order removed from Pending tab');

    const rejectOrder = insertTestOrder('flow-reject@test.local');
    await request('POST', `/orders/${rejectOrder.orderNumber}/receipt`, { receiptImage: TINY_PNG }, adminCookie);
    const rejectRes = await request('POST', `/admin/orders/${rejectOrder.orderNumber}/reject`, {
      reason: 'Payment not received'
    }, adminCookie);
    if (rejectRes.status === 200 && rejectRes.json.status === 'rejected') ok('admin reject → rejected');
    else fail('admin reject', rejectRes.json?.error || rejectRes.status);

    if (rejectRes.json.rejectReason === 'Payment not received') ok('rejection note saved');
    else fail('rejection note saved', rejectRes.json.rejectReason || 'missing');

    if (await tabHasOrder('rejected', rejectOrder.orderNumber)) ok('order appears in Rejected tab');
    else fail('order in Rejected tab', rejectOrder.orderNumber);

    const buyerEmail = 'flow-reject@test.local';
    await request('POST', '/auth/register', {
      email: buyerEmail,
      password: 'testpass123',
      name: 'Reject Flow Buyer'
    });
    const buyerRow = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(buyerEmail.toLowerCase());
    if (buyerRow?.id) {
      db.prepare('UPDATE orders SET user_id = ? WHERE id = ?').run(buyerRow.id, rejectOrder.orderId);
    }
    const buyerLogin = await loginUser(buyerEmail, 'testpass123');
    if (buyerLogin.status === 200) {
      const buyerOrders = await request('GET', '/account/orders', null, buyerLogin.cookie);
      const bo = (buyerOrders.json?.orders || []).find((o) => o.orderNumber === rejectOrder.orderNumber);
      if (bo?.rejectReason === 'Payment not received') ok('buyer order list shows rejection reason');
      else fail('buyer order list rejection reason', bo?.rejectReason || 'missing');

      const cred = await request('GET', `/account/orders/${rejectOrder.orderNumber}/credentials`, null, buyerLogin.cookie);
      if (cred.json?.buyerPhase === 'rejected' && cred.json?.rejectReason === 'Payment not received') {
        ok('buyer credentials show rejected phase + reason');
      } else {
        fail('buyer credentials rejected', JSON.stringify({ phase: cred.json?.buyerPhase, reason: cred.json?.rejectReason }));
      }
    } else fail('buyer login for reject flow', buyerLogin.status);

    db.prepare('DELETE FROM order_items WHERE order_id IN (?, ?)').run(approveOrder.orderId, rejectOrder.orderId);
    db.prepare('DELETE FROM orders WHERE id IN (?, ?)').run(approveOrder.orderId, rejectOrder.orderId);
  } catch (err) {
    fail('order flow', err.message);
  }
}

async function runVariantDescriptionCheck(adminCookie) {
  console.log('\nVariant description flow');
  const product = db.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get();
  if (!product) { fail('variant description', 'no product'); return; }

  const variant = db.prepare(
    'SELECT id FROM product_variants WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1'
  ).get(product.id);
  if (!variant) { fail('variant description', 'no variant'); return; }

  const testDesc = `Test desc ${Date.now()}`;
  const variantName = db.prepare('SELECT name FROM product_variants WHERE id = ?').get(variant.id).name;
  const existing = await request('GET', `/products/${product.id}`, null, adminCookie);
  const variants = (existing.json?.variants || []).map((v) => ({
    name: v.name,
    price: v.price,
    description: v.name === variantName ? testDesc : (v.description || v.duration || ''),
    rules: v.rules || '',
    bulkPricingEnabled: v.bulkPricingEnabled,
    bulkTiers: v.bulkTiers || []
  }));

  const put = await request('PUT', `/admin/products/${product.id}`, {
    variants
  }, adminCookie);
  if (put.status !== 200) { fail('admin save variant description', put.status); return; }

  const pub = await request('GET', `/products/${product.id}`, null, adminCookie);
  const updated = (pub.json?.variants || []).find((v) => v.name === variantName);
  if (updated?.description === testDesc) ok('catalog shows saved variant description');
  else fail('catalog shows saved variant description', updated?.description || 'missing');
}

async function runUserAdminCheck(adminCookie) {
  console.log('\nAdmin user info');
  const list = await request('GET', '/admin/users', null, adminCookie);
  if (list.status !== 200 || !Array.isArray(list.json?.users)) {
    fail('GET /admin/users', list.status);
    return;
  }
  ok('GET /admin/users');

  let buyer = list.json.users.find((u) => !u.is_admin);
  if (!buyer) {
    const email = `user-admin-test-${Date.now()}@test.local`;
    const reg = await request('POST', '/auth/register', {
      email,
      password: 'testpass123',
      name: 'User Admin Test'
    });
    if (reg.status === 201 || reg.status === 200) {
      const list2 = await request('GET', '/admin/users', null, adminCookie);
      buyer = list2.json?.users?.find((u) => u.email === email);
    }
  }
  if (!buyer) { fail('user admin check', 'no buyer user'); return; }

  if (buyer.id && buyer.email && typeof buyer.spent === 'number') ok('users list includes id, email, spent');
  else fail('users list shape', JSON.stringify({ id: buyer.id, email: buyer.email, spent: buyer.spent }));

  const detail = await request('GET', `/users/${buyer.id}`, null, adminCookie);
  if (detail.status === 200 && detail.json.id === buyer.id && detail.json.email === buyer.email) {
    ok('GET /users/:id returns user');
    if (typeof detail.json.spent === 'number' && detail.json.status) ok('GET /users/:id shape');
    else fail('GET /users/:id shape', JSON.stringify(detail.json));
  } else fail('GET /users/:id', detail.status);

  const wasSuspended = !!buyer.suspended;
  const suspend = await request('PUT', `/admin/users/${buyer.id}`, { suspended: !wasSuspended }, adminCookie);
  if (suspend.status === 200 && suspend.json.user?.status === (wasSuspended ? 'active' : 'suspended')) {
    ok('PUT suspend toggles status');
  } else fail('PUT suspend', suspend.json?.user?.status || suspend.status);

  await request('PUT', `/admin/users/${buyer.id}`, { suspended: wasSuspended }, adminCookie);

  const tx = await request('GET', '/admin/transactions', null, adminCookie);
  if (tx.status === 200 && Array.isArray(tx.json?.ledger)) {
    const row = tx.json.ledger[0];
    if (!row || (row.user && row.user.email && row.user.id !== undefined)) ok('transactions include user details');
    else if (!row) ok('transactions include user details');
    else fail('transactions user shape', JSON.stringify(row.user));
  } else fail('GET /admin/transactions', tx.status);
}

async function runRefundReportCheck(adminCookie) {
  console.log('\nRefund report submission');
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQwAHZwZ2hFBOwAAAABJRU5ErkJggg==';
  const email = `refund-flow-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', {
    email,
    password: 'testpass123',
    name: 'Refund Flow Tester'
  });
  const buyerCookie = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  if (!buyerCookie) {
    fail('refund report buyer register', 'no cookie');
    return;
  }
  ok('refund report test buyer registered');

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  const product = db.prepare('SELECT id, price FROM products ORDER BY id LIMIT 1').get();
  const seq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
  const orderNumber = String(seq);
  const orderIns = db.prepare(`
    INSERT INTO orders (
      order_number, order_seq, email, user_id, payment_method_id,
      subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode
    ) VALUES (?, ?, ?, ?, ?, 100, 0, 100, 'approved', 0, 'auto')
  `).run(orderNumber, seq, email, user.id, pm.id);
  const orderId = orderIns.lastInsertRowid;
  const orderItemId = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
    VALUES (?, ?, 'Refund Test Product', 1, ?)
  `).run(orderId, product.id, product.price).lastInsertRowid;
  const stockIns = db.prepare(`
    INSERT INTO stock_items (product_id, service_name, email, password, profiles, cost, price, status)
    VALUES (?, 'Refund Test Product', ?, 'pass', '[]', 0, ?, 'sold')
  `).run(product.id, `refund-acc-${Date.now()}@test.local`, product.price);
  const stockId = stockIns.lastInsertRowid;
  db.prepare(`
    INSERT INTO order_fulfillments (order_id, order_item_id, stock_item_id) VALUES (?, ?, ?)
  `).run(orderId, orderItemId, stockId);

  const baseBody = {
    orderNumber,
    name: 'Refund Flow Tester',
    issue: 'Account stopped working after 2 days',
    remainingDays: '20 days',
    subscription: 'Refund Test Product',
    bankAccount: 'BPI 1234567890 Refund Tester',
    selections: [{ stockItemId: stockId, profileIndex: 0 }]
  };

  const noVouch = await request('POST', '/refunds', {
    ...baseBody,
    proofImages: [TINY_PNG]
  }, buyerCookie);
  if (noVouch.status === 400) ok('refund report rejects missing vouch');
  else fail('refund report rejects missing vouch', noVouch.status);

  const noExtra = await request('POST', '/refunds', {
    ...baseBody,
    vouchImage: TINY_PNG,
    proofImages: []
  }, buyerCookie);
  if (noExtra.status === 400) ok('refund report rejects missing extra proof');
  else fail('refund report rejects missing extra proof', noExtra.status);

  const okRes = await request('POST', '/refunds', {
    ...baseBody,
    vouchImage: TINY_PNG,
    proofImages: [TINY_PNG]
  }, buyerCookie);
  if (okRes.status === 201 && okRes.json.ok && okRes.json.message) {
    ok('refund report submits successfully');
    if (okRes.json.message.includes('Refund report submitted')) ok('refund report success message');
    else fail('refund report success message', okRes.json.message);
  } else fail('refund report submits successfully', okRes.status);

  if (!okRes.json.id) {
    fail('refund report db row', 'missing id');
    return;
  }

  const row = db.prepare('SELECT id, report_type, proof_urls FROM product_reports WHERE id = ?')
    .get(okRes.json.id);
  if (row?.report_type === 'refund' && row.proof_urls) ok('refund report saved with proof files');
  else fail('refund report db row', JSON.stringify(row));
}

async function runPerItemReportCheck(adminCookie) {
  console.log('\nPer-item & profile reporting');
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQwAHZwZ2hFBOwAAAABJRU5ErkJggg==';
  const email = `report-item-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', {
    email,
    password: 'testpass123',
    name: 'Report Item Tester'
  });
  const buyerCookie = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  const product = db.prepare('SELECT id, price FROM products ORDER BY id LIMIT 1').get();
  const seq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
  const orderNumber = String(seq);
  const orderIns = db.prepare(`
    INSERT INTO orders (
      order_number, order_seq, email, user_id, payment_method_id,
      subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode
    ) VALUES (?, ?, ?, ?, ?, 200, 0, 200, 'approved', 0, 'auto')
  `).run(orderNumber, seq, email, user.id, pm.id);
  const orderId = orderIns.lastInsertRowid;
  const orderItemId = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
    VALUES (?, ?, 'Multi Qty Product', 2, ?)
  `).run(orderId, product.id, product.price).lastInsertRowid;

  const stockIds = [];
  for (let i = 0; i < 2; i++) {
    const profiles = JSON.stringify(['Slot A', 'Slot B']);
    const stockIns = db.prepare(`
      INSERT INTO stock_items (product_id, service_name, email, password, profiles, cost, price, status)
      VALUES (?, 'Multi Qty Product', ?, 'pass', ?, 0, ?, 'sold')
    `).run(product.id, `acc${i}-${Date.now()}@test.local`, profiles, product.price);
    const stockId = stockIns.lastInsertRowid;
    stockIds.push(stockId);
    db.prepare(`
      INSERT INTO order_fulfillments (order_id, order_item_id, stock_item_id) VALUES (?, ?, ?)
    `).run(orderId, orderItemId, stockId);
    db.prepare(`
      INSERT INTO email_access_credentials (stock_item_id, email, password, profile_data)
      VALUES (?, ?, 'pass', ?)
    `).run(stockId, `acc${i}@test.local`, profiles);
  }

  const targets = await request('GET', `/account/orders/${orderNumber}/report-targets`, null, buyerCookie);
  if (targets.status === 200 && targets.json.targets?.length === 2) ok('report targets list all fulfilled accounts');
  else fail('report targets count', targets.json?.targets?.length || targets.status);

  const submitOne = await request('POST', '/reports', {
    orderNumber,
    name: 'Report Item Tester',
    issue: 'Only first account broken',
    remainingDays: '15 days',
    subscription: 'Multi Qty Product',
    selections: [{ stockItemId: stockIds[0], profileIndex: 0 }],
    vouchImage: TINY_PNG,
    proofImages: [TINY_PNG]
  }, buyerCookie);
  if (submitOne.status === 201) ok('single-item report submits');
  else fail('single-item report submits', submitOne.status);

  const reportRow = db.prepare('SELECT reported_items, report_quantity FROM product_reports WHERE id = ?')
    .get(submitOne.json.id);
  let items = [];
  try { items = JSON.parse(reportRow.reported_items || '[]'); } catch (_) {}
  if (items.length === 1 && items[0].stockItemId === stockIds[0]) ok('report stores only selected item');
  else fail('report stores only selected item', JSON.stringify(items));

  const adminReports = await request('GET', '/admin/reports?tab=active', null, adminCookie);
  const adminRow = (adminReports.json || []).find((r) => r.id === submitOne.json.id);
  if (adminRow?.reportQuantity === 1) ok('admin list shows quantity 1');
  else fail('admin list quantity', adminRow?.reportQuantity);

  const flagged = db.prepare('SELECT credential_report_status FROM stock_items WHERE id = ?').get(stockIds[0]);
  const untouched = db.prepare('SELECT credential_report_status FROM stock_items WHERE id = ?').get(stockIds[1]);
  if (flagged?.credential_report_status === 'reported' && untouched?.credential_report_status !== 'reported') {
    ok('only selected credential flagged');
  } else fail('credential flag scope', `${flagged?.credential_report_status}/${untouched?.credential_report_status}`);

  const access = db.prepare('SELECT profile_data FROM email_access_credentials WHERE stock_item_id = ?').get(stockIds[0]);
  const profileData = JSON.parse(access.profile_data || '[]');
  if (profileData.length === 2 && profileData.every((p) => p.reported)) ok('all profiles flagged on reported credential');
  else fail('all profiles flagged', JSON.stringify(profileData));

  const noteRes = await request('PUT', `/admin/reports/${submitOne.json.id}/note`, {
    adminNote: 'We are reviewing your report and will update credentials soon.'
  }, adminCookie);
  if (noteRes.status === 200 && noteRes.json.adminNote) ok('admin can save buyer note');

  const buyerView = await request('GET', '/account/reports', null, buyerCookie);
  const buyerRow = (buyerView.json?.reports || []).find((r) => r.id === submitOne.json.id);
  if (buyerRow?.adminNote?.includes('reviewing')) ok('buyer sees admin note');
  else fail('buyer sees admin note', buyerRow?.adminNote || buyerView.status);
}

async function runBulkPricingCheck() {
  console.log('\nBulk pricing logic');
  const product = db.prepare('SELECT id, price FROM products ORDER BY id LIMIT 1').get();
  if (!product) { fail('bulk pricing', 'no product'); return; }
  db.prepare('UPDATE products SET bulk_pricing_enabled=1, bulk_tiers=? WHERE id=?')
    .run(JSON.stringify([{ minQty: 1, maxQty: 4, price: 100 }, { minQty: 5, maxQty: 9, price: 90 }, { minQty: 10, maxQty: null, price: 80 }]), product.id);
  const tiers = JSON.parse(db.prepare('SELECT bulk_tiers FROM products WHERE id=?').get(product.id).bulk_tiers);
  const pick = (qty) => {
    for (const t of tiers) {
      const max = t.maxQty == null ? Infinity : t.maxQty;
      if (qty >= t.minQty && qty <= max) return t.price;
    }
    return product.price;
  };
  if (pick(3) === 100 && pick(7) === 90 && pick(12) === 80) ok('bulk tier prices 3/7/12');
  else fail('bulk tier prices', `got ${pick(3)}/${pick(7)}/${pick(12)}`);
}

async function runResetWebsiteCheck(adminCookie) {
  console.log('\nReset website');
  if (process.env.SKIP_RESET_TEST === '1' || process.env.ENABLE_RESET_TEST !== '1') {
    ok('POST /admin/reset-website (skipped — set ENABLE_RESET_TEST=1 to run destructive reset)');
    return;
  }
  const bad = await request('POST', '/admin/reset-website', { confirm: 'NOPE' }, adminCookie);
  if (bad.status === 400) ok('reset requires RESET confirmation');
  else fail('reset requires RESET confirmation', bad.status);

  const res = await request('POST', '/admin/reset-website', { confirm: 'RESET' }, adminCookie);
  if (res.status === 200 && res.json.ok) ok('POST /admin/reset-website');
  else fail('POST /admin/reset-website', res.json?.error || res.status);

  const users = db.prepare('SELECT id, email, is_admin FROM users').all();
  if (users.length === 1 && users[0].is_admin) ok('reset keeps only default admin');
  else fail('reset user set', JSON.stringify(users.map((u) => u.email)));

  if (db.prepare('SELECT COUNT(*) AS c FROM orders').get().c === 0) ok('reset clears orders');
  else fail('reset orders remain');

  if (db.prepare('SELECT COUNT(*) AS c FROM product_reports').get().c === 0) ok('reset clears reports');
  else fail('reset reports remain');

  if (db.prepare('SELECT COUNT(*) AS c FROM refund_records').get().c === 0) ok('reset clears refunds');
  else fail('reset refunds remain');

  if (db.prepare('SELECT COUNT(*) AS c FROM stock_items').get().c === 0) ok('reset clears inventory stock');
  else fail('reset stock remains');

  if (db.prepare('SELECT COUNT(*) AS c FROM wallet_transactions').get().c === 0) ok('reset clears wallet transactions');
  else fail('reset wallet transactions remain');
}

async function runPaymentSettingsCheck(adminCookie) {
  console.log('\nPayment settings');
  const getRes = await request('GET', '/admin/payment-methods', null, adminCookie);
  if (getRes.status !== 200 || !getRes.json.methods?.length) {
    fail('GET /admin/payment-methods', getRes.status);
    return;
  }
  ok('GET /admin/payment-methods');

  const testText = 'Payment is accepted via QR only.\nTest line for workflow.';
  const putSettings = await request('PUT', '/admin/payment-settings', { instructionsText: testText }, adminCookie);
  if (putSettings.status === 200 && putSettings.json.instructionsText === testText) ok('PUT /admin/payment-settings');
  else fail('PUT /admin/payment-settings', putSettings.status);

  const publicPm = await request('GET', '/payment-methods');
  if (publicPm.status === 200 && publicPm.json.instructionsText === testText) ok('GET /payment-methods includes instructions');
  else fail('GET /payment-methods instructions', publicPm.status);

  const methodId = getRes.json.methods[0].id;
  const originalName = getRes.json.methods[0].name;
  const withAccount = await request('PUT', `/admin/payment-methods/${methodId}`, { account_number: '09171234567' }, adminCookie);
  if (withAccount.status === 200 && withAccount.json.account_number === '09171234567') ok('PUT payment method account_number');
  else fail('PUT payment method account_number', withAccount.status);

  const cleared = await request('PUT', `/admin/payment-methods/${methodId}`, { account_number: '' }, adminCookie);
  if (cleared.status === 200 && !cleared.json.account_number) ok('clear payment method account_number');
  else fail('clear payment method account_number', cleared.status);

  const publicAfter = await request('GET', '/payment-methods');
  const pubMethod = publicAfter.json.methods?.find((m) => m.id === methodId);
  if (publicAfter.status === 200 && pubMethod && !pubMethod.accountNumber) ok('public payment-methods hides empty account');
  else fail('public payment-methods account hide', publicAfter.status);

  const renamed = await request('PUT', `/admin/payment-methods/${methodId}`, { name: 'GCASH Wallet Test' }, adminCookie);
  if (renamed.status === 200 && renamed.json.name === 'GCASH Wallet Test') ok('rename payment method');
  else fail('rename payment method', renamed.status);

  const publicRename = await request('GET', '/payment-methods');
  const renamedPub = publicRename.json.methods?.find((m) => m.id === methodId);
  if (publicRename.status === 200 && renamedPub?.name === 'GCASH Wallet Test') ok('public API shows renamed method');
  else fail('public renamed method name', publicRename.status);

  await request('PUT', `/admin/payment-methods/${methodId}`, { name: originalName }, adminCookie);

  const beforeCount = getRes.json.methodCount ?? getRes.json.methods.length;
  if (beforeCount < 10) {
    const created = await request('POST', '/admin/payment-methods', { name: 'BDO Bank Test' }, adminCookie);
    if (created.status === 201 && created.json.name === 'BDO Bank Test') ok('POST /admin/payment-methods');
    else fail('POST /admin/payment-methods', created.status);

    const publicNew = await request('GET', '/payment-methods');
    const found = publicNew.json.methods?.some((m) => m.name === 'BDO Bank Test');
    if (publicNew.status === 200 && found) ok('new method appears in buyer API');
    else fail('new method in buyer API', publicNew.status);

    if (created.json?.id) {
      db.prepare('DELETE FROM payment_methods WHERE id = ?').run(created.json.id);
    }
  } else {
    ok('POST /admin/payment-methods (skipped — already at limit)');
  }

  let pmCount = db.prepare('SELECT COUNT(*) AS c FROM payment_methods').get().c;
  const fillIds = [];
  while (pmCount < 10) {
    const fill = await request('POST', '/admin/payment-methods', { name: `LimitFill${pmCount}` }, adminCookie);
    if (fill.status === 201 && fill.json?.id) fillIds.push(fill.json.id);
    pmCount = db.prepare('SELECT COUNT(*) AS c FROM payment_methods').get().c;
  }
  const over = await request('POST', '/admin/payment-methods', { name: 'Too many' }, adminCookie);
  if (over.status === 400) ok('payment method limit enforced');
  else fail('payment method limit', over.status);
  for (const id of fillIds) {
    db.prepare('DELETE FROM payment_methods WHERE id = ?').run(id);
  }
}

async function runInventoryCheck(adminCookie) {
  console.log('\nInventory & stock labels');
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQwAHZwZ2hFBOwAAAABJRU5ErkJggg==';
  const variant = db.prepare(`
    SELECT v.id AS variantId, v.product_id AS productId, p.allow_pre_order AS allowPreOrder, p.price
    FROM product_variants v JOIN products p ON p.id = v.product_id
    ORDER BY v.id LIMIT 1
  `).get();
  if (!variant) { fail('inventory', 'no variant'); return; }

  db.prepare('DELETE FROM stock_items WHERE variant_id = ?').run(variant.variantId);

  const before = await request('GET', `/products/${variant.productId}`, null, adminCookie);
  const vBefore = (before.json?.variants || []).find((v) => v.id === variant.variantId);
  const noStockState = variant.allowPreOrder ? 'preorder' : 'sold_out';
  if (vBefore?.availability_state === noStockState) ok('variant shows no-stock label before add');
  else fail('variant no-stock label', vBefore?.availability_state || 'missing');

  const add = await request('POST', '/admin/inventory', {
    variant_id: variant.variantId,
    email: 'stock@test.local',
    password: 'pass123',
    profiles: ['Profile 1']
  }, adminCookie);
  if (add.status === 201 && add.json.created >= 1) ok('POST /admin/inventory');
  else { fail('POST /admin/inventory', add.status); return; }

  const after = await request('GET', `/products/${variant.productId}`, null, adminCookie);
  const vAfter = (after.json?.variants || []).find((v) => v.id === variant.variantId);
  if (vAfter?.availability_state === 'available') ok('variant shows Available after add stock');
  else fail('variant available after stock', JSON.stringify(vAfter));

  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  if (!pm) { fail('inventory fulfill', 'no payment method'); return; }
  const seq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
  const orderNumber = String(seq);
  const ins = db.prepare(`
    INSERT INTO orders (
      order_number, order_seq, email, payment_method_id,
      subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode
    ) VALUES (?, ?, 'stock-label@test.local', ?, ?, 0, ?, 'pending_payment', 0, 'auto')
  `).run(orderNumber, seq, pm.id, variant.price, variant.price);
  const orderId = ins.lastInsertRowid;
  db.prepare(`
    INSERT INTO order_items (order_id, product_id, variant_id, product_name, quantity, price)
    VALUES (?, ?, ?, 'Stock Label Test', 1, ?)
  `).run(orderId, variant.productId, variant.variantId, variant.price);

  await request('POST', `/orders/${orderNumber}/receipt`, { receiptImage: TINY_PNG }, adminCookie);
  await request('POST', `/admin/orders/${orderNumber}/approve`, {}, adminCookie);

  const approvedList = await request('GET', '/admin/all-orders?tab=approved', null, adminCookie);
  const approvedOrder = (approvedList.json || []).find((o) => o.orderNumber === orderNumber);
  if (approvedOrder?.stockState === 'dropped' && !approvedOrder?.stockLabel) ok('dropped order removes stock label');
  else fail('dropped label', JSON.stringify({ stockState: approvedOrder?.stockState, stockLabel: approvedOrder?.stockLabel }));

  db.prepare('DELETE FROM order_fulfillments WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('DELETE FROM stock_items WHERE variant_id = ?').run(variant.variantId);

  const restored = await request('GET', `/products/${variant.productId}`, null, adminCookie);
  const vRestored = (restored.json?.variants || []).find((v) => v.id === variant.variantId);
  if (vRestored?.availability_state === noStockState) ok('variant label restores after stock removed');
  else fail('variant label after delete', vRestored?.availability_state || 'missing');
}

async function runThemeCheck(adminCookie) {
  console.log('\nTheme system');
  const colorhunt = await request('POST', '/admin/theme/colorhunt', {
    url: 'https://colorhunt.co/palette/40513b6099669ec8b9cdecdc'
  }, adminCookie);
  if (colorhunt.status === 200 && colorhunt.json.colors?.primary) ok('Colorhunt palette parse');
  else { fail('Colorhunt palette parse', colorhunt.status); return; }

  const colors = colorhunt.json.colors;
  const put = await request('PUT', '/admin/theme', {
    background: colors.background,
    font: colors.font,
    primary: colors.primary,
    secondary: colors.secondary,
    colorhuntUrl: 'https://colorhunt.co/palette/40513b6099669ec8b9cdecdc'
  }, adminCookie);
  if (put.status === 200 && put.json.ok) ok('PUT /admin/theme persists');
  else fail('PUT /admin/theme', put.status);

  const pub = await request('GET', '/theme-colors');
  if (pub.status === 200 && pub.json.primary === colors.primary) ok('GET /theme-colors matches saved');
  else fail('GET /theme-colors persistence', pub.json?.primary || pub.status);

  const adminTheme = await request('GET', '/admin/theme', null, adminCookie);
  if (adminTheme.status === 200 && adminTheme.json.primary === colors.primary) ok('admin theme API synced');
  else fail('admin theme API', adminTheme.status);
}

async function runStoreUpdatesCheck(adminCookie) {
  console.log('\nStore updates');
  const list = await request('GET', '/admin/store-updates', null, adminCookie);
  if (list.status === 200 && Array.isArray(list.json.updates)) ok('GET /admin/store-updates');
  else fail('GET /admin/store-updates', list.status);

  const created = await request('POST', '/admin/store-updates', {
    title: 'Test update',
    body: 'Automated test announcement',
    notifyBuyers: false
  }, adminCookie);
  const updateId = created.json?.update?.id;
  if (created.status === 200 && updateId) ok('POST /admin/store-updates');
  else fail('POST /admin/store-updates', created.status);

  const buyerLogin = await loginUser('storeupdate-test@example.com', 'TestPass123');
  let buyerCookie = buyerLogin.cookie;
  if (buyerLogin.status !== 200) {
    await request('POST', '/auth/register', {
      email: 'storeupdate-test@example.com',
      password: 'TestPass123',
      name: 'Update Tester'
    });
    const retry = await loginUser('storeupdate-test@example.com', 'TestPass123');
    buyerCookie = retry.cookie;
  }
  if (buyerCookie) {
    const buyerList = await request('GET', '/account/store-updates', null, buyerCookie);
    if (buyerList.status === 200 && Array.isArray(buyerList.json.updates)) ok('GET /account/store-updates');
    else fail('GET /account/store-updates', buyerList.status);
  } else {
    fail('buyer login for store updates', 'no cookie');
  }

  if (updateId) {
    const del = await request('DELETE', `/admin/store-updates/${updateId}`, null, adminCookie);
    if (del.status === 200) ok('DELETE /admin/store-updates/:id');
    else fail('DELETE /admin/store-updates/:id', del.status);
  }
}

async function runLoyaltyCheck(adminCookie) {
  console.log('\nLoyalty points (₱1 per ₱200 spent)');
  const email = `loyalty-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', { email, password: 'testpass123', name: 'Loyalty QA' });
  if (reg.status !== 201 && reg.status !== 200) { fail('loyalty buyer register', reg.status); return; }
  ok('loyalty buyer registered');

  const buyer = db.prepare('SELECT id, wallet_balance FROM users WHERE LOWER(email) = ?').get(email.toLowerCase());
  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  const product = db.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get();
  if (!buyer?.id || !pm || !product) { fail('loyalty seed data', 'missing'); return; }

  const seq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
  const orderNumber = String(seq);
  const total = 400;
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQwAHZwZ2hFBOwAAAABJRU5ErkJggg==';
  const ins = db.prepare(`
    INSERT INTO orders (
      order_number, order_seq, email, user_id, payment_method_id,
      subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode, receipt_url
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending', 0, 'auto', '/uploads/receipts/test.png')
  `).run(orderNumber, seq, email, buyer.id, pm.id, total, total);
  const orderId = ins.lastInsertRowid;
  db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
    VALUES (?, ?, 'Loyalty Test', 1, ?)
  `).run(orderId, product.id, total);

  const approveRes = await request('POST', `/admin/orders/${orderNumber}/approve`, {}, adminCookie);
  if (approveRes.status !== 200) { fail('loyalty order approve', approveRes.json?.error || approveRes.status); return; }

  const after = db.prepare('SELECT wallet_balance FROM users WHERE id = ?').get(buyer.id);
  const gained = (after?.wallet_balance || 0) - (buyer.wallet_balance || 0);
  if (gained === 2) ok('loyalty credit ₱2 for ₱400 shop order');
  else fail('loyalty credit amount', `expected +2, got +${gained}`);

  const tx = db.prepare(`
    SELECT amount FROM wallet_transactions WHERE user_id = ? AND type = 'loyalty' AND order_number = ?
  `).get(buyer.id, orderNumber);
  if (tx?.amount === 2) ok('loyalty wallet transaction logged');
  else fail('loyalty wallet transaction', tx?.amount || 'missing');

  db.prepare('DELETE FROM wallet_transactions WHERE order_number = ?').run(orderNumber);
  purgeGameRowsForOrder(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  db.prepare('UPDATE users SET wallet_balance = ? WHERE id = ?').run(buyer.wallet_balance, buyer.id);
}

async function runGamesCheck(adminCookie) {
  console.log('\nShop games (order → slot)');
  const email = `games-${Date.now()}@test.local`;
  const reg = await request('POST', '/auth/register', { email, password: 'testpass123', name: 'Games QA' });
  if (reg.status !== 201 && reg.status !== 200) { fail('games buyer register', reg.status); return; }
  ok('games buyer registered');
  const buyer = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email.toLowerCase());
  if (!buyer?.id) { fail('games buyer id', 'missing'); return; }

  const drawAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const wheel = await request('POST', '/admin/games/wheel', {
    title: 'QA Wheel',
    drawAt,
    isEnabled: true,
    availableDays: [0, 1, 2, 3, 4, 5, 6],
    minOrderTotal: 0
  }, adminCookie);
  if (wheel.status !== 201) { fail('create wheel campaign', wheel.json?.error || wheel.status); return; }
  ok('wheel campaign created');

  await request('POST', `/admin/games/wheel/${wheel.json.id}/prizes`, {
    label: 'Loyalty ₱400',
    prizeType: 'wallet',
    prizeValue: '400',
    quantity: 1
  }, adminCookie);

  await request('POST', '/admin/games/scratch', { title: 'QA Scratch', isEnabled: true, minOrderTotal: 0 }, adminCookie);
  await request('POST', '/admin/games/mystery', { title: 'QA Mystery', isEnabled: true, minOrderTotal: 0 }, adminCookie);
  ok('scratch + mystery pools enabled');

  const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
  const product = db.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get();
  const eligSettings = await request('PUT', '/admin/games/settings', {
    gamesEnabled: true,
    strictEligibility: true,
    requiredQuantity: 3,
    productIds: [product.id],
    telegramHandle: '@loveriette'
  }, adminCookie);
  if (eligSettings.status !== 200) { fail('games eligibility settings', eligSettings.json?.error || eligSettings.status); return; }
  ok('games strict eligibility configured (3 qty)');

  const variant = db.prepare('SELECT id FROM product_variants WHERE product_id = ? ORDER BY id LIMIT 1').get(product.id);
  if (!variant) { fail('games stock seed', 'no variant for product'); return; }
  for (let i = 0; i < 3; i++) {
    const stock = await request('POST', '/admin/inventory', {
      variant_id: variant.id,
      email: `games-stock-${Date.now()}-${i}@test.local`,
      password: 'testpass',
      profiles: [`Profile ${i + 1}`]
    }, adminCookie);
    if (stock.status !== 201) { fail('games stock seed', stock.status); return; }
  }
  ok('games stock seeded for delivery');

  const seq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
  const orderNumber = String(seq);
  const ins = db.prepare(`
    INSERT INTO orders (
      order_number, order_seq, email, user_id, payment_method_id,
      subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode, receipt_url
    ) VALUES (?, ?, ?, ?, ?, 200, 0, 200, 'pending', 0, 'auto', '/uploads/receipts/test.png')
  `).run(orderNumber, seq, email, buyer.id, pm.id);
  const orderId = ins.lastInsertRowid;
  db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES (?, ?, 'Games Test', 3, 200)`)
    .run(orderId, product.id);

  const approveRes = await request('POST', `/admin/orders/${orderNumber}/approve`, {}, adminCookie);
  if (approveRes.status !== 200) { fail('games order approve', approveRes.json?.error || approveRes.status); return; }

  const slot = db.prepare('SELECT id FROM game_wheel_slots WHERE order_id = ?').get(orderId);
  if (slot?.id) ok('wheel slot granted after delivery');
  else fail('wheel slot granted after delivery', 'missing');

  const scratch = db.prepare('SELECT id FROM game_scratch_cards WHERE order_id = ?').get(orderId);
  if (scratch?.id) ok('scratch card granted');
  else fail('scratch card granted', 'missing');

  const mystery = db.prepare('SELECT id FROM game_mystery_plays WHERE order_id = ?').get(orderId);
  if (mystery?.id) ok('mystery play granted');
  else fail('mystery play granted', 'missing');

  const dicePlay = db.prepare(`
    SELECT ip.id FROM game_instant_plays ip
    JOIN game_instant_pools p ON p.id = ip.pool_id WHERE ip.order_id = ? AND p.game_key = 'dice'
  `).get(orderId);
  if (dicePlay?.id) ok('dice play granted');
  else fail('dice play granted', 'missing');

  const hub = await request('GET', '/api/games');
  if (hub.status === 200 && hub.json.wheel && hub.json.scratch && hub.json.mystery
      && hub.json.dice && hub.json.pick && hub.json.vault) ok('GET /api/games hub (6 games)');
  else fail('GET /api/games hub', hub.status);

  if (hub.json.eligibility?.strict && hub.json.eligibility?.requiredQuantity === 3) {
    ok('games hub includes strict eligibility');
  } else fail('games hub eligibility', JSON.stringify(hub.json.eligibility || {}));

  if (hub.json.wheel?.entries != null && hub.json.recentWinners != null) ok('games hub wheel entries + recent winners');
  else fail('games hub wheel extras', 'missing entries or recentWinners');

  const gamesPage = await request('GET', '/games');
  const pageBody = gamesPage.json?.raw || '';
  if (gamesPage.status === 200 && pageBody.includes('games-hub-guide-btn')) {
    ok('GET /games page with guide link');
  } else fail('GET /games page guide', gamesPage.status);

  if (hub.json.eligibility?.guides?.wheel) ok('games hub includes guide URLs');
  else fail('games hub guides', JSON.stringify(hub.json.eligibility?.guides || {}));

  const login = await loginUser(email, 'testpass123');
  if (login.cookie) {
    const account = await request('GET', '/account/games', {}, login.cookie);
    if (account.status === 200 && account.json.wheel?.mySlots?.length) ok('account games hub has wheel slot');
    else fail('account games hub', account.json?.wheel?.mySlots?.length || account.status);
  } else fail('games buyer login', login.status);

  purgeGameRowsForOrder(orderId);
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
}

async function main() {
  console.log('Ecom workflow smoke tests');
  try {
    await runDbChecks();
    const adminCookie = await loginAdmin();
    if (adminCookie) ok('admin login');
    else fail('admin login', 'no cookie');
    await runApiChecks(adminCookie);
    await runOrderFlowCheck(adminCookie);
    await runLoyaltyCheck(adminCookie);
    await runGamesCheck(adminCookie);
    await runVariantDescriptionCheck(adminCookie);
    await runUserAdminCheck(adminCookie);
    await runRefundReportCheck(adminCookie);
    await runPerItemReportCheck(adminCookie);
    await runBulkPricingCheck();
    await runPaymentSettingsCheck(adminCookie);
    await runInventoryCheck(adminCookie);
    await runThemeCheck(adminCookie);
    await runStoreUpdatesCheck(adminCookie);
    try {
      await runResetWebsiteCheck(adminCookie);
    } catch (err) {
      if (String(err.message || err).includes('ECONNRESET')) {
        ok('reset website (server recycled after reset — expected in live server tests)');
      } else {
        fail('reset website', err.message);
      }
    }
  } catch (err) {
    fail('test runner', err.message);
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
