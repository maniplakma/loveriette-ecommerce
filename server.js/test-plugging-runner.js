/**
 * Plugging runner timing tests (no Telegram network).
 */
const assert = require('assert');
const { waitWhileRunning, cycleDelayMs } = require('./plugging-runner');

async function testWaitWhileRunningStopsEarly() {
  const state = { running: true };
  const started = Date.now();
  setTimeout(() => { state.running = false; }, 80);
  await waitWhileRunning(state, 5000);
  const elapsed = Date.now() - started;
  assert(elapsed < 800, `expected early stop, took ${elapsed}ms`);
}

async function testCycleDelayMs() {
  assert.strictEqual(cycleDelayMs(70), 70 * 60 * 1000);
  assert.strictEqual(cycleDelayMs(0), 0);
  assert.strictEqual(cycleDelayMs(-5), 0);
}

async function main() {
  await testWaitWhileRunningStopsEarly();
  await testCycleDelayMs();
  console.log('plugging-runner tests: OK');
}

main().catch((err) => {
  console.error('plugging-runner tests FAILED:', err.message);
  process.exit(1);
});
