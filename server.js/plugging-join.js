/**
 * Join Telegram groups/channels silently — no captcha messages sent.
 */
function loadGramJs() {
  try {
    const { Api } = require('telegram/tl');
    return { Api };
  } catch (_) {
    return null;
  }
}

function extractInviteHash(link) {
  const raw = String(link || '').trim();
  const plus = raw.match(/(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)/i);
  if (plus) return plus[1];
  const joinchat = raw.match(/(?:https?:\/\/)?t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);
  if (joinchat) return joinchat[1];
  return null;
}

async function joinEntity(client, entity, refLabel, logFn) {
  const gram = loadGramJs();
  if (!gram || !entity) return false;

  try {
    if (entity.broadcast || entity.megagroup || entity.gigagroup) {
      await client.invoke(new gram.Api.channels.JoinChannel({ channel: entity }));
      if (logFn) logFn(`Joined ${refLabel}`);
      return true;
    }
    if (entity.className === 'Chat') {
      if (logFn) logFn(`Already in ${refLabel}`);
      return true;
    }
  } catch (err) {
    const msg = String(err.message || err).toUpperCase();
    if (msg.includes('USER_ALREADY_PARTICIPANT') || msg.includes('ALREADY')) {
      if (logFn) logFn(`Already in ${refLabel}`);
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
    return chat;
  } catch (err) {
    const msg = String(err.message || err).toUpperCase();
    if (msg.includes('USER_ALREADY_PARTICIPANT') || msg.includes('ALREADY')) {
      const check = await client.invoke(new gram.Api.messages.CheckChatInvite({ hash }));
      const chat = check?.chat || null;
      if (logFn) logFn(`Already in invite ${refLabel}`);
      return chat;
    }
    throw err;
  }
}

async function joinTarget(client, link, entity, logFn) {
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
  joinTarget,
  joinSourceChannel
};
