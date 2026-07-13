/**
 * Plugging runner timing tests (no Telegram network).
 */
const assert = require('assert');
const {
  waitWhileRunning,
  shouldRun,
  cycleDelayMs,
  computeNextCycleAt,
  setRunnerForTest,
  clearRunnerForTest
} = require('./plugging-runner');

async function testWaitWhileRunningStopsEarly() {
  const accountId = 999001;
  const handle = { running: true, generation: 1 };
  setRunnerForTest(accountId, handle);
  const started = Date.now();
  setTimeout(() => { handle.running = false; }, 80);
  await waitWhileRunning(handle, accountId, 5000);
  clearRunnerForTest(accountId);
  const elapsed = Date.now() - started;
  assert(elapsed < 800, `expected early stop, took ${elapsed}ms`);
}

function testShouldRunRejectsReplacedHandle() {
  const accountId = 999002;
  const oldHandle = { running: true, generation: 1 };
  const newHandle = { running: true, generation: 2 };
  setRunnerForTest(accountId, newHandle);
  assert.strictEqual(shouldRun(oldHandle, accountId), false);
  assert.strictEqual(shouldRun(newHandle, accountId), true);
  clearRunnerForTest(accountId);
}

async function testCycleDelayMs() {
  assert.strictEqual(cycleDelayMs(70), 70 * 60 * 1000);
  assert.strictEqual(cycleDelayMs(0), 0);
  assert.strictEqual(cycleDelayMs(-5), 0);
}

function testComputeNextCycleAt() {
  const end = Date.now();
  const delay = 70 * 60 * 1000;
  assert.strictEqual(computeNextCycleAt(end, 70), end + delay);
  assert.strictEqual(computeNextCycleAt(end, 0), 0);
  assert.strictEqual(computeNextCycleAt(null, 70), 0);
}

function testSessionRevokedDetection() {
  const { isSessionRevokedError } = require('./plugging-telegram');
  assert.strictEqual(isSessionRevokedError(new Error('AUTH_KEY_UNREGISTERED')), true);
  assert.strictEqual(isSessionRevokedError(new Error('network timeout')), false);
}

async function main() {
  await testWaitWhileRunningStopsEarly();
  testShouldRunRejectsReplacedHandle();
  await testCycleDelayMs();
  testComputeNextCycleAt();
  testSessionRevokedDetection();
  console.log('plugging-runner tests: OK');
}

main().catch((err) => {
  console.error('plugging-runner tests FAILED:', err.message);
  process.exit(1);
});
