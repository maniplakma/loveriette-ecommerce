/**
 * Production regression — run against live site:
 *   PROD_BASE=https://loveriette.shop node server.js/test-prod-regression.js
 */
const https = require('https');
const http = require('http');

const BASE = (process.env.PROD_BASE || 'https://loveriette.shop').replace(/\/$/, '');
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+BQwAHZwZ2hFBOwAAAABJRU5ErkJggg==';

const passed = [];
const failed = [];

function ok(wf, step) { passed.push(`${wf}: ${step}`); console.log(`  ✓ [${wf}] ${step}`); }
function fail(wf, step, err) { failed.push({ wf, step, err: String(err) }); console.log(`  ✗ [${wf}] ${step}: ${err}`); }

function request(method, urlPath, body, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const lib = url.protocol === 'https:' ? https : http;
    const data = body != null ? JSON.stringify(body) : null;
    const req = lib.request(url, {
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

const PAGES = [
  '/', '/shop', '/website-making', '/plugging', '/login.html', '/signup.html',
  '/cart.html', '/checkout.html', '/about.html', '/contact.html', '/faqs.html',
  '/product/netflix-profile', '/admin.html', '/dashboard.html'
];

async function testPages() {
  const WF = 'PAGES';
  for (const p of PAGES) {
    const res = await request('GET', p);
    if (res.status === 200 && res.raw.includes('<!DOCTYPE html>')) ok(WF, `GET ${p}`);
    else fail(WF, `GET ${p}`, res.status);
  }
}

async function testHealth() {
  const WF = 'DOMAIN';
  const res = await request('GET', '/api/health');
  if (res.status !== 200) { fail(WF, 'GET /api/health', res.status); return; }
  ok(WF, 'health endpoint');
  if (res.json.domainConnected) ok(WF, 'custom domain connected');
  else fail(WF, 'domain connected', `publicUrl=${res.json.publicUrl}`);
  if (res.json.publicUrl?.includes('loveriette.shop')) ok(WF, 'PUBLIC_URL set to custom domain');
  else fail(WF, 'PUBLIC_URL', res.json.publicUrl);
}

async function testShop() {
  const WF = 'SHOP';
  const products = await request('GET', '/products');
  if (products.status !== 200 || !products.json.length) { fail(WF, 'products', products.status); return; }
  ok(WF, `${products.json.length} products`);

  const pm = await request('GET', '/payment-methods');
  if (!pm.json?.methods?.length) { fail(WF, 'payment methods', 'empty'); return; }
  ok(WF, 'payment methods');

  const email = `prod-reg-${Date.now()}@loveriette.shop`;
  const order = await request('POST', '/orders', {
    email,
    paymentMethodId: pm.json.methods[0].id,
    productId: products.json[0].id,
    variantId: products.json[0].variants?.[0]?.id,
    quantity: 1
  });
  if (order.status !== 201) {
    fail(WF, 'create order', `${order.status} ${order.json?.error || ''}`);
    return;
  }
  ok(WF, `order #${order.json.orderNumber} created`);

  const get = await request('GET', `/orders/${order.json.orderNumber}`);
  if (get.status === 200) ok(WF, 'order lookup');
  else fail(WF, 'order lookup', get.status);
}

async function testAuth() {
  const WF = 'AUTH';
  const email = `prod-auth-${Date.now()}@loveriette.shop`;
  const reg = await request('POST', '/auth/register', {
    email, password: 'ProdTestPass123!', name: 'Prod Regression'
  });
  if (reg.status !== 201 && reg.status !== 200) {
    fail(WF, 'register', `${reg.status} ${reg.json?.error || ''}`);
    return;
  }
  ok(WF, 'register buyer');
  const login = await request('POST', '/auth/login', { email, password: 'ProdTestPass123!' });
  const cookie = cookieFrom(login);
  if (!cookie) { fail(WF, 'login cookie', 'missing'); return; }

  const me = await request('GET', '/auth/me', null, cookie);
  const meEmail = me.json?.user?.email || me.json?.email;
  if (me.status === 200 && meEmail) ok(WF, 'session /auth/me');
  else fail(WF, '/auth/me', me.status === 200 ? 'no session user' : me.status);

  if (login.status === 200) ok(WF, 'login');
  else fail(WF, 'login', login.status);
}

async function testPlugging() {
  const WF = 'PLUGGING';
  const list = await request('GET', '/api/plugging');
  if (list.status !== 200 || !list.json?.plans?.length) { fail(WF, 'plans', list.status); return; }
  ok(WF, `${list.json.plans.length} plans`);

  const sub = await request('POST', '/api/plugging/subscribe', {
    planId: list.json.plans[0].id,
    name: 'Prod Plug Test',
    email: `prod-plug-${Date.now()}@loveriette.shop`
  });
  if (sub.status === 201 && sub.json?.orderRef) ok(WF, `subscribe ${sub.json.orderRef}`);
  else fail(WF, 'subscribe', sub.json?.error || sub.status);
}

async function testWebsiteMaking() {
  const WF = 'WEBSITE';
  const list = await request('GET', '/api/website-making');
  if (list.status !== 200 || !list.json?.packages?.length) { fail(WF, 'packages', list.status); return; }
  ok(WF, `${list.json.packages.length} packages`);

  const pkg = list.json.packages[0];
  const det = await request('GET', `/api/website-making/packages/${pkg.slug}`);
  if (det.status === 200 && det.json?.name) ok(WF, `package ${pkg.slug}`);
  else fail(WF, 'package detail', det.status);

  const buyerEmail = `prod-web-${Date.now()}@loveriette.shop`;
  const inq = await request('POST', '/api/website-making/inquiry', {
    packageId: pkg.id,
    name: 'Prod Web Client',
    email: buyerEmail,
    message: 'Production regression inquiry'
  });
  if (inq.status === 201 && inq.json?.inquiryRef) ok(WF, `inquiry ${inq.json.inquiryRef}`);
  else fail(WF, 'inquiry', inq.status);
}

async function testApis() {
  const WF = 'API';
  const hp = await request('GET', '/api/homepage');
  if (hp.status === 200 && hp.json?.sections) ok(WF, 'homepage');
  else fail(WF, 'homepage', hp.status);

  const tingi = await request('GET', '/tingi-drop');
  if (tingi.status === 200) ok(WF, 'tingi-drop config');
  else fail(WF, 'tingi-drop', tingi.status);

  const admin = await request('GET', '/admin/reports');
  if (admin.status === 401 || admin.status === 403) ok(WF, 'admin routes protected');
  else fail(WF, 'admin guard', admin.status);
}

async function main() {
  console.log(`Production regression @ ${BASE}\n`);
  try {
    await testHealth();
    await testPages();
    await testApis();
    await testShop();
    await testAuth();
    await testPlugging();
    await testWebsiteMaking();
  } catch (e) {
    console.error('FATAL:', e.message);
    process.exit(1);
  }

  console.log('\n========== PRODUCTION REGRESSION ==========');
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  [${f.wf}] ${f.step}: ${f.err}`));
    process.exit(1);
  }
  console.log('\nAll production workflows verified.');
}

main();
