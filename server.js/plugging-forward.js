/**
 * Telegram forward helpers — always copy-send with optional link replacement.
 */
const { groupSendDelayMs } = require('./plugging-stealth');
const { joinSourceChannel: joinSourceWithCaptcha } = require('./plugging-join');

const URL_RE = /(?:https?:\/\/(?:www\.)?|(?:t\.me|telegram\.me)\/)[^\s<>"')\]]+/gi;
const BARE_DOMAIN_RE = /(?:[a-z0-9-]+\.)+(?:shop|store|com|ph|net|org)(?:\/[^\s<>"')\]]*)?/gi;

function loadGramJs() {
  try {
    const { Api } = require('telegram/tl');
    return { Api };
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldProcessMessage(msg) {
  if (!msg || !msg.id) return false;
  if (msg.action) return false;
  return !!(msg.message || msg.media || msg.text || msg.photo || msg.video || msg.document);
}

function normalizeCustomLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(?:t\.me|telegram\.me)\//i.test(s)) return `https://${s}`;
  if (s.startsWith('@')) return `https://t.me/${s.slice(1)}`;
  if (/^[\w.-]+\.(shop|store|com|ph|net|org)(\/|$)/i.test(s)) return `https://${s}`;
  return '';
}

function getMessageText(msg) {
  return String(msg.message || msg.text || '').trim();
}

function replaceLinksInText(text, customLink) {
  if (!customLink) return { text, replacedLinks: 0 };
  let out = String(text || '');
  let replacedLinks = 0;

  const urlMatches = out.match(URL_RE);
  if (urlMatches?.length) {
    replacedLinks += urlMatches.length;
    out = out.replace(URL_RE, customLink);
  }

  const bareMatches = out.match(BARE_DOMAIN_RE);
  if (bareMatches?.length) {
    replacedLinks += bareMatches.length;
    out = out.replace(BARE_DOMAIN_RE, customLink.replace(/^https?:\/\//i, ''));
  }

  if (!replacedLinks && out) {
    out = `${out}\n\n${customLink}`;
    replacedLinks = 1;
  } else if (!out) {
    out = customLink;
    replacedLinks = 1;
  }

  return { text: out, replacedLinks };
}

function buildOutboundMessage(msg, displayName) {
  const customLink = normalizeCustomLink(displayName);
  const prefix = customLink ? '' : String(displayName || '').trim();
  const baseText = getMessageText(msg);
  let text = baseText;
  let replacedLinks = 0;

  if (customLink) {
    const replaced = replaceLinksInText(baseText, customLink);
    text = replaced.text;
    replacedLinks = replaced.replacedLinks;
  } else if (prefix) {
    text = baseText ? `${prefix}\n${baseText}` : prefix;
  }

  return { text, customLink, replacedLinks, hasPrefix: !!prefix };
}

async function joinSourceChannel(client, source, logFn) {
  try {
    return await joinSourceWithCaptcha(client, source, logFn);
  } catch (_) {
    return false;
  }
}

async function inspectSource(client, source) {
  if (!source) return { ok: false, error: 'No source entity' };

  try {
    const messages = await client.getMessages(source, { limit: 5 });
    const list = messages || [];
    const latest = list[0] || null;
    let peerId = null;
    try {
      peerId = await client.getPeerId(source);
    } catch (_) { /* ignore */ }

    return {
      ok: true,
      peerId: peerId != null ? String(peerId) : null,
      latestId: latest?.id || null,
      latestDate: latest?.date || null,
      recentCount: list.length,
      canRead: list.length > 0,
      latest
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function sendPreparedMessage(client, target, msg, displayName) {
  const prepared = buildOutboundMessage(msg, displayName);
  const payload = { message: prepared.text || ' ' };

  if (msg.media) {
    payload.file = msg.media;
  }

  await client.sendMessage(target, payload);
  return prepared;
}

async function forwardPost(client, source, target, msg, options = {}) {
  const displayName = String(options.displayName || '').trim();
  const customLink = normalizeCustomLink(displayName);

  try {
    const prepared = await sendPreparedMessage(client, target, msg, displayName);
    return {
      ok: true,
      mode: customLink ? 'relink' : (displayName ? 'copy-prefix' : 'copy'),
      replacedLinks: prepared.replacedLinks
    };
  } catch (copyErr) {
    try {
      await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
      return { ok: true, mode: 'forward-fallback', replacedLinks: 0 };
    } catch (forwardErr) {
      return {
        ok: false,
        error: String(copyErr.message || copyErr || forwardErr.message || forwardErr)
      };
    }
  }
}

async function forwardPostWithRetries(client, source, target, msg, targetName, logFn, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await forwardPost(client, source, target, msg, options);
    if (result.ok) return result;
    lastError = result.error;
    if (logFn) logFn(`Retry ${attempt}/3 → ${targetName}: ${lastError}`);
    if (attempt < 3) await sleep(groupSendDelayMs());
  }
  return { ok: false, error: lastError || 'Forward failed' };
}

module.exports = {
  shouldProcessMessage,
  joinSourceChannel,
  inspectSource,
  buildOutboundMessage,
  normalizeCustomLink,
  getMessageText,
  forwardPost,
  forwardPostWithRetries
};
