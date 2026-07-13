/**
 * Plugging workspace send queue tests (no Telegram network).
 */
const assert = require('assert');
const {
  SendCoordinator,
  clearCoordinatorForTest,
  getRunningAccountIds
} = require('./plugging-send-queue');
const { cycleDelayMs } = require('./plugging-stealth');

function mockDb(state) {
  return {
    prepare(sql) {
      return {
        get(...args) {
          if (sql.includes('FROM plugging_orders WHERE id')) {
            return {
              nextAccountId: state.order.nextAccountId,
              lastSendAt: state.order.lastSendAt
            };
          }
          if (sql.includes('label, phone FROM plugging_accounts')) {
            const id = args[0];
            return state.accounts.find((a) => a.id === id) || null;
          }
          if (sql.includes('last_cycle_ended_at AS endedAt')) {
            return null;
          }
          return null;
        },
        all(...args) {
          if (sql.includes('runner_status = \'running\'') && sql.includes('ORDER BY id')) {
            return state.accounts
              .filter((a) => a.runner_status === 'running')
              .sort((x, y) => x.id - y.id)
              .map((a) => ({ id: a.id }));
          }
          if (sql.includes('last_cycle_ended_at > 0')) {
            return state.accounts
              .filter((a) => a.last_cycle_ended_at > 0)
              .map((a) => ({ id: a.id, endedAt: a.last_cycle_ended_at }));
          }
          return [];
        },
        run(...args) {
          if (sql.includes('UPDATE plugging_orders SET')) {
            state.order.nextAccountId = args[0];
            state.order.lastSendAt = args[1];
          }
          if (sql.includes('UPDATE plugging_accounts SET last_cycle_ended_at')) {
            const acc = state.accounts.find((a) => a.id === args[1]);
            if (acc) acc.last_cycle_ended_at = args[0];
          }
        }
      };
    }
  };
}

function testRotationSevenAccountsTenMinuteGap() {
  const state = {
    order: { nextAccountId: null, lastSendAt: 0 },
    accounts: [1, 2, 3, 4, 5, 6, 7].map((id) => ({
      id,
      runner_status: 'running',
      last_cycle_ended_at: 0
    }))
  };
  const db = mockDb(state);
  const orderId = 99;
  clearCoordinatorForTest(orderId);
  const coord = new SendCoordinator(orderId);
  coord.loadFromDb(db);

  const staggerMs = 10 * 60 * 1000;
  const cycleMin = 70;

  let t = 1_000_000;
  const originalNow = Date.now;
  Date.now = () => t;

  try {
    assert.strictEqual(coord.tryAcquire(db, 1, staggerMs, cycleMin).ready, true);
    coord.complete(db, 1, t);
    assert.strictEqual(state.order.nextAccountId, 2);

    t += staggerMs;
    assert.strictEqual(coord.tryAcquire(db, 2, staggerMs, cycleMin).ready, true);
    coord.complete(db, 2, t);

    for (let id = 3; id <= 7; id += 1) {
      t += staggerMs;
      assert.strictEqual(coord.tryAcquire(db, id, staggerMs, cycleMin).ready, true, `account ${id}`);
      coord.complete(db, id, t);
    }

    t += staggerMs;
    assert.strictEqual(coord.tryAcquire(db, 1, staggerMs, cycleMin).ready, true, 'account 1 second round');
    assert.strictEqual(t - 1_000_000, 7 * staggerMs);
  } finally {
    Date.now = originalNow;
    clearCoordinatorForTest(orderId);
  }
}

function testSingleAccountUsesCycleDelayOnly() {
  const state = {
    order: { nextAccountId: null, lastSendAt: 0 },
    accounts: [{ id: 5, runner_status: 'running', last_cycle_ended_at: 0 }]
  };
  const db = mockDb(state);
  const orderId = 100;
  clearCoordinatorForTest(orderId);
  const coord = new SendCoordinator(orderId);
  coord.loadFromDb(db);

  const staggerMs = 10 * 60 * 1000;
  const cycleMin = 70;
  const cycleMs = cycleDelayMs(cycleMin);

  let t = 2_000_000;
  const originalNow = Date.now;
  Date.now = () => t;

  try {
    assert.strictEqual(coord.tryAcquire(db, 5, staggerMs, cycleMin).ready, true);
    coord.complete(db, 5, t);

    t += cycleMs - 1;
    assert.strictEqual(coord.tryAcquire(db, 5, staggerMs, cycleMin).ready, false);

    t += 1;
    assert.strictEqual(coord.tryAcquire(db, 5, staggerMs, cycleMin).ready, true);
  } finally {
    Date.now = originalNow;
    clearCoordinatorForTest(orderId);
  }
}

function testNotTurnBlocksOtherAccounts() {
  const state = {
    order: { nextAccountId: 1, lastSendAt: 0 },
    accounts: [
      { id: 1, runner_status: 'running', last_cycle_ended_at: 0 },
      { id: 2, runner_status: 'running', last_cycle_ended_at: 0 }
    ]
  };
  const db = mockDb(state);
  const coord = new SendCoordinator(101);
  coord.loadFromDb(db);
  coord.nextAccountId = 1;

  assert.strictEqual(coord.tryAcquire(db, 2, 600000, 70).ready, false);
  assert.strictEqual(coord.tryAcquire(db, 1, 600000, 70).ready, true);
}

function main() {
  testRotationSevenAccountsTenMinuteGap();
  testSingleAccountUsesCycleDelayOnly();
  testNotTurnBlocksOtherAccounts();
  console.log('plugging-send-queue tests: OK');
}

main();
