/**
 * Plugging auto-start scheduler tests (no Telegram network).
 */
const assert = require('assert');
const {
  staggerMs,
  parseDailyAt,
  msUntilNextDailyRun,
  readAutoStartSettings
} = require('./plugging-autostart');

function testStaggerMs() {
  assert.strictEqual(staggerMs(10), 10 * 60 * 1000);
  assert.strictEqual(staggerMs(0), 0);
  assert.strictEqual(staggerMs(-3), 10 * 60 * 1000);
  assert.strictEqual(staggerMs(20, { enabled: false }), 0);
}

function testParseDailyAt() {
  assert.deepStrictEqual(parseDailyAt('09:30'), { hours: 9, minutes: 30 });
  assert.strictEqual(parseDailyAt('25:00'), null);
  assert.strictEqual(parseDailyAt(''), null);
}

function testMsUntilNextDailyRun() {
  const ms = msUntilNextDailyRun('23:59');
  assert(ms > 0 && ms <= 24 * 60 * 60 * 1000);
  assert.strictEqual(msUntilNextDailyRun('invalid'), null);
}

function testReadAutoStartSettings() {
  const settings = readAutoStartSettings({
    auto_start_enabled: 1,
    auto_start_stagger_enabled: 0,
    auto_start_stagger_minutes: 15,
    auto_start_daily_at: '08:00'
  });
  assert.strictEqual(settings.enabled, true);
  assert.strictEqual(settings.staggerEnabled, false);
  assert.strictEqual(settings.staggerMinutes, 15);
  assert.strictEqual(settings.dailyAt, '08:00');
}

function main() {
  testStaggerMs();
  testParseDailyAt();
  testMsUntilNextDailyRun();
  testReadAutoStartSettings();
  console.log('plugging-autostart tests: OK');
}

main();
