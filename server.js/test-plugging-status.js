/**
 * Plugging bot readiness check — no secrets printed.
 * Run: node server.js/test-plugging-status.js
 */
const http = require('http');
const db = require('./db');
const appConfig = require('./config');
const { loadGramJs } = require('./plugging-telegram');
const { parseTargets } = require('./plugging-runner');

const BASE = appConfig.resolveTestBase();

function flag(key) {
  const row = db.prepare('SELECT value FROM plugging_content WHERE key = ?').get(key);
  return !!(row?.value && String(row.value).trim());
}

function request(method, urlPath, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const req = http.request(`${BASE}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie || '',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = raw ? JSON.parse(raw) : {}; } catch (_) { json = { raw }; }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const stats = {
    gramJsInstalled: loadGramJs(),
    pluggingEnabled: flag('plugging_enabled'),
    telegramApiIdConfigured: flag('telegram_api_id'),
    telegramApiHashConfigured: flag('telegram_api_hash'),
    masterKeyConfigured: !!String(appConfig.plugMasterKey || '').trim(),
    accountCount: db.prepare('SELECT COUNT(*) AS c FROM plugging_accounts').get().c,
    authenticatedAccounts: db.prepare("SELECT COUNT(*) AS c FROM plugging_accounts WHERE auth_status = 'authenticated'").get().c,
    runningRunners: db.prepare("SELECT COUNT(*) AS c FROM plugging_accounts WHERE runner_status = 'running'").get().c,
    approvedOrders: db.prepare("SELECT COUNT(*) AS c FROM plugging_orders WHERE status = 'approved'").get().c
  };

  console.log('Plugging readiness');
  console.log(JSON.stringify(stats, null, 2));

  const pub = await request('GET', '/api/plugging');
  console.log('\nGET /api/plugging:', pub.status === 200 ? 'OK' : pub.status);

  if (appConfig.plugMasterKey) {
    const unlock = await request('POST', '/api/plugging/workspace/unlock', { accessKey: appConfig.plugMasterKey });
    const cookie = (unlock.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    console.log('Master key unlock:', unlock.status === 200 ? 'OK' : `${unlock.status} ${unlock.json?.error || ''}`);

    if (unlock.status === 200 && cookie) {
      const ws = await request('GET', '/api/plugging/workspace', null, cookie);
      console.log('Workspace load:', ws.status === 200 ? `OK (${(ws.json.accounts || []).length} accounts)` : `${ws.status} ${ws.json?.error || ''}`);
    }
  } else {
    console.log('Master key unlock: skipped (PLUG_MASTER_KEY not set)');
  }

  // Forwarding logic unit check (no Telegram network)
  const targets = parseTargets('@group1\nt.me/testgroup');
  console.log('\nForward parser test:', targets.length === 2 ? 'OK' : 'FAIL');

  const canForwardLive = stats.gramJsInstalled
    && stats.telegramApiIdConfigured
    && stats.telegramApiHashConfigured
    && stats.authenticatedAccounts > 0;

  console.log('\nLive forwarding possible:', canForwardLive ? 'YES (needs Start in workspace)' : 'NO');
  if (!canForwardLive) {
    const missing = [];
    if (!stats.gramJsInstalled) missing.push('GramJS library');
    if (!stats.telegramApiIdConfigured || !stats.telegramApiHashConfigured) missing.push('Telegram API ID + Hash in Admin → Plugging');
    if (!stats.authenticatedAccounts) missing.push('At least one Telegram account logged in via workspace');
    console.log('Missing for live forward:', missing.join('; ') || 'unknown');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
