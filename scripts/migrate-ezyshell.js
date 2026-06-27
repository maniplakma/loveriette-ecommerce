'use strict';

/**
 * Import ezyshell store data into loveriette (SQLite).
 *
 * Usage:
 *   node scripts/migrate-ezyshell.js import --file ./ezyshell-export.json
 *   node scripts/migrate-ezyshell.js import --file ./export.json --dry-run
 *   node scripts/migrate-ezyshell.js import --file ./export.json --skip-existing-users
 *
 * Export JSON format: see deploy/EZYSHELL-MIGRATION.md
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');

function loadEnvFile() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] == null) process.env[key] = val;
  }
}

loadEnvFile();

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(root, 'server.js', 'ecom.db');

delete require.cache[require.resolve(path.join(root, 'server.js', 'db.js'))];
const db = require(path.join(root, 'server.js', 'db.js'));

const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

const STATUS_MAP = {
  pending_payment: 'pending_payment',
  pending: 'pending',
  receipt_uploaded: 'pending',
  paid: 'approved',
  approved: 'approved',
  delivered: 'approved',
  rejected: 'rejected',
  cancelled: 'rejected',
  refunded: 'refunded'
};

function normalizeStatus(raw) {
  const key = String(raw || 'pending').toLowerCase().replace(/\s+/g, '_');
  return STATUS_MAP[key] || 'pending';
}

function parseArgs(argv) {
  const args = { command: argv[2], file: null, dryRun: false, skipExistingUsers: false };
  for (let i = 3; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file' && argv[i + 1]) { args.file = argv[++i]; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--skip-existing-users') { args.skipExistingUsers = true; continue; }
  }
  return args;
}

function backupDatabase() {
  if (!fs.existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${dbPath}.pre-ezyshell-${stamp}.bak`;
  fs.copyFileSync(dbPath, dest);
  return dest;
}

function ensureLegacyTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS legacy_import_map (
      entity_type TEXT NOT NULL,
      legacy_id TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (entity_type, legacy_id)
    );
  `);
}

function getLegacyLocalId(entityType, legacyId) {
  if (legacyId == null || legacyId === '') return null;
  const row = db.prepare(
    'SELECT local_id FROM legacy_import_map WHERE entity_type = ? AND legacy_id = ?'
  ).get(entityType, String(legacyId));
  return row ? row.local_id : null;
}

function rememberLegacy(entityType, legacyId, localId, meta = {}) {
  if (legacyId == null || legacyId === '') return;
  db.prepare(`
    INSERT INTO legacy_import_map (entity_type, legacy_id, local_id, meta_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(entity_type, legacy_id) DO UPDATE SET
      local_id = excluded.local_id,
      meta_json = excluded.meta_json
  `).run(entityType, String(legacyId), localId, JSON.stringify(meta));
}

function isBcryptHash(hash) {
  return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$/.test(hash);
}

function ensurePaymentMethod(name) {
  const label = String(name || 'Legacy Import').trim() || 'Legacy Import';
  const slugBase = slugify(label);
  let slug = slugBase;
  let n = 1;
  while (db.prepare('SELECT id FROM payment_methods WHERE slug = ?').get(slug)) {
    slug = `${slugBase}-${n}`;
    n += 1;
  }
  const existing = db.prepare('SELECT id FROM payment_methods WHERE name = ? COLLATE NOCASE').get(label);
  if (existing) return existing.id;
  const result = db.prepare(`
    INSERT INTO payment_methods (name, slug, instructions, is_active, sort_order)
    VALUES (?, ?, '[]', 1, 999)
  `).run(label, slug);
  return Number(result.lastInsertRowid);
}

function ensureCategory(name) {
  const label = String(name || 'Imported').trim() || 'Imported';
  const slug = slugify(label);
  let row = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  if (row) return row.id;
  const result = db.prepare(`
    INSERT INTO categories (name, slug, description, sort_order)
    VALUES (?, ?, '', 999)
  `).run(label, slug);
  return Number(result.lastInsertRowid);
}

function ensureProduct(entry, productMap) {
  const key = entry.productKey
    || entry.legacyProductId
    || entry.productName
    || entry.name
    || 'imported-product';
  const mapKey = String(key);
  if (productMap.has(mapKey)) return productMap.get(mapKey);

  const name = String(entry.productName || entry.name || 'Imported product').trim();
  const slug = slugify(entry.productSlug || name);
  let product = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug)
    || db.prepare('SELECT id FROM products WHERE name = ? COLLATE NOCASE').get(name);

  if (!product) {
    const categoryName = entry.category || 'Imported';
    const categoryId = ensureCategory(categoryName);
    const result = db.prepare(`
      INSERT INTO products (name, description, price, status, category, category_id, slug, icon)
      VALUES (?, ?, ?, 'AVAILABLE', ?, ?, ?, '')
    `).run(
      name,
      String(entry.description || name),
      Number(entry.price || 0),
      categoryName,
      categoryId,
      slug
    );
    product = { id: Number(result.lastInsertRowid) };
  }

  productMap.set(mapKey, product.id);
  if (entry.legacyProductId != null) {
    rememberLegacy('product', entry.legacyProductId, product.id, { name });
  }
  return product.id;
}

function ensureVariant(productId, entry, variantMap) {
  const variantName = String(entry.variantName || entry.duration || 'Default').trim() || 'Default';
  const key = `${productId}::${variantName}`;
  if (variantMap.has(key)) return variantMap.get(key);

  let row = db.prepare(`
    SELECT id FROM product_variants
    WHERE product_id = ? AND name = ? COLLATE NOCASE
  `).get(productId, variantName);

  if (!row) {
    const result = db.prepare(`
      INSERT INTO product_variants (product_id, name, duration, price, cost, sort_order)
      VALUES (?, ?, ?, ?, ?, 999)
    `).run(
      productId,
      variantName,
      String(entry.duration || variantName),
      Number(entry.price || 0),
      Number(entry.cost || 0)
    );
    row = { id: Number(result.lastInsertRowid) };
  }

  variantMap.set(key, row.id);
  return row.id;
}

function nextOrderSeqValue() {
  return db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
}

function importUsers(users, stats, opts) {
  const insert = db.prepare(`
    INSERT INTO users (
      email, password_hash, name, username, wallet_balance, is_admin, suspended,
      phone, avatar_url, country, timezone, created_at, membership_level, social_links
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const u of users) {
    const email = String(u.email || '').trim().toLowerCase();
    if (!email) { stats.usersSkipped += 1; continue; }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      if (opts.skipExistingUsers) {
        stats.usersSkipped += 1;
        if (u.legacyId != null) rememberLegacy('user', u.legacyId, existing.id, { email, skipped: true });
        continue;
      }
      db.prepare(`
        UPDATE users SET
          name = COALESCE(?, name),
          username = COALESCE(?, username),
          wallet_balance = COALESCE(?, wallet_balance),
          phone = COALESCE(?, phone),
          avatar_url = COALESCE(?, avatar_url),
          country = COALESCE(?, country),
          timezone = COALESCE(?, timezone),
          membership_level = COALESCE(?, membership_level),
          social_links = COALESCE(?, social_links)
        WHERE id = ?
      `).run(
        u.name || null,
        u.username || null,
        u.walletBalance != null ? Number(u.walletBalance) : null,
        u.phone || null,
        u.avatarUrl || null,
        u.country || null,
        u.timezone || null,
        u.membershipLevel || null,
        u.socialLinks ? JSON.stringify(u.socialLinks) : null,
        existing.id
      );
      if (u.passwordHash && isBcryptHash(u.passwordHash)) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(u.passwordHash, existing.id);
      }
      stats.usersUpdated += 1;
      if (u.legacyId != null) rememberLegacy('user', u.legacyId, existing.id, { email });
      continue;
    }

    const passwordHash = isBcryptHash(u.passwordHash)
      ? u.passwordHash
      : bcrypt.hashSync(`ezyshell-import-reset-${email}-${Date.now()}`, 10);

    if (!isBcryptHash(u.passwordHash)) stats.usersPasswordResetNeeded += 1;

    const result = insert.run(
      email,
      passwordHash,
      String(u.name || email.split('@')[0] || 'Buyer'),
      u.username || null,
      Number(u.walletBalance || 0),
      u.isAdmin ? 1 : 0,
      u.suspended ? 1 : 0,
      u.phone || null,
      u.avatarUrl || null,
      u.country || null,
      u.timezone || null,
      u.createdAt || new Date().toISOString(),
      u.membershipLevel || 'member',
      u.socialLinks ? JSON.stringify(u.socialLinks) : '{}'
    );
    const userId = Number(result.lastInsertRowid);
    stats.usersImported += 1;
    if (u.legacyId != null) rememberLegacy('user', u.legacyId, userId, { email });
  }
}

function resolveUserId(userEmail, legacyUserId, emailByLegacy) {
  if (legacyUserId != null) {
    const mapped = getLegacyLocalId('user', legacyUserId);
    if (mapped) return mapped;
    const email = emailByLegacy.get(String(legacyUserId));
    if (email) {
      const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (row) return row.id;
    }
  }
  const email = String(userEmail || '').trim().toLowerCase();
  if (!email) return null;
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  return row ? row.id : null;
}

function importOrders(orders, stats, productMap, variantMap) {
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      order_number, user_id, email, payment_method_id, redeem_code_id,
      subtotal, discount, total, status, created_at, receipt_url, buyer_name,
      tingi_drop_enabled, fulfillment_mode, order_seq, reject_reason
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, variant_id, product_name, quantity, price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertStock = db.prepare(`
    INSERT INTO stock_items (
      product_id, variant_id, service_name, email, password, profiles, rules,
      cost, price, valid_start, valid_end, status, sold_to, sold_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sold', ?, ?, ?)
  `);
  const insertFulfillment = db.prepare(`
    INSERT INTO order_fulfillments (order_id, order_item_id, stock_item_id, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertEmailAccess = db.prepare(`
    INSERT INTO email_access_credentials (stock_item_id, email, password, profile_data)
    VALUES (?, ?, ?, ?)
  `);

  for (const order of orders) {
    const legacyId = order.legacyId != null ? String(order.legacyId) : null;
    if (legacyId && getLegacyLocalId('order', legacyId)) {
      stats.ordersSkipped += 1;
      continue;
    }

    const orderNumber = String(order.orderNumber || order.displayId || legacyId || '').trim();
    if (!orderNumber) { stats.ordersSkipped += 1; continue; }

    const dup = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber);
    if (dup) { stats.ordersSkipped += 1; continue; }

    const email = String(order.email || order.userEmail || '').trim().toLowerCase();
    const userId = resolveUserId(order.userEmail || order.email, order.legacyUserId, new Map());
    const paymentMethodId = ensurePaymentMethod(order.paymentMethod || 'GCash');
    const orderSeq = order.orderSeq != null ? Number(order.orderSeq) : nextOrderSeqValue();
    const status = normalizeStatus(order.status);
    const createdAt = order.createdAt || new Date().toISOString();

    const orderResult = insertOrder.run(
      orderNumber,
      userId,
      email || 'unknown@import.local',
      paymentMethodId,
      Number(order.subtotal ?? order.total ?? 0),
      Number(order.discount || 0),
      Number(order.total ?? order.subtotal ?? 0),
      status,
      createdAt,
      order.receiptUrl || null,
      order.buyerName || null,
      order.tingiDropEnabled ? 1 : 0,
      order.fulfillmentMode || 'auto',
      orderSeq,
      order.rejectReason || null
    );
    const orderId = Number(orderResult.lastInsertRowid);
    stats.ordersImported += 1;
    if (legacyId) rememberLegacy('order', legacyId, orderId, { orderNumber });

    const items = Array.isArray(order.items) ? order.items : [];
    const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
    let fulfillmentIndex = 0;

    for (const item of items) {
      const productId = ensureProduct(item, productMap);
      const variantId = ensureVariant(productId, item, variantMap);
      const itemResult = insertItem.run(
        orderId,
        productId,
        variantId,
        String(item.productName || item.name || 'Imported item'),
        Number(item.quantity || 1),
        Number(item.price || 0)
      );
      const orderItemId = Number(itemResult.lastInsertRowid);

      const qty = Math.max(1, Number(item.quantity || 1));
      for (let q = 0; q < qty; q += 1) {
        const f = fulfillments[fulfillmentIndex];
        if (!f) break;
        fulfillmentIndex += 1;

        const profiles = Array.isArray(f.profiles) ? f.profiles : [];
        const stockResult = insertStock.run(
          productId,
          variantId,
          String(f.serviceName || item.productName || item.name || 'Account'),
          String(f.email || ''),
          String(f.password || ''),
          JSON.stringify(profiles),
          String(f.rules || ''),
          Number(f.cost || 0),
          Number(item.price || f.price || 0),
          f.validStart || null,
          f.validEnd || null,
          email || null,
          f.deliveredAt || createdAt,
          f.deliveredAt || createdAt
        );
        const stockId = Number(stockResult.lastInsertRowid);
        insertFulfillment.run(orderId, orderItemId, stockId, f.deliveredAt || createdAt);

        if (f.emailAccess && (f.emailAccess.email || f.emailAccess.password)) {
          insertEmailAccess.run(
            stockId,
            String(f.emailAccess.email || ''),
            String(f.emailAccess.password || ''),
            JSON.stringify(f.emailAccess.profileData || f.emailAccess.profiles || [])
          );
        } else if (f.accessEmail || f.accessPassword) {
          insertEmailAccess.run(
            stockId,
            String(f.accessEmail || f.email || ''),
            String(f.accessPassword || f.password || ''),
            JSON.stringify(f.accessProfileData || [])
          );
        }
        stats.fulfillmentsImported += 1;
      }
    }
  }
}

function importWalletTransactions(transactions, stats) {
  const insert = db.prepare(`
    INSERT INTO wallet_transactions (user_id, type, amount, order_number, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const tx of transactions) {
    const userId = resolveUserId(tx.userEmail, tx.legacyUserId, new Map());
    if (!userId) { stats.walletSkipped += 1; continue; }
    insert.run(
      userId,
      String(tx.type || 'order'),
      Number(tx.amount || 0),
      tx.orderNumber || null,
      String(tx.description || ''),
      tx.createdAt || new Date().toISOString()
    );
    stats.walletImported += 1;
  }
}

function importRedeemCodes(codes, stats) {
  const insert = db.prepare(`
    INSERT INTO redeem_codes (code, discount_type, discount_value, is_active, max_uses, used_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const c of codes) {
    const code = String(c.code || '').trim().toUpperCase();
    if (!code) continue;
    if (db.prepare('SELECT id FROM redeem_codes WHERE code = ?').get(code)) {
      stats.redeemSkipped += 1;
      continue;
    }
    insert.run(
      code,
      c.discountType || 'fixed',
      Number(c.discountValue || 0),
      c.isActive === false ? 0 : 1,
      c.maxUses != null ? Number(c.maxUses) : null,
      Number(c.usedCount || 0)
    );
    stats.redeemImported += 1;
  }
}

function runImport(filePath, opts) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.error(`Export file not found: ${abs}`);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const users = payload.users || [];
  const orders = payload.orders || [];
  const walletTransactions = payload.walletTransactions || payload.transactions || [];
  const redeemCodes = payload.redeemCodes || [];

  const stats = {
    usersImported: 0,
    usersUpdated: 0,
    usersSkipped: 0,
    usersPasswordResetNeeded: 0,
    ordersImported: 0,
    ordersSkipped: 0,
    fulfillmentsImported: 0,
    walletImported: 0,
    walletSkipped: 0,
    redeemImported: 0,
    redeemSkipped: 0
  };

  console.log(`Source: ${payload.meta?.source || 'unknown'}  store: ${payload.meta?.store || '?'}`);
  console.log(`Users: ${users.length}  Orders: ${orders.length}  Wallet tx: ${walletTransactions.length}`);

  if (opts.dryRun) {
    console.log('\nDry run — no database changes.');
    return stats;
  }

  const backup = backupDatabase();
  if (backup) console.log(`Backup: ${backup}`);

  ensureLegacyTables();
  const productMap = new Map();
  const variantMap = new Map();

  try {
    db.exec('BEGIN IMMEDIATE');
    importUsers(users, stats, opts);
    importOrders(orders, stats, productMap, variantMap);
    importWalletTransactions(walletTransactions, stats);
    importRedeemCodes(redeemCodes, stats);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }

  console.log('\nImport complete:');
  console.log(JSON.stringify(stats, null, 2));
  if (stats.usersPasswordResetNeeded > 0) {
    console.warn(`\n${stats.usersPasswordResetNeeded} user(s) had no valid bcrypt hash — they must reset password on loveriette.`);
  }
  return stats;
}

function printHelp() {
  console.log(`
Ezyshell → Loveriette migration

  node scripts/migrate-ezyshell.js import --file ./ezyshell-export.json
  node scripts/migrate-ezyshell.js import --file ./export.json --dry-run
  node scripts/migrate-ezyshell.js import --file ./export.json --skip-existing-users

See deploy/EZYSHELL-MIGRATION.md for export steps on your VPS.
`);
}

const args = parseArgs(process.argv);
if (args.command === 'import') {
  if (!args.file) {
    console.error('Missing --file path to ezyshell-export.json');
    process.exit(1);
  }
  runImport(args.file, args);
} else {
  printHelp();
}
