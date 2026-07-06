/**
 * Platform API routes: CMS, website-making, analytics, SEO.
 */
function mountPlatformRoutes(app, db, deps) {
  const {
    requireAdmin,
    requireAuth,
    slugify,
    frontendDir,
    withPlanListing,
    productAvailability,
    getVariants,
    variantAvailability,
    lowestUnitPrice,
    parseBulkTiers
  } = deps;

  const path = require('path');
  const crypto = require('crypto');
  const { sendHtmlPage, isInvalidPageSlug } = require('./send-html-page');
  const { mapActivityFeedRow } = require('./activity-feed');

  function parseJson(raw, fallback = null) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  const HOMEPAGE_SECTION_DEFAULTS = {
    why_choose_us: {
      items: [
        { icon: 'shield', title: 'Secure & Reliable', text: 'Enterprise-grade security for every transaction.' },
        { icon: 'zap', title: 'Fast Delivery', text: 'Instant access to digital products after approval.' },
        { icon: 'heart', title: 'Dedicated Support', text: 'Real people ready to help via chat and tickets.' },
        { icon: 'star', title: 'Premium Quality', text: 'Curated services at affordable prices.' }
      ]
    },
    service_categories: {
      items: [
        { title: 'Plugging', desc: 'Telegram message auto forwarder — relay messages across your groups and channels.', link: '/plugging', icon: 'plug', cta: 'View Plugging', primary: true },
        { title: 'Shop', desc: 'Premium digital products and subscriptions delivered after purchase.', link: '/shop', icon: 'cart', cta: 'Browse Shop' },
        { title: 'Website Making', desc: 'Custom ecommerce sites and ongoing maintenance for your brand.', link: '/website-making', icon: 'web', cta: 'View Packages' }
      ]
    }
  };

  function ensureSectionItems(section) {
    if (!section?.key) return section;
    const fallback = HOMEPAGE_SECTION_DEFAULTS[section.key];
    if (!fallback) return section;
    const content = section.content && typeof section.content === 'object' ? { ...section.content } : {};
    if (!Array.isArray(content.items) || !content.items.length) {
      content.items = fallback.items;
    }
    return { ...section, content };
  }

  function genAppId() {
    return crypto.randomBytes(6).toString('hex');
  }

  function genPlugRequestId() {
    return `PLG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  function genInquiryRef() {
    let ref = `WEB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    while (db.prepare('SELECT 1 FROM website_inquiries WHERE inquiry_ref = ?').get(ref)) {
      ref = `WEB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }
    return ref;
  }

  function mapInquiryRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      inquiryRef: row.inquiry_ref,
      packageId: row.package_id,
      packageName: row.package_name || null,
      name: row.name,
      email: row.email,
      phone: row.phone,
      message: row.message,
      status: row.status,
      adminNotes: row.admin_notes || '',
      unreadByAdmin: !!row.unread_by_admin,
      unreadByClient: !!row.unread_by_client,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      chatUrl: row.inquiry_ref ? `/website-making/inquiry/${row.inquiry_ref}` : null
    };
  }

  function getInquiryMessages(inquiryId) {
    return db.prepare(`
      SELECT id, sender_type AS senderType, body, created_at AS createdAt
      FROM website_inquiry_messages WHERE inquiry_id = ? ORDER BY id ASC
    `).all(inquiryId);
  }

  function getPlatformSettings() {
    const rows = db.prepare('SELECT key, value FROM platform_content').all();
    const out = {};
    rows.forEach((r) => { out[r.key] = r.value; });
    return out;
  }

  function getPluggingSettings() {
    const rows = db.prepare('SELECT key, value FROM plugging_content').all();
    const out = {};
    rows.forEach((r) => { out[r.key] = r.value; });
    return out;
  }

  function mapPluggingProducts(db, enabledOnly = true) {
    const prodWhere = enabledOnly ? 'WHERE is_enabled = 1' : '';
    const products = db.prepare(`
      SELECT id, name, slug, description, icon, category, features, sort_order, is_enabled
      FROM plugging_products ${prodWhere} ORDER BY sort_order ASC, id ASC
    `).all();
    if (!products.length) return [];
    const productIds = products.map((p) => p.id);
    const placeholders = productIds.map(() => '?').join(',');
    const variantWhere = enabledOnly ? 'AND is_enabled = 1' : '';
    const allPlans = db.prepare(`
      SELECT id, product_id, name, slug, description, price, price_label AS priceLabel, duration,
             max_sources AS maxSources, max_destinations AS maxDestinations, features, sort_order, is_enabled
      FROM plugging_plans WHERE product_id IN (${placeholders}) ${variantWhere}
      ORDER BY product_id ASC, sort_order ASC, id ASC
    `).all(...productIds);
    const plansByProduct = {};
    allPlans.forEach((v) => {
      if (!plansByProduct[v.product_id]) plansByProduct[v.product_id] = [];
      plansByProduct[v.product_id].push({
        ...v,
        features: parseJson(v.features, [])
      });
    });
    return products.map((prod) => {
      const variants = plansByProduct[prod.id] || [];
      const prices = variants.map((v) => Number(v.price)).filter((n) => n > 0);
      const startingPrice = prices.length ? Math.min(...prices) : 0;
      return {
        ...prod,
        features: parseJson(prod.features, []),
        variants,
        startingPrice,
        shareUrl: `/plugging/plan/${prod.slug}`
      };
    }).filter((p) => !enabledOnly || p.variants.length > 0)
      .filter((p) => p.slug !== 'starter');
  }

  function getFooterContent() {
    const rows = db.prepare('SELECT key, value FROM footer_content').all();
    const out = {};
    rows.forEach((r) => { out[r.key] = r.value; });
    return out;
  }

  function mapProductSeo(p) {
    return {
      ...p,
      slug: p.slug,
      shareUrl: p.slug ? `/product/${p.slug}` : `/product.html?id=${p.id}`,
      metaTitle: p.meta_title || p.name,
      metaDescription: p.meta_description || p.description,
      ogImage: p.og_image || p.image_url || null,
      isFeatured: !!p.is_featured,
      isEnabled: p.is_enabled !== 0
    };
  }

  function enrichProduct(product) {
    const a = productAvailability(product);
    product.stock = a.stock;
    product.availability = a.label;
    product.availability_state = a.state;
    const rows = db.prepare(
      'SELECT id, name, duration, price, description, bulk_pricing_enabled AS bulkPricingEnabled, bulk_tiers AS bulkTiers FROM product_variants WHERE product_id = ? ORDER BY sort_order ASC, id ASC'
    ).all(product.id);
    product.variants = rows.map((v) => {
      const va = variantAvailability(product, v.id);
      const displayPrice = lowestUnitPrice(product.id, v.id, v.price);
      return {
        ...v,
        bulkTiers: parseBulkTiers(v.bulkTiers),
        displayPrice,
        availability: va.label,
        availability_state: va.state
      };
    });
    product.bulkPricingEnabled = !!product.bulk_pricing_enabled;
    product.bulkTiers = parseBulkTiers(product.bulk_tiers);
    product.displayPrice = lowestUnitPrice(product.id, null, product.price);
    product.reviews = db.prepare(
      'SELECT id, author_name AS authorName, rating, body, created_at AS createdAt FROM product_reviews WHERE product_id = ? AND is_published = 1 ORDER BY id DESC LIMIT 20'
    ).all(product.id);
    product.relatedProducts = db.prepare(`
      SELECT id, name, slug, icon, price, category FROM products
      WHERE id != ? AND category = ? AND is_enabled != 0
      ORDER BY sold_count DESC LIMIT 4
    `).all(product.id, product.category).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      icon: r.icon,
      price: r.price,
      category: r.category,
      startingPrice: r.price,
      shareUrl: r.slug ? `/product/${r.slug}` : `/product.html?id=${r.id}`
    }));
    return mapProductSeo(product);
  }

  function logActivity(type, message, meta = {}) {
    try {
      db.prepare('INSERT INTO activity_feed (feed_type, message, meta_json) VALUES (?, ?, ?)')
        .run(type, message, JSON.stringify(meta));
    } catch (_) { /* ignore */ }
  }

  function trackVisit(req) {
    try {
      const p = String(req.path || '/').slice(0, 500);
      if (p.startsWith('/admin') || p.startsWith('/api')) return;
      db.prepare('INSERT INTO page_visits (path, referrer, user_agent) VALUES (?, ?, ?)')
        .run(p, String(req.get('referer') || '').slice(0, 500), String(req.get('user-agent') || '').slice(0, 300));
    } catch (_) { /* ignore */ }
  }

  // ── Pretty URL page routes ──
  const pageRoutes = [
    ['/', 'index.html'],
    ['/shop', 'shop.html'],
    ['/website-making', 'website-making.html'],
    ['/plugging', 'plugging.html']
  ];
  pageRoutes.forEach(([route, file]) => {
    app.get(route, (req, res) => {
      trackVisit(req);
      sendHtmlPage(res, frontendDir, file);
    });
  });

  app.get(['/product', '/product/'], (req, res) => res.redirect(302, '/shop'));

  app.get('/product/:slug', (req, res) => {
    if (isInvalidPageSlug(req.params.slug)) {
      return res.redirect(302, '/shop');
    }
    trackVisit(req);
    sendHtmlPage(res, frontendDir, 'product.html');
  });

  app.get('/website-making/inquiry/:ref', (req, res) => {
    const ref = String(req.params.ref || '').trim();
    if (!ref || ref.length > 32) return res.redirect(302, '/website-making');
    trackVisit(req);
    sendHtmlPage(res, frontendDir, 'website-inquiry.html');
  });

  app.get('/website-making/:slug', (req, res) => {
    if (req.params.slug === 'inquiry') return res.redirect(302, '/website-making');
    if (isInvalidPageSlug(req.params.slug)) return res.redirect(302, '/website-making');
    trackVisit(req);
    sendHtmlPage(res, frontendDir, 'website-package.html');
  });

  app.get('/plugging/plan/:slug', (req, res) => {
    if (isInvalidPageSlug(req.params.slug)) return res.redirect(302, '/plugging');
    trackVisit(req);
    sendHtmlPage(res, frontendDir, 'plugging-product.html');
  });

  // ── Public CMS ──
  app.get('/api/homepage', (req, res) => {
    res.set('Cache-Control', 'public, max-age=45, stale-while-revalidate=120');
    const sections = db.prepare(
      'SELECT section_key AS key, section_type AS type, title, subtitle, body, content_json AS contentJson, sort_order AS sortOrder FROM cms_sections WHERE is_enabled = 1 AND section_key != ? ORDER BY sort_order ASC'
    ).all('service_benefits').map((s) => ensureSectionItems({ ...s, content: parseJson(s.contentJson, {}) }));
    const faqs = db.prepare(
      'SELECT question, answer FROM cms_faqs WHERE scope = ? AND is_enabled = 1 ORDER BY sort_order ASC'
    ).all('home');
    const banners = db.prepare(
      'SELECT title, subtitle, image_url AS imageUrl, link_url AS linkUrl FROM cms_banners WHERE scope = ? AND is_enabled = 1 ORDER BY sort_order ASC'
    ).all('home');
    const announcements = db.prepare(
      'SELECT title, body FROM cms_announcements WHERE (scope = ? OR scope = ?) AND is_enabled = 1 ORDER BY id DESC LIMIT 5'
    ).all('all', 'home');
    const activity = db.prepare(
      "SELECT feed_type AS type, message, meta_json AS metaJson, created_at AS createdAt FROM activity_feed WHERE feed_type = 'order' ORDER BY id DESC LIMIT 15"
    ).all().map(mapActivityFeedRow);
    const testimonials = db.prepare(`
      SELECT service_type AS serviceType, author_name AS authorName, author_role AS authorRole,
             body, rating, avatar_url AS avatarUrl
      FROM cms_testimonials WHERE is_enabled = 1 AND service_type != 'lending'
      ORDER BY sort_order ASC, id ASC LIMIT 12
    `).all();
    res.json({ sections, faqs, banners, announcements, activity, testimonials, footer: getFooterContent() });
  });

  app.get('/api/activity-feed', (req, res) => {
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    res.json(db.prepare(
      "SELECT feed_type AS type, message, meta_json AS metaJson, created_at AS createdAt FROM activity_feed WHERE feed_type = 'order' ORDER BY id DESC LIMIT 20"
    ).all().map(mapActivityFeedRow));
  });

  app.post('/api/track-visit', (req, res) => {
    trackVisit({ path: req.body?.path || '/', get: (h) => req.get(h) });
    res.json({ ok: true });
  });

  // ── Products by slug ──
  app.get('/api/products/slug/:slug', (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE slug = ? AND is_enabled != 0').get(req.params.slug);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(enrichProduct(product));
  });

  app.get('/products/:id/reviews', (req, res) => {
    const id = Number(req.params.id);
    const reviews = db.prepare(
      'SELECT id, author_name AS authorName, rating, body, created_at AS createdAt FROM product_reviews WHERE product_id = ? AND is_published = 1 ORDER BY id DESC'
    ).all(id);
    res.json(reviews);
  });

  // ── Website making public ──
  app.get('/api/website-making', (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const packages = db.prepare(`
      SELECT id, name, slug, category, description, price, price_label AS priceLabel, features, image_url AS imageUrl,
             meta_title AS metaTitle, meta_description AS metaDescription
      FROM website_packages WHERE is_enabled = 1 ORDER BY sort_order ASC
    `).all().map((p) => ({
      ...p,
      features: parseJson(p.features, []),
      shareUrl: `/website-making/${p.slug}`
    }));
    const portfolio = db.prepare(
      'SELECT title, description, image_url AS imageUrl, link_url AS linkUrl FROM website_portfolio WHERE is_enabled = 1 ORDER BY sort_order ASC'
    ).all();
    const faqs = db.prepare(
      'SELECT question, answer FROM cms_faqs WHERE scope = ? AND is_enabled = 1 ORDER BY sort_order ASC'
    ).all('website');
    res.json({ packages, portfolio, faqs, shareUrl: '/website-making' });
  });

  app.get('/api/website-making/packages/:slug', (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const pkg = db.prepare('SELECT * FROM website_packages WHERE slug = ? AND is_enabled = 1').get(req.params.slug);
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    const others = db.prepare(`
      SELECT id, name, slug, category, description, price, price_label AS priceLabel, image_url AS imageUrl
      FROM website_packages WHERE is_enabled = 1 AND slug != ? ORDER BY sort_order ASC LIMIT 3
    `).all(pkg.slug).map((p) => ({
      ...p,
      shareUrl: `/website-making/${p.slug}`
    }));
    res.json({
      ...pkg,
      priceLabel: pkg.price_label,
      longDescription: pkg.long_description,
      features: parseJson(pkg.features, []),
      imageUrl: pkg.image_url,
      metaTitle: pkg.meta_title,
      metaDescription: pkg.meta_description,
      ogImage: pkg.og_image,
      shareUrl: `/website-making/${pkg.slug}`,
      relatedPackages: others
    });
  });

  app.post('/api/website-making/inquiry', (req, res) => {
    const { packageId, name, email, phone, message } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    const inquiryRef = genInquiryRef();
    const msg = String(message || '').trim();
    const r = db.prepare(`
      INSERT INTO website_inquiries (package_id, name, email, phone, message, inquiry_ref, status, unread_by_admin, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'new', 1, datetime('now'))
    `).run(packageId || null, String(name).trim(), String(email).trim(), phone || '', msg, inquiryRef);
    if (msg) {
      db.prepare(`
        INSERT INTO website_inquiry_messages (inquiry_id, sender_type, body) VALUES (?, 'client', ?)
      `).run(r.lastInsertRowid, msg);
    }
    logActivity('website', `${name} sent a website inquiry`, { email, inquiryRef });
    db.prepare(`
      INSERT INTO admin_notifications (type, title, body) VALUES ('website', 'Website Inquiry', ?)
    `).run(`${name} (${email}) — ${inquiryRef}`);
    res.status(201).json({
      ok: true,
      inquiryRef,
      inquiryUrl: `/website-making/inquiry/${inquiryRef}`
    });
  });

  app.get('/api/website-making/inquiry/:ref', (req, res) => {
    const row = db.prepare(`
      SELECT wi.*, wp.name AS package_name FROM website_inquiries wi
      LEFT JOIN website_packages wp ON wp.id = wi.package_id
      WHERE wi.inquiry_ref = ?
    `).get(req.params.ref);
    if (!row) return res.status(404).json({ error: 'Inquiry not found' });
    const emailCheck = String(req.query.email || '').trim().toLowerCase();
    if (emailCheck && emailCheck !== String(row.email).toLowerCase()) {
      return res.status(403).json({ error: 'Email does not match this inquiry' });
    }
    db.prepare('UPDATE website_inquiries SET unread_by_client = 0 WHERE id = ?').run(row.id);
    res.json({
      inquiry: mapInquiryRow(row),
      messages: getInquiryMessages(row.id)
    });
  });

  app.post('/api/website-making/inquiry/:ref/messages', (req, res) => {
    const row = db.prepare('SELECT * FROM website_inquiries WHERE inquiry_ref = ?').get(req.params.ref);
    if (!row) return res.status(404).json({ error: 'Inquiry not found' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || email !== String(row.email).toLowerCase()) {
      return res.status(403).json({ error: 'Valid email required to reply' });
    }
    const body = String(req.body?.message || '').trim();
    if (!body) return res.status(400).json({ error: 'Message is required' });
    db.prepare(`
      INSERT INTO website_inquiry_messages (inquiry_id, sender_type, body) VALUES (?, 'client', ?)
    `).run(row.id, body);
    db.prepare(`
      UPDATE website_inquiries SET unread_by_admin = 1, updated_at = datetime('now'),
        status = CASE WHEN status = 'closed' THEN 'open' ELSE status END
      WHERE id = ?
    `).run(row.id);
    try {
      db.prepare(`
        INSERT INTO admin_notifications (type, title, body) VALUES ('website', 'Inquiry Reply', ?)
      `).run(`${row.name} replied on ${row.inquiry_ref}`);
    } catch (_) { /* ignore */ }
    res.status(201).json({ ok: true, messages: getInquiryMessages(row.id) });
  });

  // ── Plugging public ──
  app.get('/api/plugging', (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const settings = getPluggingSettings();
    const products = mapPluggingProducts(db, true);
    const plans = products.flatMap((p) => (p.variants || []).map((v) => ({
      ...v,
      productName: p.name,
      productSlug: p.slug
    })));
    const faqs = db.prepare(
      'SELECT question, answer FROM cms_faqs WHERE scope = ? AND is_enabled = 1 ORDER BY sort_order ASC'
    ).all('plugging');
    res.json({
      enabled: settings.plugging_enabled !== '0',
      heroTitle: settings.plugging_hero_title,
      heroSubtitle: settings.plugging_hero_subtitle,
      howItWorks: parseJson(settings.plugging_how_it_works, []),
      contactTelegram: settings.plugging_contact_telegram || '',
      products,
      plans,
      faqs,
      shareUrl: '/plugging',
      requestUrl: '/api/plugging/request'
    });
  });

  app.get('/api/plugging/products/:slug', (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const all = mapPluggingProducts(db, true);
    const product = all.find((p) => p.slug === req.params.slug);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const others = all.filter((p) => p.slug !== product.slug).slice(0, 3);
    res.json({ product, related: others });
  });

  app.post('/api/plugging/request', (req, res) => {
    const settings = getPluggingSettings();
    if (settings.plugging_enabled === '0') {
      return res.status(403).json({ error: 'Plugging service is currently unavailable' });
    }
    const {
      planId, name, email, telegramUsername, sourceChat, destinationChats, filterKeywords, notes
    } = req.body || {};
    if (!name || !telegramUsername || !sourceChat || !destinationChats) {
      return res.status(400).json({ error: 'Name, Telegram username, source chat, and destinations are required' });
    }
    const requestId = genPlugRequestId();
    db.prepare(`
      INSERT INTO plugging_requests
        (request_id, plan_id, name, email, telegram_username, source_chat, destination_chats, filter_keywords, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requestId,
      planId || null,
      String(name).trim(),
      String(email || '').trim(),
      String(telegramUsername).trim().replace(/^@/, ''),
      String(sourceChat).trim(),
      String(destinationChats).trim(),
      String(filterKeywords || '').trim(),
      String(notes || '').trim()
    );
    logActivity('plugging', `New plugging request ${requestId} from @${String(telegramUsername).replace(/^@/, '')}`, { requestId });
    try {
      db.prepare(`
        INSERT INTO admin_notifications (type, title, body) VALUES ('plugging', 'New Plugging Request', ?)
      `).run(`${name} (@${String(telegramUsername).replace(/^@/, '')}) — ${requestId}`);
    } catch (_) { /* ignore */ }
    res.status(201).json({ requestId, shareUrl: `/plugging?ref=${requestId}` });
  });

  app.get('/api/plugging/request/:requestId', (req, res) => {
    const row = db.prepare(`
      SELECT request_id AS requestId, status, created_at AS createdAt,
             telegram_username AS telegramUsername, source_chat AS sourceChat,
             destination_chats AS destinationChats
      FROM plugging_requests WHERE request_id = ?
    `).get(req.params.requestId);
    if (!row) return res.status(404).json({ error: 'Request not found' });
    res.json(row);
  });

  // ── Sitemap ──
  app.get('/sitemap.xml', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    const urls = [
      '/', '/shop', '/website-making', '/plugging',
      '/faqs.html', '/about.html', '/contact.html'
    ];
    db.prepare("SELECT slug FROM products WHERE is_enabled != 0 AND slug IS NOT NULL").all()
      .forEach((p) => urls.push(`/product/${p.slug}`));
    db.prepare('SELECT slug FROM website_packages WHERE is_enabled = 1').all()
      .forEach((p) => urls.push(`/website-making/${p.slug}`));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')
    }\n</urlset>`;
    res.type('application/xml').send(xml);
  });

  // ── Platform analytics (admin) ──
  app.get('/admin/platform/stats', requireAdmin, (req, res) => {
    const productSales = db.prepare("SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE status = 'approved'").get().v;
    const websiteInquiries = db.prepare('SELECT COUNT(*) AS c FROM website_inquiries').get().c;
    const newWebsiteInquiries = db.prepare("SELECT COUNT(*) AS c FROM website_inquiries WHERE status IN ('new','open') OR unread_by_admin = 1").get().c;
    const pendingPluggingOrders = db.prepare("SELECT COUNT(*) AS c FROM plugging_orders WHERE status IN ('pending_payment','pending_approval')").get().c;
    const pluggingRequests = db.prepare('SELECT COUNT(*) AS c FROM plugging_requests').get().c;
    const activePlugs = db.prepare("SELECT COUNT(*) AS c FROM plugging_requests WHERE status = 'active'").get().c;
    const visitorsToday = db.prepare(`
      SELECT COUNT(*) AS c FROM page_visits WHERE date(created_at) = date('now')
    `).get().c;
    const visitorsWeek = db.prepare(`
      SELECT COUNT(*) AS c FROM page_visits WHERE created_at >= datetime('now', '-7 days')
    `).get().c;
    const topPages = db.prepare(`
      SELECT path, COUNT(*) AS views FROM page_visits
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY path ORDER BY views DESC LIMIT 10
    `).all();
    const servicePerf = [
      { service: 'Ecommerce', metric: 'Sales', value: productSales },
      { service: 'Website Making', metric: 'Inquiries', value: websiteInquiries },
      { service: 'Plugging', metric: 'Requests', value: pluggingRequests }
    ];
    res.json({
      productSales,
      websiteInquiries,
      newWebsiteInquiries,
      pendingPluggingOrders,
      pluggingRequests,
      activePlugs,
      visitorsToday,
      visitorsWeek,
      topPages,
      servicePerformance: servicePerf
    });
  });

  // ── Admin CMS ──
  app.get('/admin/cms/homepage', requireAdmin, (req, res) => {
    res.json({
      sections: db.prepare('SELECT * FROM cms_sections WHERE section_key != ? ORDER BY sort_order ASC').all('service_benefits'),
      faqs: db.prepare('SELECT * FROM cms_faqs ORDER BY scope, sort_order ASC').all(),
      banners: db.prepare('SELECT * FROM cms_banners ORDER BY sort_order ASC').all(),
      announcements: db.prepare('SELECT * FROM cms_announcements ORDER BY id DESC').all(),
      testimonials: db.prepare('SELECT * FROM cms_testimonials ORDER BY sort_order ASC, id ASC').all(),
      footer: getFooterContent()
    });
  });

  app.put('/admin/cms/sections/:key', requireAdmin, (req, res) => {
    const { title, subtitle, body, contentJson, sortOrder, isEnabled } = req.body || {};
    db.prepare(`
      UPDATE cms_sections SET title = COALESCE(?, title), subtitle = COALESCE(?, subtitle),
        body = COALESCE(?, body), content_json = COALESCE(?, content_json),
        sort_order = COALESCE(?, sort_order), is_enabled = COALESCE(?, is_enabled),
        updated_at = datetime('now')
      WHERE section_key = ?
    `).run(title, subtitle, body, contentJson != null ? JSON.stringify(contentJson) : null,
      sortOrder, isEnabled != null ? (isEnabled ? 1 : 0) : null, req.params.key);
    res.json({ ok: true });
  });

  app.post('/admin/cms/testimonials', requireAdmin, (req, res) => {
    const { serviceType, authorName, authorRole, body, rating, sortOrder } = req.body || {};
    const r = db.prepare(`
      INSERT INTO cms_testimonials (service_type, author_name, author_role, body, rating, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(serviceType || 'general', authorName, authorRole || '', body, rating || 5, sortOrder || 0);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/cms/testimonials/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE cms_testimonials SET service_type = COALESCE(?, service_type),
        author_name = COALESCE(?, author_name), author_role = COALESCE(?, author_role),
        body = COALESCE(?, body), rating = COALESCE(?, rating),
        sort_order = COALESCE(?, sort_order), is_enabled = COALESCE(?, is_enabled)
      WHERE id = ?
    `).run(b.serviceType, b.authorName, b.authorRole, b.body, b.rating, b.sortOrder,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/admin/cms/testimonials/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM cms_testimonials WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/admin/cms/faqs', requireAdmin, (req, res) => {
    const { scope, question, answer, sortOrder } = req.body || {};
    const r = db.prepare('INSERT INTO cms_faqs (scope, question, answer, sort_order) VALUES (?, ?, ?, ?)')
      .run(scope || 'home', question, answer, sortOrder || 0);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/cms/faqs/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE cms_faqs SET scope = COALESCE(?, scope), question = COALESCE(?, question),
        answer = COALESCE(?, answer), sort_order = COALESCE(?, sort_order),
        is_enabled = COALESCE(?, is_enabled) WHERE id = ?
    `).run(b.scope, b.question, b.answer, b.sortOrder, b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/admin/cms/faqs/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM cms_faqs WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.put('/admin/cms/footer', requireAdmin, (req, res) => {
    const upsert = db.prepare('INSERT INTO footer_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    Object.entries(req.body || {}).forEach(([k, v]) => upsert.run(k, String(v)));
    res.json({ ok: true });
  });

  // ── Admin product reviews & SEO ──
  app.get('/admin/products/:id/reviews', requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT * FROM product_reviews WHERE product_id = ? ORDER BY id DESC').all(req.params.id));
  });

  app.post('/admin/products/:id/reviews', requireAdmin, (req, res) => {
    const { authorName, rating, body, isPublished } = req.body || {};
    const r = db.prepare(`
      INSERT INTO product_reviews (product_id, author_name, rating, body, is_published) VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, authorName || 'Customer', rating || 5, body || '', isPublished !== false ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/products/reviews/:reviewId', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM product_reviews WHERE id = ?').run(req.params.reviewId);
    res.json({ ok: true });
  });

  app.get('/admin/promotional-banners', requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT * FROM promotional_banners ORDER BY sort_order ASC').all());
  });

  app.post('/admin/promotional-banners', requireAdmin, (req, res) => {
    const b = req.body || {};
    const r = db.prepare(`
      INSERT INTO promotional_banners (title, subtitle, image_url, link_url, scope, sort_order, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(b.title || '', b.subtitle || '', b.imageUrl || '', b.linkUrl || '', b.scope || 'shop', b.sortOrder || 0, b.isEnabled !== false ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/promotional-banners/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE promotional_banners SET title = COALESCE(?, title), subtitle = COALESCE(?, subtitle),
        image_url = COALESCE(?, image_url), link_url = COALESCE(?, link_url),
        scope = COALESCE(?, scope), sort_order = COALESCE(?, sort_order),
        is_enabled = COALESCE(?, is_enabled) WHERE id = ?
    `).run(b.title, b.subtitle, b.imageUrl, b.linkUrl, b.scope, b.sortOrder,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/admin/promotional-banners/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM promotional_banners WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Admin modules (service availability) ──
  app.get('/admin/modules', requireAdmin, (req, res) => {
    const plugging = getPluggingSettings();
    const platform = getPlatformSettings();
    res.json({
      shop: platform.shop_enabled !== '0',
      plugging: plugging.plugging_enabled !== '0',
      websiteMaking: platform.website_making_enabled !== '0'
    });
  });

  app.put('/admin/modules', requireAdmin, (req, res) => {
    const b = req.body || {};
    const upsertPlugging = db.prepare('INSERT INTO plugging_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const upsertPlatform = db.prepare('INSERT INTO platform_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    if (typeof b.shop === 'boolean') upsertPlatform.run('shop_enabled', b.shop ? '1' : '0');
    if (typeof b.plugging === 'boolean') upsertPlugging.run('plugging_enabled', b.plugging ? '1' : '0');
    if (typeof b.websiteMaking === 'boolean') upsertPlatform.run('website_making_enabled', b.websiteMaking ? '1' : '0');
    res.json({ ok: true });
  });

  // ── Admin website making ──
  app.get('/admin/website-making', requireAdmin, (req, res) => {
    res.json({
      packages: db.prepare('SELECT * FROM website_packages ORDER BY sort_order ASC').all(),
      portfolio: db.prepare('SELECT * FROM website_portfolio ORDER BY sort_order ASC').all(),
      inquiries: db.prepare(`
        SELECT wi.*, wp.name AS package_name FROM website_inquiries wi
        LEFT JOIN website_packages wp ON wp.id = wi.package_id ORDER BY wi.id DESC LIMIT 100
      `).all(),
      faqs: db.prepare("SELECT * FROM cms_faqs WHERE scope = 'website' ORDER BY sort_order ASC").all()
    });
  });

  app.post('/admin/website-making/packages', requireAdmin, (req, res) => {
    const b = req.body || {};
    let slug = b.slug || slugify(b.name);
    if (db.prepare('SELECT 1 FROM website_packages WHERE slug = ?').get(slug)) slug = `${slug}-${Date.now()}`;
    const r = db.prepare(`
      INSERT INTO website_packages (name, slug, category, description, long_description, price, price_label, features, sort_order, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.name, slug, b.category || 'custom', b.description || '', b.longDescription || '',
      b.price || 0, b.priceLabel || '', JSON.stringify(b.features || []), b.sortOrder || 0, b.isEnabled !== false ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid, slug, shareUrl: `/website-making/${slug}` });
  });

  app.put('/admin/website-making/packages/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    const existing = db.prepare('SELECT * FROM website_packages WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Package not found' });
    let slug = b.slug ?? existing.slug;
    if (b.slug && b.slug !== existing.slug && db.prepare('SELECT 1 FROM website_packages WHERE slug = ? AND id != ?').get(slug, req.params.id)) {
      slug = `${slug}-${Date.now()}`;
    }
    db.prepare(`
      UPDATE website_packages SET name = COALESCE(?, name), slug = ?, category = COALESCE(?, category),
        description = COALESCE(?, description), long_description = COALESCE(?, long_description),
        price = COALESCE(?, price), price_label = COALESCE(?, price_label),
        features = COALESCE(?, features), meta_title = COALESCE(?, meta_title),
        meta_description = COALESCE(?, meta_description), image_url = COALESCE(?, image_url),
        sort_order = COALESCE(?, sort_order), is_enabled = COALESCE(?, is_enabled)
      WHERE id = ?
    `).run(b.name, slug, b.category, b.description, b.longDescription, b.price, b.priceLabel,
      b.features != null ? JSON.stringify(b.features) : null, b.metaTitle, b.metaDescription, b.imageUrl,
      b.sortOrder, b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null, req.params.id);
    res.json({ ok: true, shareUrl: `/website-making/${slug}` });
  });

  app.delete('/admin/website-making/packages/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM website_packages WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.get('/admin/website-making/inquiries/:id', requireAdmin, (req, res) => {
    const row = db.prepare(`
      SELECT wi.*, wp.name AS package_name FROM website_inquiries wi
      LEFT JOIN website_packages wp ON wp.id = wi.package_id WHERE wi.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Inquiry not found' });
    db.prepare('UPDATE website_inquiries SET unread_by_admin = 0 WHERE id = ?').run(row.id);
    res.json({ inquiry: mapInquiryRow(row), messages: getInquiryMessages(row.id) });
  });

  app.post('/admin/website-making/inquiries/:id/messages', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM website_inquiries WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Inquiry not found' });
    const body = String(req.body?.message || '').trim();
    if (!body) return res.status(400).json({ error: 'Message is required' });
    db.prepare(`
      INSERT INTO website_inquiry_messages (inquiry_id, sender_type, body) VALUES (?, 'admin', ?)
    `).run(row.id, body);
    db.prepare(`
      UPDATE website_inquiries SET unread_by_client = 1, updated_at = datetime('now'),
        status = CASE WHEN status = 'new' THEN 'open' ELSE status END
      WHERE id = ?
    `).run(row.id);
    res.status(201).json({ ok: true, messages: getInquiryMessages(row.id) });
  });

  app.put('/admin/website-making/inquiries/:id', requireAdmin, (req, res) => {
    const status = req.body?.status;
    const adminNotes = req.body?.adminNotes;
    const allowed = ['new', 'open', 'reviewed', 'contacted', 'in_progress', 'closed'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const row = db.prepare('SELECT id FROM website_inquiries WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Inquiry not found' });
    if (status != null) {
      db.prepare('UPDATE website_inquiries SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, req.params.id);
    }
    if (adminNotes != null) {
      db.prepare('UPDATE website_inquiries SET admin_notes = ? WHERE id = ?').run(String(adminNotes), req.params.id);
    }
    const updated = db.prepare(`
      SELECT wi.*, wp.name AS package_name FROM website_inquiries wi
      LEFT JOIN website_packages wp ON wp.id = wi.package_id WHERE wi.id = ?
    `).get(req.params.id);
    res.json({ ok: true, inquiry: mapInquiryRow(updated) });
  });

  app.post('/admin/website-making/portfolio', requireAdmin, (req, res) => {
    const b = req.body || {};
    const r = db.prepare(`
      INSERT INTO website_portfolio (title, description, image_url, link_url, sort_order) VALUES (?, ?, ?, ?, ?)
    `).run(b.title, b.description || '', b.imageUrl || '', b.linkUrl || '', b.sortOrder || 0);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/website-making/portfolio/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM website_portfolio WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Admin plugging ──
  app.get('/admin/plugging', requireAdmin, (req, res) => {
    res.json({
      settings: getPluggingSettings(),
      products: mapPluggingProducts(db, false),
      requests: db.prepare(`
        SELECT pr.*, pp.name AS plan_name FROM plugging_requests pr
        LEFT JOIN plugging_plans pp ON pp.id = pr.plan_id
        ORDER BY pr.id DESC LIMIT 100
      `).all(),
      faqs: db.prepare("SELECT * FROM cms_faqs WHERE scope = 'plugging' ORDER BY sort_order ASC").all()
    });
  });

  app.put('/admin/plugging/settings', requireAdmin, (req, res) => {
    const upsert = db.prepare('INSERT INTO plugging_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    Object.entries(req.body || {}).forEach(([k, v]) => {
      upsert.run(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    res.json({ ok: true });
  });

  app.post('/admin/plugging/products', requireAdmin, (req, res) => {
    const b = req.body || {};
    let slug = b.slug || slugify(b.name);
    if (db.prepare('SELECT 1 FROM plugging_products WHERE slug = ?').get(slug)) slug = `${slug}-${Date.now()}`;
    const r = db.prepare(`
      INSERT INTO plugging_products (name, slug, description, icon, category, features, sort_order, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.name, slug, b.description || '', b.icon || 'mdi:send', b.category || 'Plugging',
      JSON.stringify(b.features || []), b.sortOrder || 0, b.isEnabled !== false ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid, slug });
  });

  app.put('/admin/plugging/products/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE plugging_products SET name = COALESCE(?, name), description = COALESCE(?, description),
        icon = COALESCE(?, icon), category = COALESCE(?, category),
        features = COALESCE(?, features), sort_order = COALESCE(?, sort_order),
        is_enabled = COALESCE(?, is_enabled) WHERE id = ?
    `).run(b.name, b.description, b.icon, b.category,
      b.features != null ? JSON.stringify(b.features) : null, b.sortOrder,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/admin/plugging/products/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM plugging_plans WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM plugging_products WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/admin/plugging/plans', requireAdmin, (req, res) => {
    const b = req.body || {};
    if (!b.productId) return res.status(400).json({ error: 'productId is required' });
    let slug = b.slug || slugify(`${b.name}-${b.duration || ''}`);
    if (db.prepare('SELECT 1 FROM plugging_plans WHERE slug = ?').get(slug)) slug = `${slug}-${Date.now()}`;
    const r = db.prepare(`
      INSERT INTO plugging_plans (product_id, name, slug, description, price, price_label, duration,
        max_sources, max_destinations, features, sort_order, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.productId, b.name, slug, b.description || '', b.price || 0, b.priceLabel || '',
      b.duration || '', b.maxSources || 1, b.maxDestinations || 3, JSON.stringify(b.features || []),
      b.sortOrder || 0, b.isEnabled !== false ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid, slug });
  });

  app.put('/admin/plugging/plans/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    db.prepare(`
      UPDATE plugging_plans SET product_id = COALESCE(?, product_id), name = COALESCE(?, name),
        description = COALESCE(?, description), price = COALESCE(?, price),
        price_label = COALESCE(?, price_label), duration = COALESCE(?, duration),
        max_sources = COALESCE(?, max_sources), max_destinations = COALESCE(?, max_destinations),
        features = COALESCE(?, features), sort_order = COALESCE(?, sort_order),
        is_enabled = COALESCE(?, is_enabled) WHERE id = ?
    `).run(b.productId, b.name, b.description, b.price, b.priceLabel, b.duration, b.maxSources, b.maxDestinations,
      b.features != null ? JSON.stringify(b.features) : null, b.sortOrder,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/admin/plugging/plans/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM plugging_plans WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.put('/admin/plugging/requests/:id', requireAdmin, (req, res) => {
    const { status, adminNotes } = req.body || {};
    db.prepare(`
      UPDATE plugging_requests SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes),
        updated_at = datetime('now') WHERE id = ?
    `).run(status, adminNotes, req.params.id);
    res.json({ ok: true });
  });

  const { mountPluggingService } = require('./plugging-service');
  mountPluggingService(app, db, {
    requireAdmin,
    frontendDir,
    getPluggingSettings,
    trackVisit: (req) => trackVisit({ path: req.path, get: (h) => req.get(h) })
  });

  return { logActivity };
}

module.exports = { mountPlatformRoutes };
