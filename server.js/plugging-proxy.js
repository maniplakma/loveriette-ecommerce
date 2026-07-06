/**
 * Admin-managed proxy pool + auto-assign for plugging accounts.
 */
function getEnabledProxyPool(db) {
  return db.prepare(`
    SELECT id, url FROM plugging_proxies WHERE is_enabled = 1 ORDER BY id ASC
  `).all();
}

function pickProxyFromPool(db) {
  const pool = getEnabledProxyPool(db);
  if (!pool.length) return '';
  const n = db.prepare('SELECT COUNT(*) AS c FROM plugging_accounts').get().c;
  return pool[n % pool.length].url;
}

function pickProxyForNewAccount(db, settings) {
  const fromPool = pickProxyFromPool(db);
  if (fromPool) return fromPool;

  if (String(settings?.proxy_enabled || '0') === '1') {
    return String(settings.proxy_url || '').trim();
  }
  return '';
}

function ensureAccountProxy(db, accountId, settings) {
  const account = db.prepare('SELECT id, proxy_url FROM plugging_accounts WHERE id = ?').get(accountId);
  if (!account) return '';
  if (String(account.proxy_url || '').trim()) return account.proxy_url.trim();

  const proxy = pickProxyForNewAccount(db, settings);
  if (proxy) {
    db.prepare(`
      UPDATE plugging_accounts SET proxy_url = ?, updated_at = datetime('now') WHERE id = ?
    `).run(proxy, accountId);
  }
  return proxy;
}

function autoEnableProxySetting(db) {
  const has = db.prepare('SELECT 1 FROM plugging_proxies WHERE is_enabled = 1 LIMIT 1').get();
  if (has) {
    db.prepare(`
      INSERT INTO plugging_content (key, value) VALUES ('proxy_enabled', '1')
      ON CONFLICT(key) DO UPDATE SET value = '1'
    `).run();
  }
}

function listPluggingProxies(db) {
  return db.prepare(`
    SELECT id, label, url, is_enabled AS isEnabled, created_at AS createdAt
    FROM plugging_proxies ORDER BY id ASC
  `).all();
}

module.exports = {
  pickProxyForNewAccount,
  ensureAccountProxy,
  autoEnableProxySetting,
  listPluggingProxies,
  getEnabledProxyPool
};
