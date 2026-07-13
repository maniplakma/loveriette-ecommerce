/**
 * Plugging subscription orders + customer workspace (access key → Telegram OTP → forward).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const appConfig = require('./config');
const { sendHtmlPage } = require('./send-html-page');
const { sendLoginCode, verifyLoginCode } = require('./plugging-telegram');
const { startRunner, stopRunner, stopRunnerGracefully, isRunning, resumeRunnersOnBoot, watchPluggingRunners } = require('./plugging-runner');
const {
  runStaggeredStart,
  stopStaggeredStart,
  isStaggeredStartRunning,
  readAutoStartSettings,
  initAutoStartSchedulers,
  refreshAutoStartSchedule
} = require('./plugging-autostart');
const {
  runJoinGroupsBatch,
  stopJoinBatch,
  isJoinBatchRunning,
  buildJoinGroupsStatus,
  pruneJoinResults,
  parseJoinGroups
} = require('./plugging-join-batch');
const { isPostLink, normalizePostLink } = require('./plugging-post');
const { extractInviteHash } = require('./plugging-join');
const { pickProxyForNewAccount, listPluggingProxies, autoEnableProxySetting, ensureAccountProxy } = require('./plugging-proxy');
const { logPlugActivity, getAccountActivity, clearAccountActivity } = require('./plugging-activity');
const { creditLoyaltyForPurchase, getLoyaltyBalance } = require('./loyalty');
const {
  normalizePlugOrder,
  computeExpiresAtFromDuration,
  isOrderExpired,
  formatLimitLabel,
  ORDER_SELECT
} = require('./plugging-limits');

function mountPluggingService(app, db, deps) {
  const {
    requireAdmin,
    frontendDir,
    getPluggingSettings,
    trackVisit,
    getSessionUserId
  } = deps;

  const COOKIE = 'plug_access_key';
  const COOKIE_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;
  const COOKIE_DEFAULT_MS = 365 * 24 * 60 * 60 * 1000;

  function cookieBaseOpts() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: !!appConfig.cookieSecure
    };
  }

  function cookieOptsForOrder(order, key) {
    const base = cookieBaseOpts();
    if (isMasterAccessKey(key)) {
      return { ...base, maxAge: COOKIE_LIFETIME_MS };
    }
    const exp = order?.expiresAt || order?.expires_at;
    if (exp) {
      const ms = new Date(exp).getTime() - Date.now();
      if (ms > 0) return { ...base, maxAge: ms };
    }
    return { ...base, maxAge: COOKIE_DEFAULT_MS };
  }
  const PLUG_MASTER_KEY_SETTING = 'plug_master_key';
  const PLUG_MASTER_CREATED_SETTING = 'plug_master_key_created_at';

  function readPlugMasterKeyFromDb() {
    const row = db.prepare('SELECT value FROM plugging_content WHERE key = ?').get(PLUG_MASTER_KEY_SETTING);
    return String(row?.value || '').trim();
  }

  function writePlugMasterKeyToDb(key) {
    db.prepare(`
      INSERT INTO plugging_content (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(PLUG_MASTER_KEY_SETTING, key);
    db.prepare(`
      INSERT INTO plugging_content (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(PLUG_MASTER_CREATED_SETTING, new Date().toISOString());
  }

  function getPlugMasterKey() {
    const fromDb = readPlugMasterKeyFromDb();
    if (fromDb) return fromDb;
    return String(appConfig.plugMasterKey || '').trim();
  }

  function generatePlugMasterKeyValue() {
    return `PLG-MASTER-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  function loadNormalizedOrder(whereSql, ...params) {
    const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const row = db.prepare(`${ORDER_SELECT} ${whereSql}`).get(...args);
    return normalizePlugOrder(row);
  }

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
    return loadNormalizedOrder('WHERE po.order_ref = ?', ref);
  }

  function getApprovedOrderByAccessKey(key) {
    return loadNormalizedOrder('WHERE po.access_key = ? AND po.status = ?', [String(key || '').trim(), 'approved']);
  }

  function ensurePlugMasterOrder(keyOverride) {
    const key = String(keyOverride || getPlugMasterKey() || '').trim();
    if (!key) return null;

    const existing = db.prepare(`
      SELECT po.*, pp.name AS plan_name, pp.max_sources AS maxSources, pp.max_destinations AS maxDestinations
      FROM plugging_orders po
      LEFT JOIN plugging_plans pp ON pp.id = po.plan_id
      WHERE po.order_ref = 'PLG-MASTER' AND po.status = 'approved'
      ORDER BY po.id ASC LIMIT 1
    `).get();

    if (existing) {
      if (existing.access_key !== key) {
        db.prepare(`
          UPDATE plugging_orders SET access_key = ?, updated_at = datetime('now') WHERE id = ?
        `).run(key, existing.id);
      }
      return loadNormalizedOrder('WHERE po.id = ?', existing.id);
    }

    const plan = db.prepare(`
      SELECT * FROM plugging_plans
      WHERE is_enabled = 1
      ORDER BY priority DESC, max_sources DESC, max_destinations DESC, id ASC
      LIMIT 1
    `).get() || db.prepare('SELECT * FROM plugging_plans ORDER BY id ASC LIMIT 1').get();

    db.prepare(`
      INSERT INTO plugging_orders (
        order_ref, plan_id, customer_name, email, total, status, access_key, approved_at
      ) VALUES ('PLG-MASTER', ?, 'Master Workspace', 'master@localhost', 0, 'approved', ?, datetime('now'))
    `).run(plan?.id || null, key);

    return loadNormalizedOrder('WHERE po.access_key = ? AND po.status = ?', [key, 'approved']);
  }

  function resolvePlugAccessKey(key) {
    const trimmed = String(key || '').trim();
    if (!trimmed) return null;
    const masterKey = getPlugMasterKey();
    if (masterKey && trimmed === masterKey) {
      const order = ensurePlugMasterOrder(masterKey);
      return order && !isOrderExpired(order) ? order : null;
    }
    const order = getApprovedOrderByAccessKey(trimmed);
    if (!order || isOrderExpired(order)) return null;
    return order;
  }

  function isMasterAccessKey(key) {
    const masterKey = getPlugMasterKey();
    return !!masterKey && String(key || '').trim() === masterKey;
  }

  function requirePlugWorkspace(req, res, next) {
    const key = getCookie(req, COOKIE) || req.headers['x-plug-access-key'];
    const order = resolvePlugAccessKey(key);
    if (!order) {
      return res.status(401).json({ error: 'Invalid, expired, or inactive access key. Enter your key at /plugging/workspace' });
    }
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

  function normalizeTargetRef(ref) {
    const raw = String(ref || '').trim();
    if (!raw) return '';

    if (extractInviteHash(raw)) return raw;

    const tmeUser = raw.match(/(?:https?:\/\/)?t\.me\/(?!c\/|\+|joinchat\/)([A-Za-z0-9_]+)(?:\/(\d+))?/i);
    if (tmeUser) {
      if (tmeUser[2]) {
        throw new Error('Use @groupname for targets — do not paste a post link here');
      }
      return `@${tmeUser[1]}`;
    }

    if (raw.startsWith('@')) {
      const user = raw.slice(1).split('/')[0];
      if (raw.includes('/')) {
        throw new Error(`Target "${raw}" must be @groupname only`);
      }
      return `@${user}`;
    }

    if (/^[A-Za-z0-9_]+$/.test(raw)) return `@${raw}`;

    throw new Error(`Invalid target "${raw}" — use @groupname`);
  }

  function normalizeJoinGroupsText(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map(normalizeTargetRef).join('\n');
  }

  function readJoinGroupsPayload(orderRow) {
    const groupsText = String(orderRow.join_groups_text || '');
    const status = buildJoinGroupsStatus(db, orderRow.id, groupsText);
    return {
      groupsText,
      running: isJoinBatchRunning(orderRow.id),
      ...status
    };
  }

  function normalizeTargetsText(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map(normalizeTargetRef).join('\n');
  }

  function persistAccountConfig(account, body, maxDestinations) {
    const sourceLink = normalizePostLink(String(body.sourceLink ?? account.source_link ?? '').trim());
    const displayName = String(body.displayName ?? account.display_name ?? '').trim();
    const delayMinutes = body.delayMinutes != null
      ? Math.max(0, Number(body.delayMinutes) || 0)
      : Number(account.delay_minutes) || 0;
    const targetsText = normalizeTargetsText(
      body.targetsText != null ? String(body.targetsText) : String(account.targets_text || '')
    );
    const label = body.label != null ? String(body.label).trim() : String(account.label || '');
    const targetLines = targetsText.split(/\r?\n/).filter((line) => line.trim()).length;

    if (!sourceLink) {
      throw new Error('Post link is required');
    }
    if (!isPostLink(sourceLink)) {
      throw new Error('Post link must include a post number, e.g. https://t.me/channel/123');
    }
    if (targetLines < 1) {
      throw new Error('Add at least one target group link');
    }
    if (targetLines > (maxDestinations || 3)) {
      throw new Error(`Your plan allows up to ${maxDestinations || 3} destination groups`);
    }

    db.prepare(`
      UPDATE plugging_accounts SET
        label = ?,
        source_link = ?,
        display_name = ?,
        delay_minutes = ?,
        targets_text = ?,
        last_error = '',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(label, sourceLink, displayName, delayMinutes, targetsText, account.id);

    return db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(account.id);
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
    const userId = getSessionUserId?.(req) || null;
    db.prepare(`
      INSERT INTO plugging_orders (order_ref, plan_id, customer_name, email, total, status, user_id)
      VALUES (?, ?, ?, ?, ?, 'pending_payment', ?)
    `).run(orderRef, plan.id, String(name).trim(), String(email || '').trim(), plan.price, userId);

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
      expiresAt: order.expires_at || order.expiresAt || null,
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
    if (!order) return res.status(401).json({ error: 'Invalid access key, payment not approved yet, or subscription expired' });
    res.cookie(COOKIE, key, cookieOptsForOrder(order, key));
    res.json({
      ok: true,
      orderRef: order.order_ref,
      planName: order.plan_name,
      lifetime: isMasterAccessKey(key),
      remember: true
    });
  });

  app.post('/api/plugging/workspace/logout', (req, res) => {
    res.clearCookie(COOKIE, cookieBaseOpts());
    res.json({ ok: true });
  });

  app.get('/api/plugging/workspace', requirePlugWorkspace, (req, res) => {
    const accounts = db.prepare('SELECT * FROM plugging_accounts WHERE order_id = ? ORDER BY id ASC').all(req.plugOrder.id);
    const loyalty = req.plugOrder.order_ref === 'PLG-MASTER'
      ? null
      : getLoyaltyBalance(db, { userId: req.plugOrder.user_id, email: req.plugOrder.email });
    res.json({
      orderRef: req.plugOrder.order_ref,
      planName: req.plugOrder.plan_name,
      maxSources: req.plugOrder.maxSources || 1,
      maxDestinations: req.plugOrder.maxDestinations || 3,
      maxSourcesLabel: formatLimitLabel(req.plugOrder.maxSources),
      maxDestinationsLabel: formatLimitLabel(req.plugOrder.maxDestinations),
      priority: !!req.plugOrder.planPriority,
      expiresAt: req.plugOrder.expiresAt || null,
      isMaster: !!req.plugOrder.isMaster,
      loyalty,
      autoStart: readAutoStartSettings(req.plugOrder),
      autoStartRunning: isStaggeredStartRunning(req.plugOrder.id),
      joinGroups: readJoinGroupsPayload(req.plugOrder),
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

    try {
      const updated = persistAccountConfig(account, req.body || {}, req.plugOrder.maxDestinations);
      res.json({ ok: true, account: mapAccount(updated) });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not save forwarding settings' });
    }
  });

  app.post('/api/plugging/workspace/accounts/:id/start', requirePlugWorkspace, async (req, res) => {
    let account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ? AND order_id = ?')
      .get(req.params.id, req.plugOrder.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.auth_status !== 'authenticated') {
      return res.status(400).json({ error: 'Complete Telegram login first' });
    }
    try {
      const body = req.body || {};
      if (body.sourceLink != null || body.targetsText != null || body.displayName != null || body.delayMinutes != null) {
        account = persistAccountConfig(account, body, req.plugOrder.maxDestinations);
      } else if (!String(account.source_link || '').trim()) {
        return res.status(400).json({ error: 'Save a post link before starting (https://t.me/channel/123)' });
      } else if (!String(account.targets_text || '').split(/\r?\n/).filter((l) => l.trim()).length) {
        return res.status(400).json({ error: 'Save at least one target group before starting' });
      }

      ensureAccountProxy(db, account.id, getPluggingSettings());
      clearAccountActivity(db, account.id);
      db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run('running', '', account.id);
      await startRunner(db, account.id, getPluggingSettings);
      res.json({ ok: true, runnerStatus: 'running' });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not start forwarder' });
    }
  });

  app.post('/api/plugging/workspace/accounts/:id/stop', requirePlugWorkspace, async (req, res) => {
    const account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ? AND order_id = ?')
      .get(req.params.id, req.plugOrder.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    await stopRunnerGracefully(Number(req.params.id));
    db.prepare('UPDATE plugging_accounts SET runner_status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run('stopped', req.params.id);
    logPlugActivity(db, account.id, 'stopped', 'Forwarder stopped manually');
    res.json({ ok: true, runnerStatus: 'stopped' });
  });

  app.put('/api/plugging/workspace/auto-start', requirePlugWorkspace, (req, res) => {
    const body = req.body || {};
    const enabled = body.enabled != null ? (body.enabled ? 1 : 0) : undefined;
    const staggerEnabled = body.staggerEnabled != null ? (body.staggerEnabled ? 1 : 0) : undefined;
    const staggerMinutes = body.staggerMinutes != null ? Math.max(0, Math.round(Number(body.staggerMinutes) || 0)) : undefined;
    const dailyAt = body.dailyAt != null ? String(body.dailyAt || '').trim() : undefined;

    const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(req.plugOrder.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    db.prepare(`
      UPDATE plugging_orders SET
        auto_start_enabled = COALESCE(?, auto_start_enabled),
        auto_start_stagger_enabled = COALESCE(?, auto_start_stagger_enabled),
        auto_start_stagger_minutes = COALESCE(?, auto_start_stagger_minutes),
        auto_start_daily_at = COALESCE(?, auto_start_daily_at),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(enabled, staggerEnabled, staggerMinutes, dailyAt, order.id);

    const updated = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(order.id);
    refreshAutoStartSchedule(db, order.id, getPluggingSettings);
    res.json({
      ok: true,
      autoStart: readAutoStartSettings(updated),
      autoStartRunning: isStaggeredStartRunning(order.id)
    });
  });

  app.post('/api/plugging/workspace/auto-start/run', requirePlugWorkspace, async (req, res) => {
    const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(req.plugOrder.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const settings = readAutoStartSettings(order);
    const staggerEnabled = req.body?.staggerEnabled != null
      ? !!req.body.staggerEnabled
      : settings.staggerEnabled;
    const staggerMinutes = req.body?.staggerMinutes != null
      ? Math.max(0, Math.round(Number(req.body.staggerMinutes) || 0))
      : settings.staggerMinutes;

    try {
      const result = await runStaggeredStart(db, order.id, getPluggingSettings, {
        staggerMinutes,
        staggerEnabled,
        source: 'manual'
      });
      if (!result.ok) return res.status(400).json({ error: result.error || 'Could not start accounts' });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not start accounts' });
    }
  });

  app.post('/api/plugging/workspace/auto-start/stop', requirePlugWorkspace, (req, res) => {
    const stopped = stopStaggeredStart(req.plugOrder.id);
    res.json({
      ok: true,
      stopped,
      autoStartRunning: isStaggeredStartRunning(req.plugOrder.id)
    });
  });

  app.put('/api/plugging/workspace/join-groups', requirePlugWorkspace, (req, res) => {
    const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(req.plugOrder.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    let groupsText = '';
    try {
      groupsText = normalizeJoinGroupsText(String(req.body?.groupsText ?? order.join_groups_text ?? ''));
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Invalid group list' });
    }

    db.prepare(`
      UPDATE plugging_orders SET join_groups_text = ?, updated_at = datetime('now') WHERE id = ?
    `).run(groupsText, order.id);

    const groups = parseJoinGroups(groupsText);
    pruneJoinResults(db, order.id, groups);

    const updated = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(order.id);
    res.json({
      ok: true,
      joinGroups: readJoinGroupsPayload(updated)
    });
  });

  app.post('/api/plugging/workspace/join-groups/run', requirePlugWorkspace, async (req, res) => {
    const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(req.plugOrder.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    try {
      const result = await runJoinGroupsBatch(db, order.id, getPluggingSettings, {
        source: 'manual'
      });
      if (!result.ok) return res.status(400).json({ error: result.error || 'Could not start join batch' });
      res.json({
        ...result,
        joinGroups: readJoinGroupsPayload(order)
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not start join batch' });
    }
  });

  app.post('/api/plugging/workspace/join-groups/stop', requirePlugWorkspace, (req, res) => {
    const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(req.plugOrder.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const stopped = stopJoinBatch(order.id);
    res.json({
      ok: true,
      stopped,
      joinGroups: readJoinGroupsPayload(order)
    });
  });

  app.get('/api/plugging/workspace/join-groups/status', requirePlugWorkspace, (req, res) => {
    const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(req.plugOrder.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(readJoinGroupsPayload(order));
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

  app.delete('/api/plugging/workspace/accounts/:id', requirePlugWorkspace, async (req, res) => {
    await stopRunnerGracefully(Number(req.params.id));
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
    let accessKey = getPlugMasterKey();
    if (!accessKey && String(appConfig.plugMasterKey || '').trim()) {
      accessKey = String(appConfig.plugMasterKey || '').trim();
      writePlugMasterKeyToDb(accessKey);
    }
    if (!accessKey) {
      return res.json({
        enabled: false,
        message: 'No master key yet. Click Generate Key to create lifetime owner access.'
      });
    }
    ensurePlugMasterOrder(accessKey);
    const createdRow = db.prepare('SELECT value FROM plugging_content WHERE key = ?').get(PLUG_MASTER_CREATED_SETTING);
    res.json({
      enabled: true,
      accessKey,
      createdAt: createdRow?.value || null,
      workspaceUrl: '/plugging/workspace',
      note: 'Lifetime owner key — no expiry. Opens /plugging/workspace without customer approval. Keep secret.'
    });
  });

  app.post('/admin/plugging/master-key/generate', requireAdmin, (req, res) => {
    const regenerate = !!req.body?.regenerate;
    const existing = readPlugMasterKeyFromDb() || String(appConfig.plugMasterKey || '').trim();
    if (existing && !regenerate) {
      ensurePlugMasterOrder(existing);
      const createdRow = db.prepare('SELECT value FROM plugging_content WHERE key = ?').get(PLUG_MASTER_CREATED_SETTING);
      return res.json({
        enabled: true,
        accessKey: existing,
        createdAt: createdRow?.value || null,
        workspaceUrl: '/plugging/workspace',
        note: 'Lifetime owner key — no expiry. Opens /plugging/workspace without customer approval. Keep secret.'
      });
    }

    const accessKey = generatePlugMasterKeyValue();
    writePlugMasterKeyToDb(accessKey);
    ensurePlugMasterOrder(accessKey);
    res.json({
      enabled: true,
      accessKey,
      createdAt: new Date().toISOString(),
      workspaceUrl: '/plugging/workspace',
      regenerated: regenerate,
      note: 'Lifetime owner key — no expiry. Opens /plugging/workspace without customer approval. Keep secret.'
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
      const plan = db.prepare('SELECT * FROM plugging_plans WHERE id = ?').get(order.plan_id);
      const expiresAt = computeExpiresAtFromDuration(plan?.duration, new Date());
      db.prepare(`
        UPDATE plugging_orders
        SET status = 'approved', access_key = ?, approved_at = datetime('now'),
            expires_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(accessKey, expiresAt, order.id);

      const approvedOrder = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(order.id);
      if (approvedOrder.order_ref !== 'PLG-MASTER' && Number(approvedOrder.total) >= 200) {
        creditLoyaltyForPurchase(db, {
          userId: approvedOrder.user_id,
          email: approvedOrder.email,
          total: approvedOrder.total,
          orderRef: approvedOrder.order_ref,
          source: 'plugging'
        });
      }
    } else if (status) {
      db.prepare('UPDATE plugging_orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, order.id);
    }

    const updated = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(order.id);
    res.json({ ok: true, accessKey: updated.access_key, status: updated.status });
  });

  setImmediate(() => {
    resumeRunnersOnBoot(db, getPluggingSettings).catch((err) => {
      console.error('[plugging] resume runners failed:', err.message);
    });
    initAutoStartSchedulers(db, getPluggingSettings);
    const WATCH_MS = Math.max(60_000, Number(process.env.PLUG_RUNNER_WATCH_MS) || 90_000);
    setInterval(() => {
      watchPluggingRunners(db, getPluggingSettings).catch((err) => {
        console.error('[plugging] runner watchdog failed:', err.message);
      });
    }, WATCH_MS).unref?.();
  });
}

module.exports = { mountPluggingService };
