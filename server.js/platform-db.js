/**
 * Platform schema: lending, website-making, CMS, SEO, analytics.
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

    CREATE TABLE IF NOT EXISTS loan_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      min_amount INTEGER NOT NULL DEFAULT 1000,
      max_amount INTEGER NOT NULL DEFAULT 50000,
      interest_rate REAL NOT NULL DEFAULT 3.0,
      admin_fee INTEGER NOT NULL DEFAULT 0,
      penalty_rate REAL NOT NULL DEFAULT 2.0,
      term_months INTEGER NOT NULL DEFAULT 3,
      repayment_schedule TEXT NOT NULL DEFAULT '[]',
      features TEXT NOT NULL DEFAULT '[]',
      meta_title TEXT,
      meta_description TEXT,
      og_image TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS loan_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      plan_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      form_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES loan_plans(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS lending_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lending_kyc (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_required INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lending_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_required INTEGER NOT NULL DEFAULT 1
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
      delay_minutes INTEGER NOT NULL DEFAULT 70,
      targets_text TEXT NOT NULL DEFAULT '',
      runner_status TEXT NOT NULL DEFAULT 'stopped',
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      cycles_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES plugging_orders(id) ON DELETE CASCADE
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
    'CREATE INDEX IF NOT EXISTS idx_loan_applications_status ON loan_applications(status)',
    'CREATE INDEX IF NOT EXISTS idx_website_inquiries_status ON website_inquiries(status)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_requests_status ON plugging_requests(status)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_orders_status ON plugging_orders(status)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_accounts_order ON plugging_accounts(order_id)',
    'CREATE INDEX IF NOT EXISTS idx_plugging_plans_product ON plugging_plans(product_id)',
    'CREATE INDEX IF NOT EXISTS idx_activity_feed_created ON activity_feed(created_at)'
  ];
  for (const sql of platformIndexes) {
    try { db.exec(sql); } catch (_) { /* ignore */ }
  }

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

  const defaultLending = {
    lending_enabled: '1',
    lending_hero_title: 'Flexible Lending Solutions',
    lending_hero_subtitle: 'Fast approval, transparent rates, and flexible repayment plans tailored for you.',
    lending_interest_note: 'Rates vary by plan. No hidden charges.',
    lending_contact_email: '',
    lending_contact_phone: '',
    lending_borrower_responsibilities: JSON.stringify([
      'Make repayments on or before the due date',
      'Keep contact information up to date',
      'Notify us immediately if you face payment difficulties',
      'Provide accurate information during application'
    ]),
    lending_terms: JSON.stringify([
      { title: 'Eligibility', body: 'Applicants must be 18+ with valid government ID and proof of income.' },
      { title: 'Approval', body: 'All applications are subject to review. Approval is not guaranteed.' },
      { title: 'Repayment', body: 'Late payments may incur penalties as stated in your loan plan.' }
    ]),
    lending_apply_fields: JSON.stringify([
      { key: 'full_name', label: 'Full Name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'phone', label: 'Phone Number', type: 'tel', required: true },
      { key: 'amount', label: 'Loan Amount (₱)', type: 'number', required: true },
      { key: 'purpose', label: 'Purpose of Loan', type: 'textarea', required: true }
    ])
  };
  const upsertLending = db.prepare('INSERT INTO lending_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  for (const [k, v] of Object.entries(defaultLending)) {
    try { upsertLending.run(k, v); } catch (_) { /* ignore */ }
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
    proxy_url: ''
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
      ['service_benefits', 'cards', 'Service Benefits', 'Everything you need in one platform', '', JSON.stringify({
        items: [
          { title: 'Digital Products', text: 'Premium subscriptions and tools at fair prices.', link: '/shop' },
          { title: 'Lending', text: 'Flexible loans with transparent terms.', link: '/lending' },
          { title: 'Website Making', text: 'Professional websites built for your business.', link: '/website-making' }
        ]
      }), 2],
      ['service_categories', 'categories', 'Our Services', 'Four powerful services, one platform', '', JSON.stringify({
        items: [
          { title: 'Plugging', desc: 'Telegram message auto forwarder — automatically relay messages to your groups and channels.', link: '/plugging', icon: 'plug', cta: 'Plugging', primary: true },
          { title: 'Shop', desc: 'Premium digital products, apps, and subscriptions delivered instantly after purchase.', link: '/shop', icon: 'cart', cta: 'Browse Shop' },
          { title: 'Lending', desc: 'Personal and business loans with flexible terms, fast approval, and transparent rates.', link: '/lending', icon: 'loan', cta: 'Lending' },
          { title: 'Websites', desc: 'Custom ecommerce sites, auto-order platforms, and ongoing maintenance for your brand.', link: '/website-making', icon: 'web', cta: 'Websites' }
        ]
      }), 3]
    ];
    sections.forEach((s) => ins.run(...s));
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM cms_statistics').get().c === 0) {
    const ins = db.prepare('INSERT INTO cms_statistics (label, value, icon, sort_order) VALUES (?, ?, ?, ?)');
    [
      ['Happy Customers', '2,500+', 'users', 0],
      ['Products Sold', '10,000+', 'cart', 1],
      ['Loans Approved', '150+', 'loan', 2],
      ['Websites Built', '80+', 'web', 3]
    ].forEach((r) => ins.run(...r));
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM cms_faqs WHERE scope = ?').get('home').c === 0) {
    const ins = db.prepare('INSERT INTO cms_faqs (scope, question, answer, sort_order) VALUES (?, ?, ?, ?)');
    [
      ['home', 'What services do you offer?', 'We offer digital products, lending services, and professional website development.', 0],
      ['home', 'How do I place an order?', 'Browse our shop, select a product, checkout, and upload your payment receipt.', 1],
      ['home', 'Is my payment secure?', 'Yes. We verify payments manually and never store card details.', 2]
    ].forEach((r) => ins.run(...r));
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM loan_plans').get().c === 0) {
    const ins = db.prepare(`
      INSERT INTO loan_plans (name, slug, description, min_amount, max_amount, interest_rate, admin_fee, penalty_rate, term_months, repayment_schedule, features, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    ins.run('Quick Cash', 'quick-cash', 'Short-term loan for immediate needs.', 1000, 10000, 3.5, 200, 2.0, 1, '["Monthly"]', '["Fast approval","1 month term","Low admin fee"]', 0);
    ins.run('Personal Loan', 'personal-loan', 'Flexible personal loan with monthly repayments.', 5000, 50000, 2.8, 500, 1.5, 6, '["Monthly x6"]', '["Up to ₱50k","6 month term","Flexible repayment"]', 1);
    ins.run('Business Loan', 'business-loan', 'Capital for small business growth.', 10000, 100000, 2.5, 1000, 1.5, 12, '["Monthly x12"]', '["Up to ₱100k","12 month term","Business support"]', 2);
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM lending_kyc').get().c === 0) {
    const ins = db.prepare('INSERT INTO lending_kyc (title, description, sort_order) VALUES (?, ?, ?)');
    ins.run('Valid Government ID', 'Passport, driver\'s license, or national ID', 0);
    ins.run('Proof of Income', 'Payslip, bank statement, or business permit', 1);
    ins.run('Proof of Address', 'Utility bill or barangay certificate (within 3 months)', 2);
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

  if (db.prepare('SELECT COUNT(*) AS c FROM cms_faqs WHERE scope = ?').get('lending').c === 0) {
    const ins = db.prepare('INSERT INTO cms_faqs (scope, question, answer, sort_order) VALUES (?, ?, ?, ?)');
    [
      ['lending', 'How long does approval take?', 'Most applications are reviewed within 1-2 business days.', 0],
      ['lending', 'What are the interest rates?', 'Rates vary by plan. See individual loan plans for details.', 1],
      ['lending', 'Can I pay early?', 'Yes. Early repayment is allowed with no extra penalty.', 2]
    ].forEach((r) => ins.run(...r));
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
    ins.run('general', 'New lending service is now available');
    ins.run('website', 'Website making packages updated');
  }

  const defaultServices = [
    { title: 'Plugging', desc: 'Telegram message auto forwarder — automatically relay messages to your groups and channels.', link: '/plugging', icon: 'plug', cta: 'Plugging', primary: true },
    { title: 'Shop', desc: 'Premium digital products, apps, and subscriptions delivered instantly after purchase.', link: '/shop', icon: 'cart', cta: 'Browse Shop' },
    { title: 'Lending', desc: 'Personal and business loans with flexible terms, fast approval, and transparent rates.', link: '/lending', icon: 'loan', cta: 'Lending' },
    { title: 'Websites', desc: 'Custom ecommerce sites, auto-order platforms, and ongoing maintenance for your brand.', link: '/website-making', icon: 'web', cta: 'Websites' }
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
      name: 'Standard Plugging',
      slug: 'standard',
      description: '1 Telegram account → up to 3 destinations. Ideal for small resellers testing auto forward.',
      icon: 'mdi:send',
      category: 'Plugging',
      features: ['1 Telegram account', 'Up to 3 target groups/channels', 'Self-service workspace', 'Runs on your own account'],
      sortOrder: 0,
      variants: [
        {
          name: '7 Days',
          slug: 'standard-7d',
          duration: '7 Days',
          description: 'Try plugging for one week — perfect to test your setup.',
          price: 199,
          priceLabel: '₱199',
          maxSources: 1,
          maxDestinations: 3,
          features: ['1 source chat', '3 destinations', '7-day access'],
          sortOrder: 0
        },
        {
          name: '30 Days',
          slug: 'standard-30d',
          duration: '30 Days',
          description: 'Full month of auto forwarding for everyday reselling.',
          price: 599,
          priceLabel: '₱599',
          maxSources: 1,
          maxDestinations: 3,
          features: ['1 source chat', '3 destinations', '30-day access'],
          sortOrder: 1
        }
      ]
    },
    {
      name: 'Pro Plugging',
      slug: 'pro',
      description: '3 Telegram accounts → up to 10 destinations. For active sellers managing multiple sources.',
      icon: 'mdi:flash',
      category: 'Plugging',
      features: ['3 Telegram accounts', 'Up to 10 destinations', 'Keyword filters', 'Priority support'],
      sortOrder: 1,
      variants: [
        {
          name: '7 Days',
          slug: 'pro-7d',
          duration: '7 Days',
          description: 'Pro access for one week — multiple accounts ready.',
          price: 499,
          priceLabel: '₱499',
          maxSources: 3,
          maxDestinations: 10,
          features: ['3 source chats', '10 destinations', '7-day access'],
          sortOrder: 0
        },
        {
          name: '30 Days',
          slug: 'pro-30d',
          duration: '30 Days',
          description: 'Pro access for one month — scale your forwarding.',
          price: 1299,
          priceLabel: '₱1,299',
          maxSources: 3,
          maxDestinations: 10,
          features: ['3 source chats', '10 destinations', '30-day access'],
          sortOrder: 1
        }
      ]
    },
    {
      name: 'Business Plugging',
      slug: 'business',
      description: 'Unlimited accounts & destinations for teams and high-volume relay operations.',
      icon: 'mdi:rocket-launch',
      category: 'Plugging',
      features: ['Unlimited accounts', 'Unlimited destinations', 'Custom delay settings', 'Dedicated support'],
      sortOrder: 2,
      variants: [
        {
          name: '7 Days',
          slug: 'business-7d',
          duration: '7 Days',
          description: 'Business trial — full power for one week.',
          price: 999,
          priceLabel: '₱999',
          maxSources: 99,
          maxDestinations: 99,
          features: ['Unlimited sources', 'Unlimited destinations', '7-day access'],
          sortOrder: 0
        },
        {
          name: '30 Days',
          slug: 'business-30d',
          duration: '30 Days',
          description: 'Business monthly — for teams running multiple relays.',
          price: 2499,
          priceLabel: '₱2,499',
          maxSources: 99,
          maxDestinations: 99,
          features: ['Unlimited sources', 'Unlimited destinations', '30-day access'],
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
      max_sources, max_destinations, features, sort_order, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const updPlan = db.prepare(`
    UPDATE plugging_plans SET product_id = ?, name = ?, description = ?, price = ?, price_label = ?,
      duration = ?, max_sources = ?, max_destinations = ?, features = ?, sort_order = ?, is_enabled = 1
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
          v.maxSources, v.maxDestinations, featJson, v.sortOrder, v.slug
        );
      } else {
        insPlan.run(
          productId, v.name, v.slug, v.description, v.price, v.priceLabel, v.duration,
          v.maxSources, v.maxDestinations, featJson, v.sortOrder
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

  try {
    db.prepare('UPDATE cms_testimonials SET is_enabled = 0').run();
  } catch (_) { /* ignore */ }
}

function seedPluggingProductsAndVariants(db, slugify) {
  ensurePluggingExamples(db);
}

module.exports = { initPlatformDb };
