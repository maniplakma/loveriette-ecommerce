/**
 * Native Telegram forward — forward the exact post, no copy/paste.
 */
const { groupSendDelayMs } = require('./plugging-stealth');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldProcessMessage(msg) {
  if (!msg || !msg.id) return false;
  if (msg.action) return false;
  return !!(msg.message || msg.media || msg.text || msg.photo || msg.video || msg.document);
}

async function forwardPost(client, source, target, msg) {
  try {
    await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
    return { ok: true, mode: 'forward' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function forwardPostWithRetries(client, source, target, msg, targetName, logFn) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await forwardPost(client, source, target, msg);
    if (result.ok) return result;
    lastError = result.error;
    if (logFn) logFn(`Retry ${attempt}/3 → ${targetName}: ${lastError}`);
    if (attempt < 3) await sleep(groupSendDelayMs());
  }
  return { ok: false, error: lastError || 'Forward failed' };
}

module.exports = {
  shouldProcessMessage,
  forwardPost,
  forwardPostWithRetries
};
