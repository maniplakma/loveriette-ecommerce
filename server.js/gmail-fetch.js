'use strict';

const { getValidAccessToken } = require('./gmail-oauth');

const DEFAULT_GMAIL_FILTERS = {
  unreadOnly: true,
  inboxOnly: true,
  allowedSenders: [],
  blockedSenders: [],
  subjectKeywords: [],
  extraQuery: ''
};

function parseLineList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseGmailFilters(integration = {}) {
  return {
    unreadOnly: integration.unreadOnly !== false,
    inboxOnly: integration.inboxOnly !== false,
    allowedSenders: parseLineList(integration.allowedSenders),
    blockedSenders: parseLineList(integration.blockedSenders),
    subjectKeywords: parseLineList(integration.subjectKeywords),
    extraQuery: String(integration.extraQuery || '').trim()
  };
}

function decodeBase64Url(str) {
  if (!str) return '';
  const padded = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getHeader(headers, name) {
  const h = (headers || []).find((x) => String(x.name || '').toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

function walkParts(part, out) {
  if (!part) return;
  const data = part.body?.data;
  if (data) {
    const decoded = decodeBase64Url(data);
    if (part.mimeType === 'text/html') out.html += decoded;
    else if (part.mimeType === 'text/plain') out.text += decoded;
  }
  (part.parts || []).forEach((p) => walkParts(p, out));
}

function extractBodies(payload) {
  const out = { text: '', html: '' };
  if (payload?.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') out.html = decoded;
    else out.text = decoded;
  }
  walkParts(payload, out);
  return out;
}

function sanitizeEmailHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/<meta[\s\S]*?>/gi, '')
    .replace(/<base[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function decodeBasicEntities(str) {
  return String(str || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function unwrapTrackingRedirect(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if ((host === 'www.google.com' || host === 'google.com') && u.pathname === '/url') {
      const q = u.searchParams.get('q') || u.searchParams.get('url');
      if (q) return decodeBasicEntities(q);
    }
    if (host.includes('safelinks.protection.outlook.com')) {
      const q = u.searchParams.get('url');
      if (q) return decodeBasicEntities(decodeURIComponent(q));
    }
  } catch (_) { /* ignore malformed URLs */ }
  return url;
}

function normalizeHref(href) {
  let url = decodeBasicEntities(String(href || '').trim());
  if (!url || url === '#') return '';
  if (/^mailto:/i.test(url) || /^tel:/i.test(url)) return url;
  url = unwrapTrackingRedirect(url);
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url) && /^www\./i.test(url)) url = `https://${url}`;
  return url;
}

function stripEmailWhiteBackgrounds(html) {
  return String(html || '')
    .replace(/\bbgcolor\s*=\s*["']?(#fff(?:fff)?|white)["']?/gi, '')
    .replace(/\bbackground-color\s*:\s*(#fff(?:fff)?|#ffffff|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/gi, 'background-color:transparent')
    .replace(/\bbackground\s*:\s*(#fff(?:fff)?|#ffffff|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/gi, 'background:transparent');
}

function prepareEmailHtmlForDisplay(html) {
  let safe = sanitizeEmailHtml(String(html || ''));
  safe = stripEmailWhiteBackgrounds(safe);
  safe = safe.replace(/<a\b([^>]*)>/gi, (full, attrs) => {
    const hrefMatch = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) return full;
    const href = normalizeHref(hrefMatch[2] || hrefMatch[3] || hrefMatch[4]);
    if (!href) return full;
    let clean = attrs.replace(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i, '');
    clean = clean.replace(/\btarget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    clean = clean.replace(/\brel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const escHref = href.replace(/"/g, '&quot;');
    return `<a${clean} class="buyer-inbox-email-link" href="${escHref}" target="_blank" rel="noopener noreferrer">`;
  });
  return safe;
}

function extractUrlsFromEmail(html, text) {
  const urls = [];
  const seen = new Set();
  const push = (raw) => {
    const href = normalizeHref(raw);
    if (!href || !/^https?:\/\//i.test(href) || seen.has(href)) return;
    seen.add(href);
    urls.push(href);
  };
  const src = String(html || '');
  let m;
  const hrefRe = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  while ((m = hrefRe.exec(src))) push(m[2] || m[3] || m[4]);
  String(text || '').replace(/https?:\/\/[^\s<>"']+/gi, (u) => { push(u); return u; });
  return urls.slice(0, 8);
}

function linkifyPlainText(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/(https?:\/\/[^\s<]+|(?:www\.)[^\s<]+)/gi, (raw) => {
    const href = normalizeHref(raw);
    if (!href || !/^https?:\/\//i.test(href)) return raw;
    return `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${raw}</a>`;
  });
}

function formatDateFromHeader(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleString();
}

async function gmailApiGet(accessToken, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || 'Gmail API request failed');
  return json;
}

function buildSearchQueries(accountEmail, filters) {
  const email = String(accountEmail || '').trim().toLowerCase();
  if (!email) return [];

  const baseParts = [
    filters.inboxOnly !== false ? 'in:inbox' : '',
    filters.unreadOnly !== false ? 'is:unread' : '',
    filters.extraQuery || ''
  ].filter(Boolean);

  const base = baseParts.join(' ');
  return [
    `${base} to:${email}`.trim(),
    `${base} "${email}"`.trim(),
    `${base} ${email.split('@')[0]}`.trim()
  ].filter(Boolean);
}

function matchesAccount(haystack, email) {
  const localPart = email.split('@')[0];
  return haystack.includes(email) || haystack.includes(localPart);
}

function passesMessageFilters({ subject, from, body }, filters) {
  const subj = String(subject || '').toLowerCase();
  const fromStr = String(from || '').toLowerCase();
  const bodyStr = String(body || '').toLowerCase();
  const hay = `${subj} ${fromStr} ${bodyStr}`;

  if (filters.blockedSenders.some((b) => hay.includes(String(b).toLowerCase()))) {
    return false;
  }
  if (filters.allowedSenders.length
    && !filters.allowedSenders.some((a) => hay.includes(String(a).toLowerCase()))) {
    return false;
  }
  if (filters.subjectKeywords.length
    && !filters.subjectKeywords.some((k) => subj.includes(String(k).toLowerCase()))) {
    return false;
  }
  return true;
}

function parseMessageFull(full, accountEmail) {
  const headers = full.payload?.headers || [];
  const subject = getHeader(headers, 'Subject');
  const from = getHeader(headers, 'From');
  const date = formatDateFromHeader(getHeader(headers, 'Date'));
  const bodies = extractBodies(full.payload);
  const bodyText = bodies.text.trim();
  const rawHtml = bodies.html.trim();
  const body = bodyText || rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const bodyHtmlDisplay = rawHtml
    ? prepareEmailHtmlForDisplay(rawHtml)
    : linkifyPlainText(bodyText || body);
  const links = extractUrlsFromEmail(rawHtml || bodyHtmlDisplay, bodyText || body);
  const email = String(accountEmail || '').trim().toLowerCase();
  const haystack = `${subject} ${from} ${body}`.toLowerCase();

  if (email && !matchesAccount(haystack, email)) {
    return null;
  }

  return {
    messageId: full.id,
    internalDate: Number(full.internalDate) || 0,
    subject,
    from,
    date,
    body,
    bodyHtml: bodyHtmlDisplay,
    bodyText: bodyText || body,
    links
  };
}

/**
 * Fetch exactly one latest matching message (newest first). Skips already-delivered message id.
 */
async function fetchLatestUnreadGmail(db, connectionRow, accountEmail, options = {}) {
  const filters = { ...DEFAULT_GMAIL_FILTERS, ...(options.filters || {}) };
  const skipMessageId = options.skipMessageId || null;
  const accessToken = await getValidAccessToken(db, connectionRow);
  const email = String(accountEmail || '').trim().toLowerCase();
  if (!email) throw new Error('Account email is required');

  const queries = buildSearchQueries(email, filters);
  let candidateIds = [];

  for (const q of queries) {
    const list = await gmailApiGet(
      accessToken,
      `/messages?q=${encodeURIComponent(q)}&maxResults=8`
    );
    if (list.messages?.length) {
      candidateIds = list.messages.map((m) => m.id);
      break;
    }
  }

  if (!candidateIds.length) {
    return {
      found: false,
      message: filters.unreadOnly !== false
        ? 'No new unread email for this account yet. Request the OTP or login email on the service first, then fetch again.'
        : 'No matching email found for this account yet.'
    };
  }

  const parsed = [];
  for (const messageId of candidateIds) {
    const full = await gmailApiGet(accessToken, `/messages/${messageId}?format=full`);
    const msg = parseMessageFull(full, email);
    if (!msg) continue;
    if (!passesMessageFilters(msg, filters)) continue;
    parsed.push(msg);
  }

  if (!parsed.length) {
    return {
      found: false,
      message: 'Inbox has messages but none passed your seller filters. Contact support if this persists.'
    };
  }

  parsed.sort((a, b) => b.internalDate - a.internalDate);
  const latest = parsed[0];

  if (skipMessageId && latest.messageId === skipMessageId) {
    return {
      found: false,
      message: 'No new email since your last fetch. Trigger a fresh OTP or login email on the service, then try again.',
      alreadyFetched: true
    };
  }

  return {
    found: true,
    messageId: latest.messageId,
    subject: latest.subject,
    from: latest.from,
    date: latest.date,
    body: latest.body,
    bodyHtml: latest.bodyHtml,
    bodyText: latest.bodyText,
    links: latest.links || []
  };
}

function getLastFetchedMessageId(db, buyerId, stockItemId) {
  const row = db.prepare(`
    SELECT gmail_message_id AS gmailMessageId
    FROM fetched_emails
    WHERE buyer_id = ? AND stock_item_id = ? AND gmail_message_id IS NOT NULL AND gmail_message_id != ''
    ORDER BY id DESC LIMIT 1
  `).get(buyerId, stockItemId);
  return row?.gmailMessageId || null;
}

module.exports = {
  DEFAULT_GMAIL_FILTERS,
  parseGmailFilters,
  parseLineList,
  fetchLatestUnreadGmail,
  getLastFetchedMessageId,
  linkifyPlainText,
  sanitizeEmailHtml,
  prepareEmailHtmlForDisplay,
  extractUrlsFromEmail,
  normalizeHref,
  passesMessageFilters,
  buildSearchQueries
};
