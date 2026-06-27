/**
 * Platform API routes: CMS, lending, website-making, analytics, SEO.
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

  function genAppId() {
    return crypto.randomBytes(6).toString('hex');
  }

  function genPlugRequestId() {
    return `PLG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  function getLendingSettings() {
    const rows = db.prepare('SELECT key, value FROM lending_content').all();
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
    return products.map((prod) => {
      const variantWhere = enabledOnly ? 'AND is_enabled = 1' : '';
      const variants = db.prepare(`
        SELECT id, name, slug, description, price, price_label AS priceLabel, duration,
               max_sources AS maxSources, max_destinations AS maxDestinations, features, sort_order, is_enabled
        FROM plugging_plans WHERE product_id = ? ${variantWhere}
        ORDER BY sort_order ASC, id ASC
      `).all(prod.id).map((v) => ({
        ...v,
        features: parseJson(v.features, [])
      }));
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
    `).all(product.id, product.category).map((r) => withPlanListing(r));
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
    ['/lending', 'lending.html'],
    ['/lending/apply', 'lending-apply.html'],
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

  app.get('/lending/plan/:slug', (req, res) => {
    if (isInvalidPageSlug(req.params.slug)) return res.redirect(302, '/lending');
    trackVisit(req);
    sendHtmlPage(res, frontendDir, 'lending-plan.html');
  });

  app.get('/lending/application/:appId', (req, res) => {
    if (isInvalidPageSlug(req.params.appId)) return res.redirect(302, '/lending');
    trackVisit(req);
    sendHtmlPage(res, frontendDir, 'lending-application.html');
  });

  app.get('/website-making/:slug', (req, res) => {
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
    res.set('Cache-Control', 'public, max-age=30');
    const sections = db.prepare(
      'SELECT section_key AS key, section_type AS type, title, subtitle, body, content_json AS contentJson, sort_order AS sortOrder FROM cms_sections WHERE is_enabled = 1 ORDER BY sort_order ASC'
    ).all().map((s) => ({ ...s, content: parseJson(s.contentJson, {}) }));
    const statistics = db.prepare(
      'SELECT label, value, icon FROM cms_statistics WHERE is_enabled = 1 ORDER BY sort_order ASC'
    ).all();
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
      "SELECT feed_type AS type, message, meta_json AS metaJson, created_at AS createdAt FROM activity_feed WHERE feed_type IN ('order', 'lending') ORDER BY id DESC LIMIT 15"
    ).all().map(mapActivityFeedRow);
    const featured = db.prepare(
      "SELECT * FROM products WHERE is_featured = 1 AND is_enabled != 0 ORDER BY id ASC LIMIT 6"
    ).all().map(withPlanListing);
    res.json({ sections, statistics, faqs, banners, announcements, activity, featured, footer: getFooterContent() });
  });

  app.get('/api/activity-feed', (req, res) => {
    res.set('Cache-Control', 'public, max-age=15');
    res.json(db.prepare(
      "SELECT feed_type AS type, message, meta_json AS metaJson, created_at AS createdAt FROM activity_feed WHERE feed_type IN ('order', 'lending') ORDER BY id DESC LIMIT 20"
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

  // ── Lending public ──
  app.get('/api/lending', (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const settings = getLendingSettings();
    const plans = db.prepare(`
      SELECT id, name, slug, description, min_amount AS minAmount, max_amount AS maxAmount,
             interest_rate AS interestRate, admin_fee AS adminFee, penalty_rate AS penaltyRate,
             term_months AS termMonths, repayment_schedule AS repaymentSchedule, features,
             meta_title AS metaTitle, meta_description AS metaDescription
      FROM loan_plans WHERE is_enabled = 1 ORDER BY sort_order ASC
    `).all().map((p) => ({
      ...p,
      features: parseJson(p.features, []),
      repaymentSchedule: parseJson(p.repaymentSchedule, []),
      shareUrl: `/lending/plan/${p.slug}`
    }));
    const faqs = db.prepare(
      'SELECT question, answer FROM cms_faqs WHERE scope = ? AND is_enabled = 1 ORDER BY sort_order ASC'
    ).all('lending');
    const kyc = db.prepare('SELECT title, description, is_required AS required FROM lending_kyc ORDER BY sort_order ASC').all();
    const documents = db.prepare('SELECT title, description, is_required AS required FROM lending_documents ORDER BY sort_order ASC').all();
    res.json({
      enabled: settings.lending_enabled !== '0',
      heroTitle: settings.lending_hero_title,
      heroSubtitle: settings.lending_hero_subtitle,
      interestNote: settings.lending_interest_note,
      contactEmail: settings.lending_contact_email,
      contactPhone: settings.lending_contact_phone,
      borrowerResponsibilities: parseJson(settings.lending_borrower_responsibilities, []),
      terms: parseJson(settings.lending_terms, []),
      applyFields: parseJson(settings.lending_apply_fields, []),
      plans,
      faqs,
      kyc,
      documents,
      shareUrl: '/lending',
      applyUrl: '/lending/apply'
    });
  });

  app.get('/api/lending/plans/:slug', (req, res) => {
    const plan = db.prepare('SELECT * FROM loan_plans WHERE slug = ? AND is_enabled = 1').get(req.params.slug);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json({
      ...plan,
      minAmount: plan.min_amount,
      maxAmount: plan.max_amount,
      interestRate: plan.interest_rate,
      adminFee: plan.admin_fee,
      penaltyRate: plan.penalty_rate,
      termMonths: plan.term_months,
      features: parseJson(plan.features, []),
      repaymentSchedule: parseJson(plan.repayment_schedule, []),
      shareUrl: `/lending/plan/${plan.slug}`
    });
  });

  app.post('/api/lending/apply', (req, res) => {
    const settings = getLendingSettings();
    if (settings.lending_enabled === '0') {
      return res.status(403).json({ error: 'Lending is currently unavailable' });
    }
    const { planId, formData } = req.body || {};
    const appId = genAppId();
    const userId = req.session?.userId || null;
    db.prepare(`
      INSERT INTO loan_applications (application_id, user_id, plan_id, status, form_data)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(appId, userId, planId || null, JSON.stringify(formData || {}));
    logActivity('lending', `New loan application submitted`, { applicationId: appId });
    db.prepare(`
      INSERT INTO admin_notifications (type, title, body) VALUES ('lending', 'New Loan Application', ?)
    `).run(`Application ${appId} submitted`);
    res.status(201).json({ applicationId: appId, shareUrl: `/lending/application/${appId}` });
  });

  app.get('/api/lending/application/:appId', (req, res) => {
    const row = db.prepare(`
      SELECT la.application_id AS applicationId, la.status, la.form_data AS formData, la.created_at AS createdAt,
             lp.name AS planName, lp.slug AS planSlug
      FROM loan_applications la
      LEFT JOIN loan_plans lp ON lp.id = la.plan_id
      WHERE la.application_id = ?
    `).get(req.params.appId);
    if (!row) return res.status(404).json({ error: 'Application not found' });
    res.json({ ...row, formData: parseJson(row.formData, {}) });
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
    const pkg = db.prepare('SELECT * FROM website_packages WHERE slug = ? AND is_enabled = 1').get(req.params.slug);
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    res.json({
      ...pkg,
      priceLabel: pkg.price_label,
      longDescription: pkg.long_description,
      features: parseJson(pkg.features, []),
      imageUrl: pkg.image_url,
      shareUrl: `/website-making/${pkg.slug}`
    });
  });

  app.post('/api/website-making/inquiry', (req, res) => {
    const { packageId, name, email, phone, message } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    db.prepare(`
      INSERT INTO website_inquiries (package_id, name, email, phone, message) VALUES (?, ?, ?, ?, ?)
    `).run(packageId || null, String(name).trim(), String(email).trim(), phone || '', message || '');
    logActivity('website', `${name} sent a website inquiry`, { email });
    db.prepare(`
      INSERT INTO admin_notifications (type, title, body) VALUES ('website', 'Website Inquiry', ?)
    `).run(`${name} (${email}) sent an inquiry`);
    res.status(201).json({ ok: true });
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
    const product = mapPluggingProducts(db, true).find((p) => p.slug === req.params.slug);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const others = mapPluggingProducts(db, true).filter((p) => p.slug !== product.slug).slice(0, 3);
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
      '/', '/shop', '/lending', '/lending/apply', '/website-making', '/plugging',
      '/faqs.html', '/about.html', '/contact.html'
    ];
    db.prepare("SELECT slug FROM products WHERE is_enabled != 0 AND slug IS NOT NULL").all()
      .forEach((p) => urls.push(`/product/${p.slug}`));
    db.prepare('SELECT slug FROM loan_plans WHERE is_enabled = 1').all()
      .forEach((p) => urls.push(`/lending/plan/${p.slug}`));
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
    const lendingApps = db.prepare('SELECT COUNT(*) AS c FROM loan_applications').get().c;
    const approvedLoans = db.prepare("SELECT COUNT(*) AS c FROM loan_applications WHERE status = 'approved'").get().c;
    const websiteInquiries = db.prepare('SELECT COUNT(*) AS c FROM website_inquiries').get().c;
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
      { service: 'Lending', metric: 'Applications', value: lendingApps },
      { service: 'Website Making', metric: 'Inquiries', value: websiteInquiries },
      { service: 'Plugging', metric: 'Requests', value: pluggingRequests }
    ];
    res.json({
      productSales,
      lendingApplications: lendingApps,
      approvedLoans,
      websiteInquiries,
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
      sections: db.prepare('SELECT * FROM cms_sections ORDER BY sort_order ASC').all(),
      statistics: db.prepare('SELECT * FROM cms_statistics ORDER BY sort_order ASC').all(),
      faqs: db.prepare('SELECT * FROM cms_faqs ORDER BY scope, sort_order ASC').all(),
      banners: db.prepare('SELECT * FROM cms_banners ORDER BY sort_order ASC').all(),
      announcements: db.prepare('SELECT * FROM cms_announcements ORDER BY id DESC').all(),
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

  app.post('/admin/cms/statistics', requireAdmin, (req, res) => {
    const { label, value, icon, sortOrder } = req.body || {};
    const r = db.prepare('INSERT INTO cms_statistics (label, value, icon, sort_order) VALUES (?, ?, ?, ?)')
      .run(label, value, icon || '', sortOrder || 0);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/cms/statistics/:id', requireAdmin, (req, res) => {
    const { label, value, icon, sortOrder, isEnabled } = req.body || {};
    db.prepare(`
      UPDATE cms_statistics SET label = COALESCE(?, label), value = COALESCE(?, value),
        icon = COALESCE(?, icon), sort_order = COALESCE(?, sort_order),
        is_enabled = COALESCE(?, is_enabled) WHERE id = ?
    `).run(label, value, icon, sortOrder, isEnabled != null ? (isEnabled ? 1 : 0) : null, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/admin/cms/statistics/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM cms_statistics WHERE id = ?').run(req.params.id);
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

  // ── Admin lending ──
  app.get('/admin/lending', requireAdmin, (req, res) => {
    res.json({
      settings: getLendingSettings(),
      plans: db.prepare('SELECT * FROM loan_plans ORDER BY sort_order ASC').all(),
      applications: db.prepare(`
        SELECT la.*, lp.name AS plan_name FROM loan_applications la
        LEFT JOIN loan_plans lp ON lp.id = la.plan_id ORDER BY la.id DESC LIMIT 100
      `).all(),
      kyc: db.prepare('SELECT * FROM lending_kyc ORDER BY sort_order ASC').all(),
      documents: db.prepare('SELECT * FROM lending_documents ORDER BY sort_order ASC').all(),
      faqs: db.prepare("SELECT * FROM cms_faqs WHERE scope = 'lending' ORDER BY sort_order ASC").all()
    });
  });

  app.put('/admin/lending/settings', requireAdmin, (req, res) => {
    const upsert = db.prepare('INSERT INTO lending_content (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    Object.entries(req.body || {}).forEach(([k, v]) => {
      upsert.run(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    res.json({ ok: true });
  });

  app.post('/admin/lending/plans', requireAdmin, (req, res) => {
    const b = req.body || {};
    let slug = b.slug || slugify(b.name);
    if (db.prepare('SELECT 1 FROM loan_plans WHERE slug = ?').get(slug)) slug = `${slug}-${Date.now()}`;
    const r = db.prepare(`
      INSERT INTO loan_plans (name, slug, description, min_amount, max_amount, interest_rate, admin_fee, penalty_rate, term_months, repayment_schedule, features, sort_order, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.name, slug, b.description || '', b.minAmount || 1000, b.maxAmount || 50000,
      b.interestRate || 3, b.adminFee || 0, b.penaltyRate || 2, b.termMonths || 3,
      JSON.stringify(b.repaymentSchedule || []), JSON.stringify(b.features || []), b.sortOrder || 0, b.isEnabled !== false ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid, slug, shareUrl: `/lending/plan/${slug}` });
  });

  app.put('/admin/lending/plans/:id', requireAdmin, (req, res) => {
    const b = req.body || {};
    const existing = db.prepare('SELECT * FROM loan_plans WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Plan not found' });
    let slug = b.slug ?? existing.slug;
    if (b.slug && b.slug !== existing.slug && db.prepare('SELECT 1 FROM loan_plans WHERE slug = ? AND id != ?').get(slug, req.params.id)) {
      slug = `${slug}-${Date.now()}`;
    }
    db.prepare(`
      UPDATE loan_plans SET name = COALESCE(?, name), slug = ?, description = COALESCE(?, description),
        min_amount = COALESCE(?, min_amount), max_amount = COALESCE(?, max_amount),
        interest_rate = COALESCE(?, interest_rate), admin_fee = COALESCE(?, admin_fee),
        penalty_rate = COALESCE(?, penalty_rate), term_months = COALESCE(?, term_months),
        repayment_schedule = COALESCE(?, repayment_schedule), features = COALESCE(?, features),
        meta_title = COALESCE(?, meta_title), meta_description = COALESCE(?, meta_description),
        sort_order = COALESCE(?, sort_order), is_enabled = COALESCE(?, is_enabled)
      WHERE id = ?
    `).run(b.name, slug, b.description, b.minAmount, b.maxAmount, b.interestRate, b.adminFee,
      b.penaltyRate, b.termMonths,
      b.repaymentSchedule != null ? JSON.stringify(b.repaymentSchedule) : null,
      b.features != null ? JSON.stringify(b.features) : null,
      b.metaTitle, b.metaDescription, b.sortOrder,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null, req.params.id);
    res.json({ ok: true, shareUrl: `/lending/plan/${slug}` });
  });

  app.delete('/admin/lending/plans/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM loan_plans WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.put('/admin/lending/applications/:id', requireAdmin, (req, res) => {
    const { status } = req.body || {};
    db.prepare('UPDATE loan_applications SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(status, req.params.id);
    res.json({ ok: true });
  });

  app.post('/admin/lending/kyc', requireAdmin, (req, res) => {
    const { title, description, sortOrder, isRequired } = req.body || {};
    const r = db.prepare('INSERT INTO lending_kyc (title, description, sort_order, is_required) VALUES (?, ?, ?, ?)')
      .run(title, description || '', sortOrder || 0, isRequired !== false ? 1 : 0);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.delete('/admin/lending/kyc/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM lending_kyc WHERE id = ?').run(req.params.id);
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

  app.put('/admin/website-making/inquiries/:id', requireAdmin, (req, res) => {
    db.prepare('UPDATE website_inquiries SET status = ? WHERE id = ?').run(req.body?.status || 'reviewed', req.params.id);
    res.json({ ok: true });
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
