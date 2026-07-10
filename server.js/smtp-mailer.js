'use strict';

const nodemailer = require('nodemailer');

function parseSmtpSettings(getSetting) {
  let settings = {};
  try {
    settings = JSON.parse(getSetting('integration_smtp', '{}') || '{}');
  } catch (_) {
    settings = {};
  }

  if (process.env.SMTP_HOST || process.env.SMTP_PASSWORD) {
    const envSecure = String(process.env.SMTP_SECURE || '0').trim().toLowerCase();
    const port = Number(process.env.SMTP_PORT || settings.port || 587) || 587;
    settings = {
      ...settings,
      host: String(process.env.SMTP_HOST || settings.host || 'live.smtp.mailtrap.io').trim(),
      port,
      secure: envSecure === '1' || envSecure === 'true'
        ? true
        : (envSecure === '0' || envSecure === 'false' ? false : settings.secure === true),
      user: String(process.env.SMTP_USER || settings.user || settings.username || 'api').trim(),
      password: String(process.env.SMTP_PASSWORD || settings.password || '').trim(),
      fromEmail: String(process.env.SMTP_FROM_EMAIL || settings.fromEmail || 'noreply@loveriette.shop').trim(),
      fromName: String(process.env.SMTP_FROM_NAME || settings.fromName || 'loveriette').trim() || 'loveriette'
    };
    if (settings.host && settings.password && settings.fromEmail) {
      settings.enabled = process.env.SMTP_ENABLED !== '0' && process.env.SMTP_ENABLED !== 'false';
    }
  }

  return settings;
}

function isTruthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function isSmtpConfigured(settings = {}) {
  const host = String(settings.host || '').trim();
  const fromEmail = String(settings.fromEmail || '').trim();
  const user = String(settings.user || settings.username || '').trim();
  const password = String(settings.password || '').trim();
  if (!host || !fromEmail) return false;
  if (!user && !password) return true;
  return !!(user && password);
}

function isSmtpSendReady(getSetting) {
  const settings = parseSmtpSettings(getSetting);
  if (!isTruthy(settings.enabled)) return false;
  return isSmtpConfigured(settings);
}

function mergeSmtpSettings(existing = {}, incoming = {}) {
  const bool = (val, fallback = false) => {
    if (val === true || val === 'true' || val === 1 || val === '1' || val === 'on') return true;
    if (val === false || val === 'false' || val === 0 || val === '0') return false;
    return fallback;
  };

  const merged = {
    ...existing,
    ...incoming,
    enabled: Object.prototype.hasOwnProperty.call(incoming, 'enabled')
      ? bool(incoming.enabled, false)
      : bool(existing.enabled, false),
    secure: Object.prototype.hasOwnProperty.call(incoming, 'secure')
      ? bool(incoming.secure, true)
      : bool(existing.secure, true),
    host: String(incoming.host ?? existing.host ?? '').trim(),
    port: Number(incoming.port ?? existing.port ?? 465) || 465,
    user: String(incoming.user ?? incoming.username ?? existing.user ?? existing.username ?? '').trim(),
    fromEmail: String(incoming.fromEmail ?? existing.fromEmail ?? '').trim(),
    fromName: String(incoming.fromName ?? existing.fromName ?? 'loveriette').trim() || 'loveriette'
  };

  const incomingPassword = incoming.password != null ? String(incoming.password) : '';
  merged.password = incomingPassword.trim()
    ? incomingPassword
    : String(existing.password || '');

  return merged;
}

function createSmtpTransport(settings) {
  const host = String(settings.host || '').trim();
  const port = Number(settings.port) || 465;
  const secure = settings.secure !== false && settings.secure !== 'false';
  const user = String(settings.user || settings.username || '').trim();
  const password = String(settings.password || '');

  const options = {
    host,
    port,
    secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  };

  if (!secure && (port === 587 || port === 2525 || port === 25)) {
    options.requireTLS = true;
  }

  if (user || password) {
    options.auth = { user, pass: password };
  }

  return nodemailer.createTransport(options);
}

async function sendViaSmtp(settings, { toEmail, subject, html, text }) {
  const recipient = String(toEmail || '').trim().toLowerCase();
  if (!recipient) throw new Error('Recipient email is required');
  if (!isSmtpConfigured(settings)) {
    throw new Error('SMTP is not configured — add host, from email, and credentials in Admin → Integrations → SMTP');
  }

  const fromEmail = String(settings.fromEmail).trim();
  const fromName = String(settings.fromName || 'loveriette').trim() || 'loveriette';
  const transport = createSmtpTransport(settings);

  try {
    const info = await transport.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: recipient,
      subject: String(subject || ''),
      text: String(text || ''),
      html: String(html || '')
    });
    return { ok: true, messageId: info.messageId || null, fromEmail, provider: 'smtp' };
  } catch (err) {
    throw new Error(formatSmtpSendError(err));
  } finally {
    transport.close?.();
  }
}

function formatSmtpSendError(err) {
  const msg = String(err?.message || err || 'SMTP send failed');
  if (/invalid login|authentication failed|535|534/i.test(msg)) {
    return 'SMTP login failed — check username and password in Admin → Integrations → SMTP.';
  }
  if (/certificate|self signed|TLS/i.test(msg)) {
    return 'SMTP TLS error — try port 465 with SSL on, or port 587 with SSL off.';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) {
    return 'Could not reach SMTP server — check host and port.';
  }
  return msg;
}

function publicSmtpSettings(settings = {}) {
  return {
    enabled: isTruthy(settings.enabled),
    host: String(settings.host || ''),
    port: Number(settings.port) || 465,
    secure: settings.secure !== false && settings.secure !== 'false',
    user: String(settings.user || settings.username || ''),
    fromEmail: String(settings.fromEmail || ''),
    fromName: String(settings.fromName || 'loveriette'),
    configured: isSmtpConfigured(settings),
    hasPassword: !!String(settings.password || '').trim()
  };
}

module.exports = {
  parseSmtpSettings,
  isSmtpConfigured,
  isSmtpSendReady,
  isTruthy,
  mergeSmtpSettings,
  sendViaSmtp,
  formatSmtpSendError,
  publicSmtpSettings
};
