'use strict';

const { mergeSmtpSettings, isSmtpConfigured } = require('./smtp-mailer');

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function buildSmtpFromEnv() {
  const password = env('SMTP_PASSWORD');
  if (!password) return null;

  const envSecure = env('SMTP_SECURE', '0').toLowerCase();
  return mergeSmtpSettings({}, {
    enabled: env('SMTP_ENABLED', '1') !== '0' && env('SMTP_ENABLED', '').toLowerCase() !== 'false',
    host: env('SMTP_HOST', 'live.smtp.mailtrap.io'),
    port: Number(env('SMTP_PORT', '587')) || 587,
    secure: envSecure === '1' || envSecure === 'true',
    user: env('SMTP_USER', 'api'),
    password,
    fromEmail: env('SMTP_FROM_EMAIL', 'noreply@loveriette.shop'),
    fromName: env('SMTP_FROM_NAME', 'loveriette')
  });
}

function buyerEmailsDefaults() {
  return {
    enabled: true,
    welcome: true,
    passwordReset: true,
    password: true,
    orderDelivered: true
  };
}

function bootstrapSmtpFromEnv(db, { clearSettingsCache } = {}) {
  const smtp = buildSmtpFromEnv();
  if (!smtp || !isSmtpConfigured(smtp)) return { ok: false, reason: 'no_env' };

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsert.run('integration_smtp', JSON.stringify(smtp));
  upsert.run('integration_buyer_emails', JSON.stringify(buyerEmailsDefaults()));

  if (typeof clearSettingsCache === 'function') clearSettingsCache();
  else if (clearSettingsCache && typeof clearSettingsCache.delete === 'function') {
    clearSettingsCache.delete('integration_smtp');
    clearSettingsCache.delete('integration_buyer_emails');
  }

  return { ok: true, host: smtp.host, fromEmail: smtp.fromEmail };
}

module.exports = {
  buildSmtpFromEnv,
  bootstrapSmtpFromEnv
};
