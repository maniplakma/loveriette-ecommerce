const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');
const appConfig = require('./config');

const db = new DatabaseSync(appConfig.dbPath);

function integrityCheck(database) {
  try {
    const row = database.prepare('PRAGMA integrity_check').get();
    const result = row?.integrity_check ?? Object.values(row || {})[0];
    return result === 'ok' ? { ok: true } : { ok: false, result: String(result) };
  } catch (err) {
    return { ok: false, result: err.message || String(err) };
  }
}

const integrity = integrityCheck(db);
if (!integrity.ok) {
  const msg = `[db] CRITICAL: integrity check failed (${integrity.result}). ` +
    `Restore server.js/ecom.db from ecom.db.pre-deploy-* backup or run: bash scripts/repair-db.sh`;
  console.error(msg);
  throw new Error(msg);
}

try {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
} catch (_) { /* ignore on read-only or unsupported */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(user_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS faqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS contact_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    icon TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    link_text TEXT NOT NULL,
    link_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS terms_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS privacy_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    instructions TEXT NOT NULL DEFAULT '[]',
    qr_image_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS redeem_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL DEFAULT 'fixed',
    discount_value INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    email TEXT NOT NULL,
    payment_method_id INTEGER NOT NULL,
    redeem_code_id INTEGER,
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
    FOREIGN KEY (redeem_code_id) REFERENCES redeem_codes(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
`);

// New feature tables (copied/adapted from the live admin: inventory, comms, reports, settings)
db.exec(`
  CREATE TABLE IF NOT EXISTS stock_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    service_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    profiles TEXT NOT NULL DEFAULT '[]',
    cost INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    valid_start TEXT,
    valid_end TEXT,
    status TEXT NOT NULL DEFAULT 'available',
    sold_to TEXT,
    sold_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    customer_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS dm_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    customer_name TEXT NOT NULL,
    last_message TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thread_id) REFERENCES dm_threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT,
    email TEXT NOT NULL,
    service TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    resolution TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const userMigrations = [
  'ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN username TEXT',
  'ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0'
];

for (const sql of userMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

const orderMigrations = [
  'ALTER TABLE orders ADD COLUMN receipt_url TEXT',
  'ALTER TABLE orders ADD COLUMN buyer_name TEXT',
  'ALTER TABLE orders ADD COLUMN tingi_drop_enabled INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE orders ADD COLUMN fulfillment_mode TEXT NOT NULL DEFAULT 'auto'",
  'ALTER TABLE orders ADD COLUMN order_seq INTEGER',
  'ALTER TABLE orders ADD COLUMN tingi_hold_until TEXT',
  'ALTER TABLE orders ADD COLUMN reject_reason TEXT'
];

for (const sql of orderMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

try {
  db.exec(`
    UPDATE orders SET status = 'pending' WHERE status = 'receipt_uploaded';
    UPDATE orders SET status = 'approved' WHERE status = 'paid';
    UPDATE orders SET status = 'rejected' WHERE status = 'cancelled';
  `);
} catch (_) { /* ignore */ }

// Backfill sequential display order IDs (1, 2, 3…)
try {
  const missing = db.prepare('SELECT id FROM orders WHERE order_seq IS NULL ORDER BY datetime(created_at) ASC, id ASC').all();
  if (missing.length) {
    const maxSeq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) AS m FROM orders').get().m;
    let seq = maxSeq;
    const upd = db.prepare('UPDATE orders SET order_seq = ? WHERE id = ?');
    for (const row of missing) {
      seq += 1;
      upd.run(seq, row.id);
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_seq ON orders(order_seq)');
} catch (_) { /* ignore */ }

// Generate @usernames for users that don't have one yet
try {
  const noUsername = db.prepare("SELECT id, name, email FROM users WHERE username IS NULL OR username = ''").all();
  const setUsername = db.prepare('UPDATE users SET username = ? WHERE id = ?');
  for (const u of noUsername) {
    const base = (u.name || u.email.split('@')[0] || 'user')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'user';
    setUsername.run(`${base}_${u.id}`, u.id);
  }
} catch (_) { /* ignore */ }

// Default key-value settings (loyalty, theme, store profile)
const defaultSettings = {
  loyalty_enabled: '1',
  loyalty_earn_rate: '0.005',
  loyalty_redeem_rate: '1',
  theme_light_primary: '#e50914',
  theme_dark_primary: '#ff3b3b',
  theme_force_mode: 'light',
  theme_bg: '#080404',
  theme_font: '#f0ecec',
  theme_primary: '#e50914',
  theme_secondary: '#ff3b3b',
  theme_colorhunt_url: '',
  store_display_name: 'loveriette shop',
  store_brand_name: 'loveriette',
  store_logo_url: '/assets/store-logo.png',
  store_logo_auto_theme: '1',
  store_name_font: 'Pacifico',
  store_bio: 'Lovebyriette offers digital products and premium accounts at affordable prices. Reliable, fast service, and open for supplying and bulk orders.',
  store_location: 'Marawi, Lanao del Sur, Philippines',
  store_profile_photo: '',
  vouch_seller_telegram: '@skyloverie',
  tingi_min_auto_drop: '5',
  tingi_checkout_enabled: '1',
  tingi_min_qty: '2',
  tingi_max_qty: '50',
  tingi_hold_days: '10',
  payment_instructions_text: 'Pay via QR only — send the exact amount or we cannot approve your order.\nMake sure you are paying the correct QR code.\nUploaded receipts only — edited or downloaded screenshots are not accepted.\nWe will review your payment shortly after you confirm.',
  order_guide_steps: JSON.stringify([
    {
      number: '1',
      title: 'Choose a product',
      description: 'Browse the catalog and select the plan you need.',
      bullets: ['Open Shop from the menu', 'Choose a product and variant (e.g. 1 month)']
    },
    {
      number: '2',
      title: 'Add to cart',
      description: 'Add items to your cart or go straight to checkout.',
      bullets: ['Tap Purchase on the plan card', 'Or use the cart icon to collect multiple items']
    },
    {
      number: '3',
      title: 'Checkout and pay',
      description: 'Complete payment via GCash or your chosen method.',
      bullets: ['Enter your email at checkout', 'Upload your payment receipt screenshot', 'Tap Confirm — we will review your order']
    },
    {
      number: '4',
      title: 'Get approved and access',
      description: 'We verify your payment, then deliver your credentials.',
      bullets: ['Wait for approval — usually within a few hours', 'Open My Account → Purchases for your details', 'Contact support if you need help']
    }
  ])
};
const upsertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
for (const [k, v] of Object.entries(defaultSettings)) {
  try { upsertSetting.run(k, v); } catch (_) { /* ignore */ }
}

try {
  const getVal = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  const set = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const cyberFlag = getVal('theme_cyber_noir_migrated');
  const bg = (getVal('theme_bg') || '').toLowerCase();
  const primary = (getVal('theme_primary') || '').toLowerCase();
  if (!cyberFlag && bg === '#f1dec9' && (primary === '#8d7b68' || primary === '')) {
    set.run('theme_bg', '#080404');
    set.run('theme_font', '#f0ecec');
    set.run('theme_primary', '#e50914');
    set.run('theme_secondary', '#ff3b3b');
    set.run('theme_light_primary', '#e50914');
    set.run('theme_cyber_noir_migrated', '1');
  }
  if (!getVal('theme_cyber_noir_v2')) {
    set.run('theme_bg', '#080404');
    set.run('theme_font', '#f0ecec');
    set.run('theme_primary', '#e50914');
    set.run('theme_secondary', '#ff3b3b');
    set.run('theme_light_primary', '#e50914');
    set.run('theme_colorhunt_url', '');
    set.run('theme_cyber_noir_v2', '1');
  }
  if (!getVal('flirty_copy_v1')) {
    set.run('order_guide_steps', defaultSettings.order_guide_steps);
    set.run('payment_instructions_text', defaultSettings.payment_instructions_text);
    set.run('flirty_copy_v1', '1');
  }
} catch (_) { /* ignore */ }

try {
  const guideSeed = defaultSettings.order_guide_steps;
  if (guideSeed && !db.prepare('SELECT 1 FROM settings WHERE key = ?').get('order_guide_steps')) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('order_guide_steps', guideSeed);
  }
} catch (_) { /* ignore */ }

try {
  const holdDays = Number(defaultSettings.tingi_hold_days) || 10;
  db.exec(`
    UPDATE orders SET tingi_hold_until = datetime(created_at, '+${holdDays} days')
    WHERE status = 'approved' AND fulfillment_mode = 'manual' AND tingi_hold_until IS NULL
  `);
} catch (_) { /* ignore */ }

const productMigrations = [
  'ALTER TABLE products ADD COLUMN long_description TEXT',
  'ALTER TABLE products ADD COLUMN views INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE products ADD COLUMN sold_count INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE products ADD COLUMN warranty TEXT DEFAULT '—'",
  'ALTER TABLE products ADD COLUMN updated_at TEXT',
  'ALTER TABLE products ADD COLUMN cost INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE products ADD COLUMN category_id INTEGER',
  'ALTER TABLE products ADD COLUMN allow_pre_order INTEGER NOT NULL DEFAULT 1',
  "ALTER TABLE products ADD COLUMN icon TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE products ADD COLUMN bulk_pricing_enabled INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE products ADD COLUMN bulk_tiers TEXT NOT NULL DEFAULT '[]'"
];

for (const sql of productMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

// Categories (groups) + product variants (plans). Hierarchy: category → product → plan/variant
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    duration TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    cost INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`);

// Variant description + rules (separate fields) + per-stock rules override
const variantStockMigrations = [
  "ALTER TABLE product_variants ADD COLUMN rules TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE stock_items ADD COLUMN variant_id INTEGER',
  "ALTER TABLE product_variants ADD COLUMN description TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE stock_items ADD COLUMN rules TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE product_variants ADD COLUMN bulk_pricing_enabled INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE product_variants ADD COLUMN bulk_tiers TEXT NOT NULL DEFAULT '[]'"
];
for (const sql of variantStockMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

const paymentMethodMigrations = [
  'ALTER TABLE payment_methods ADD COLUMN account_number TEXT'
];
for (const sql of paymentMethodMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

// Order fulfillment, wallet ledger, buyer reports linkage
db.exec(`
  CREATE TABLE IF NOT EXISTS order_fulfillments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    order_item_id INTEGER NOT NULL,
    stock_item_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE,
    UNIQUE(stock_item_id)
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'order',
    amount INTEGER NOT NULL DEFAULT 0,
    order_number TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const fulfillmentMigrations = [
  'ALTER TABLE order_items ADD COLUMN variant_id INTEGER',
  'ALTER TABLE users ADD COLUMN wallet_balance INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE product_reports ADD COLUMN user_id INTEGER',
  'ALTER TABLE product_reports ADD COLUMN stock_item_id INTEGER',
  "ALTER TABLE product_reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'report'",
  'ALTER TABLE product_reports ADD COLUMN remaining_days TEXT',
  'ALTER TABLE product_reports ADD COLUMN bank_account TEXT',
  'ALTER TABLE product_reports ADD COLUMN buyer_name TEXT',
  'ALTER TABLE product_reports ADD COLUMN proof_note TEXT',
  'ALTER TABLE cart_items ADD COLUMN variant_id INTEGER'
];
for (const sql of fulfillmentMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

const profileMigrations = [
  'ALTER TABLE users ADD COLUMN phone TEXT',
  'ALTER TABLE users ADD COLUMN avatar_url TEXT',
  'ALTER TABLE users ADD COLUMN country TEXT',
  'ALTER TABLE users ADD COLUMN timezone TEXT',
  'ALTER TABLE users ADD COLUMN last_login_at TEXT',
  'ALTER TABLE users ADD COLUMN last_login_ip TEXT',
  'ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE users ADD COLUMN notify_orders INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE users ADD COLUMN notify_marketing INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'",
  "ALTER TABLE users ADD COLUMN dark_mode TEXT NOT NULL DEFAULT 'system'",
  "ALTER TABLE users ADD COLUMN membership_level TEXT NOT NULL DEFAULT 'member'",
  "ALTER TABLE users ADD COLUMN social_links TEXT NOT NULL DEFAULT '{}'"
];
for (const sql of profileMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Performance indexes for common query patterns
const perfIndexes = [
  'CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email)',
  'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
  'CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)',
  'CREATE INDEX IF NOT EXISTS idx_order_fulfillments_order_id ON order_fulfillments(order_id)',
  'CREATE INDEX IF NOT EXISTS idx_order_fulfillments_order_item ON order_fulfillments(order_item_id)',
  'CREATE INDEX IF NOT EXISTS idx_order_fulfillments_stock ON order_fulfillments(stock_item_id)',
  'CREATE INDEX IF NOT EXISTS idx_stock_items_product_status ON stock_items(product_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_stock_items_variant_status ON stock_items(variant_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_dm_threads_user ON dm_threads(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages(thread_id)',
  'CREATE INDEX IF NOT EXISTS idx_dm_messages_thread_id ON dm_messages(thread_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_product_reports_user ON product_reports(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id)',
  'CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id)'
];
for (const sql of perfIndexes) {
  try { db.exec(sql); } catch (_) { /* ignore */ }
}

// Account credentials, email access, replacement audit, buyer notifications, refunds
db.exec(`
  CREATE TABLE IF NOT EXISTS email_access_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_item_id INTEGER NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    profile_data TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS account_replacement_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER,
    stock_item_id INTEGER NOT NULL,
    order_number TEXT,
    user_id INTEGER,
    old_email TEXT NOT NULL DEFAULT '',
    old_password TEXT NOT NULL DEFAULT '',
    old_profiles TEXT NOT NULL DEFAULT '[]',
    old_email_access TEXT NOT NULL DEFAULT '{}',
    new_email TEXT NOT NULL DEFAULT '',
    new_password TEXT NOT NULL DEFAULT '',
    new_profiles TEXT NOT NULL DEFAULT '[]',
    new_email_access TEXT NOT NULL DEFAULT '{}',
    admin_user_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE,
    FOREIGN KEY (report_id) REFERENCES product_reports(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS user_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS store_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS refund_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER,
    order_id INTEGER,
    order_number TEXT,
    user_id INTEGER,
    amount INTEGER NOT NULL DEFAULT 0,
    bank_account TEXT,
    status TEXT NOT NULL DEFAULT 'processed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES product_reports(id) ON DELETE SET NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
  );
`);

const reportCredentialMigrations = [
  'ALTER TABLE product_reports ADD COLUMN admin_notes TEXT',
  'ALTER TABLE product_reports ADD COLUMN stock_description TEXT',
  'ALTER TABLE product_reports ADD COLUMN resolution_action TEXT',
  'ALTER TABLE product_reports ADD COLUMN reject_reason TEXT',
  'ALTER TABLE product_reports ADD COLUMN proof_urls TEXT'
];
for (const sql of reportCredentialMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

const reportItemMigrations = [
  'ALTER TABLE product_reports ADD COLUMN order_item_id INTEGER',
  'ALTER TABLE product_reports ADD COLUMN fulfillment_id INTEGER',
  'ALTER TABLE product_reports ADD COLUMN reported_items TEXT',
  'ALTER TABLE product_reports ADD COLUMN report_quantity INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE product_reports ADD COLUMN reported_profiles TEXT',
  "ALTER TABLE stock_items ADD COLUMN credential_report_status TEXT NOT NULL DEFAULT 'ok'",
  'ALTER TABLE product_reports ADD COLUMN admin_note TEXT'
];
for (const sql of reportItemMigrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_access_stock ON email_access_credentials(stock_item_id);
    CREATE INDEX IF NOT EXISTS idx_replacement_history_stock ON account_replacement_history(stock_item_id);
    CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_refund_records_order ON refund_records(order_number);
  `);
} catch (_) { /* ignore */ }

// Backfill email_access_credentials from stock_items for sold accounts
try {
  const soldWithoutAccess = db.prepare(`
    SELECT s.id, s.email, s.password, s.profiles FROM stock_items s
    WHERE s.status = 'sold'
      AND NOT EXISTS (SELECT 1 FROM email_access_credentials e WHERE e.stock_item_id = s.id)
  `).all();
  const insAccess = db.prepare(`
    INSERT INTO email_access_credentials (stock_item_id, email, password, profile_data)
    VALUES (?, ?, ?, ?)
  `);
  for (const row of soldWithoutAccess) {
    insAccess.run(row.id, row.email || '', row.password || '', row.profiles || '[]');
  }
} catch (_) { /* ignore */ }

const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';

// Seed categories from the distinct product categories that already exist
if (db.prepare('SELECT COUNT(*) AS c FROM categories').get().c === 0) {
  const cats = db.prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> ''").all();
  const insCat = db.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)');
  const seedCats = cats.length ? cats.map((r) => r.category) : ['Entertainment', 'Editing', 'Educational'];
  seedCats.forEach((name, i) => { try { insCat.run(name, slugify(name), i); } catch (_) { /* dup slug */ } });
}

// Backfill products.category_id from the matching category name
try {
  const allCats = db.prepare('SELECT id, name FROM categories').all();
  const upd = db.prepare('UPDATE products SET category_id = ? WHERE category_id IS NULL AND LOWER(category) = LOWER(?)');
  allCats.forEach((c) => upd.run(c.id, c.name));
} catch (_) { /* ignore */ }

try {
  db.exec(`
    UPDATE product_variants SET description = duration
    WHERE TRIM(description) = '' AND TRIM(duration) != '';
  `);
} catch (_) { /* ignore */ }

// Seed a couple of plans/variants for the first product so the feature is visible
try {
  if (db.prepare('SELECT COUNT(*) AS c FROM product_variants').get().c === 0) {
    const first = db.prepare("SELECT id, price FROM products ORDER BY id ASC LIMIT 1").get();
    if (first) {
      const insV = db.prepare(
        'INSERT INTO product_variants (product_id, name, duration, price, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
      );
      insV.run(first.id, '1 Month', '30 days', first.price, '30 days · full subscription', 0);
      insV.run(first.id, '3 Months', '90 days', Math.round(first.price * 2.6), '90 days · best value', 1);
      insV.run(first.id, '1 Year', '365 days', Math.round(first.price * 9), '365 days · annual plan', 2);
    }
  }
} catch (_) { /* ignore */ }

// Seed a reasonable cost for products that don't have one yet (digital goods ~ low cost)
try {
  db.exec('UPDATE products SET cost = CAST(price * 0.15 AS INTEGER) WHERE cost = 0');
} catch (_) { /* ignore */ }

const seedProducts = [
  {
    name: 'Netflix Shared Profile',
    description: 'Shared profile · PH only · 1 device',
    long_description: '1 device only, ph only, and both email and password cannot be changed. 25-30 days is considered a full subscription. vouch required for warranty.',
    price: 85,
    status: 'AVAILABLE',
    category: 'Entertainment',
    views: 274,
    sold_count: 35,
    warranty: '30 days'
  },
  {
    name: 'Spotify Premium 1 Month',
    description: 'Ad-free music on all devices',
    long_description: 'Premium individual account. Ad-free listening, offline downloads, and high-quality audio on all your devices.',
    price: 150,
    status: 'AVAILABLE',
    category: 'Entertainment',
    views: 120,
    sold_count: 18,
    warranty: '30 days'
  },
  {
    name: 'CapCut Pro 1 Month',
    description: 'Premium editing tools and effects',
    long_description: 'Unlock all CapCut Pro features including premium effects, transitions, and export without watermark.',
    price: 120,
    status: 'AVAILABLE',
    category: 'Editing',
    views: 89,
    sold_count: 12,
    warranty: '30 days'
  },
  {
    name: 'Canva Pro 1 Month',
    description: 'Design templates and brand kit access',
    long_description: 'Access millions of premium templates, background remover, brand kit, and team features.',
    price: 180,
    status: 'AVAILABLE',
    category: 'Editing',
    views: 64,
    sold_count: 9,
    warranty: '30 days'
  },
  {
    name: 'Coursera Plus 1 Month',
    description: 'Unlimited access to top courses',
    long_description: 'Unlimited access to 7,000+ courses, guided projects, and professional certificates from top universities.',
    price: 250,
    status: 'AVAILABLE',
    category: 'Educational',
    views: 45,
    sold_count: 6,
    warranty: '30 days'
  },
  {
    name: 'Grammarly Premium 1 Month',
    description: 'Advanced writing suggestions and checks',
    long_description: 'Advanced grammar, tone, clarity, and plagiarism checks for better writing across all platforms.',
    price: 100,
    status: 'AVAILABLE',
    category: 'Educational',
    views: 38,
    sold_count: 5,
    warranty: '30 days'
  }
];

const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;

if (productCount === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, description, long_description, price, status, category, views, sold_count, warranty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const item of seedProducts) {
      insert.run(
        item.name, item.description, item.long_description,
        item.price, item.status, item.category,
        item.views, item.sold_count, item.warranty
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
} else {
  const netflix = db.prepare('SELECT id, long_description FROM products WHERE id = 1').get();
  if (netflix && !netflix.long_description) {
    const sample = seedProducts[0];
    db.prepare(`
      UPDATE products
      SET name = ?, description = ?, long_description = ?, price = ?,
          views = ?, sold_count = ?, warranty = ?, updated_at = datetime('now')
      WHERE id = 1
    `).run(
      sample.name, sample.description, sample.long_description,
      sample.price, sample.views, sample.sold_count, sample.warranty
    );
    const updateOthers = db.prepare(`
      UPDATE products
      SET long_description = ?, views = ?, sold_count = ?, warranty = ?
      WHERE id = ? AND long_description IS NULL
    `);
    seedProducts.slice(1).forEach((item, i) => {
      updateOthers.run(item.long_description, item.views, item.sold_count, item.warranty, i + 2);
    });
  }
}

// Backfill product icons from name when empty
const iconByName = [
  ['netflix', 'cbi:netflix-alt'],
  ['spotify', 'simple-icons:spotify'],
  ['capcut', 'arcticons:capcut'],
  ['canva', 'simple-icons:canva'],
  ['coursera', 'simple-icons:coursera'],
  ['grammarly', 'simple-icons:grammarly']
];
const setIcon = db.prepare("UPDATE products SET icon = ? WHERE id = ? AND (icon IS NULL OR icon = '')");
for (const row of db.prepare('SELECT id, name FROM products').all()) {
  const match = iconByName.find(([key]) => row.name.toLowerCase().includes(key));
  if (match) setIcon.run(match[1], row.id);
}

const seedFaqs = [
  {
    question: 'How do I get my account after payment?',
    answer: 'After your payment is approved, sign in and open My Account → Purchases. Your credentials (email, password, PIN, or access details) appear on the order page for that purchase. Delivery is digital only — nothing is shipped physically. If details are missing after approval, contact support with your order number and payment proof.',
    sort_order: 1
  },
  {
    question: 'Is there a warranty on digital products?',
    answer: 'Yes. Eligible shop items include a warranty period stated on the product page (commonly 30 days from delivery). Warranty covers defects such as login failure or service not working as described when used according to the product rules. It does not cover misuse, sharing against policy, or unauthorized credential changes on shared accounts. Open a support ticket with your order ID to request warranty service.',
    sort_order: 2
  },
  {
    question: 'Can I change the password on my account?',
    answer: 'For shared or profile-type products, do not change the registered email or password unless the listing explicitly allows it — unauthorized changes may void your warranty. For private or solo accounts labeled as fully yours, you may customize credentials after delivery. Always read the product description before modifying anything.',
    sort_order: 3
  },
  {
    question: 'What if I paid the wrong amount?',
    answer: 'Orders with incorrect payment amounts may be held or rejected until the difference is settled or the order is cancelled. Pay exactly the total shown at checkout and upload a clear, unedited receipt. Contact support before submitting a new payment if you are unsure.',
    sort_order: 4
  },
  {
    question: 'How do refunds work?',
    answer: 'Digital goods are generally final once delivered and working as described. Refunds or replacements are considered only for defective, incorrect, or misdescribed items, and must be requested within 24 hours of purchase with valid proof. Chargebacks without contacting us first may result in permanent account suspension.',
    sort_order: 5
  },
  {
    question: 'How can I reach support?',
    answer: 'Use the Contact page for Telegram, email, and channel links. When messaging support, include your registered email, order number, and a screenshot of the issue. Response times vary by queue volume; Telegram is usually the fastest during business hours.',
    sort_order: 6
  }
];

const seedContact = [
  {
    icon: 'telegram',
    title: 'Telegram',
    description: 'Chat with us directly on Telegram for the fastest response.',
    link_text: '@skyloverie',
    link_url: 'https://t.me/skyloverie',
    sort_order: 1
  },
  {
    icon: 'email',
    title: 'Email',
    description: "Send us an email and we'll get back to you as soon as possible.",
    link_text: 'riettemadzehn@gmail.com',
    link_url: 'mailto:riettemadzehn@gmail.com',
    sort_order: 2
  },
  {
    icon: 'channel',
    title: 'Telegram Channel',
    description: 'Join our Telegram channel for the latest updates, promos, and announcements.',
    link_text: '@lovebyriette',
    link_url: 'https://t.me/lovebyriette',
    sort_order: 3
  }
];

const faqCount = db.prepare('SELECT COUNT(*) AS count FROM faqs').get().count;
if (faqCount === 0) {
  const insertFaq = db.prepare(`
    INSERT INTO faqs (question, answer, sort_order) VALUES (?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const item of seedFaqs) {
      insertFaq.run(item.question, item.answer, item.sort_order);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const contactCount = db.prepare('SELECT COUNT(*) AS count FROM contact_channels').get().count;
if (contactCount === 0) {
  const insertContact = db.prepare(`
    INSERT INTO contact_channels (icon, title, description, link_text, link_url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const item of seedContact) {
      insertContact.run(
        item.icon, item.title, item.description,
        item.link_text, item.link_url, item.sort_order
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const seedTerms = [
  {
    title: '1. Acceptance of Terms',
    body: 'By accessing or using Loveriette ("the Platform"), you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree, you must not use the Platform. You represent that you are at least 18 years of age or have legal parental consent, and that you have the legal capacity to enter into this agreement under applicable law in the Philippines.',
    sort_order: 1
  },
  {
    title: '2. Account Registration & Security',
    body: 'You must register with a valid email address and maintain accurate account information. You are solely responsible for all activity under your account and for safeguarding your login credentials. Notify us immediately of unauthorized access. We may suspend or terminate accounts with false information, duplicate abuse accounts, or suspected fraud without prior notice.',
    sort_order: 2
  },
  {
    title: '3. Digital Products & Services',
    body: 'All shop items are digital goods or access credentials delivered electronically. Website making and plugging are professional services governed by the scope agreed at purchase or inquiry. Descriptions, stock labels, and warranty periods on product pages form part of your order. You agree not to resell, redistribute, or publicly share purchased credentials unless explicitly permitted in writing.',
    sort_order: 3
  },
  {
    title: '4. Payment, Verification & Delivery',
    body: 'You must pay the exact amount shown at checkout using approved payment methods. Upload only genuine, unedited payment receipts. We manually verify payments; delivery times depend on review queues and business hours. Orders with incorrect amounts, invalid receipts, or suspected fraud may be rejected. Delivery is complete when credentials or access are posted to your account or issued via the service workflow.',
    sort_order: 4
  },
  {
    title: '5. Prohibited Conduct',
    body: 'You may not: (a) use the Platform for illegal activity; (b) attempt to hack, scrape, or disrupt our systems; (c) submit fraudulent payments or chargebacks in bad faith; (d) harass staff or other users; (e) circumvent access controls or share admin tools; (f) use plugging or automation to spam, impersonate, or violate Telegram\'s terms; (g) misrepresent your identity or payment source.',
    sort_order: 5
  },
  {
    title: '6. Refunds, Replacements & Chargebacks',
    body: 'Except where required by law, all sales are final once digital goods are delivered and functioning as described. Refunds or replacements are granted only for defective, incorrect, or materially misdescribed items, requested within 24 hours of purchase with order ID and proof. Initiating a payment chargeback without first contacting support may result in immediate and permanent account termination and forfeiture of access.',
    sort_order: 6
  },
  {
    title: '7. Warranty Disclaimer',
    body: 'THE PLATFORM AND ALL PRODUCTS ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. We do not guarantee uninterrupted uptime of third-party services (e.g., streaming apps, Telegram). Warranty on specific shop items, if any, is limited to the period and terms stated on the product page.',
    sort_order: 7
  },
  {
    title: '8. Limitation of Liability',
    body: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, LOVERIETTE AND ITS OPERATORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, DATA, OR GOODWILL. OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM YOUR USE OF THE PLATFORM SHALL NOT EXCEED THE AMOUNT YOU PAID FOR THE SPECIFIC ORDER GIVING RISE TO THE CLAIM IN THE 30 DAYS BEFORE THE CLAIM.',
    sort_order: 8
  },
  {
    title: '9. Account Suspension & Termination',
    body: 'We may suspend or terminate your account at any time for violation of these Terms, fraud, abuse, excessive refund requests, chargebacks, or conduct harmful to the Platform or other users. Upon termination, you lose access to undelivered or delivered digital goods without refund, except where law requires otherwise.',
    sort_order: 9
  },
  {
    title: '10. Changes to Terms',
    body: 'We may modify these Terms at any time. Material changes will be posted on this page with an updated date. Continued use after changes constitutes acceptance. If you disagree with updated Terms, you must stop using the Platform and close your account.',
    sort_order: 10
  },
  {
    title: '11. Governing Law & Disputes',
    body: 'These Terms are governed by the laws of the Republic of the Philippines. You agree to first attempt informal resolution by contacting us through official channels. Unresolved disputes shall be subject to the exclusive jurisdiction of competent courts in the Philippines, unless mandatory consumer protection law provides otherwise.',
    sort_order: 11
  },
  {
    title: '12. Contact',
    body: 'For questions about these Terms, contact us via the Contact page (Telegram, email) or through your order dashboard. Official support only responds through channels listed on loveriette.com — do not trust unsolicited messages claiming to be staff.',
    sort_order: 12
  }
];

const seedPrivacy = [
  {
    title: '1. Information We Collect',
    body: 'We collect: (a) account data — name, email, password hash, and profile details you provide; (b) order data — products purchased, payment receipts you upload, delivery credentials, and support messages; (c) technical data — IP address, browser type, device information, session cookies, and pages visited; (d) communications — chat, tickets, and inquiry messages. We do not intentionally collect government ID unless you voluntarily provide it for a specific service.',
    sort_order: 1
  },
  {
    title: '2. How We Use Your Information',
    body: 'We use your data to: create and manage your account; process and verify payments; deliver digital products and services; provide customer support; send order status updates; prevent fraud and abuse; improve Platform security and performance; and comply with legal obligations. We do not sell your personal information to third-party marketers.',
    sort_order: 2
  },
  {
    title: '3. Legal Basis & Consent',
    body: 'We process your information to perform our contract with you (fulfilling orders), for legitimate interests (fraud prevention, security, analytics), and where required by law. By using the Platform, you consent to this Policy. You may withdraw consent for optional communications by contacting us, but this may limit certain features.',
    sort_order: 3
  },
  {
    title: '4. Data Sharing & Third Parties',
    body: 'We may share limited data with: payment and messaging providers (e.g., Telegram) necessary to deliver services; hosting and infrastructure providers under confidentiality obligations; and law enforcement when legally required. Third-party platforms have their own privacy policies. We require service providers to handle data only for authorized purposes.',
    sort_order: 4
  },
  {
    title: '5. Data Retention',
    body: 'We retain account and order records while your account is active and for a reasonable period afterward for legal, tax, and dispute resolution purposes (typically up to 3 years unless a longer period is required by law). Payment receipt images may be deleted or anonymized after order resolution. You may request deletion subject to legal retention requirements.',
    sort_order: 5
  },
  {
    title: '6. Security Measures',
    body: 'We implement reasonable administrative, technical, and organizational safeguards including encrypted passwords, access controls, and secure hosting. No method of transmission over the internet is 100% secure. You are responsible for protecting your account password and not sharing credentials with others.',
    sort_order: 6
  },
  {
    title: '7. Cookies & Local Storage',
    body: 'We use essential cookies and local storage for authentication, cart persistence, theme preferences, and session management. These are necessary for core Platform functionality. You may disable cookies in your browser, but some features may not work correctly.',
    sort_order: 7
  },
  {
    title: '8. Your Rights',
    body: 'Subject to applicable law (including the Philippine Data Privacy Act), you may request: access to personal data we hold about you; correction of inaccurate data; deletion where no legal basis requires retention; and restriction of certain processing. Submit requests via the Contact page with identity verification. We respond within a reasonable timeframe.',
    sort_order: 8
  },
  {
    title: '9. Children\'s Privacy',
    body: 'The Platform is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us data, contact us immediately and we will delete it.',
    sort_order: 9
  },
  {
    title: '10. International Transfers',
    body: 'Your data may be processed on servers located outside your country. By using the Platform, you consent to transfer and processing in jurisdictions that may have different data protection laws, with appropriate safeguards where required.',
    sort_order: 10
  },
  {
    title: '11. Changes to This Policy',
    body: 'We may update this Privacy Policy from time to time. Changes are posted on this page with an updated effective date. Material changes may be communicated via the Platform or email where appropriate. Continued use after changes constitutes acceptance.',
    sort_order: 11
  },
  {
    title: '12. Contact Us',
    body: 'For privacy-related requests or questions, contact us through the official channels on our Contact page (Telegram or email). Include "Privacy Request" in your message and sufficient information to verify your identity.',
    sort_order: 12
  }
];

const termsCount = db.prepare('SELECT COUNT(*) AS count FROM terms_sections').get().count;
if (termsCount === 0) {
  const insert = db.prepare('INSERT INTO terms_sections (title, body, sort_order) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const item of seedTerms) insert.run(item.title, item.body, item.sort_order);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

try {
  const flirtyFaqFlag = db.prepare('SELECT value FROM settings WHERE key = ?').get('flirty_faq_terms_v1');
  if (!flirtyFaqFlag) {
    const faqUpd = db.prepare('UPDATE faqs SET question = ?, answer = ? WHERE sort_order = ?');
    for (const f of seedFaqs) faqUpd.run(f.question, f.answer, f.sort_order);
    const termUpd = db.prepare('UPDATE terms_sections SET title = ?, body = ? WHERE sort_order = ?');
    for (const t of seedTerms) termUpd.run(t.title, t.body, t.sort_order);
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('flirty_faq_terms_v1', '1');
  }
} catch (_) { /* ignore */ }

try {
  const strictFlag = db.prepare('SELECT value FROM settings WHERE key = ?').get('strict_legal_faqs_v2');
  if (!strictFlag) {
    db.prepare('DELETE FROM faqs').run();
    const faqIns = db.prepare('INSERT INTO faqs (question, answer, sort_order) VALUES (?, ?, ?)');
    for (const f of seedFaqs) faqIns.run(f.question, f.answer, f.sort_order);

    db.prepare('DELETE FROM terms_sections').run();
    const termIns = db.prepare('INSERT INTO terms_sections (title, body, sort_order) VALUES (?, ?, ?)');
    for (const t of seedTerms) termIns.run(t.title, t.body, t.sort_order);

    db.prepare('DELETE FROM privacy_sections').run();
    const privIns = db.prepare('INSERT INTO privacy_sections (title, body, sort_order) VALUES (?, ?, ?)');
    for (const p of seedPrivacy) privIns.run(p.title, p.body, p.sort_order);

    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('strict_legal_faqs_v2', '1');
  }
} catch (_) { /* ignore */ }

try {
  const socialFlag = db.prepare('SELECT value FROM settings WHERE key = ?').get('default_social_links_v1');
  if (!socialFlag) {
    const defaultSocial = JSON.stringify([
      { key: 'telegram', label: 'Telegram', url: 'https://t.me/skyloverie', enabled: true },
      { key: 'email', label: 'Email', url: 'mailto:riettemadzehn@gmail.com', enabled: true },
      { key: 'channel', label: 'Telegram Channel', url: 'https://t.me/lovebyriette', enabled: true }
    ]);
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get('social_links');
    if (!existing || !String(existing.value || '').trim() || String(existing.value).trim() === '[]') {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run('social_links', defaultSocial);
    }
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('default_social_links_v1', '1');
  }
} catch (_) { /* ignore */ }

const privacyCount = db.prepare('SELECT COUNT(*) AS count FROM privacy_sections').get().count;
if (privacyCount === 0) {
  const insert = db.prepare('INSERT INTO privacy_sections (title, body, sort_order) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const item of seedPrivacy) insert.run(item.title, item.body, item.sort_order);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const seedPaymentMethods = [
  {
    name: 'GCASH',
    slug: 'gcash',
    instructions: JSON.stringify([
      'Send payment via GCash to the number shown in admin settings.',
      'Upload your receipt after payment.'
    ]),
    qr_image_url: '',
    sort_order: 1
  },
  {
    name: 'QRPH',
    slug: 'qrph',
    instructions: JSON.stringify([
      'Scan the QR code using any supported bank or e-wallet app.',
      'Send the exact amount shown.'
    ]),
    qr_image_url: '',
    sort_order: 2
  },
  {
    name: 'MARIBANK',
    slug: 'maribank',
    instructions: JSON.stringify([
      'Payment is accepted via QR only.',
      'Please send the exact amount or your order may be rejected.',
      'Make sure you are paying to the correct QR code.',
      'Uploaded receipts only — downloaded or edited receipts will not be accepted.'
    ]),
    qr_image_url: '',
    sort_order: 3
  }
];

const seedRedeemCodes = [
  { code: 'LOVERIE10', discount_type: 'fixed', discount_value: 10, max_uses: 100 },
  { code: 'WELCOME5', discount_type: 'percent', discount_value: 5, max_uses: null }
];

const paymentCount = db.prepare('SELECT COUNT(*) AS count FROM payment_methods').get().count;
if (paymentCount === 0) {
  const insert = db.prepare(`
    INSERT INTO payment_methods (name, slug, instructions, qr_image_url, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const m of seedPaymentMethods) {
      insert.run(m.name, m.slug, m.instructions, m.qr_image_url, m.sort_order);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const redeemCount = db.prepare('SELECT COUNT(*) AS count FROM redeem_codes').get().count;
if (redeemCount === 0) {
  const insert = db.prepare(`
    INSERT INTO redeem_codes (code, discount_type, discount_value, max_uses)
    VALUES (?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const c of seedRedeemCodes) {
      insert.run(c.code, c.discount_type, c.discount_value, c.max_uses);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Seed sample data for the new admin sections (only if empty)
if (db.prepare('SELECT COUNT(*) AS c FROM admin_notifications').get().c === 0) {
  const ins = db.prepare('INSERT INTO admin_notifications (type, title, body, is_read) VALUES (?, ?, ?, ?)');
  const seed = [
    ['chat', 'New Chat Message', 'A buyer started a chat conversation.', 0],
    ['order', 'New order received', 'Order #401 is awaiting payment review.', 0],
    ['message', 'New message from buyer', 'Hello, di ako makapag fetch ng email.', 0],
    ['payout', 'Payment approved', 'Order #400 was marked as paid.', 1],
    ['report', 'Product report filed', 'A buyer reported an issue with a Netflix account.', 1]
  ];
  for (const s of seed) ins.run(...s);
}

if (db.prepare('SELECT COUNT(*) AS c FROM chat_sessions').get().c === 0) {
  const insS = db.prepare('INSERT INTO chat_sessions (customer_name, status) VALUES (?, ?)');
  const insM = db.prepare('INSERT INTO chat_messages (session_id, sender, body) VALUES (?, ?, ?)');
  const sessions = [
    ['Angel Luna', 'closed'],
    ['Hanna Macasling', 'closed'],
    ['chi', 'open']
  ];
  sessions.forEach((s) => {
    const r = insS.run(s[0], s[1]);
    insM.run(r.lastInsertRowid, 'customer', 'Hello po, tanong ko lang sa order ko.');
    insM.run(r.lastInsertRowid, 'admin', 'Hi! Sure, ano pong order number?');
  });
}

if (db.prepare('SELECT COUNT(*) AS c FROM store_updates').get().c === 0) {
  const insUp = db.prepare('INSERT INTO store_updates (title, body, is_published) VALUES (?, ?, 1)');
  insUp.run(
    'Welcome to Loveriette',
    'Browse premium digital subscriptions, pay via GCash, and receive your credentials after approval.'
  );
  insUp.run(
    'Need help?',
    'Use Chat Seller in the sidebar to message our team directly.'
  );
}

if (db.prepare('SELECT COUNT(*) AS c FROM dm_threads').get().c === 0) {
  const insT = db.prepare('INSERT INTO dm_threads (customer_name, last_message) VALUES (?, ?)');
  const insM = db.prepare('INSERT INTO dm_messages (thread_id, sender, body) VALUES (?, ?, ?)');
  const threads = [
    ['Angel Luna', 'hellooo poooo'],
    ['Hanna Macasling', 'shared po'],
    ['justwista', 'hello! rejected po order ko nung may 8']
  ];
  threads.forEach((t) => {
    const r = insT.run(t[0], t[1]);
    insM.run(r.lastInsertRowid, 'customer', t[1]);
  });
}

const ADMIN_EMAIL = (appConfig.adminEmail || 'admin@localhost').toLowerCase();
const ADMIN_PASSWORD = appConfig.adminPassword || 'changeme-local-only';
const ADMIN_NAME = appConfig.adminName || 'Site Admin';

const existingAdmin = db.prepare('SELECT id, is_admin FROM users WHERE email = ?').get(ADMIN_EMAIL);
if (!existingAdmin) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO users (email, password_hash, name, is_admin) VALUES (?, ?, ?, 1)')
    .run(ADMIN_EMAIL, hash, ADMIN_NAME);
} else if (!existingAdmin.is_admin) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existingAdmin.id);
}

/**
 * Wipe transactional data — keeps default admin, catalog, settings, payment methods.
 */
function resetWebsiteData() {
  const configuredEmail = (appConfig.adminEmail || '').toLowerCase();
  let admin = configuredEmail
    ? db.prepare('SELECT id, email FROM users WHERE LOWER(email) = ?').get(configuredEmail)
    : null;
  if (!admin) {
    admin = db.prepare('SELECT id, email FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
  }
  if (!admin) throw new Error('Default admin account not found');

  const wipeTables = [
    'website_inquiry_messages',
    'website_inquiries',
    'plugging_activity_log',
    'plugging_proxies',
    'plugging_accounts',
    'plugging_orders',
    'plugging_requests',
    'activity_feed',
    'page_visits',
    'product_reviews',
    'refund_records',
    'account_replacement_history',
    'store_updates',
    'user_notifications',
    'wallet_transactions',
    'order_fulfillments',
    'order_items',
    'orders',
    'cart_items',
    'product_reports',
    'support_tickets',
    'email_access_credentials',
    'stock_items',
    'dm_messages',
    'dm_threads',
    'chat_messages',
    'chat_sessions',
    'admin_notifications'
  ];

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const table of wipeTables) {
      try {
        db.exec(`DELETE FROM ${table}`);
      } catch (err) {
        if (String(err.message || '').includes('no such table')) continue;
        throw new Error(`Failed wiping ${table}: ${err.message || err}`);
      }
    }
    db.prepare('DELETE FROM users WHERE id != ?').run(admin.id);
    db.exec('UPDATE redeem_codes SET used_count = 0');

    const products = db.prepare('SELECT id, name FROM products ORDER BY id').all();
    const updProduct = db.prepare(
      'UPDATE products SET sold_count = ?, views = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?'
    );
    for (const p of products) {
      const seed = seedProducts.find((s) => s.name === p.name) || { sold_count: 0, views: 0, status: 'AVAILABLE' };
      updProduct.run(seed.sold_count || 0, seed.views || 0, seed.status || 'AVAILABLE', p.id);
    }

    db.prepare(`
      UPDATE users SET
        wallet_balance = 0,
        phone = NULL,
        avatar_url = NULL,
        country = NULL,
        timezone = NULL,
        last_login_at = NULL,
        last_login_ip = NULL,
        session_version = session_version + 1,
        suspended = 0
      WHERE id = ?
    `).run(admin.id);

    db.exec('PRAGMA foreign_keys = ON');
    db.exec('COMMIT');
    return { adminId: admin.id, adminEmail: admin.email };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* transaction may already be closed */ }
    throw err;
  }
}

db.resetWebsiteData = resetWebsiteData;

const { initPlatformDb } = require('./platform-db');
initPlatformDb(db);

const { initGmailSchema } = require('./gmail-schema');
const { initMailerSchema } = require('./mailer-schema');
const { initGamesSchema } = require('./games-schema');
initGmailSchema(db);
initMailerSchema(db);
initGamesSchema(db);

/** Verify checkout-critical columns exist (production DB may lag behind code). */
function ensureCriticalSchema() {
  const required = {
    orders: ['order_seq', 'tingi_drop_enabled', 'fulfillment_mode', 'receipt_url', 'reject_reason'],
    order_items: ['variant_id']
  };
  const missing = [];
  for (const [table, cols] of Object.entries(required)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const col of cols) {
      if (!have.has(col)) missing.push(`${table}.${col}`);
    }
  }
  if (!missing.length) return { ok: true, missing: [] };

  const fixes = {
    'orders.order_seq': 'ALTER TABLE orders ADD COLUMN order_seq INTEGER',
    'orders.tingi_drop_enabled': 'ALTER TABLE orders ADD COLUMN tingi_drop_enabled INTEGER NOT NULL DEFAULT 0',
    'orders.fulfillment_mode': "ALTER TABLE orders ADD COLUMN fulfillment_mode TEXT NOT NULL DEFAULT 'auto'",
    'orders.receipt_url': 'ALTER TABLE orders ADD COLUMN receipt_url TEXT',
    'orders.reject_reason': 'ALTER TABLE orders ADD COLUMN reject_reason TEXT',
    'order_items.variant_id': 'ALTER TABLE order_items ADD COLUMN variant_id INTEGER'
  };
  for (const key of missing) {
    const sql = fixes[key];
    if (!sql) continue;
    try {
      db.exec(sql);
    } catch (err) {
      console.error(`[db] schema fix failed for ${key}:`, err.message);
    }
  }
  const stillMissing = [];
  for (const [table, cols] of Object.entries(required)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const col of cols) {
      if (!have.has(col)) stillMissing.push(`${table}.${col}`);
    }
  }
  if (stillMissing.length) {
    console.error('[db] CRITICAL missing columns after repair:', stillMissing.join(', '));
  }
  return { ok: !stillMissing.length, missing: stillMissing };
}

db.ensureCriticalSchema = ensureCriticalSchema;
ensureCriticalSchema();

module.exports = db;
