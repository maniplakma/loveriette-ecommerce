const tls = require('tls');
const net = require('net');

function createImapSocket(config) {
  const host = config.host;
  const port = Number(config.port) || 993;
  const useTls = String(config.enc || 'SSL').toUpperCase() !== 'NONE';
  const opts = { host, port, servername: host, rejectUnauthorized: !!config.validateSsl };

  return new Promise((resolve, reject) => {
    const socket = useTls
      ? tls.connect(opts, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));

    socket.setTimeout(15000);
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('IMAP connection timed out'));
    });
  });
}

function imapCommand(socket, tag, command) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      const re = new RegExp(`${tag} (OK|NO|BAD)[^\r\n]*`, 'i');
      if (re.test(buffer)) {
        socket.off('data', onData);
        const match = buffer.match(re);
        if (/OK/i.test(match[0])) resolve(buffer);
        else reject(new Error(buffer.match(/NO[^\r\n]*/i)?.[0] || 'IMAP command failed'));
      }
    };
    socket.on('data', onData);
    socket.write(`${tag} ${command}\r\n`);
  });
}

function waitForGreeting(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes('* OK')) {
        socket.off('data', onData);
        resolve();
      } else if (buffer.includes('* BYE') || buffer.includes('* NO')) {
        socket.off('data', onData);
        reject(new Error('IMAP server rejected connection'));
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
    socket.once('timeout', () => reject(new Error('IMAP greeting timed out')));
  });
}

function escapeImapString(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function decodeBody(raw) {
  if (!raw) return '';
  let text = raw.replace(/\r\n/g, '\n');
  const parts = text.split('\n\n');
  if (parts.length > 1) text = parts.slice(1).join('\n\n');
  text = text.replace(/\* \d+ FETCH[^\n]*\n?/gi, '');
  text = text.replace(/\)\s*$/g, '').trim();
  return text.slice(0, 8000);
}

function parseFetchResponse(raw) {
  const subject = raw.match(/Subject: ([^\r\n]+)/i)?.[1]?.trim() || '';
  const from = raw.match(/From: ([^\r\n]+)/i)?.[1]?.trim() || '';
  const date = raw.match(/Date: ([^\r\n]+)/i)?.[1]?.trim() || '';
  const bodyMatch = raw.match(/BODY\[TEXT\][^\{]*\{(\d+)\}\r\n([\s\S]*?)(?=\r\n\*|\r\n[a-z]\d+ OK)/i)
    || raw.match(/BODY\[\][^\{]*\{(\d+)\}\r\n([\s\S]*?)(?=\r\n\*|\r\n[a-z]\d+ OK)/i);
  const body = bodyMatch ? decodeBody(bodyMatch[2]) : decodeBody(raw);
  return { subject, from, date, body };
}

async function fetchLatestEmailForAccount(config, accountEmail) {
  if (!config?.host || !config?.username || !config?.password) {
    throw new Error('IMAP is not configured in admin integrations');
  }
  if (!accountEmail) throw new Error('Account email is required');

  const socket = await createImapSocket(config);
  let tagNum = 1;
  const tag = () => `a${tagNum++}`;

  try {
    await waitForGreeting(socket);
    await imapCommand(socket, tag(), `LOGIN "${escapeImapString(config.username)}" "${escapeImapString(config.password)}"`);

    const folder = config.folder || 'INBOX';
    await imapCommand(socket, tag(), `SELECT "${escapeImapString(folder)}"`);

    const searchEmail = accountEmail.toLowerCase();
    let searchRaw = '';
    try {
      searchRaw = await imapCommand(socket, tag(), `SEARCH TEXT "${escapeImapString(searchEmail)}"`);
    } catch (_) {
      searchRaw = await imapCommand(socket, tag(), 'SEARCH ALL');
    }

    const ids = (searchRaw.match(/\* SEARCH([\d\s]+)/i)?.[1] || '')
      .trim().split(/\s+/).filter(Boolean).map(Number);
    if (!ids.length) {
      return { found: false, message: 'No emails found for this account yet.' };
    }

    const latestId = ids[ids.length - 1];
    const fetchRaw = await imapCommand(
      socket,
      tag(),
      `FETCH ${latestId} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT])`
    );

    const parsed = parseFetchResponse(fetchRaw);
    const haystack = `${parsed.subject} ${parsed.from} ${parsed.body}`.toLowerCase();
    if (!haystack.includes(searchEmail.split('@')[0]) && !haystack.includes(searchEmail)) {
      return {
        found: false,
        message: 'No recent email matched this account. Try again later.'
      };
    }

    return { found: true, ...parsed };
  } finally {
    try {
      socket.write(`${tag()} LOGOUT\r\n`);
    } catch (_) { /* ignore */ }
    try { socket.destroy(); } catch (_) { /* ignore */ }
  }
}

module.exports = { fetchLatestEmailForAccount };
