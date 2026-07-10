'use strict';

const THEME = {
  bg: '#f1dec9',
  surface: '#faf3ea',
  text: '#4a3c2e',
  muted: '#7a6b5c',
  primary: '#8d7b68',
  accent: '#c45c4a',
  border: '#e8dcc8'
};

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(amount) {
  return `₱${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatEmailDate(value) {
  if (!value) return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const raw = String(value);
  const d = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function emailShell({ title, eyebrow, greeting, lead, bodyHtml, ctaLabel, ctaUrl, storeName }) {
  const brand = escHtml(storeName || 'loveriette');
  const ctaBlock = ctaLabel && ctaUrl
    ? `<p style="margin:28px 0 0;text-align:center;">
        <a href="${escHtml(ctaUrl)}" style="display:inline-block;background:${THEME.primary};color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px;">${escHtml(ctaLabel)}</a>
      </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:${THEME.bg};font-family:Georgia,'Times New Roman',serif;color:${THEME.text};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid ${THEME.border};">
    <tr>
      <td style="padding:28px 28px 10px;text-align:center;background:linear-gradient(180deg, ${THEME.surface} 0%, #fff 100%);">
        <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${THEME.muted};margin-bottom:8px;">${escHtml(eyebrow || brand)}</div>
        <div style="font-size:34px;line-height:1.1;font-weight:700;color:${THEME.text};">${escHtml(title)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 30px;">
        <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hi ${escHtml(greeting)},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:${THEME.text};">${lead}</p>
        ${bodyHtml || ''}
        ${ctaBlock}
        <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:${THEME.muted};text-align:center;">
          ${brand} · digital delivery only · do not share your credentials publicly
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function summaryTable(rows) {
  const items = rows.map(([label, value]) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${THEME.border};font-size:13px;color:${THEME.muted};width:34%;vertical-align:top;">${escHtml(label)}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${THEME.border};font-size:14px;color:${THEME.text};vertical-align:top;">${value}</td>
    </tr>`).join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;background:${THEME.surface};border:1px solid ${THEME.border};border-radius:14px;padding:4px 16px;">
    ${items}
  </table>`;
}

function buildWelcomeEmail({ name, storeName, siteUrl }) {
  const html = emailShell({
    title: 'Welcome',
    eyebrow: storeName || 'loveriette',
    greeting: name || 'there',
    lead: `Welcome to <strong>${escHtml(storeName || 'loveriette')}</strong>. Your account is ready — browse the shop, track orders, and access your purchases anytime from your dashboard.`,
    ctaLabel: 'Open My Account',
    ctaUrl: `${siteUrl}/dashboard.html`,
    storeName
  });
  return {
    subject: `Welcome to ${storeName || 'loveriette'}`,
    html,
    text: `Welcome to ${storeName || 'loveriette'}. Your account is ready. Visit ${siteUrl}/dashboard.html`
  };
}

function buildPasswordChangedEmail({ name, storeName, siteUrl }) {
  const html = emailShell({
    title: 'Password Updated',
    eyebrow: 'Account Security',
    greeting: name || 'there',
    lead: 'Your account password was changed successfully. If you did not make this change, contact support immediately through the website.',
    ctaLabel: 'Go to Account Settings',
    ctaUrl: `${siteUrl}/dashboard.html`,
    storeName
  });
  return {
    subject: `Your ${storeName || 'loveriette'} password was changed`,
    html,
    text: `Your password was changed. If this wasn't you, contact support. ${siteUrl}/dashboard.html`
  };
}

function buildOrderDeliveredEmail({
  name,
  orderId,
  itemLabel,
  orderDate,
  quantity,
  paymentMethod,
  total,
  storeName,
  siteUrl
}) {
  const bodyHtml = `
    <div style="text-align:center;margin:0 0 12px;">
      <div style="display:inline-block;font-size:13px;font-weight:700;letter-spacing:0.08em;color:${THEME.accent};">ORDER #${escHtml(orderId)}</div>
    </div>
    ${summaryTable([
      ['Item', escHtml(itemLabel)],
      ['Date', escHtml(formatEmailDate(orderDate))],
      ['Qty', escHtml(String(quantity))],
      ['Payment', escHtml(paymentMethod || '—')],
      ['Credentials', 'Check on website'],
      ['Total', `<strong style="color:${THEME.accent};font-size:16px;">${escHtml(formatMoney(total))}</strong>`]
    ])}`;

  const html = emailShell({
    title: 'Delivered',
    eyebrow: storeName || 'loveriette',
    greeting: name || 'there',
    lead: `Great news — your order for <strong>${escHtml(itemLabel)}</strong> has been completed and delivered to your account.`,
    bodyHtml,
    ctaLabel: 'View My Purchases',
    ctaUrl: `${siteUrl}/dashboard.html`,
    storeName
  });

  return {
    subject: `Order #${orderId} delivered — ${storeName || 'loveriette'}`,
    html,
    text: `Order #${orderId} delivered. Credentials: check on website — ${siteUrl}/dashboard.html`
  };
}

function buildPasswordResetEmail({ name, storeName, siteUrl, resetUrl, expiresMinutes = 60 }) {
  const html = emailShell({
    title: 'Reset Password',
    eyebrow: 'Account Recovery',
    greeting: name || 'there',
    lead: `We received a request to reset your <strong>${escHtml(storeName || 'loveriette')}</strong> password. Click the button below to choose a new password. This link expires in ${expiresMinutes} minutes.`,
    bodyHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:${THEME.muted};">If you did not request this, you can ignore this email — your password will stay the same.</p>`,
    ctaLabel: 'Reset Password',
    ctaUrl: resetUrl,
    storeName
  });
  return {
    subject: `Reset your ${storeName || 'loveriette'} password`,
    html,
    text: `Reset your password: ${resetUrl}\n\nThis link expires in ${expiresMinutes} minutes. If you did not request this, ignore this email.`
  };
}

module.exports = {
  buildWelcomeEmail,
  buildPasswordChangedEmail,
  buildPasswordResetEmail,
  buildOrderDeliveredEmail
};
