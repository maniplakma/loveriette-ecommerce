/**
 * Staggered auto-start for all plugging accounts in a workspace order.
 * Account 1 starts immediately, account 2 after stagger delay, and so on.
 */
const { startRunner } = require('./plugging-runner');
const { logPlugActivity } = require('./plugging-activity');
const { isPostLink } = require('./plugging-post');
const { parseTargets } = require('./plugging-runner');

const orderQueues = new Map();
const dailyTimers = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function staggerMs(minutes, { enabled = true } = {}) {
  if (!enabled) return 0;
  const n = Number(minutes);
  if (!Number.isFinite(n) || n < 0) return 10 * 60 * 1000;
  return Math.round(n * 60 * 1000);
}

function parseDailyAt(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function msUntilNextDailyRun(dailyAt) {
  const parsed = parseDailyAt(dailyAt);
  if (!parsed) return null;
  const now = new Date();
  const next = new Date(now);
  next.setHours(parsed.hours, parsed.minutes, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function getReadyAccounts(db, orderId) {
  return db.prepare(`
    SELECT *
    FROM plugging_accounts
    WHERE order_id = ?
      AND auth_status = 'authenticated'
      AND TRIM(session_string) != ''
    ORDER BY id ASC
  `).all(orderId).filter((row) => {
    if (!isPostLink(row.source_link)) return false;
    if (!parseTargets(row.targets_text).length) return false;
    return true;
  });
}

async function startAccountSafe(db, account, getSettings) {
  try {
    await startRunner(db, account.id, getSettings);
    logPlugActivity(db, account.id, 'started', 'Auto-start: forwarder started');
    return { ok: true, accountId: account.id };
  } catch (err) {
    const errMsg = String(err.message || err).slice(0, 500);
    db.prepare(`
      UPDATE plugging_accounts SET last_error = ?, updated_at = datetime('now') WHERE id = ?
    `).run(errMsg, account.id);
    logPlugActivity(db, account.id, 'error', `Auto-start failed: ${errMsg.slice(0, 200)}`);
    return { ok: false, accountId: account.id, error: errMsg };
  }
}

async function runStaggeredStart(db, orderId, getSettings, { staggerMinutes = 10, staggerEnabled = true, source = 'manual' } = {}) {
  if (orderQueues.get(orderId)) {
    return { ok: false, error: 'A staggered start is already running for this workspace' };
  }

  const accounts = getReadyAccounts(db, orderId);
  if (!accounts.length) {
    return { ok: false, error: 'No accounts ready — each needs login, post link, and target groups' };
  }

  const delayMs = staggerMs(staggerMinutes, { enabled: staggerEnabled });
  const queue = { running: true, startedAt: Date.now() };
  orderQueues.set(orderId, queue);

  const results = [];
  (async () => {
    try {
      for (let i = 0; i < accounts.length; i += 1) {
        if (!queue.running) break;
        if (i > 0 && delayMs > 0) await sleep(delayMs);
        if (!queue.running) break;
        const result = await startAccountSafe(db, accounts[i], getSettings);
        results.push(result);
      }
    } finally {
      orderQueues.delete(orderId);
    }
  })();

  return {
    ok: true,
    source,
    queued: accounts.length,
    staggerEnabled: !!staggerEnabled,
    staggerMinutes: staggerEnabled ? (Number(staggerMinutes) || 10) : 0,
    accountIds: accounts.map((a) => a.id)
  };
}

function stopStaggeredStart(orderId) {
  const queue = orderQueues.get(orderId);
  if (!queue) return false;
  queue.running = false;
  return true;
}

function isStaggeredStartRunning(orderId) {
  return !!orderQueues.get(orderId);
}

function readAutoStartSettings(orderRow) {
  return {
    enabled: !!orderRow.auto_start_enabled,
    staggerEnabled: orderRow.auto_start_stagger_enabled == null
      ? true
      : !!orderRow.auto_start_stagger_enabled,
    staggerMinutes: Number(orderRow.auto_start_stagger_minutes) || 10,
    dailyAt: String(orderRow.auto_start_daily_at || '').trim()
  };
}

function scheduleDailyAutoStart(db, orderId, getSettings) {
  const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'approved') return;

  const settings = readAutoStartSettings(order);
  const existing = dailyTimers.get(orderId);
  if (existing) clearTimeout(existing);

  if (!settings.enabled || !settings.dailyAt) {
    dailyTimers.delete(orderId);
    return;
  }

  const waitMs = msUntilNextDailyRun(settings.dailyAt);
  if (waitMs == null) {
    dailyTimers.delete(orderId);
    return;
  }

  const timer = setTimeout(async () => {
    dailyTimers.delete(orderId);
    try {
      await runStaggeredStart(db, orderId, getSettings, {
        staggerMinutes: settings.staggerMinutes,
        staggerEnabled: settings.staggerEnabled,
        source: 'daily'
      });
    } catch (err) {
      console.error(`[plugging-autostart] daily start failed for order ${orderId}:`, err.message);
    }
    scheduleDailyAutoStart(db, orderId, getSettings);
  }, waitMs);

  dailyTimers.set(orderId, timer);
}

function initAutoStartSchedulers(db, getSettings) {
  const orders = db.prepare(`
    SELECT id FROM plugging_orders
    WHERE status = 'approved' AND auto_start_enabled = 1
      AND TRIM(auto_start_daily_at) != ''
  `).all();

  for (const row of orders) {
    scheduleDailyAutoStart(db, row.id, getSettings);
  }
}

function refreshAutoStartSchedule(db, orderId, getSettings) {
  scheduleDailyAutoStart(db, orderId, getSettings);
}

module.exports = {
  runStaggeredStart,
  stopStaggeredStart,
  isStaggeredStartRunning,
  readAutoStartSettings,
  initAutoStartSchedulers,
  refreshAutoStartSchedule,
  staggerMs,
  parseDailyAt,
  msUntilNextDailyRun
};
