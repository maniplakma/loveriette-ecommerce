'use strict';

const appConfig = require('./config');
const { getValidAccessToken } = require('./gmail-oauth');
const { getActiveGmailConnection } = require('./gmail-schema');
const { markBuyerEmailSent, wasBuyerEmailSent } = require('./mailer-schema');
const {
  parseSmtpSettings,
  isSmtpSendReady,
  sendViaSmtp,
  formatSmtpSendError
} = require('./smtp-mailer');
const {
  buildWelcomeEmail,
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
  buildOrderDeliveredEmail
} = require('./mailer-templates');

const DEFAULT_FROM_NAME = 'loveriette';

function parseBuyerEmailSettings(getSetting) {
  try {
    return JSON.parse(getSetting('integration_buyer_emails', '{}') || '{}');
  } catch (_) {
    return {};
  }
}

function buyerEmailsEnabled(getSetting, kind) {
  const settings = parseBuyerEmailSettings(getSetting);
  if (settings.enabled === false || settings.enabled === 'false') return false;
  if (kind === 'welcome' && (settings.welcome === false || settings.welcome === 'false')) return false;
  if (kind === 'password' && (settings.password === false || settings.password === 'false')) return false;
  if (kind === 'password_reset' && (settings.passwordReset === false || settings.passwordReset === 'false')) return false;
  if (kind === 'order_delivered' && (settings.orderDelivered === false || settings.orderDelivered === 'false')) return false;
  return true;
}

function resolveSiteUrl(getSetting) {
  return String(getSetting('site_public_url', '') || appConfig.publicUrl || '').replace(/\/$/, '')
    || 'https://loveriette.shop';
}

function resolveStoreName(getSetting) {
  return String(getSetting('store_brand_name', '') || getSetting('store_display_name', '') || 'loveriette').trim();
}

function encodeSubject(subject) {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function encodeRawEmail({ fromEmail, fromName, toEmail, subject, html, text }) {
  const lines = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${toEmail}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="alt-boundary"',
    '',
    '--alt-boundary',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    String(text || '').replace(/\r?\n/g, '\r\n'),
    '',
    '--alt-boundary',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    '',
    '--alt-boundary--'
  ];
  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendBuyerEmail(db, getSetting, { toEmail, subject, html, text }) {
  const recipient = String(toEmail || '').trim().toLowerCase();
  if (!recipient) throw new Error('Recipient email is required');

  if (isSmtpSendReady(getSetting)) {
    const smtp = parseSmtpSettings(getSetting);
    return sendViaSmtp(smtp, { toEmail: recipient, subject, html, text });
  }

  const conn = getActiveGmailConnection(db);
  if (!conn?.access_token_enc) {
    throw new Error('No email sender configured — set up SMTP in Admin → Integrations, or connect Gmail OAuth.');
  }

  const accessToken = await getValidAccessToken(db, conn);
  const fromEmail = String(conn.connected_email || appConfig.adminEmail || 'riettemadzehn@gmail.com').trim();
  const fromName = DEFAULT_FROM_NAME;
  const raw = encodeRawEmail({ fromEmail, fromName, toEmail: recipient, subject, html, text });

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatGmailSendErrorMessage(json.error?.message || json.error || 'Gmail send failed'));
  }
  return { ok: true, messageId: json.id || null, fromEmail, provider: 'gmail' };
}

function isOutboundEmailReady(getSetting, db) {
  if (isSmtpSendReady(getSetting)) return true;
  return !!getActiveGmailConnection(db)?.access_token_enc;
}

function formatSendError(err) {
  const msg = String(err?.message || err || 'Email send failed');
  if (/SMTP/i.test(msg)) return formatSmtpSendError(err);
  return formatGmailSendErrorMessage(msg);
}

function formatGmailSendErrorMessage(raw) {
  const msg = String(raw || 'Gmail send failed');
  if (/insufficient authentication scopes/i.test(msg)) {
    return 'Gmail send permission missing — go to Integrations → Gmail OAuth, click Connect Gmail again, and approve send access.';
  }
  if (/invalid_grant|token has been expired|revoked/i.test(msg)) {
    return 'Gmail session expired — reconnect Gmail OAuth in Admin → Integrations.';
  }
  return msg;
}

function formatGmailSendError(err) {
  return formatGmailSendErrorMessage(err?.message || err);
}

async function sendOnce(db, getSetting, { type, referenceKey, toEmail, build }) {
  if (!buyerEmailsEnabled(getSetting, type)) return { skipped: true, reason: 'disabled' };
  if (wasBuyerEmailSent(db, type, referenceKey)) return { skipped: true, reason: 'duplicate' };

  const payload = build();
  await sendBuyerEmail(db, getSetting, {
    toEmail,
    subject: payload.subject,
    html: payload.html,
    text: payload.text
  });
  markBuyerEmailSent(db, type, referenceKey, String(toEmail).toLowerCase(), payload.subject);
  return { ok: true };
}

async function sendWelcomeEmail(db, getSetting, { userId, email, name }) {
  const siteUrl = resolveSiteUrl(getSetting);
  const storeName = resolveStoreName(getSetting);
  return sendOnce(db, getSetting, {
    type: 'welcome',
    referenceKey: `user:${userId}`,
    toEmail: email,
    build: () => buildWelcomeEmail({ name, storeName, siteUrl })
  });
}

async function sendPasswordResetEmail(db, getSetting, { userId, email, name, resetUrl }) {
  const siteUrl = resolveSiteUrl(getSetting);
  const storeName = resolveStoreName(getSetting);
  if (!buyerEmailsEnabled(getSetting, 'password_reset')) {
    return { skipped: true, reason: 'disabled' };
  }

  const payload = buildPasswordResetEmail({
    name,
    storeName,
    siteUrl,
    resetUrl,
    expiresMinutes: 60
  });

  await sendBuyerEmail(db, getSetting, {
    toEmail: email,
    subject: payload.subject,
    html: payload.html,
    text: payload.text
  });
  markBuyerEmailSent(db, 'password_reset', `user:${userId}:${Date.now()}`, String(email).toLowerCase(), payload.subject);
  return { ok: true };
}

async function sendPasswordChangedEmail(db, getSetting, { userId, email, name }) {
  const user = db.prepare('SELECT notify_email FROM users WHERE id = ?').get(userId);
  if (user && !user.notify_email) return { skipped: true, reason: 'user_pref' };

  const siteUrl = resolveSiteUrl(getSetting);
  const storeName = resolveStoreName(getSetting);
  const referenceKey = `user:${userId}:pw:${Date.now()}`;
  return sendOnce(db, getSetting, {
    type: 'password',
    referenceKey,
    toEmail: email,
    build: () => buildPasswordChangedEmail({ name, storeName, siteUrl })
  });
}

function loadDeliveredOrderContext(db, orderId) {
  return db.prepare(`
    SELECT o.id, o.order_number, o.order_seq, o.email, o.total, o.created_at,
           o.status, o.user_id, o.buyer_name,
           pm.name AS payment_method_name, pm.slug AS payment_method_slug,
           u.name AS user_name, u.notify_email
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `).get(orderId);
}

function orderDisplayId(order) {
  if (!order) return '—';
  return order.order_seq != null ? String(order.order_seq) : String(order.order_number || '—');
}

async function trySendOrderDeliveredEmail(db, getSetting, orderId) {
  if (!buyerEmailsEnabled(getSetting, 'order_delivered')) return { skipped: true, reason: 'disabled' };

  const order = loadDeliveredOrderContext(db, orderId);
  if (!order || order.status !== 'approved') return { skipped: true, reason: 'not_approved' };

  const summary = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS expected,
           (SELECT COUNT(*) FROM order_fulfillments WHERE order_id = ?) AS fulfilled
    FROM order_items WHERE order_id = ?
  `).get(orderId, orderId);
  const expected = Number(summary?.expected || 0);
  const fulfilled = Number(summary?.fulfilled || 0);
  if (expected <= 0 || fulfilled < expected) return { skipped: true, reason: 'not_fully_delivered' };

  const toEmail = String(order.email || '').trim().toLowerCase();
  if (!toEmail) return { skipped: true, reason: 'no_email' };
  if (order.user_id && order.notify_email === 0) return { skipped: true, reason: 'user_pref' };

  const referenceKey = `order:${orderId}:delivered`;
  if (wasBuyerEmailSent(db, 'order_delivered', referenceKey)) {
    return { skipped: true, reason: 'duplicate' };
  }

  const items = db.prepare(`
    SELECT product_name, quantity FROM order_items WHERE order_id = ? ORDER BY id ASC
  `).all(orderId);
  const itemLabel = items.map((row) => row.product_name).filter(Boolean).join(' · ') || 'Your order';
  const quantity = items.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const buyerName = order.buyer_name || order.user_name || toEmail.split('@')[0] || 'there';
  const siteUrl = resolveSiteUrl(getSetting);
  const storeName = resolveStoreName(getSetting);
  const paymentMethod = order.payment_method_slug || order.payment_method_name || '—';

  const payload = buildOrderDeliveredEmail({
    name: buyerName,
    orderId: orderDisplayId(order),
    itemLabel,
    orderDate: order.created_at,
    quantity,
    paymentMethod,
    total: order.total,
    storeName,
    siteUrl
  });

  await sendBuyerEmail(db, getSetting, {
    toEmail,
    subject: payload.subject,
    html: payload.html,
    text: payload.text
  });
  markBuyerEmailSent(db, 'order_delivered', referenceKey, toEmail, payload.subject);
  return { ok: true };
}

function queueBuyerEmail(task) {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((err) => console.error('[buyer-email]', err.message || err));
  });
}

module.exports = {
  buyerEmailsEnabled,
  parseBuyerEmailSettings,
  sendBuyerEmail,
  isOutboundEmailReady,
  isSmtpSendReady,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  trySendOrderDeliveredEmail,
  queueBuyerEmail,
  formatGmailSendError,
  formatSendError
};
