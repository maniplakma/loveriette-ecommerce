/**
 * Plugging subscription orders + customer workspace (access key → Telegram OTP → forward).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const appConfig = require('./config');
const { sendHtmlPage } = require('./send-html-page');
const { sendLoginCode, verifyLoginCode } = require('./plugging-telegram');
const { startRunner, stopRunner, isRunning } = require('./plugging-runner');
const { pickProxyForNewAccount, listPluggingProxies, autoEnableProxySetting, ensureAccountProxy } = require('./plugging-proxy');

function mountPluggingService(app, db, deps) {
  const {
    requireAdmin,
    frontendDir,
    getPluggingSettings,
    trackVisit
  } = deps;

  const COOKIE = 'plug_access_key';
  const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 };

  function getCookie(req, name) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  function saveReceiptImageFromDataUrl(dataUrl, filenameBase) {
    const str = String(dataUrl || '');
    const match = str.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return null;
    const receiptsDir = path.join(appConfig.uploadsDir, 'receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });
    const ext = match[1] === 'jpeg' ? 'jpg' : (match[1].replace(/[^a-z0-9]/gi, '') || 'png');
    const filename = `${filenameBase}.${ext}`;
    fs.writeFileSync(path.join(receiptsDir, filename), Buffer.from(match[2], 'base64'));
    return `/uploads/receipts/${filename}`;
  }

  function genOrderRef() {
    return `PLG-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  function genAccessKey() {
    return `PLG-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  function getOrderByRef(ref) {
    return db.prepare(`
      SELECT po.*, pp.name AS plan_name, pp.max_sources AS maxSources, pp.max_destinations AS maxDestinations
      FROM plugging_orders po
      LEFT JOIN plugging_plans pp ON pp.id = po.plan_id
      WHERE po.order_ref = ?
    `).get(ref);
  }

  function getApprovedOrderByAccessKey(key) {
    return db.prepare(`
      SELECT po.*, pp.name AS plan_name, pp.max_sources AS maxSources, pp.max_destinations AS maxDestinations
      FROM plugging_orders po
      LEFT JOIN plugging_plans pp ON pp.id = po.plan_id
      WHERE po.access_key = ? AND po.status = 'approved'
    `).get(String(key || '').trim());
  }

  function ensurePlugMasterOrder() {
    const key = String(appConfig.plugMasterKey || '').trim();
    if (!key) return null;

    const existing = db.prepare(`
      SELECT po.*, pp.name AS plan_name, pp.max_sources AS maxSources, pp.max_destinations AS maxDestinations
      FROM plugging_orders po
      LEFT JOIN plugging_plans pp ON pp.id = po.plan_id
      WHERE po.access_key = ? AND po.status = 'approved'
    `).get(key);
    if (existing) return existing;

    const plan = db.prepare(`
      SELECT * FROM plugging_plans WHERE is_enabled = 1 ORDER BY max_sources DESC, max_destinations DESC, id ASC LIMIT 1
    `).get() || db.prepare('SELECT * FROM plugging_plans ORDER BY id ASC LIMIT 1').get();

    db.prepare(`
      INSERT INTO plugging_orders (
        order_ref, plan_id, customer_name, email, total, status, access_key, approved_at
      ) VALUES ('PLG-MASTER', ?, 'Master Workspace', 'master@localhost', 0, 'approved', ?, datetime('now'))
    `).run(plan?.id || null, key);

    return db.prepare(`
      SELECT po.*, pp.name AS plan_name, pp.max_sources AS maxSources, pp.max_destinations AS maxDestinations
      FROM plugging_orders po
      LEFT JOIN plugging_plans pp ON pp.id = po.plan_id
      WHERE po.access_key = ? AND po.status = 'approved'
    `).get(key);
  }

  function resolvePlugAccessKey(key) {
    const trimmed = String(key || '').trim();
    if (!trimmed) return null;
    if (appConfig.plugMasterKey && trimmed === appConfig.plugMasterKey) {
      return ensurePlugMasterOrder();
    }
    return getApprovedOrderByAccessKey(trimmed);
  }

  function requirePlugWorkspace(req, res, next) {
    const key = getCookie(req, COOKIE) || req.headers['x-plug-access-key'];
    const order = resolvePlugAccessKey(key);
    if (!order) return res.status(401).json({ error: 'Invalid or expired access key. Enter your key at /plugging/workspace' });
    req.plugOrder = order;
    next();
  }

  function mapAccount(row) {
    if (!row) return null;
    return {
      id: row.id,
      label: row.label,
      phone: row.phone,
      authStatus: row.auth_status,
      sourceLink: row.source_link,
      displayName: row.display_name,
      delayMinutes: row.delay_minutes,
      targetsText: row.targets_text,
      runnerStatus: isRunning(row.id) ? 'running' : row.runner_status,
      successCount: row.success_count,
      failedCount: row.failed_count,
      cyclesCount: row.cycles_count,
      lastError: row.last_error,
      targetCount: String(row.targets_text || '').split(/\r?\n/).filter(Boolean).length
    };
  }

  // ── Pages ──
  [
    ['/plugging/subscribe', 'plugging-subscribe.html'],
    ['/plugging/payment', 'plugging-payment.html'],
    ['/plugging/status', 'plugging-status.html'],
    ['/plugging/workspace', 'plugging-workspace.html']
  ].forEach(([route, file]) => {
    app.get(route, (req, res) => {
      trackVisit?.(req);
      sendHtmlPage(res, frontendDir, file);
    });
  });

  // ── Public orders ──
  app.post('/api/plugging/subscribe', (req, res) => {
    const settings = getPluggingSettings();
    if (settings.plugging_enabled === '0') {
      return res.status(403).json({ error: 'Plugging service is unavailable' });
    }
    const { planId, name, email } = req.body || {};
    const plan = db.prepare('SELECT * FROM plugging_plans WHERE id = ? AND is_enabled = 1').get(Number(planId));
    if (!plan) return res.status(400).json({ error: 'Invalid plan' });
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const orderRef = genOrderRef();
    db.prepare(`
      INSERT INTO plugging_orders (order_ref, plan_id, customer_name, email, total, status)
      VALUES (?, ?, ?, ?, ?, 'pending_payment')
    `).run(orderRef, plan.id, String(name).trim(), String(email || '').trim(), plan.price);

    res.status(201).json({
      orderRef,
      total: plan.price,
      planName: plan.name,
      paymentUrl: `/plugging/payment?order=${orderRef}`
    });
  });

  app.get('/api/plugging/orders/:ref', (req, res) => {
    const order = getOrderByRef(req.params.ref);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({
      orderRef: order.order_ref,
      status: order.status,
      planName: order.plan_name,
      total: order.total,
      customerName: order.customer_name,
      accessKey: order.status === 'approved' ? order.access_key : null,
      workspaceUrl: order.status === 'approved' ? '/plugging/workspace' : null,
      createdAt: order.created_at,
      approvedAt: order.approved_at
    });
  });

  app.post('/api/plugging/orders/:ref/payment', (req, res) => {
    const order = getOrderByRef(req.params.ref);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending_payment') {
      return res.status(400).json({ error: 'Payment already submitted for this order' });
    }
    const { paymentMethodId, receiptImage } = req.body || {};
    const pm = db.prepare('SELECT id FROM payment_methods WHERE id = ? AND is_active = 1').get(Number(paymentMethodId));
    if (!pm) return res.status(400).json({ error: 'Select a valid payment method' });
    const receiptUrl = saveReceiptImageFromDataUrl(receiptImage, `plug-${order.id}-${Date.now()}`);
    if (!receiptUrl) return res.status(400).json({ error: 'Upload a valid receipt image' });

    db.prepare(`
      UPDATE plugging_orders SET payment_method_id = ?, receipt_path = ?, status = 'pending_approval', updated_at = datetime('now')
      WHERE id = ?
    `).run(paymentMethodId, receiptUrl, order.id);

    try {
      db.prepare(`INSERT INTO admin_notifications (type, title, body) VALUES ('plugging', 'Plugging Payment', ?)`)
        .run(`${order.customer_name} — ${order.order_ref} awaiting approval`);
    } catch (_) { /* ignore */ }

    res.json({
      ok: true,
      statusUrl: `/plugging/status?order=${order.order_ref}`,
      thanksUrl: `/order-thanks.html?type=plugging&order=${encodeURIComponent(order.order_ref)}`
    });
  });

  // ── Workspace auth ──
  app.post('/api/plugging/workspace/unlock', (req, res) => {
    const key = String(req.body?.accessKey || '').trim();
    const order = resolvePlugAccessKey(key);
    if (!order) return res.status(401).json({ error: 'Invalid access key or payment not approved yet' });
    res.cookie(COOKIE, key, COOKIE_OPTS);
    res.json({ ok: true, orderRef: order.order_ref, planName: order.plan_name });
  });

  app.post('/api/plugging/workspace/logout', (req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.get('/api/plugging/workspace', requirePlugWorkspace, (req, res) => {
    const accounts = db.prepare('SELECT * FROM plugging_accounts WHERE order_id = ? ORDER BY id ASC').all(req.plugOrder.id);
    res.json({
      orderRef: req.plugOrder.order_ref,
      planName: req.plugOrder.plan_name,
      maxSources: req.plugOrder.maxSources || 1,
      maxDestinations: req.plugOrder.maxDestinations || 3,
      accounts: accounts.map(mapAccount)
    });
  });

  app.post('/api/plugging/workspace/accounts', requirePlugWorkspace, async (req, res) => {
    const { phone, label } = req.body || {};
    const normalized = normalizePhone(phone);
    if (!normalized) return res.status(400).json({ error: 'Phone number is required' });

    const count = db.prepare('SELECT COUNT(*) AS c FROM plugging_accounts WHERE order_id = ?').get(req.plugOrder.id).c;
    if (count >= (req.plugOrder.maxSources || 1)) {
      return res.status(400).json({ error: `Your plan allows up to ${req.plugOrder.maxSources} Telegram account(s)` });
    }

    try {
      const settings = getPluggingSettings();
      const proxy = pickProxyForNewAccount(db, settings);
      const sent = await sendLoginCode(settings, `+${normalized}`, '', proxy);
      const r = db.prepare(`
        INSERT INTO plugging_accounts (order_id, label, phone, session_string, auth_status, phone_code_hash, proxy_url)
        VALUES (?, ?, ?, ?, 'code_sent', ?, ?)
      `).run(req.plugOrder.id, String(label || '').trim(), normalized, sent.sessionString, sent.phoneCodeHash, proxy);
      res.status(201).json({ accountId: r.lastInsertRowid, message: 'Telegram code sent. Check your Telegram app.' });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not send Telegram code' });
    }
  });

  app.post('/api/plugging/workspace/accounts/:id/verify-code', requirePlugWorkspace, async (req, res) => {
    const account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ? AND order_id = ?')
      .get(req.params.id, req.plugOrder.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Enter the code from Telegram' });

    try {
      const settings = getPluggingSettings();
      const verified = await verifyLoginCode(settings, {
        phone: `+${account.phone}`,
        code,
        phoneCodeHash: account.phone_code_hash,
        sessionString: account.session_string,
        proxyUrl: account.proxy_url || ''
      });
      db.prepare(`
        UPDATE plugging_accounts SET session_string = ?, auth_status = 'authenticated', phone_code_hash = NULL,
          updated_at = datetime('now') WHERE id = ?
      `).run(verified.sessionString, account.id);
      res.json({ ok: true, account: mapAccount(db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(account.id)) });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Invalid code' });
    }
  });

  app.put('/api/plugging/workspace/accounts/:id', requirePlugWorkspace, (req, res) => {
    const account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ? AND order_id = ?')
      .get(req.params.id, req.plugOrder.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.auth_status !== 'authenticated') {
      return res.status(400).json({ error: 'Complete Telegram login first' });
    }

    const b = req.body || {};
    const targets = String(b.targetsText ?? account.targets_text);
    const targetLines = targets.split(/\r?\n/).filter((l) => l.trim()).length;
    if (targetLines > (req.plugOrder.maxDestinations || 3)) {
      return res.status(400).json({ error: `Your plan allows up to ${req.plugOrder.maxDestinations} destination groups` });
    }

    db.prepare(`
      UPDATE plugging_accounts SET label = COALESCE(?, label), source_link = COALESCE(?, source_link),
        display_name = COALESCE(?, display_name), delay_minutes = COALESCE(?, delay_minutes),
        targets_text = COALESCE(?, targets_text), updated_at = datetime('now') WHERE id = ?
    `).run(b.label, b.sourceLink, b.displayName, b.delayMinutes, b.targetsText, account.id);

    res.json({ account: mapAccount(db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(account.id)) });
  });

  app.post('/api/plugging/workspace/accounts/:id/start', requirePlugWorkspace, (req, res) => {
    const account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ? AND order_id = ?')
      .get(req.params.id, req.plugOrder.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    try {
      ensureAccountProxy(db, account.id, getPluggingSettings());
      startRunner(db, account.id, getPluggingSettings);
      res.json({ ok: true, runnerStatus: 'running' });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not start forwarder' });
    }
  });

  app.post('/api/plugging/workspace/accounts/:id/stop', requirePlugWorkspace, (req, res) => {
    const account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ? AND order_id = ?')
      .get(req.params.id, req.plugOrder.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    stopRunner(Number(req.params.id));
    db.prepare('UPDATE plugging_accounts SET runner_status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run('stopped', req.params.id);
    logPlugActivity(db, account.id, 'stopped', 'Forwarder stopped manually');
    res.json({ ok: true, runnerStatus: 'stopped' });
  });

  app.get('/api/plugging/workspace/accounts/:id/activity', requirePlugWorkspace, (req, res) => {
    const account = db.prepare('SELECT id FROM plugging_accounts WHERE id = ? AND order_id = ?')
      .get(req.params.id, req.plugOrder.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const since = Number(req.query.since) || 0;
    const limit = Number(req.query.limit) || 80;
    res.json({ items: getAccountActivity(db, account.id, since, limit) });
  });

  app.delete('/api/plugging/workspace/accounts/:id/activity', requirePlugWorkspace, (req, res) => {
    const account = db.prepare('SELECT id FROM plugging_accounts WHERE id = ? AND order_id = ?')
      .get(req.params.id, req.plugOrder.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    clearAccountActivity(db, account.id);
    res.json({ ok: true });
  });

  app.delete('/api/plugging/workspace/accounts/:id', requirePlugWorkspace, (req, res) => {
    stopRunner(Number(req.params.id));
    db.prepare('DELETE FROM plugging_accounts WHERE id = ? AND order_id = ?').run(req.params.id, req.plugOrder.id);
    res.json({ ok: true });
  });

  app.get('/admin/plugging/proxies', requireAdmin, (req, res) => {
    res.json(listPluggingProxies(db));
  });

  app.post('/admin/plugging/proxies', requireAdmin, (req, res) => {
    const { label, url } = req.body || {};
    const proxyUrl = String(url || '').trim();
    if (!proxyUrl) return res.status(400).json({ error: 'Proxy URL is required' });
    if (!/^socks[45]:\/\//i.test(proxyUrl) && !/^https?:\/\//i.test(proxyUrl)) {
      return res.status(400).json({ error: 'Use socks5://user:pass@host:port format' });
    }
    const r = db.prepare(`
      INSERT INTO plugging_proxies (label, url) VALUES (?, ?)
    `).run(String(label || '').trim(), proxyUrl);
    autoEnableProxySetting(db);
    res.status(201).json({ id: r.lastInsertRowid });
  });

  app.put('/admin/plugging/proxies/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM plugging_proxies WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Proxy not found' });
    const b = req.body || {};
    db.prepare(`
      UPDATE plugging_proxies SET
        label = COALESCE(?, label),
        url = COALESCE(?, url),
        is_enabled = COALESCE(?, is_enabled)
      WHERE id = ?
    `).run(
      b.label,
      b.url ? String(b.url).trim() : null,
      b.isEnabled != null ? (b.isEnabled ? 1 : 0) : null,
      row.id
    );
    res.json({ ok: true });
  });

  app.delete('/admin/plugging/proxies/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM plugging_proxies WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── Admin orders ──
  app.get('/admin/plugging/master-key', requireAdmin, (req, res) => {
    const accessKey = String(appConfig.plugMasterKey || '').trim();
    if (!accessKey) {
      return res.json({ enabled: false, message: 'Set PLUG_MASTER_KEY in .env and restart the server.' });
    }
    ensurePlugMasterOrder();
    res.json({
      enabled: true,
      accessKey,
      workspaceUrl: '/plugging/workspace',
      note: 'Owner master key — bypasses payment approval. Keep secret in production.'
    });
  });

  app.get('/admin/plugging/orders', requireAdmin, (req, res) => {
    res.json(db.prepare(`
      SELECT po.*, pp.name AS plan_name, pm.name AS payment_method_name
      FROM plugging_orders po
      LEFT JOIN plugging_plans pp ON pp.id = po.plan_id
      LEFT JOIN payment_methods pm ON pm.id = po.payment_method_id
      ORDER BY po.id DESC LIMIT 200
    `).all());
  });

  app.put('/admin/plugging/orders/:id', requireAdmin, (req, res) => {
    const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const { status } = req.body || {};
    let accessKey = order.access_key;

    if (status === 'approved' && order.status !== 'approved') {
      accessKey = genAccessKey();
      db.prepare(`
        UPDATE plugging_orders SET status = 'approved', access_key = ?, approved_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(accessKey, order.id);
    } else if (status) {
      db.prepare('UPDATE plugging_orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, order.id);
    }

    const updated = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(order.id);
    res.json({ ok: true, accessKey: updated.access_key, status: updated.status });
  });
}

module.exports = { mountPluggingService };
