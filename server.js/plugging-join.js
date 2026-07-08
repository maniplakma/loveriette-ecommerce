/**
 * Join Telegram groups/channels and answer common captcha prompts (+, x, etc.).
 */
const { groupSendDelayMs } = require('./plugging-stealth');

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

function extractInviteHash(link) {
  const raw = String(link || '').trim();
  const plus = raw.match(/(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)/i);
  if (plus) return plus[1];
  const joinchat = raw.match(/(?:https?:\/\/)?t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);
  if (joinchat) return joinchat[1];
  return null;
}

const CAPTCHA_ANSWERS = ['+', '✅', '👍', '☑️', '✔️', '✓', 'confirm', 'verify', '1', 'yes', 'x', 'X'];
const CAPTCHA_HINT_RE = /captcha|verify|verification|human|click|press|button|anti.?spam|not a bot|prove|solve|\+|✅|👍/i;

async function sendCaptchaAnswers(client, chat, logFn) {
  if (!chat) return;
  let sent = false;

  try {
    const recent = await client.getMessages(chat, { limit: 8 });
    for (const msg of recent || []) {
      const text = String(msg.message || msg.text || '');
      if (!CAPTCHA_HINT_RE.test(text)) continue;
      for (const answer of CAPTCHA_ANSWERS) {
        try {
          await client.sendMessage(chat, { message: answer, replyTo: msg.id });
          if (logFn) logFn(`Captcha reply sent: "${answer}"`);
          sent = true;
          await sleep(800);
          break;
        } catch (_) { /* try next */ }
      }
      if (sent) break;
    }
  } catch (_) { /* ignore */ }

  if (!sent) {
    for (const answer of ['+', '✅', '👍']) {
      try {
        await client.sendMessage(chat, { message: answer });
        if (logFn) logFn(`Join verify sent: "${answer}"`);
        await sleep(600);
        break;
      } catch (_) { /* ignore */ }
    }
  }
}

async function joinEntity(client, entity, refLabel, logFn) {
  const gram = loadGramJs();
  if (!gram || !entity) return false;

  try {
    if (entity.broadcast || entity.megagroup || entity.gigagroup) {
      await client.invoke(new gram.Api.channels.JoinChannel({ channel: entity }));
      if (logFn) logFn(`Joined ${refLabel}`);
      await sendCaptchaAnswers(client, entity, logFn);
      return true;
    }
    if (entity.className === 'Chat') {
      if (logFn) logFn(`Already in ${refLabel}`);
      await sendCaptchaAnswers(client, entity, logFn);
      return true;
    }
  } catch (err) {
    const msg = String(err.message || err).toUpperCase();
    if (msg.includes('USER_ALREADY_PARTICIPANT') || msg.includes('ALREADY')) {
      if (logFn) logFn(`Already in ${refLabel}`);
      await sendCaptchaAnswers(client, entity, logFn);
      return true;
    }
    throw err;
  }
  return false;
}

async function joinFromInvite(client, hash, refLabel, logFn) {
  const gram = loadGramJs();
  if (!gram || !hash) return null;

  try {
    const result = await client.invoke(new gram.Api.messages.ImportChatInvite({ hash }));
    const chat = result?.chats?.[0] || null;
    if (logFn) logFn(`Joined via invite ${refLabel}`);
    if (chat) await sendCaptchaAnswers(client, chat, logFn);
    return chat;
  } catch (err) {
    const msg = String(err.message || err).toUpperCase();
    if (msg.includes('USER_ALREADY_PARTICIPANT') || msg.includes('ALREADY')) {
      const check = await client.invoke(new gram.Api.messages.CheckChatInvite({ hash }));
      const chat = check?.chat || null;
      if (logFn) logFn(`Already in invite ${refLabel}`);
      if (chat) await sendCaptchaAnswers(client, chat, logFn);
      return chat;
    }
    throw err;
  }
}

async function joinTargetWithCaptcha(client, link, entity, logFn) {
  const hash = extractInviteHash(link);
  if (hash) {
    const joined = await joinFromInvite(client, hash, link, logFn);
    if (joined) return joined;
  }
  if (entity) {
    await joinEntity(client, entity, link, logFn);
    return entity;
  }
  return null;
}

async function joinSourceChannel(client, source, logFn) {
  return joinEntity(client, source, 'source channel', logFn);
}

module.exports = {
  extractInviteHash,
  joinTargetWithCaptcha,
  joinSourceChannel,
  sendCaptchaAnswers,
  CAPTCHA_ANSWERS
};
