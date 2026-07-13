'use strict';

/**
 * Workspace send queue — one account forwards at a time per order when stagger is ON.
 * Rotation: account 1 → 2 → … → N → 1 with staggerMinutes between each send.
 * Each account also respects its own cycle delay (delay_minutes) before sending again.
 */
const { cycleDelayMs } = require('./plugging-stealth');
const { readAutoStartSettings, staggerMs } = require('./plugging-stagger-settings');

const coordinators = new Map();
const POLL_MS = 5000;
const MAX_WAIT_MS = 30000;

function readWorkspaceStagger(db, orderId) {
  const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ?').get(orderId);
  const settings = readAutoStartSettings(order || {});
  return {
    enabled: settings.staggerEnabled,
    staggerMs: staggerMs(settings.staggerMinutes, { enabled: settings.staggerEnabled }),
    staggerMinutes: settings.staggerMinutes
  };
}

function isWorkspaceStaggerEnabled(db, orderId) {
  const { enabled, staggerMs: gap } = readWorkspaceStagger(db, orderId);
  return enabled && gap > 0;
}

function getRunningAccountIds(db, orderId) {
  return db.prepare(`
    SELECT id FROM plugging_accounts
    WHERE order_id = ? AND runner_status = 'running'
    ORDER BY id ASC
  `).all(orderId).map((row) => row.id);
}

class SendCoordinator {
  constructor(orderId) {
    this.orderId = orderId;
    this.loaded = false;
    this.lastSendEndedAt = 0;
    this.nextAccountId = null;
    this.holder = null;
    this.accountLastCycleEnd = new Map();
  }

  loadFromDb(db) {
    if (this.loaded) return;
    const order = db.prepare(`
      SELECT send_queue_next_account_id AS nextAccountId, send_queue_last_send_at AS lastSendAt
      FROM plugging_orders WHERE id = ?
    `).get(this.orderId);
    this.nextAccountId = order?.nextAccountId || null;
    this.lastSendEndedAt = Number(order?.lastSendAt) || 0;

    const rows = db.prepare(`
      SELECT id, last_cycle_ended_at AS endedAt
      FROM plugging_accounts
      WHERE order_id = ? AND last_cycle_ended_at > 0
    `).all(this.orderId);
    for (const row of rows) {
      this.accountLastCycleEnd.set(row.id, Number(row.endedAt) || 0);
    }
    this.loaded = true;
  }

  persist(db) {
    db.prepare(`
      UPDATE plugging_orders SET
        send_queue_next_account_id = ?,
        send_queue_last_send_at = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(this.nextAccountId || null, this.lastSendEndedAt || 0, this.orderId);
  }

  ensureNextAccount(db) {
    const runningIds = getRunningAccountIds(db, this.orderId);
    if (!runningIds.length) {
      this.nextAccountId = null;
      return runningIds;
    }
    if (!this.nextAccountId || !runningIds.includes(this.nextAccountId)) {
      this.nextAccountId = runningIds[0];
      this.persist(db);
    }
    return runningIds;
  }

  advanceNext(db) {
    const runningIds = getRunningAccountIds(db, this.orderId);
    if (!runningIds.length) {
      this.nextAccountId = null;
      return;
    }
    if (!this.nextAccountId || !runningIds.includes(this.nextAccountId)) {
      this.nextAccountId = runningIds[0];
      return;
    }
    const idx = runningIds.indexOf(this.nextAccountId);
    this.nextAccountId = runningIds[(idx + 1) % runningIds.length];
  }

  earliestSendAt(db, accountId, staggerGapMs, cycleDelayMin) {
    const runningIds = getRunningAccountIds(db, this.orderId);
    const personalMs = cycleDelayMs(cycleDelayMin);
    const personalLast = this.accountLastCycleEnd.get(accountId) || 0;
    const personalReady = personalLast > 0 && personalMs > 0 ? personalLast + personalMs : 0;
    const staggerReady = this.lastSendEndedAt > 0 && staggerGapMs > 0
      ? this.lastSendEndedAt + staggerGapMs
      : 0;

    if (runningIds.length <= 1) {
      if (!personalLast) return 0;
      return personalReady || 0;
    }

    if (!this.lastSendEndedAt) return 0;
    return Math.max(staggerReady, personalReady || 0);
  }

  computeWait(db, accountId, staggerGapMs, cycleDelayMin) {
    this.ensureNextAccount(db);

    if (this.holder && this.holder !== accountId) {
      return { ready: false, waitMs: POLL_MS, reason: 'busy' };
    }

    if (this.nextAccountId !== accountId) {
      return { ready: false, waitMs: POLL_MS, reason: 'not_turn' };
    }

    const earliest = this.earliestSendAt(db, accountId, staggerGapMs, cycleDelayMin);
    const now = Date.now();
    if (now < earliest) {
      return { ready: false, waitMs: Math.min(earliest - now, MAX_WAIT_MS), reason: 'delay' };
    }

    return { ready: true, waitMs: 0, reason: 'ready' };
  }

  tryAcquire(db, accountId, staggerGapMs, cycleDelayMin) {
    const state = this.computeWait(db, accountId, staggerGapMs, cycleDelayMin);
    if (!state.ready) return state;
    this.holder = accountId;
    return state;
  }

  complete(db, accountId, cycleEndedAt) {
    this.holder = null;
    this.lastSendEndedAt = cycleEndedAt;
    this.accountLastCycleEnd.set(accountId, cycleEndedAt);
    db.prepare(`
      UPDATE plugging_accounts SET last_cycle_ended_at = ?, updated_at = datetime('now') WHERE id = ?
    `).run(cycleEndedAt, accountId);
    this.advanceNext(db);
    this.persist(db);
  }

  releaseIfHolder(accountId) {
    if (this.holder === accountId) this.holder = null;
  }
}

function getCoordinator(orderId) {
  if (!coordinators.has(orderId)) {
    coordinators.set(orderId, new SendCoordinator(orderId));
  }
  return coordinators.get(orderId);
}

function clearCoordinatorForTest(orderId) {
  coordinators.delete(orderId);
}

async function waitForSendTurn(db, orderId, accountId, waitFn, shouldRun, cycleDelayMin) {
  const stagger = readWorkspaceStagger(db, orderId);
  if (!stagger.enabled || stagger.staggerMs <= 0) return true;

  const coordinator = getCoordinator(orderId);
  coordinator.loadFromDb(db);

  let loggedWait = false;
  while (shouldRun()) {
    const state = coordinator.tryAcquire(db, accountId, stagger.staggerMs, cycleDelayMin);
    if (state.ready) return true;

    if (!loggedWait && state.reason !== 'busy') {
      loggedWait = true;
    }
    const waitMs = Math.max(1000, Math.min(state.waitMs || POLL_MS, MAX_WAIT_MS));
    await waitFn(waitMs);
  }

  coordinator.releaseIfHolder(accountId);
  return false;
}

function completeSendTurn(db, orderId, accountId, cycleEndedAt) {
  if (!isWorkspaceStaggerEnabled(db, orderId)) return;
  const coordinator = getCoordinator(orderId);
  coordinator.loadFromDb(db);
  coordinator.complete(db, accountId, cycleEndedAt);
}

function abortSendTurn(db, orderId, accountId) {
  if (!isWorkspaceStaggerEnabled(db, orderId)) return;
  getCoordinator(orderId).releaseIfHolder(accountId);
}

function formatQueueWaitMessage(db, orderId, accountId, cycleDelayMin) {
  const stagger = readWorkspaceStagger(db, orderId);
  const coordinator = getCoordinator(orderId);
  coordinator.loadFromDb(db);
  const state = coordinator.computeWait(db, accountId, stagger.staggerMs, cycleDelayMin);
  if (state.ready) return null;

  const nextId = coordinator.nextAccountId;
  const nextLabel = db.prepare('SELECT label, phone FROM plugging_accounts WHERE id = ?').get(nextId);
  const who = nextLabel?.label || nextLabel?.phone || `account #${nextId}`;

  if (state.reason === 'not_turn') {
    return `Waiting for rotation — next send slot: ${who}`;
  }
  if (state.reason === 'delay') {
    return `Waiting for send slot (${stagger.staggerMinutes} min account gap / ${cycleDelayMin} min cycle delay)`;
  }
  return 'Waiting for another account to finish forwarding';
}

module.exports = {
  readWorkspaceStagger,
  isWorkspaceStaggerEnabled,
  getRunningAccountIds,
  getCoordinator,
  waitForSendTurn,
  completeSendTurn,
  abortSendTurn,
  formatQueueWaitMessage,
  clearCoordinatorForTest,
  SendCoordinator
};
