'use strict';

/**
 * Export ezyshell MongoDB store data → JSON for loveriette import.
 *
 * Run ON THE VPS from ezyshell backend (uses its mongoose + .env):
 *   cd /var/www/ezyshell/backend
 *   node /var/www/ecommerce/scripts/ezyshell-mongo-export.js --store-slug loveriette
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let storeSlug = 'loveriette';
let outFile = '/var/www/ecommerce/ezyshell-export.json';
let dryRun = false;

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--store-slug' && args[i + 1]) storeSlug = args[++i];
  else if (args[i] === '--out' && args[i + 1]) outFile = args[++i];
  else if (args[i] === '--dry-run') dryRun = true;
}

const backendDir = '/var/www/ezyshell/backend';
process.chdir(backendDir);

const { createRequire } = require('module');
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
backendRequire('dotenv').config({ path: path.join(backendDir, '.env') });

const mongoose = backendRequire('mongoose');

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return null;
}

function oid(v) {
  if (!v) return null;
  return String(v);
}

function slugMatch(value, slug) {
  return String(value || '').toLowerCase().includes(String(slug).toLowerCase());
}

function mapOrderStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (['approved', 'paid', 'delivered', 'completed'].includes(s)) return 'approved';
  if (['rejected', 'cancelled', 'canceled', 'declined'].includes(s)) return 'rejected';
  if (['refunded'].includes(s)) return 'refunded';
  if (['pending', 'pending_payment', 'receipt_uploaded', 'processing'].includes(s)) return 'pending';
  return 'pending';
}

function parseProfiles(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [raw];
    } catch {
      return raw ? [raw] : [];
    }
  }
  return [];
}

function extractFulfillments(order) {
  const out = [];
  const items = order.items || order.orderItems || order.lineItems || order.products || [];

  for (const item of items) {
    const creds =
      item.credentials ||
      item.account ||
      item.delivery ||
      item.stock ||
      (item.deliveredAccounts || []).flat?.() ||
      [];

    const credList = Array.isArray(creds) ? creds : [creds];
    for (const c of credList) {
      if (!c || typeof c !== 'object') continue;
      out.push({
        serviceName: pick(c, 'serviceName', 'service', 'name') || pick(item, 'name', 'productName', 'title') || 'Account',
        email: String(pick(c, 'email', 'accountEmail', 'username') || ''),
        password: String(pick(c, 'password', 'pass') || ''),
        profiles: parseProfiles(pick(c, 'profiles', 'profile', 'profileData', 'pins')),
        rules: String(pick(c, 'rules', 'notes') || ''),
        validStart: pick(c, 'validStart', 'validFrom', 'startDate'),
        validEnd: pick(c, 'validEnd', 'validUntil', 'endDate', 'expiry'),
        deliveredAt: pick(c, 'deliveredAt', 'soldAt', 'createdAt') || order.updatedAt || order.createdAt,
        emailAccess: c.emailAccess || (pick(c, 'accessEmail', 'emailAccessEmail') ? {
          email: pick(c, 'accessEmail', 'emailAccessEmail'),
          password: pick(c, 'accessPassword', 'emailAccessPassword'),
          profileData: parseProfiles(pick(c, 'accessProfiles', 'accessProfileData'))
        } : null)
      });
    }
  }

  // Some orders store accounts at root level
  const rootAccounts = order.accounts || order.deliveredAccounts || order.credentials || [];
  for (const c of (Array.isArray(rootAccounts) ? rootAccounts : [rootAccounts])) {
    if (!c || typeof c !== 'object') continue;
    out.push({
      serviceName: pick(c, 'serviceName', 'service', 'name') || 'Account',
      email: String(pick(c, 'email') || ''),
      password: String(pick(c, 'password') || ''),
      profiles: parseProfiles(c.profiles),
      rules: String(c.rules || ''),
      deliveredAt: pick(c, 'deliveredAt') || order.updatedAt || order.createdAt,
      emailAccess: c.emailAccess || null
    });
  }

  return out;
}

function mapOrderItems(order) {
  const items = order.items || order.orderItems || order.lineItems || order.products || [];
  return items.map((item) => ({
    productName: pick(item, 'productName', 'name', 'title', 'serviceName') || 'Product',
    variantName: pick(item, 'variantName', 'variant', 'planName', 'duration', 'label') || '',
    quantity: Number(pick(item, 'quantity', 'qty') || 1),
    price: Number(pick(item, 'price', 'amount', 'unitPrice') || 0),
    category: pick(item, 'category', 'categoryName') || 'Imported'
  }));
}

async function findSeller(db, slug) {
  const users = db.collection('users');
  const queries = [
    { username: new RegExp(slug, 'i') },
    { storeSlug: slug },
    { shopSlug: slug },
    { slug },
    { 'store.slug': slug },
    { 'shop.slug': slug }
  ];
  for (const q of queries) {
    const u = await users.findOne(q);
    if (u) return u;
  }
  const byName = await users.findOne({ name: new RegExp(slug, 'i') });
  if (byName) return byName;
  return null;
}

function orderBelongsToSeller(order, sellerId, slug) {
  const sid = oid(sellerId);
  const candidates = [
    order.sellerId, order.seller, order.storeId, order.store,
    order.shopId, order.shop, order.merchantId, order.vendorId,
    order.ownerId, order.createdBy, order.storeOwnerId, order.storeOwner
  ].map(oid);

  if (sid && candidates.includes(sid)) return true;

  const nested = [
    pick(order, 'store', 'shop', 'seller', 'merchant', 'storeOwner'),
  ];
  for (const n of nested) {
    if (typeof n === 'object' && n) {
      if (oid(n._id) === sid || oid(n.id) === sid) return true;
      if (slugMatch(n.slug, slug) || slugMatch(n.username, slug) || slugMatch(n.name, slug)) return true;
    }
  }

  if (slugMatch(order.storeSlug, slug) || slugMatch(order.shopSlug, slug)) return true;

  // Single-store fallback: if no seller found, include all orders (manual review)
  return !sid;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI missing in /var/www/ezyshell/backend/.env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const seller = await findSeller(db, storeSlug);
  const sellerId = seller?._id;
  console.log('Seller:', seller ? `${seller.email || seller.username || seller.name} (${sellerId})` : 'NOT FOUND — exporting ALL orders (review before import)');

  const allOrders = await db.collection('orders').find({}).toArray();
  let orders = allOrders.filter((o) => orderBelongsToSeller(o, sellerId, storeSlug));
  if (orders.length === 0 && allOrders.length > 0) {
    console.log('WARN: No orders matched seller filter — exporting ALL orders for this database.');
    orders = allOrders;
  }
  console.log(`Orders: ${orders.length} / ${allOrders.length} total in DB`);

  const buyerIds = new Set();
  const buyerEmails = new Set();
  for (const o of orders) {
    if (o.userId) buyerIds.add(oid(o.userId));
    if (o.user) buyerIds.add(oid(o.user));
    if (o.buyerId) buyerIds.add(oid(o.buyerId));
    if (o.email) buyerEmails.add(String(o.email).toLowerCase());
    if (o.buyerEmail) buyerEmails.add(String(o.buyerEmail).toLowerCase());
  }

  const userQuery = {
    $or: [
      ...(buyerIds.size ? [{ _id: { $in: [...buyerIds].filter(Boolean).map((id) => {
        try { return new mongoose.Types.ObjectId(id); } catch { return id; }
      }) } }] : []),
      ...(buyerEmails.size ? [{ email: { $in: [...buyerEmails] } }] : [])
    ]
  };

  let users = [];
  if (userQuery.$or.length) {
    users = await db.collection('users').find(userQuery).toArray();
  }
  if (seller) users.push(seller);
  // dedupe users by email
  const seen = new Set();
  users = users.filter((u) => {
    const key = String(u.email || u._id).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Users to export: ${users.length}`);

  const payload = {
    meta: {
      source: 'ezyshell-mongo',
      store: storeSlug,
      sellerId: oid(sellerId),
      exportedAt: new Date().toISOString(),
      orderCount: orders.length,
      userCount: users.length
    },
    users: users.map((u) => ({
      legacyId: oid(u._id),
      email: String(u.email || '').toLowerCase(),
      passwordHash: pick(u, 'password', 'passwordHash', 'password_hash') || '',
      name: pick(u, 'name', 'fullName', 'displayName') || String(u.email || '').split('@')[0],
      username: pick(u, 'username', 'handle'),
      walletBalance: Number(pick(u, 'walletBalance', 'balance', 'wallet') || 0),
      isAdmin: u.role === 'admin' || u.isAdmin ? 1 : 0,
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null
    })),
    orders: orders.map((o) => ({
      legacyId: oid(o._id),
      orderNumber: String(pick(o, 'orderNumber', 'orderNo', 'orderId', 'number', 'reference') || oid(o._id)),
      orderSeq: Number(pick(o, 'orderSeq', 'seq', 'displayId') || 0) || undefined,
      legacyUserId: oid(pick(o, 'userId', 'user', 'buyerId')),
      email: String(pick(o, 'email', 'buyerEmail', 'customerEmail') || '').toLowerCase(),
      status: mapOrderStatus(pick(o, 'status', 'orderStatus', 'state')),
      subtotal: Number(pick(o, 'subtotal', 'subTotal') || pick(o, 'total', 'amount') || 0),
      discount: Number(pick(o, 'discount', 'discountAmount') || 0),
      total: Number(pick(o, 'total', 'amount', 'grandTotal') || 0),
      paymentMethod: pick(o, 'paymentMethod', 'payment_method', 'paymentType') || 'GCash',
      createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
      receiptUrl: pick(o, 'receiptUrl', 'receipt', 'proofUrl'),
      buyerName: pick(o, 'buyerName', 'customerName', 'name'),
      items: mapOrderItems(o),
      fulfillments: extractFulfillments(o)
    })),
    walletTransactions: [],
    redeemCodes: []
  };

  if (dryRun) {
    console.log(JSON.stringify({ meta: payload.meta, sampleUser: payload.users[0], sampleOrder: payload.orders[0] }, null, 2));
    process.exit(0);
  }

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outFile}`);
  console.log('Next:');
  console.log(`  cd /var/www/ecommerce`);
  console.log(`  node scripts/migrate-ezyshell.js import --file ${outFile} --dry-run`);
  console.log(`  node scripts/migrate-ezyshell.js import --file ${outFile}`);
  console.log(`  pm2 restart ecommerce`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
