/**
 * Parse Telegram post links and fetch the exact message to forward.
 * Example: https://t.me/directhererie/4
 */
const { joinSourceChannel } = require('./plugging-join');

function parsePostLink(link) {
  const raw = String(link || '').trim();
  if (!raw) throw new Error('Post link is required');

  const privateMatch = raw.match(/(?:https?:\/\/)?t\.me\/c\/(\d+)\/(\d+)/i);
  if (privateMatch) {
    return {
      type: 'private',
      messageId: Number(privateMatch[2]),
      channelPeer: BigInt(`-100${privateMatch[1]}`),
      label: `post #${privateMatch[2]}`
    };
  }

  const publicMatch = raw.match(/(?:https?:\/\/)?t\.me\/(?!c\/|\+|joinchat\/)([A-Za-z0-9_]+)\/(\d+)/i);
  if (publicMatch) {
    return {
      type: 'public',
      messageId: Number(publicMatch[2]),
      username: publicMatch[1],
      channelRef: `@${publicMatch[1]}`,
      label: `@${publicMatch[1]}/${publicMatch[2]}`
    };
  }

  throw new Error('Invalid post link — use https://t.me/channelname/123 (not a channel-only link)');
}

function isPostLink(link) {
  try {
    parsePostLink(link);
    return true;
  } catch (_) {
    return false;
  }
}

async function resolvePostMessage(client, postLink, logFn) {
  const parsed = parsePostLink(postLink);
  let source;

  if (parsed.type === 'private') {
    source = await client.getEntity(parsed.channelPeer);
  } else {
    source = await client.getEntity(parsed.channelRef);
  }

  await joinSourceChannel(client, source, logFn);

  const messages = await client.getMessages(source, { ids: [parsed.messageId] });
  const msg = messages?.[0];
  if (!msg) {
    throw new Error(`Post not found — check link ${postLink}`);
  }

  return {
    source,
    message: msg,
    messageId: parsed.messageId,
    label: parsed.label
  };
}

module.exports = {
  parsePostLink,
  isPostLink,
  resolvePostMessage
};
