'use strict';

/**
 * Set ezyshell store banner → link to loveriette (Option 1).
 *
 * Run on VPS:
 *   cd /var/www/ezyshell/backend
 *   LOVERIETTE_URL='https://YOUR-SHOP-URL/login.html?from=ezyshell' \
 *     NODE_PATH=$(pwd)/node_modules \
 *     node /var/www/ecommerce/scripts/set-ezyshell-store-banner.js
 */

const path = require('path');
const backendDir = '/var/www/ezyshell/backend';
process.chdir(backendDir);

const { createRequire } = require('module');
const backendRequire = createRequire(path.join(backendDir, 'package.json'));
backendRequire('dotenv').config({ path: path.join(backendDir, '.env') });
const mongoose = backendRequire('mongoose');

const storeSlug = process.argv.includes('--store-slug')
  ? process.argv[process.argv.indexOf('--store-slug') + 1]
  : 'loveriette';

const shopUrl = (
  process.env.LOVERIETTE_URL ||
  process.env.LOVERIETTE_SHOP_URL ||
  'http://161.97.78.192:3001/login.html?from=ezyshell'
).replace(/\/$/, '');

const loginUrl = shopUrl.includes('?')
  ? shopUrl
  : `${shopUrl.replace(/\/login\.html$/, '')}/login.html?from=ezyshell`;

const bannerText =
  `We've moved to loveriette! Shop here: ${loginUrl} — use your same email & password. Your orders are ready.`;

const bannerFields = {
  storeAnnouncement: bannerText,
  announcement: bannerText,
  storeNotice: bannerText,
  bannerText,
  migrationBanner: {
    enabled: true,
    text: bannerText,
    link: loginUrl,
    linkLabel: 'Go to loveriette'
  }
};

async function findStoreUser(db) {
  const users = db.collection('users');
  const queries = [
    { username: new RegExp(storeSlug, 'i') },
    { storeSlug },
    { shopSlug: storeSlug },
    { slug: storeSlug },
    { 'store.slug': storeSlug }
  ];
  for (const q of queries) {
    const u = await users.findOne(q);
    if (u) return { collection: users, doc: u };
  }
  const stores = db.collection('stores');
  try {
    const s = await stores.findOne({ slug: storeSlug });
    if (s) return { collection: stores, doc: s };
  } catch (_) { /* no stores collection */ }
  return null;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const hit = await findStoreUser(db);
  if (!hit) {
    console.error(`Store "${storeSlug}" not found in MongoDB.`);
    console.error('Set banner manually in ezyshell Admin → Store Editor, or edit settings.');
    console.error('Banner text to paste:');
    console.error(bannerText);
    process.exit(1);
  }

  await hit.collection.updateOne(
    { _id: hit.doc._id },
    { $set: bannerFields }
  );

  console.log('Banner updated for store:', storeSlug);
  console.log('Link:', loginUrl);
  console.log('Text:', bannerText);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
