/**
 * Platform module smoke tests: website-making inquiry chat, plugging, homepage.
 * Run with server up: node server.js/test-platform.js
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
  throw new Error('admin login failed — set TEST_ADMIN_PASSWORD or ADMIN_PASSWORD');
}

async function runPageRoutes() {
  console.log('\nPlatform page routes');
  const staticPaths = [
    '/',
    '/shop',
    '/games',
    '/website-making',
    '/plugging',
    '/plugging/subscribe',
    '/plugging/payment',
    '/plugging/status',
    '/plugging/workspace',
    '/login.html',
    '/forgot-password.html',
    '/reset-password.html',
    '/admin.html',
    '/dashboard.html',
    '/signup.html',
    '/cart.html',
    '/checkout.html',
    '/about.html',
    '/contact.html',
    '/faqs.html',
    '/guide.html',
    '/terms.html',
    '/privacy.html',
    '/order-thanks.html'
  ];
  for (const path of staticPaths) {
    const res = await request('GET', path);
    if (res.status === 200) ok(`GET ${path}`);
    else fail(`GET ${path}`, res.status);
  }

  const product = db.prepare('SELECT slug FROM products WHERE slug IS NOT NULL AND slug != \'\' LIMIT 1').get();
  if (product?.slug) {
    const res = await request('GET', `/product/${product.slug}`);
    if (res.status === 200) ok(`GET /product/${product.slug}`);
    else fail('GET /product/:slug', res.status);
  }

  const webPkg = db.prepare('SELECT slug FROM website_packages WHERE slug IS NOT NULL AND slug != \'\' LIMIT 1').get();
  if (webPkg?.slug) {
    const res = await request('GET', `/website-making/${webPkg.slug}`);
    if (res.status === 200) ok(`GET /website-making/:slug`);
    else fail('GET /website-making/:slug', res.status);
  }

  const plugProd = db.prepare('SELECT slug FROM plugging_products WHERE slug IS NOT NULL AND slug != \'\' LIMIT 1').get();
  if (plugProd?.slug) {
    const res = await request('GET', `/plugging/plan/${plugProd.slug}`);
    if (res.status === 200) ok(`GET /plugging/plan/:slug`);
    else fail('GET /plugging/plan/:slug', res.status);
  }
}

async function runHomepageApi() {
  console.log('\nHomepage API');
  const res = await request('GET', '/api/homepage');
  if (res.status === 200 && res.json.sections?.length) ok('GET /api/homepage sections');
  else fail('GET /api/homepage', res.status);
  if (res.json.testimonials?.length) ok('GET /api/homepage testimonials');
  else fail('GET /api/homepage testimonials', 'empty');
  if (!('featured' in res.json) && !('statistics' in res.json)) ok('GET /api/homepage trimmed sections');
  else fail('GET /api/homepage trimmed', 'legacy fields present');
  const services = (res.json.sections || []).find((s) => s.key === 'service_categories');
  const items = services?.content?.items || services?.items || [];
  const hasGames = items.some((i) => String(i.link || '').toLowerCase() === '/games');
  if (hasGames) ok('homepage services includes Games card');
  else fail('homepage services includes Games card', items.map((i) => i.link).join(', '));
}

async function runWebsiteMakingApi() {
  console.log('\nWebsite Making API');
  const res = await request('GET', '/api/website-making');
  if (res.status !== 200) {
    fail('GET /api/website-making', res.status);
    return;
  }
  if (Array.isArray(res.json.packages) && res.json.packages.length > 0) {
    ok('GET /api/website-making packages');
  } else {
    fail('GET /api/website-making packages', 'empty');
  }
  if (Array.isArray(res.json.faqs) && res.json.faqs.length > 0) {
    ok('GET /api/website-making faqs');
  } else {
    fail('GET /api/website-making faqs', 'empty');
  }
}

async function runWebsiteInquiryChat(adminCookie) {
  console.log('\nWebsite inquiry chat');
  const pkg = db.prepare('SELECT id FROM website_packages WHERE is_enabled = 1 LIMIT 1').get();
  if (!pkg) { fail('website package seed', 'none'); return; }

  const email = `web-inq-${Date.now()}@test.local`;
  const submit = await request('POST', '/api/website-making/inquiry', {
    packageId: pkg.id,
    name: 'Web Test Client',
    email,
    phone: '09170000000',
    message: 'I need a website for my shop.'
  });
  if (submit.status !== 201 || !submit.json.inquiryRef) {
    fail('POST /api/website-making/inquiry', submit.json?.error || submit.status);
    return;
  }
  ok('POST inquiry returns inquiryRef');
  const ref = submit.json.inquiryRef;

  const thread = await request('GET', `/api/website-making/inquiry/${ref}?email=${encodeURIComponent(email)}`);
  if (thread.status === 200 && thread.json.messages?.length >= 1) ok('GET inquiry thread');
  else fail('GET inquiry thread', thread.status);

  const reply = await request('POST', `/api/website-making/inquiry/${ref}/messages`, {
    email,
    message: 'Can you share a timeline?'
  });
  if (reply.status === 201 && reply.json.messages?.length >= 2) ok('client reply');
  else fail('client reply', reply.status);

  const inqRow = db.prepare('SELECT id FROM website_inquiries WHERE inquiry_ref = ?').get(ref);
  const adminGet = await request('GET', `/admin/website-making/inquiries/${inqRow.id}`, null, adminCookie);
  if (adminGet.status === 200 && adminGet.json.messages?.length >= 2) ok('admin GET inquiry detail');
  else fail('admin GET inquiry', adminGet.status);

  const adminReply = await request('POST', `/admin/website-making/inquiries/${inqRow.id}/messages`, {
    message: 'We can start within 2 weeks.'
  }, adminCookie);
  if (adminReply.status === 201 && adminReply.json.messages?.some((m) => m.senderType === 'admin')) {
    ok('admin reply');
  } else fail('admin reply', adminReply.status);

  const page = await request('GET', `/website-making/inquiry/${ref}`);
  if (page.status === 200) ok('GET /website-making/inquiry/:ref page');
  else fail('inquiry page', page.status);
}

async function runPluggingApi() {
  console.log('\nPlugging API');
  const res = await request('GET', '/api/plugging');
  if (res.status === 200 && Array.isArray(res.json.products)) ok('GET /api/plugging');
  else fail('GET /api/plugging', res.status);
}

async function runPlatformStats(adminCookie) {
  console.log('\nPlatform admin stats');
  const res = await request('GET', '/admin/platform/stats', null, adminCookie);
  if (res.status === 200 && res.json.newWebsiteInquiries != null && res.json.pendingPluggingOrders != null) {
    ok('GET /admin/platform/stats pending counts');
  } else fail('GET /admin/platform/stats', res.status);
}

async function main() {
  console.log('Platform workflow smoke tests');
  try {
    await runPageRoutes();
    await runHomepageApi();
    await runWebsiteMakingApi();
    await runPluggingApi();
    const adminCookie = await loginAdmin();
    ok('admin login');
    await runWebsiteInquiryChat(adminCookie);
    await runPlatformStats(adminCookie);
  } catch (err) {
    fail('runner', err.message);
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
