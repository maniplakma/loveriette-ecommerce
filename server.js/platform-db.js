/**
 * Platform schema: website-making, CMS, SEO, analytics.
 * Loaded by db.js after core tables exist.
 */
function initPlatformDb(db) {
  const slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

  const productPlatformMigrations = [
    'ALTER TABLE products ADD COLUMN slug TEXT',
    'ALTER TABLE products ADD COLUMN meta_title TEXT',
    'ALTER TABLE products ADD COLUMN meta_description TEXT',
    'ALTER TABLE products ADD COLUMN og_image TEXT',
    'ALTER TABLE products ADD COLUMN image_url TEXT',
    'ALTER TABLE products ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE products ADD COLUMN promo_banner TEXT'
  ];
  for (const sql of productPlatformMigrations) {
    try { db.exec(sql); } catch (_) { /* exists */ }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Customer',
      rating INTEGER NOT NULL DEFAULT 5,
      body TEXT NOT NULL DEFAULT '',
      is_published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotional_banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      link_url TEXT,
      scope TEXT NOT NULL DEFAULT 'shop',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cms_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_key TEXT NOT NULL UNIQUE,
      section_type TEXT NOT NULL DEFAULT 'content',
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cms_statistics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cms_testimonials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL DEFAULT 'general',
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 5,
      avatar_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cms_faqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'home',
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cms_banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'home',
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      link_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cms_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'all',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_type TEXT NOT NULL DEFAULT 'order',
      message TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS page_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      referrer TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS platform_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS website_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'custom',
      description TEXT NOT NULL DEFAULT '',
      long_description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      price_label TEXT NOT NULL DEFAULT '',
      features TEXT NOT NULL DEFAULT '[]',
      meta_title TEXT,
      meta_description TEXT,
      og_image TEXT,
      image_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS website_portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      link_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS website_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (package_id) REFERENCES website_packages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS plugging_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugging_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'mdi:send',
      category TEXT NOT NULL DEFAULT 'Plugging',
      features TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plugging_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      price_label TEXT NOT NULL DEFAULT '',
      max_sources INTEGER NOT NULL DEFAULT 1,
      max_destinations INTEGER NOT NULL DEFAULT 3,
      features TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plugging_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      plan_id INTEGER,
      user_id INTEGER,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      telegram_username TEXT NOT NULL DEFAULT '',
      source_chat TEXT NOT NULL DEFAULT '',
      destination_chats TEXT NOT NULL DEFAULT '',
      filter_keywords TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      admin_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES plugging_plans(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS plugging_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_ref TEXT NOT NULL UNIQUE,
      plan_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL DEFAULT 0,
      payment_method_id INTEGER,
      receipt_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      access_key TEXT UNIQUE,
      approved_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES plugging_plans(id)
    );

    CREATE TABLE IF NOT EXISTS plugging_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      session_string TEXT NOT NULL DEFAULT '',
      auth_status TEXT NOT NULL DEFAULT 'pending',
      phone_code_hash TEXT,
      source_link TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      delay_minutes INTEGER NOT NULL DEFAULT 5,
      targets_text TEXT NOT NULL DEFAULT '',
      runner_status TEXT NOT NULL DEFAULT 'stopped',
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      cycles_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      proxy_url TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES plugging_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plugging_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL DEFAULT '',
      target_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES plugging_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plugging_proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS footer_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const platformIndexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug) WHERE slug IS NOT NULL AND slug != ""',
    'CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews(product_id)',
    'CREATE INDEX IF NOT EXISTS idx_page_visits_path ON page_visits(path)',
    'CREATE INDEX IF NOT EXISTS idx_page_visits_created ON page_visits(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_website_inquiries_status ON website_inquiries(status)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_requests_status ON plugging_requests(status)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_orders_status ON plugging_orders(status)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_accounts_order ON plugging_accounts(order_id)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_activity_account ON plugging_activity_log(account_id, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_plans_product ON plugging_plans(product_id)',
    'CREATE INDEX IF NOT EXISTS idx_activity_feed_created ON activity_feed(created_at)'
  ];
  for (const sql of platformIndexes) {
    try { db.exec(sql); } catch (_) { /* ignore */ }
  }

  try { db.exec(`ALTER TABLE plugging_accounts ADD COLUMN proxy_url TEXT NOT NULL DEFAULT ''`); } catch (_) { /* exists */ }
  try { db.exec(`ALTER TABLE plugging_orders ADD COLUMN expires_at TEXT`); } catch (_) { /* exists */ }
  try { db.exec(`ALTER TABLE plugging_plans ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`); } catch (_) { /* exists */ }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugging_proxies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (_) { /* ignore */ }

  // Backfill product slugs
  try {
    const noSlug = db.prepare("SELECT id, name FROM products WHERE slug IS NULL OR slug = ''").all();
    const upd = db.prepare('UPDATE products SET slug = ? WHERE id = ?');
    const taken = new Set(db.prepare("SELECT slug FROM products WHERE slug IS NOT NULL AND slug != ''").all().map((r) => r.slug));
    for (const p of noSlug) {
      let slug = slugify(p.name);
      let n = 1;
      while (taken.has(slug)) { slug = `${slugify(p.name)}-${n++}`; }
      taken.add(slug);
      upd.run(slug, p.id);
    }
  } catch (_) { /* ignore */ }

  const defaultPlatform = {
    shop_enabled: '1',
    website_making_enabled: '1'
  };
  const upsertPlatform = db.prepare('INSERT INTO platform_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  for (const [k, v] of Object.entries(defaultPlatform)) {
    try { upsertPlatform.run(k, v); } catch (_) { /* ignore */ }
  }

  const defaultPlugging = {
    plugging_enabled: '1',
    plugging_hero_title: 'Telegram Plugging Service',
    plugging_hero_subtitle: 'Connect your Telegram, set your source & targets in the workspace, and the auto forwarder runs on your account — instantly, no admin setup.',
    plugging_how_it_works: JSON.stringify([
      { title: 'Choose a plan & pay', text: 'Select a plugging package and upload your payment receipt.' },
      { title: 'Get your access key', text: 'After admin approves payment, you receive a unique access key.' },
      { title: 'Enter workspace', text: 'Use your access key at the plugging workspace to log in.' },
      { title: 'Connect Telegram', text: 'Enter your phone number, receive the Telegram code, and start forwarding.' }
    ]),
    plugging_contact_telegram: '',
    telegram_api_id: '',
    telegram_api_hash: '',
    proxy_enabled: '0',
    proxy_url: '',
    plug_master_key: '',
    plug_master_key_created_at: ''
  };
  const upsertPlugging = db.prepare('INSERT INTO plugging_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  for (const [k, v] of Object.entries(defaultPlugging)) {
    try { upsertPlugging.run(k, v); } catch (_) { /* ignore */ }
  }
  try {
    db.prepare(`UPDATE plugging_content SET value = ? WHERE key = 'plugging_hero_subtitle'`)
      .run(defaultPlugging.plugging_hero_subtitle);
  } catch (_) { /* ignore */ }

  const defaultFooter = {
    footer_tagline: 'Premium digital services for everyone.',
    footer_copyright: '© 2026 LOVERIETTE. ALL RIGHTS RESERVED.'
  };
  const upsertFooter = db.prepare('INSERT INTO footer_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  for (const [k, v] of Object.entries(defaultFooter)) {
    try { upsertFooter.run(k, v); } catch (_) { /* ignore */ }
  }

  // Seed CMS sections if empty
  if (db.prepare('SELECT COUNT(*) AS c FROM cms_sections').get().c === 0) {
    const ins = db.prepare(`
      INSERT INTO cms_sections (section_key, section_type, title, subtitle, body, content_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const sections = [
      ['why_choose_us', 'features', 'Why Choose Us', 'Trusted by thousands', '', JSON.stringify({
        items: [
          { icon: 'shield', title: 'Secure & Reliable', text: 'Enterprise-grade security for every transaction.' },
          { icon: 'zap', title: 'Fast Delivery', text: 'Instant access to digital products after approval.' },
          { icon: 'heart', title: 'Dedicated Support', text: 'Real people ready to help via chat and tickets.' },
          { icon: 'star', title: 'Premium Quality', text: 'Curated services at affordable prices.' }
        ]
      }), 1],
      ['service_categories', 'categories', 'Our Services', 'Shop, websites, and plugging — one platform', '', JSON.stringify({
        items: [
          { title: 'Plugging', desc: 'Telegram message auto forwarder — automatically relay messages to your groups and channels.', link: '/plugging', icon: 'plug', cta: 'Plugging', primary: true },
          { title: 'Shop', desc: 'Premium digital products, apps, and subscriptions delivered instantly after purchase.', link: '/shop', icon: 'cart', cta: 'Browse Shop' },
          { title: 'Website Making', desc: 'Custom ecommerce sites, auto-order platforms, and ongoing maintenance for your brand.', link: '/website-making', icon: 'web', cta: 'View Packages' }
        ]
      }), 2]
    ];
    sections.forEach((s) => ins.run(...s));
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM cms_faqs WHERE scope = ?').get('home').c === 0) {
    const ins = db.prepare('INSERT INTO cms_faqs (scope, question, answer, sort_order) VALUES (?, ?, ?, ?)');
    [
      ['home', 'What services do you offer?', 'We offer digital products, website development, and plugging services.', 0],
      ['home', 'How do I place an order?', 'Browse our shop, select a product, checkout, and upload your payment receipt.', 1],
      ['home', 'Is my payment secure?', 'Yes. We verify payments manually and never store card details.', 2]
    ].forEach((r) => ins.run(...r));
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM website_packages').get().c === 0) {
    const ins = db.prepare(`
      INSERT INTO website_packages (name, slug, category, description, long_description, price, price_label, features, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const pkgs = [
      ['Ecommerce Website', 'ecommerce', 'ecommerce', 'Full online store with cart & checkout.', 'Complete ecommerce solution with product catalog, cart, payment integration, and admin panel.', 25000, 'Starting at ₱25,000', '["Product catalog","Cart & checkout","Admin panel","Mobile responsive"]', 0],
      ['Auto Order Website', 'auto-order', 'auto-order', 'Automated order processing site.', 'Streamlined ordering with automated fulfillment workflows.', 18000, 'Starting at ₱18,000', '["Auto order flow","Payment QR","Order notifications","Admin dashboard"]', 1],
      ['Custom Website', 'custom', 'custom', 'Tailored design for your brand.', 'Fully custom design and development based on your requirements.', 35000, 'Starting at ₱35,000', '["Custom design","Unique features","SEO setup","Training included"]', 2],
      ['Business Website', 'business', 'business', 'Professional corporate presence.', 'Clean business site with services, about, and contact pages.', 15000, 'Starting at ₱15,000', '["5 pages","Contact form","Google Maps","Social links"]', 3],
      ['Landing Page', 'landing-page', 'landing', 'High-converting single page.', 'Focused landing page optimized for conversions.', 8000, 'Starting at ₱8,000', '["Single page","CTA optimized","Mobile first","Fast loading"]', 4],
      ['Maintenance Service', 'maintenance', 'maintenance', 'Ongoing site care & updates.', 'Monthly maintenance including updates, backups, and minor edits.', 3000, '₱3,000/month', '["Monthly updates","Security patches","Backup","Minor edits"]', 5],
      ['Monthly Website Rental', 'rental', 'rental', 'Rent a ready-made website.', 'Get a fully managed website with monthly subscription.', 2500, '₱2,500/month', '["Ready-made site","Hosting included","Monthly updates","Support included"]', 6]
    ];
    pkgs.forEach((p) => ins.run(...p));
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM cms_faqs WHERE scope = ?').get('website').c === 0) {
    const ins = db.prepare('INSERT INTO cms_faqs (scope, question, answer, sort_order) VALUES (?, ?, ?, ?)');
    [
      ['website', 'How long does it take to build a website?', 'Typical turnaround is 1-2 weeks depending on complexity.', 0],
      ['website', 'Do you provide hosting?', 'Yes, hosting is included in rental and maintenance packages.', 1],
      ['website', 'Can I request changes after launch?', 'Minor edits are included in maintenance plans.', 2]
    ].forEach((r) => ins.run(...r));
  }

  migratePluggingProducts(db, slugify);
  ensurePluggingExamples(db);

  if (db.prepare('SELECT COUNT(*) AS c FROM cms_faqs WHERE scope = ?').get('plugging').c === 0) {
    const ins = db.prepare('INSERT INTO cms_faqs (scope, question, answer, sort_order) VALUES (?, ?, ?, ?)');
    [
      ['plugging', 'What is Telegram plugging?', 'Plugging auto-forwards messages from a source Telegram chat to your target groups using your own Telegram account.', 0],
      ['plugging', 'Is setup done manually by admins?', 'No. Once your payment is approved, you use your access key in the workspace to connect your own Telegram account and configure forwarding yourself.', 1],
      ['plugging', 'Do I need to share my Telegram password?', 'No. You only enter your phone number and the one-time code Telegram sends you — same as normal Telegram login.', 2]
    ].forEach((r) => ins.run(...r));
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM activity_feed').get().c === 0) {
    const ins = db.prepare('INSERT INTO activity_feed (feed_type, message) VALUES (?, ?)');
    ins.run('order', 'Welcome to the Loveriette platform!');
    ins.run('website', 'Website making packages updated');
  }

  const defaultServices = [
    { title: 'Plugging', desc: 'Telegram message auto forwarder — automatically relay messages to your groups and channels.', link: '/plugging', icon: 'plug', cta: 'Plugging', primary: true },
    { title: 'Shop', desc: 'Premium digital products, apps, and subscriptions delivered instantly after purchase.', link: '/shop', icon: 'cart', cta: 'Browse Shop' },
    { title: 'Website Making', desc: 'Custom ecommerce sites, auto-order platforms, and ongoing maintenance for your brand.', link: '/website-making', icon: 'web', cta: 'View Packages' }
  ];
  const catRow = db.prepare("SELECT id, content_json FROM cms_sections WHERE section_key = 'service_categories'").get();
  if (catRow) {
    let content = {};
    try { content = JSON.parse(catRow.content_json || '{}'); } catch (_) { content = {}; }
    let items = Array.isArray(content.items) ? [...content.items] : [];
    const links = new Set(items.map((i) => i.link));
    for (const d of defaultServices) {
      if (!links.has(d.link)) {
        items.push(d);
        links.add(d.link);
      }
    }
    const plugIdx = items.findIndex((i) => i.link === '/plugging');
    if (plugIdx > 0) {
      const [plug] = items.splice(plugIdx, 1);
      items.unshift(plug);
    }
    content.items = items;
    db.prepare('UPDATE cms_sections SET content_json = ? WHERE id = ?').run(JSON.stringify(content), catRow.id);
  }

  migrateWebsiteInquiryChat(db);

  return { slugify };
}

function migratePluggingProducts(db, slugify) {
  try {
    const cols = db.prepare('PRAGMA table_info(plugging_plans)').all();
    if (!cols.some((c) => c.name === 'product_id')) {
      db.exec('ALTER TABLE plugging_plans ADD COLUMN product_id INTEGER REFERENCES plugging_products(id) ON DELETE CASCADE');
    }
    if (!cols.some((c) => c.name === 'duration')) {
      db.exec("ALTER TABLE plugging_plans ADD COLUMN duration TEXT NOT NULL DEFAULT ''");
    }
  } catch (_) { /* ignore */ }

  const orphans = db.prepare('SELECT * FROM plugging_plans WHERE product_id IS NULL ORDER BY sort_order ASC').all();
  for (const plan of orphans) {
    let prod = db.prepare('SELECT id FROM plugging_products WHERE slug = ?').get(plan.slug);
    if (!prod) {
      const r = db.prepare(`
        INSERT INTO plugging_products (name, slug, description, icon, sort_order, is_enabled)
        VALUES (?, ?, ?, 'mdi:send', ?, 1)
      `).run(plan.name, plan.slug, plan.description || '', plan.sort_order || 0);
      prod = { id: r.lastInsertRowid };
    }
    db.prepare(`
      UPDATE plugging_plans SET product_id = ?, duration = COALESCE(NULLIF(duration, ''), '30 Days')
      WHERE id = ?
    `).run(prod.id, plan.id);
  }
}

function ensurePluggingExamples(db) {
  const examples = [
    {
      name: 'VIP Plugging',
      slug: 'vip',
      description: 'Connect up to 10 Telegram accounts. Each account can forward to up to 50 groups/channels.',
      icon: 'mdi:crown',
      category: 'Plugging',
      features: ['10 Telegram accounts', '50 groups per account', 'Self-service workspace', 'Cycle delay control'],
      sortOrder: 0,
      variants: [
        {
          name: '7 Days',
          slug: 'vip-7d',
          duration: '7 Days',
          description: 'VIP access for one week.',
          price: 499,
          priceLabel: '₱499',
          maxSources: 10,
          maxDestinations: 50,
          priority: 0,
          features: ['10 accounts', '50 groups each', '7-day access'],
          sortOrder: 0
        },
        {
          name: '30 Days',
          slug: 'vip-30d',
          duration: '30 Days',
          description: 'VIP access for one month.',
          price: 1499,
          priceLabel: '₱1,499',
          maxSources: 10,
          maxDestinations: 50,
          priority: 0,
          features: ['10 accounts', '50 groups each', '30-day access'],
          sortOrder: 1
        }
      ]
    },
    {
      name: 'VIP+ Plugging',
      slug: 'vip-plus',
      description: 'Unlimited Telegram accounts and unlimited groups per account. Priority forwarding like master access with expiry.',
      icon: 'mdi:rocket-launch',
      category: 'Plugging',
      features: ['Unlimited accounts', 'Unlimited groups', 'Priority forwarding', 'Expiry based on plan duration'],
      sortOrder: 1,
      variants: [
        {
          name: '7 Days',
          slug: 'vip-plus-7d',
          duration: '7 Days',
          description: 'VIP+ trial — full unlimited access for one week.',
          price: 999,
          priceLabel: '₱999',
          maxSources: 999,
          maxDestinations: 999,
          priority: 1,
          features: ['Unlimited accounts', 'Unlimited groups', 'Priority', '7-day access'],
          sortOrder: 0
        },
        {
          name: '30 Days',
          slug: 'vip-plus-30d',
          duration: '30 Days',
          description: 'VIP+ monthly — unlimited relay with priority.',
          price: 2999,
          priceLabel: '₱2,999',
          maxSources: 999,
          maxDestinations: 999,
          priority: 1,
          features: ['Unlimited accounts', 'Unlimited groups', 'Priority', '30-day access'],
          sortOrder: 1
        }
      ]
    }
  ];

  const getProduct = db.prepare('SELECT id FROM plugging_products WHERE slug = ?');
  const insProduct = db.prepare(`
    INSERT INTO plugging_products (name, slug, description, icon, category, features, sort_order, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const updProduct = db.prepare(`
    UPDATE plugging_products SET name = ?, description = ?, icon = ?, category = ?, features = ?, sort_order = ?
    WHERE slug = ?
  `);
  const getPlan = db.prepare('SELECT id FROM plugging_plans WHERE slug = ?');
  const insPlan = db.prepare(`
    INSERT INTO plugging_plans (product_id, name, slug, description, price, price_label, duration,
      max_sources, max_destinations, features, sort_order, is_enabled, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const updPlan = db.prepare(`
    UPDATE plugging_plans SET product_id = ?, name = ?, description = ?, price = ?, price_label = ?,
      duration = ?, max_sources = ?, max_destinations = ?, features = ?, sort_order = ?, is_enabled = 1,
      priority = ?
    WHERE slug = ?
  `);

  for (const ex of examples) {
    let productId;
    const existing = getProduct.get(ex.slug);
    if (existing) {
      productId = existing.id;
      updProduct.run(
        ex.name, ex.description, ex.icon, ex.category,
        JSON.stringify(ex.features), ex.sortOrder, ex.slug
      );
    } else {
      productId = insProduct.run(
        ex.name, ex.slug, ex.description, ex.icon, ex.category,
        JSON.stringify(ex.features), ex.sortOrder
      ).lastInsertRowid;
    }

    for (const v of ex.variants) {
      const planRow = getPlan.get(v.slug);
      const featJson = JSON.stringify(v.features || []);
      if (planRow) {
        updPlan.run(
          productId, v.name, v.description, v.price, v.priceLabel, v.duration,
          v.maxSources, v.maxDestinations, featJson, v.sortOrder, v.priority || 0, v.slug
        );
      } else {
        insPlan.run(
          productId, v.name, v.slug, v.description, v.price, v.priceLabel, v.duration,
          v.maxSources, v.maxDestinations, featJson, v.sortOrder, v.priority || 0
        );
      }
    }
  }

  // Normalize legacy auto-migrated single plans (plan slug = product slug) into 30-day variants
  try {
    db.prepare(`
      UPDATE plugging_plans SET
        slug = slug || '-legacy-30d',
        name = '30 Days',
        duration = '30 Days'
      WHERE id IN (
        SELECT pl.id FROM plugging_plans pl
        JOIN plugging_products pp ON pp.id = pl.product_id
        WHERE pl.slug = pp.slug AND pl.slug NOT LIKE '%-7d' AND pl.slug NOT LIKE '%-30d'
      )
    `).run();
  } catch (_) { /* ignore */ }

  // Do not bulk-disable testimonials — lending rows are removed by scope filter only.
}

function migrateWebsiteInquiryChat(db) {
  const crypto = require('crypto');
  const cols = db.prepare('PRAGMA table_info(website_inquiries)').all().map((c) => c.name);
  const addCol = (sql) => { try { db.exec(sql); } catch (_) { /* ignore */ } };
  if (!cols.includes('inquiry_ref')) addCol('ALTER TABLE website_inquiries ADD COLUMN inquiry_ref TEXT');
  if (!cols.includes('updated_at')) addCol('ALTER TABLE website_inquiries ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP');
  if (!cols.includes('unread_by_admin')) addCol('ALTER TABLE website_inquiries ADD COLUMN unread_by_admin INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('unread_by_client')) addCol('ALTER TABLE website_inquiries ADD COLUMN unread_by_client INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('admin_notes')) addCol('ALTER TABLE website_inquiries ADD COLUMN admin_notes TEXT NOT NULL DEFAULT \'\'');

  db.exec(`
    CREATE TABLE IF NOT EXISTS website_inquiry_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inquiry_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL CHECK(sender_type IN ('client','admin')),
      body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (inquiry_id) REFERENCES website_inquiries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_website_inquiry_messages_inquiry ON website_inquiry_messages(inquiry_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_website_inquiries_ref ON website_inquiries(inquiry_ref);
  `);

  const noRef = db.prepare("SELECT id, message FROM website_inquiries WHERE inquiry_ref IS NULL OR inquiry_ref = ''").all();
  const updRef = db.prepare('UPDATE website_inquiries SET inquiry_ref = ? WHERE id = ?');
  const insMsg = db.prepare('INSERT INTO website_inquiry_messages (inquiry_id, sender_type, body) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM website_inquiry_messages WHERE inquiry_id = ?)');
  for (const row of noRef) {
    let ref = `WEB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    while (db.prepare('SELECT 1 FROM website_inquiries WHERE inquiry_ref = ?').get(ref)) {
      ref = `WEB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }
    updRef.run(ref, row.id);
    if (row.message) insMsg.run(row.id, 'client', row.message, row.id);
  }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_homepage_restore_v1'").get()) {
      const insSection = db.prepare(`
        INSERT INTO cms_sections (section_key, section_type, title, subtitle, body, content_json, sort_order, is_enabled)
        VALUES (?, ?, ?, ?, '', ?, ?, 1)
      `);
      const ensureSection = (key, type, title, subtitle, content, sortOrder) => {
        if (!db.prepare('SELECT 1 FROM cms_sections WHERE section_key = ?').get(key)) {
          insSection.run(key, type, title, subtitle, JSON.stringify(content), sortOrder);
        }
      };
      ensureSection('why_choose_us', 'features', 'Why Choose Us', 'Trusted by thousands of customers', {
        items: [
          { icon: 'shield', title: 'Secure & Reliable', text: 'Enterprise-grade security for every transaction.' },
          { icon: 'zap', title: 'Fast Delivery', text: 'Instant access to digital products after approval.' },
          { icon: 'heart', title: 'Dedicated Support', text: 'Real people ready to help via chat and tickets.' },
          { icon: 'star', title: 'Premium Quality', text: 'Curated services at affordable prices.' }
        ]
      }, 1);
      ensureSection('service_benefits', 'cards', 'Service Benefits', 'Everything you need in one platform', {
        items: [
          { title: 'Digital Products', text: 'Premium subscriptions and tools at fair prices.', link: '/shop' },
          { title: 'Website Making', text: 'Professional websites built for your business.', link: '/website-making' },
          { title: 'Telegram Plugging', text: 'Automated message forwarding for Telegram.', link: '/plugging' }
        ]
      }, 2);

      const featuredCount = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_featured = 1 AND is_enabled != 0').get().c;
      if (featuredCount === 0) {
        db.prepare(`
          UPDATE products SET is_featured = 1
          WHERE id IN (SELECT id FROM products WHERE is_enabled != 0 ORDER BY sold_count DESC, views DESC, id ASC LIMIT 4)
        `).run();
      }

      const extraFaqs = [
        ['home', 'How long does delivery take?', 'Digital products are delivered after payment approval, usually within minutes to a few hours.', 3],
        ['home', 'What payment methods do you accept?', 'Supported local payment methods are shown at checkout. Upload your receipt to confirm payment.', 4],
        ['home', 'How does website making work?', 'Choose a package, submit an inquiry, and our team will contact you with next steps.', 5]
      ];
      const faqIns = db.prepare('INSERT OR IGNORE INTO cms_faqs (scope, question, answer, sort_order, is_enabled) VALUES (?, ?, ?, ?, 1)');
      extraFaqs.forEach((f) => { try { faqIns.run(...f); } catch (_) { /* ignore dupes */ } });

      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_homepage_restore_v1', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_services_subtitle_v2'").get()) {
      db.prepare("UPDATE cms_sections SET subtitle = ? WHERE section_key = 'service_categories'")
        .run('Shop, websites, and plugging — one platform');
      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_services_subtitle_v2', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_lending_removed_v1'").get()) {
      db.exec(`
        DROP TABLE IF EXISTS loan_applications;
        DROP TABLE IF EXISTS loan_plans;
        DROP TABLE IF EXISTS lending_kyc;
        DROP TABLE IF EXISTS lending_documents;
        DROP TABLE IF EXISTS lending_content;
      `);
      db.prepare("DELETE FROM cms_faqs WHERE scope = 'lending'").run();
      db.prepare("DELETE FROM admin_notifications WHERE type = 'lending'").run();
      const catRow = db.prepare("SELECT id, content_json FROM cms_sections WHERE section_key = 'service_categories'").get();
      if (catRow) {
        let content = {};
        try { content = JSON.parse(catRow.content_json || '{}'); } catch (_) { content = {}; }
        if (Array.isArray(content.items)) {
          content.items = content.items.filter((i) => i.link !== '/lending');
          db.prepare('UPDATE cms_sections SET content_json = ?, subtitle = ? WHERE id = ?')
            .run(JSON.stringify(content), 'Shop, websites, and plugging — one platform', catRow.id);
        }
      }
      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_lending_removed_v1', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }

  // Always strip lending from CMS service cards (idempotent — admin may re-save old data)
  try {
    const catRow = db.prepare("SELECT id, content_json FROM cms_sections WHERE section_key = 'service_categories'").get();
    if (catRow) {
      let content = {};
      try { content = JSON.parse(catRow.content_json || '{}'); } catch (_) { content = {}; }
      if (Array.isArray(content.items)) {
        const filtered = content.items.filter((i) => {
          const link = String(i?.link || '').toLowerCase();
          const title = String(i?.title || '').toLowerCase();
          return link !== '/lending' && !link.includes('lending.html') && title !== 'lending';
        });
        if (filtered.length !== content.items.length) {
          content.items = filtered;
          db.prepare('UPDATE cms_sections SET content_json = ? WHERE id = ?')
            .run(JSON.stringify(content), catRow.id);
        }
      }
    }
    db.prepare("DELETE FROM cms_faqs WHERE scope = 'lending'").run();
    db.prepare("DELETE FROM admin_notifications WHERE type = 'lending'").run();
  } catch (_) { /* ignore */ }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_homepage_content_v3'").get()) {
      const defaults = {
        why_choose_us: {
          items: [
            { icon: 'shield', title: 'Secure & Reliable', text: 'Enterprise-grade security for every transaction.' },
            { icon: 'zap', title: 'Fast Delivery', text: 'Instant access to digital products after approval.' },
            { icon: 'heart', title: 'Dedicated Support', text: 'Real people ready to help via chat and tickets.' },
            { icon: 'star', title: 'Premium Quality', text: 'Curated services at affordable prices.' }
          ]
        },
        service_benefits: {
          items: [
            { title: 'Digital Products', text: 'Premium subscriptions and tools at fair prices.', link: '/shop' },
            { title: 'Website Making', text: 'Professional websites built for your business.', link: '/website-making' },
            { title: 'Telegram Plugging', text: 'Automated message forwarding for Telegram.', link: '/plugging' }
          ]
        },
        service_categories: {
          items: [
            { title: 'Plugging', desc: 'Telegram message auto forwarder — automatically relay messages to your groups and channels.', link: '/plugging', icon: 'plug', cta: 'View Plugging', primary: true },
            { title: 'Shop', desc: 'Premium digital products, apps, and subscriptions delivered after purchase.', link: '/shop', icon: 'cart', cta: 'Browse Shop' },
            { title: 'Website Making', desc: 'Custom ecommerce sites, auto-order platforms, and ongoing maintenance.', link: '/website-making', icon: 'web', cta: 'View Packages' }
          ]
        }
      };
      const fixSection = (key, fallback) => {
        const row = db.prepare('SELECT id, content_json FROM cms_sections WHERE section_key = ?').get(key);
        if (!row) return;
        let content = {};
        try { content = JSON.parse(row.content_json || '{}'); } catch (_) { content = {}; }
        if (!Array.isArray(content.items) || !content.items.length) {
          content.items = fallback.items;
          db.prepare('UPDATE cms_sections SET content_json = ? WHERE id = ?').run(JSON.stringify(content), row.id);
        }
      };
      fixSection('why_choose_us', defaults.why_choose_us);
      fixSection('service_benefits', defaults.service_benefits);
      fixSection('service_categories', defaults.service_categories);

      if (db.prepare('SELECT COUNT(*) AS c FROM cms_statistics WHERE is_enabled = 1').get().c < 3) {
        const ins = db.prepare('INSERT OR IGNORE INTO cms_statistics (label, value, icon, sort_order, is_enabled) VALUES (?, ?, ?, ?, 1)');
        [
          ['Happy Customers', '2,500+', 'users', 0],
          ['Products Sold', '10,000+', 'cart', 1],
          ['Websites Built', '80+', 'web', 2],
          ['Orders Delivered', '15,000+', 'star', 3]
        ].forEach((r) => { try { ins.run(...r); } catch (_) { /* ignore */ } });
      }
      db.prepare("UPDATE cms_statistics SET is_enabled = 0 WHERE label LIKE '%Loan%' OR label LIKE '%Lending%'").run();
      if (!db.prepare("SELECT 1 FROM cms_statistics WHERE is_enabled = 1 AND label = 'Orders Delivered'").get()) {
        db.prepare("INSERT INTO cms_statistics (label, value, icon, sort_order, is_enabled) VALUES ('Orders Delivered', '15,000+', 'star', 3, 1)").run();
      }

      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_homepage_content_v3', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_homepage_stats_v4'").get()) {
      db.prepare("UPDATE cms_statistics SET is_enabled = 0 WHERE label LIKE '%Loan%' OR label LIKE '%Lending%'").run();
      if (!db.prepare("SELECT 1 FROM cms_statistics WHERE label = 'Orders Delivered'").get()) {
        db.prepare("INSERT INTO cms_statistics (label, value, icon, sort_order, is_enabled) VALUES ('Orders Delivered', '15,000+', 'star', 3, 1)").run();
      } else {
        db.prepare("UPDATE cms_statistics SET is_enabled = 1, value = '15,000+', sort_order = 3 WHERE label = 'Orders Delivered'").run();
      }
      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_homepage_stats_v4', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_testimonials_restore_v1'").get()) {
      db.prepare("UPDATE cms_testimonials SET is_enabled = 0 WHERE service_type = 'lending'").run();
      db.prepare("DELETE FROM cms_testimonials WHERE service_type = 'lending'").run();
      const enabledCount = db.prepare('SELECT COUNT(*) AS c FROM cms_testimonials WHERE is_enabled = 1').get().c;
      if (enabledCount === 0) {
        const ins = db.prepare(`
          INSERT INTO cms_testimonials (service_type, author_name, author_role, body, rating, sort_order, is_enabled)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `);
        const rows = [
          ['shop', 'Maria C.', 'Verified Buyer', 'Fast delivery and legit premium account. Will order again.', 5, 0],
          ['plugging', 'James R.', 'Plugging Customer', 'Setup was smooth and message forwarding works perfectly.', 5, 1],
          ['website', 'Ana L.', 'Website Client', 'Professional team built exactly what I needed for my online store.', 5, 2],
          ['general', 'Ken P.', 'Repeat Customer', 'Trusted seller — responsive support and fair prices every time.', 5, 3],
          ['shop', 'Sofia M.', 'Verified Buyer', 'Payment verified quickly and credentials arrived in my dashboard.', 5, 4],
          ['general', 'Daniel T.', 'Long-time Client', 'Best place for digital products and bulk orders.', 5, 5]
        ];
        rows.forEach((r) => ins.run(...r));
      } else {
        db.prepare("UPDATE cms_testimonials SET is_enabled = 1 WHERE service_type != 'lending'").run();
      }
      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_testimonials_restore_v1', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_cms_faqs_long_v2'").get()) {
      const homeFaqs = [
        ['home', 'What services do you offer?', 'Loveriette is a multi-service digital platform. Our Shop offers premium app accounts, streaming subscriptions, and creative tools with verified delivery after payment. Website Making covers ecommerce stores, auto-order sites, landing pages, and ongoing maintenance. Plugging is a self-service Telegram message auto-forwarder that runs on your own account.', 0],
        ['home', 'How do I place an order?', 'Create an account or sign in, then browse the Shop and add items to your cart. At checkout, choose your payment method and pay the exact amount shown. Upload a clear payment receipt before submitting. Once approved, credentials appear in My Account → Purchases.', 1],
        ['home', 'How long does delivery take?', 'Most digital shop orders are processed within minutes to a few hours after payment verification. Orders outside business hours are handled at the next active period. Website and plugging services follow their respective inquiry or access-key workflows.', 2],
        ['home', 'What payment methods do you accept?', 'Accepted methods are shown at checkout (e.g. GCash, QRPH). Pay the exact total and upload only genuine, unedited receipts. Incorrect amounts may delay or void your order.', 3],
        ['home', 'Is my payment secure?', 'We do not store card or banking passwords. Payments are verified manually with reasonable safeguards. Never share your login or OTP with unofficial support contacts.', 4],
        ['home', 'How does website making work?', 'Compare packages on the Website Making page, submit an inquiry with your requirements, and our team responds with scope, timeline, and payment steps.', 5]
      ];
      const plugFaqs = [
        ['plugging', 'What is Telegram plugging?', 'Plugging auto-forwards messages from a source Telegram chat to your target groups or channels using your own Telegram account. You control source, targets, and forwarding rules inside your private workspace.', 0],
        ['plugging', 'Is setup done manually by admins?', 'No. After payment approval you receive an access key. Enter it on the Plugging page, verify your Telegram with OTP, configure source and targets, then start forwarding yourself.', 1],
        ['plugging', 'Do I need to share my Telegram password?', 'Never. You only enter your phone number and the one-time code Telegram sends — the same as normal Telegram login. We never ask for your Telegram password.', 2],
        ['plugging', 'Can I run plugging on multiple devices?', 'Your workspace session is tied to your access key and plan duration. Use one active workspace per key unless your plan states otherwise. Contact support before sharing keys.', 3]
      ];
      db.prepare("DELETE FROM cms_faqs WHERE scope IN ('home', 'plugging')").run();
      const ins = db.prepare('INSERT INTO cms_faqs (scope, question, answer, sort_order, is_enabled) VALUES (?, ?, ?, ?, 1)');
      [...homeFaqs, ...plugFaqs].forEach((r) => ins.run(...r));
      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_cms_faqs_long_v2', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_website_faqs_ensure_v1'").get()) {
      const count = db.prepare("SELECT COUNT(*) AS c FROM cms_faqs WHERE scope = 'website' AND is_enabled = 1").get().c;
      if (count === 0) {
        const ins = db.prepare('INSERT INTO cms_faqs (scope, question, answer, sort_order, is_enabled) VALUES (?, ?, ?, ?, 1)');
        [
          ['website', 'How long does it take to build a website?', 'Typical turnaround is 1–2 weeks depending on complexity.', 0],
          ['website', 'Do you provide hosting?', 'Yes, hosting is included in rental and maintenance packages.', 1],
          ['website', 'Can I request changes after launch?', 'Minor edits are included in maintenance plans.', 2]
        ].forEach((r) => ins.run(...r));
      }
      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_website_faqs_ensure_v1', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }

  try {
    if (!db.prepare("SELECT 1 FROM platform_content WHERE key = '_homepage_trim_v5'").get()) {
      db.prepare("DELETE FROM cms_sections WHERE section_key = 'service_benefits'").run();
      db.prepare('UPDATE cms_statistics SET is_enabled = 0').run();
      db.prepare("INSERT INTO platform_content (key, value) VALUES ('_homepage_trim_v5', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (_) { /* ignore */ }
}

function seedPluggingProductsAndVariants(db, slugify) {
  ensurePluggingExamples(db);
}

module.exports = { initPlatformDb };
