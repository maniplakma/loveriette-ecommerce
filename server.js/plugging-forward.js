/**
 * Telegram forward helpers for plugging runner + diagnostics.
 */
const { groupSendDelayMs } = require('./plugging-stealth');

const URL_RE = /(?:https?:\/\/(?:www\.)?|(?:t\.me|telegram\.me)\/)[^\s<>"')\]]+/gi;

function loadGramJs() {
  try {
    const { Api } = require('telegram/tl');
    const { utils } = require('telegram');
    return { Api, utils };
  } catch (_) {
    return null;
  }
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
  return '';
}

function buildOutboundMessage(msg, displayName) {
  const customLink = normalizeCustomLink(displayName);
  const prefix = customLink ? '' : String(displayName || '').trim();
  let text = String(msg.message || msg.text || '').trim();
  let replacedLinks = 0;

  if (customLink) {
    const matches = text.match(URL_RE);
    if (matches?.length) {
      replacedLinks = matches.length;
      text = text.replace(URL_RE, customLink);
    } else if (text) {
      text = `${text}\n\n${customLink}`;
      replacedLinks = 1;
    } else {
      text = customLink;
      replacedLinks = 1;
    }
  } else if (prefix) {
    text = text ? `${prefix}\n${text}` : prefix;
  }

  return { text, customLink, replacedLinks, hasPrefix: !!prefix };
}

function needsCustomSend(displayName) {
  const customLink = normalizeCustomLink(displayName);
  const prefix = customLink ? '' : String(displayName || '').trim();
  return !!(customLink || prefix);
}

async function joinSourceChannel(client, source) {
  const gram = loadGramJs();
  if (!gram || !source) return false;
  try {
    await client.invoke(new gram.Api.channels.JoinChannel({ channel: source }));
    return true;
  } catch (_) {
    return false;
  }
}

async function inspectSource(client, source) {
  const gram = loadGramJs();
  if (!source) return { ok: false, error: 'No source entity' };

  try {
    const messages = await client.getMessages(source, { limit: 5 });
    const list = messages || [];
    const latest = list[0] || null;
    let peerId = null;
    try {
      peerId = gram ? await client.getPeerId(source) : null;
    } catch (_) { /* ignore */ }

    return {
      ok: true,
      peerId: peerId != null ? String(peerId) : null,
      latestId: latest?.id || null,
      latestDate: latest?.date || null,
      recentCount: list.length,
      canRead: list.length > 0 || latest != null
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

  if (!needsCustomSend(displayName)) {
    try {
      await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
      return { ok: true, mode: 'forward', replacedLinks: 0 };
    } catch (forwardErr) {
      try {
        const prepared = await sendPreparedMessage(client, target, msg, displayName);
        return { ok: true, mode: 'copy', replacedLinks: prepared.replacedLinks };
      } catch (copyErr) {
        return {
          ok: false,
          error: String(copyErr.message || copyErr || forwardErr.message || forwardErr)
        };
      }
    }
  }

  try {
    const prepared = await sendPreparedMessage(client, target, msg, displayName);
    return {
      ok: true,
      mode: customLink ? 'relink' : 'copy-prefix',
      replacedLinks: prepared.replacedLinks
    };
  } catch (copyErr) {
    return { ok: false, error: String(copyErr.message || copyErr) };
  }
}

async function forwardPostWithRetries(client, source, target, msg, targetName, logFn, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await forwardPost(client, source, target, msg, options);
    if (result.ok) return result;
    lastError = result.error;
    if (logFn) logFn(`Retry ${attempt}/3 → ${targetName}: ${lastError}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, groupSendDelayMs()));
  }
  return { ok: false, error: lastError || 'Forward failed' };
}

module.exports = {
  shouldProcessMessage,
  joinSourceChannel,
  inspectSource,
  buildOutboundMessage,
  normalizeCustomLink,
  forwardPost,
  forwardPostWithRetries
};
