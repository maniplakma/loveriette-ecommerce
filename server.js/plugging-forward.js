/**
 * Telegram forward helpers for plugging runner + diagnostics.
 */
const { groupSendDelayMs } = require('./plugging-stealth');

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

async function forwardPost(client, source, target, msg) {
  try {
    await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
    return { ok: true, mode: 'forward' };
  } catch (forwardErr) {
    try {
      await client.sendMessage(target, { message: msg });
      return { ok: true, mode: 'copy' };
    } catch (copyErr) {
      return {
        ok: false,
        error: String(copyErr.message || copyErr || forwardErr.message || forwardErr)
      };
    }
  }
}

async function forwardPostWithRetries(client, source, target, msg, targetName, logFn) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await forwardPost(client, source, target, msg);
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
  forwardPost,
  forwardPostWithRetries
};
