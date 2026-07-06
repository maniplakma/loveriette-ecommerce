/**
 * GramJS helpers for plugging workspace Telegram login.
 */
const path = require('path');
const fs = require('fs');

let TelegramClient;
let StringSession;
let Api;

function loadGramJs() {
  if (TelegramClient) return true;
  try {
    ({ TelegramClient } = require('telegram'));
    ({ StringSession } = require('telegram/sessions'));
    ({ Api } = require('telegram/tl'));
    return true;
  } catch (_) {
    return false;
  }
}

function getSessionsDir(appRoot) {
  const dir = path.join(appRoot || process.cwd(), 'server.js', 'plugging-sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseProxy(proxyUrl) {
  if (!proxyUrl) return undefined;
  try {
    const u = new URL(proxyUrl);
    const scheme = u.protocol.replace(':', '');
    if (scheme === 'socks5' || scheme === 'socks4' || scheme === 'http') {
      return {
        socksType: scheme === 'socks4' ? 4 : 5,
        ip: u.hostname,
        port: Number(u.port) || 1080,
        username: u.username || undefined,
        password: u.password || undefined
      };
    }
  } catch (_) { /* ignore */ }
  return undefined;
}

async function createClient(settings, sessionString = '', accountProxyUrl = '') {
  if (!loadGramJs()) throw new Error('Telegram library not available');
  const apiId = Number(settings.telegram_api_id || process.env.TELEGRAM_API_ID);
  const apiHash = String(settings.telegram_api_hash || process.env.TELEGRAM_API_HASH || '');
  if (!apiId || !apiHash) throw new Error('Telegram API credentials not configured in admin panel');

  const proxyUrl = String(accountProxyUrl || '').trim()
    || (settings.proxy_enabled === '1' ? String(settings.proxy_url || '').trim() : '');
  const proxy = proxyUrl ? parseProxy(proxyUrl) : undefined;

  const client = new TelegramClient(new StringSession(sessionString || ''), apiId, apiHash, {
    connectionRetries: 5,
    useWSS: false,
    proxy
  });
  await client.connect();
  return client;
}

async function sendLoginCode(settings, phone, sessionString = '', accountProxyUrl = '') {
  const client = await createClient(settings, sessionString, accountProxyUrl);
  try {
    const result = await client.sendCode(
      { apiId: Number(settings.telegram_api_id), apiHash: settings.telegram_api_hash },
      phone
    );
    const saved = client.session.save();
    return {
      phoneCodeHash: result.phoneCodeHash,
      sessionString: saved
    };
  } finally {
    await client.disconnect();
  }
}

async function verifyLoginCode(settings, { phone, code, phoneCodeHash, sessionString, proxyUrl = '' }) {
  const client = await createClient(settings, sessionString, proxyUrl);
  try {
    await client.invoke(new Api.auth.SignIn({
      phoneNumber: phone,
      phoneCodeHash,
      phoneCode: String(code).trim()
    }));
    return { sessionString: client.session.save(), authorized: true };
  } catch (err) {
    if (String(err?.errorMessage || err?.message || '').includes('SESSION_PASSWORD_NEEDED')) {
      throw new Error('Two-step verification is enabled on this Telegram account. Disable it or use an account without 2FA.');
    }
    throw err;
  } finally {
    await client.disconnect();
  }
}

async function withAuthorizedClient(settings, sessionString, fn, accountProxyUrl = '') {
  const client = await createClient(settings, sessionString, accountProxyUrl);
  try {
    if (!(await client.isUserAuthorized())) {
      throw new Error('Telegram session expired — please log in again with your phone number.');
    }
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

module.exports = {
  loadGramJs,
  getSessionsDir,
  sendLoginCode,
  verifyLoginCode,
  withAuthorizedClient
};
