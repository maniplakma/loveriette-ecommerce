/**
 * Plugging plan limits helpers.
 */
const assert = require('assert');
const {
  normalizePlugOrder,
  hasBatchWorkspace,
  isUnlimited,
  formatLimitLabel
} = require('./plugging-limits');

function testHasBatchWorkspace() {
  assert.strictEqual(hasBatchWorkspace({ order_ref: 'PLG-MASTER' }), true);
  assert.strictEqual(hasBatchWorkspace({ planPriority: 1 }), true);
  assert.strictEqual(hasBatchWorkspace({ priority: 1 }), true);
  assert.strictEqual(hasBatchWorkspace({ planPriority: 0 }), false);
  assert.strictEqual(hasBatchWorkspace(null), false);
}

function testNormalizePlugOrder() {
  const master = normalizePlugOrder({ order_ref: 'PLG-MASTER' });
  assert.strictEqual(master.isMaster, true);
  assert.strictEqual(master.planPriority, 1);
  assert.strictEqual(hasBatchWorkspace(master), true);

  const vip = normalizePlugOrder({ maxSources: 10, maxDestinations: 50, planPriority: 0 });
  assert.strictEqual(vip.isMaster, false);
  assert.strictEqual(hasBatchWorkspace(vip), false);

  const vipPlus = normalizePlugOrder({ maxSources: 999, maxDestinations: 999, planPriority: 1 });
  assert.strictEqual(hasBatchWorkspace(vipPlus), true);
}

function testUnlimitedLabels() {
  assert.strictEqual(isUnlimited(999), true);
  assert.strictEqual(formatLimitLabel(999), 'Unlimited');
  assert.strictEqual(formatLimitLabel(10), '10');
}

function main() {
  testHasBatchWorkspace();
  testNormalizePlugOrder();
  testUnlimitedLabels();
  console.log('plugging-limits tests: OK');
}

main();
