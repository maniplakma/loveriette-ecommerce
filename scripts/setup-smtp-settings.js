#!/usr/bin/env node
/**
 * One-time SMTP setup — writes Mailtrap (or any SMTP) into site DB from .env or env vars.
 *
 * On VPS:
 *   Add to /var/www/ecommerce/.env (chmod 600):
 *     SMTP_HOST=live.smtp.mailtrap.io
 *     SMTP_PORT=587
 *     SMTP_SECURE=0
 *     SMTP_USER=api
 *     SMTP_PASSWORD=your_api_token
 *     SMTP_FROM_EMAIL=noreply@loveriette.shop
 *     SMTP_FROM_NAME=loveriette
 *
 *   Then: node scripts/setup-smtp-settings.js && pm2 restart ecommerce
 */
'use strict';

const path = require('path');
const appRoot = process.env.APP_ROOT || path.resolve(__dirname, '..');

const db = require(path.join(appRoot, 'server.js', 'db.js'));
const { mergeSmtpSettings, isSmtpConfigured } = require(path.join(appRoot, 'server.js', 'smtp-mailer.js'));

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

const smtp = mergeSmtpSettings({}, {
  enabled: true,
  host: env('SMTP_HOST', 'live.smtp.mailtrap.io'),
  port: Number(env('SMTP_PORT', '587')) || 587,
  secure: env('SMTP_SECURE', '0') === '1' || env('SMTP_SECURE', '').toLowerCase() === 'true',
  user: env('SMTP_USER', 'api'),
  password: env('SMTP_PASSWORD'),
  fromEmail: env('SMTP_FROM_EMAIL', 'noreply@loveriette.shop'),
  fromName: env('SMTP_FROM_NAME', 'loveriette')
});

if (!isSmtpConfigured(smtp)) {
  console.error('ERROR: Set SMTP_PASSWORD and SMTP_FROM_EMAIL in .env first.');
  process.exit(1);
}

const buyerEmails = {
  enabled: true,
  welcome: true,
  passwordReset: true,
  password: true,
  orderDelivered: true
};

db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run('integration_smtp', JSON.stringify(smtp));

db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run('integration_buyer_emails', JSON.stringify(buyerEmails));

console.log('SMTP settings saved to database.');
console.log(`  Host: ${smtp.host}:${smtp.port} (SSL ${smtp.secure ? 'on' : 'off'})`);
console.log(`  From: ${smtp.fromName} <${smtp.fromEmail}>`);
console.log(`  User: ${smtp.user}`);
console.log('Buyer emails: all enabled.');
console.log('Run: pm2 restart ecommerce');
