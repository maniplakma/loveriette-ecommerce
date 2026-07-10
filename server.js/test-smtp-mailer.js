/**
 * SMTP settings tests (no network).
 */
const assert = require('assert');
const {
  isSmtpConfigured,
  mergeSmtpSettings,
  publicSmtpSettings
} = require('./smtp-mailer');

function testIsSmtpConfigured() {
  assert.strictEqual(isSmtpConfigured({ host: 'smtp.test.com', fromEmail: 'a@b.com', user: 'u', password: 'p' }), true);
  assert.strictEqual(isSmtpConfigured({ host: '', fromEmail: 'a@b.com' }), false);
  assert.strictEqual(isSmtpConfigured({ host: 'smtp.test.com', fromEmail: '' }), false);
}

function testMergeKeepsPassword() {
  const merged = mergeSmtpSettings(
    { host: 'smtp.test.com', fromEmail: 'a@b.com', password: 'secret', enabled: true },
    { host: 'smtp.test.com', password: '' }
  );
  assert.strictEqual(merged.password, 'secret');
}

function testPublicSettingsHidePassword() {
  const pub = publicSmtpSettings({ host: 'smtp.test.com', fromEmail: 'a@b.com', password: 'secret', enabled: true });
  assert.strictEqual(pub.hasPassword, true);
  assert.strictEqual(pub.configured, false);
  const pub2 = publicSmtpSettings({ host: 'smtp.test.com', fromEmail: 'a@b.com', user: 'u', password: 'secret', enabled: true });
  assert.strictEqual(pub2.configured, true);
}

function main() {
  testIsSmtpConfigured();
  testMergeKeepsPassword();
  testPublicSettingsHidePassword();
  console.log('smtp-mailer tests: OK');
}

main();
