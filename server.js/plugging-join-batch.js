/**
 * Join-only batch — all workspace accounts join shared groups before forwarding.
 * No stagger/delay between accounts (forwarding auto-start keeps its own delay).
 */
const { withAuthorizedClient } = require('./plugging-telegram');
const { ensureAccountProxy } = require('./plugging-proxy');
const { logPlugActivity } = require('./plugging-activity');
const { parseTargets, resolveEntityFromLink } = require('./plugging-runner');
const { joinTarget, extractInviteHash, isAlreadyMember } = require('./plugging-join');
const { handlePostJoinVerification } = require('./plugging-verify');

const MAX_JOIN_ATTEMPTS = 3;
const orderQueues = new Map();

function entityLabel(entity) {
  if (!entity) return '';
  if (entity.username) return `@${entity.username}`;
  if (entity.title) return String(entity.title);
  return String(entity.id);
}

function normalizeGroupRef(ref) {
  return String(ref || '').trim();
}

function parseJoinGroups(text) {
  return parseTargets(text);
}

function getJoinableAccounts(db, orderId) {
  return db.prepare(`
    SELECT *
    FROM plugging_accounts
    WHERE order_id = ?
      AND auth_status = 'authenticated'
      AND TRIM(session_string) != ''
    ORDER BY id ASC
  `).all(orderId);
}

function getJoinResultRow(db, orderId, accountId, groupRef) {
  return db.prepare(`
    SELECT * FROM plugging_join_results
    WHERE order_id = ? AND account_id = ? AND group_ref = ?
  `).get(orderId, accountId, groupRef);
}

function upsertJoinResult(db, orderId, accountId, groupRef, patch) {
  const key = normalizeGroupRef(groupRef);
  const existing = getJoinResultRow(db, orderId, accountId, key);
  const status = patch.status != null ? patch.status : (existing?.status || 'pending');
  const attempts = patch.attempts != null ? patch.attempts : (existing?.attempts || 0);
  const lastError = patch.lastError != null ? patch.lastError : (existing?.last_error || '');

  if (existing) {
    db.prepare(`
      UPDATE plugging_join_results
      SET status = ?, attempts = ?, last_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, attempts, lastError, existing.id);
    return { ...existing, status, attempts, last_error: lastError };
  }

  const r = db.prepare(`
    INSERT INTO plugging_join_results (order_id, account_id, group_ref, status, attempts, last_error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orderId, accountId, key, status, attempts, lastError);
  return {
    id: r.lastInsertRowid,
    order_id: orderId,
    account_id: accountId,
    group_ref: key,
    status,
    attempts,
    last_error: lastError
  };
}

function pruneJoinResults(db, orderId, groups) {
  const keep = new Set(groups.map(normalizeGroupRef));
  const rows = db.prepare('SELECT id, group_ref FROM plugging_join_results WHERE order_id = ?').all(orderId);
  const del = db.prepare('DELETE FROM plugging_join_results WHERE id = ?');
  for (const row of rows) {
    if (!keep.has(normalizeGroupRef(row.group_ref))) del.run(row.id);
  }
}

function listJoinResults(db, orderId) {
  return db.prepare(`
    SELECT pjr.*, pa.label, pa.phone
    FROM plugging_join_results pjr
    JOIN plugging_accounts pa ON pa.id = pjr.account_id
    WHERE pjr.order_id = ?
    ORDER BY pjr.group_ref ASC, pjr.account_id ASC
  `).all(orderId);
}

function buildJoinGroupsStatus(db, orderId, groupsText) {
  const groups = parseJoinGroups(groupsText);
  const accounts = getJoinableAccounts(db, orderId);
  const results = listJoinResults(db, orderId);
  const resultMap = new Map();
  for (const row of results) {
    resultMap.set(`${row.account_id}:${normalizeGroupRef(row.group_ref)}`, row);
  }

  const completed = [];
  const pending = [];
  const errors = [];

  for (const groupRef of groups) {
    const key = normalizeGroupRef(groupRef);
    const accountStates = accounts.map((account) => {
      const row = resultMap.get(`${account.id}:${key}`);
      return {
        accountId: account.id,
        label: account.label || account.phone,
        phone: account.phone,
        status: row?.status || 'pending',
        attempts: row?.attempts || 0,
        lastError: row?.last_error || ''
      };
    });

    const allCompleted = accounts.length > 0 && accountStates.every((s) => s.status === 'completed');
    const hasError = accountStates.some((s) => s.status === 'error');
    const hasPending = accountStates.some((s) => s.status !== 'completed');

    if (allCompleted) {
      completed.push(key);
    } else if (hasError || hasPending) {
      pending.push(key);
    }

    const failedAccounts = accountStates.filter((s) => s.status === 'error');
    if (failedAccounts.length) {
      errors.push({ groupRef: key, accounts: failedAccounts });
    }
  }

  return {
    configured: groups,
    completed,
    completedText: completed.join('\n'),
    pending,
    errors,
    accountCount: accounts.length,
    results: results.map((row) => ({
      accountId: row.account_id,
      accountLabel: row.label || row.phone,
      groupRef: row.group_ref,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      updatedAt: row.updated_at
    }))
  };
}

async function joinGroupOnce(client, db, account, groupRef) {
  const key = normalizeGroupRef(groupRef);
  let entity = null;
  let wasMember = false;

  const hash = extractInviteHash(key);
  if (hash) {
    const membership = await isAlreadyMember(client, null, key);
    if (membership.member && membership.entity) {
      entity = membership.entity;
      wasMember = true;
    }
  }
  if (!entity) {
    entity = await resolveEntityFromLink(client, key);
  }

  if (!wasMember && entity) {
    const membership = await isAlreadyMember(client, entity, key);
    if (membership.member) {
      wasMember = true;
      entity = membership.entity || entity;
    }
  }

  if (!wasMember) {
    const beforeJoin = entity;
    const joined = await joinTarget(client, key, entity, (msg) => {
      logPlugActivity(db, account.id, 'info', `[Join groups] ${msg}`, key);
    }, { skipMemberCheck: true });
    entity = joined || beforeJoin || entity;
    if (entity) {
      await handlePostJoinVerification(client, entity, entityLabel(entity) || key, (msg) => {
        logPlugActivity(db, account.id, 'info', `[Join groups] ${msg}`, key);
      });
    }
  }

  if (!entity) throw new Error('Could not resolve group');

  const membership = await isAlreadyMember(client, entity, key);
  if (!membership.member) throw new Error('Join did not complete');

  if (!wasMember) {
    logPlugActivity(db, account.id, 'info', `[Join groups] Joined ${entityLabel(entity) || key}`, key);
  } else {
    logPlugActivity(db, account.id, 'info', `[Join groups] Already in ${entityLabel(entity) || key}`, key);
  }

  return entity;
}

async function joinGroupForAccount(db, account, groupRef, getSettings, queue) {
  const orderId = account.order_id;
  const key = normalizeGroupRef(groupRef);
  if (queue && !queue.running) {
    return { ok: false, skipped: true, stopped: true, groupRef: key };
  }

  const existing = getJoinResultRow(db, orderId, account.id, key);

  if (existing?.status === 'completed') {
    return { ok: true, skipped: true, groupRef: key };
  }
  if (existing && existing.attempts >= MAX_JOIN_ATTEMPTS && existing.status === 'error') {
    return { ok: false, skipped: true, groupRef: key, error: existing.last_error || 'Max attempts reached' };
  }

  const settings = getSettings();
  ensureAccountProxy(db, account.id, settings);
  const accountRow = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(account.id);

  let attemptNum = existing?.attempts || 0;
  let lastError = '';

  while (attemptNum < MAX_JOIN_ATTEMPTS) {
    if (queue && !queue.running) {
      upsertJoinResult(db, orderId, account.id, key, {
        status: 'pending',
        attempts: attemptNum,
        lastError: ''
      });
      return { ok: false, skipped: true, stopped: true, groupRef: key };
    }

    attemptNum += 1;
    upsertJoinResult(db, orderId, account.id, key, {
      status: 'joining',
      attempts: attemptNum,
      lastError: ''
    });

    try {
      await withAuthorizedClient(
        settings,
        accountRow.session_string,
        async (client) => joinGroupOnce(client, db, accountRow, key),
        accountRow.proxy_url || ''
      );
      upsertJoinResult(db, orderId, account.id, key, {
        status: 'completed',
        attempts: attemptNum,
        lastError: ''
      });
      return { ok: true, groupRef: key };
    } catch (err) {
      lastError = String(err.message || err).slice(0, 500);
      const finalStatus = attemptNum >= MAX_JOIN_ATTEMPTS ? 'error' : 'pending';
      upsertJoinResult(db, orderId, account.id, key, {
        status: finalStatus,
        attempts: attemptNum,
        lastError
      });
      logPlugActivity(
        db, account.id, 'error',
        `[Join groups] ${key} failed (${attemptNum}/${MAX_JOIN_ATTEMPTS}): ${lastError}`,
        key
      );
      if (attemptNum >= MAX_JOIN_ATTEMPTS) {
        return { ok: false, groupRef: key, error: lastError, attempts: attemptNum };
      }
    }
  }

  return { ok: false, groupRef: key, error: lastError || 'Max attempts reached', attempts: attemptNum };
}

async function runAccountJoinBatch(db, account, groups, getSettings, queue) {
  const outcomes = [];
  for (const groupRef of groups) {
    if (queue && !queue.running) break;
    outcomes.push(await joinGroupForAccount(db, account, groupRef, getSettings, queue));
    if (queue && !queue.running) break;
  }
  return outcomes;
}

async function runJoinGroupsBatch(db, orderId, getSettings, { source = 'manual' } = {}) {
  if (isJoinBatchRunning(orderId)) {
    return { ok: false, error: 'A join-groups batch is already running for this workspace' };
  }

  const order = db.prepare('SELECT join_groups_text, join_groups_enabled FROM plugging_orders WHERE id = ?').get(orderId);
  if (order && order.join_groups_enabled === 0) {
    return { ok: false, error: 'Join groups is turned off — enable it in the panel first' };
  }
  const groups = parseJoinGroups(order?.join_groups_text || '');
  if (!groups.length) {
    return { ok: false, error: 'Add at least one group or channel to join' };
  }

  const accounts = getJoinableAccounts(db, orderId);
  if (!accounts.length) {
    return { ok: false, error: 'No authenticated accounts — log in at least one Telegram number first' };
  }

  pruneJoinResults(db, orderId, groups);

  const queue = { running: true, startedAt: Date.now() };
  orderQueues.set(orderId, queue);

  (async () => {
    try {
      await Promise.all(accounts.map(async (account) => {
        if (!queue.running) return;
        logPlugActivity(db, account.id, 'started', '[Join groups] Batch started for this account');
        await runAccountJoinBatch(db, account, groups, getSettings, queue);
        if (!queue.running) {
          logPlugActivity(db, account.id, 'stopped', '[Join groups] Stopped by user');
          return;
        }
        logPlugActivity(db, account.id, 'complete', '[Join groups] Batch finished for this account');
      }));
    } finally {
      orderQueues.delete(orderId);
    }
  })();

  return {
    ok: true,
    source,
    queued: accounts.length,
    groupCount: groups.length,
    accountIds: accounts.map((a) => a.id)
  };
}

function stopJoinBatch(db, orderId) {
  const queue = orderQueues.get(orderId);
  const wasRunning = !!(queue && queue.running);
  if (queue) {
    queue.running = false;
    orderQueues.delete(orderId);
  }

  db.prepare(`
    UPDATE plugging_join_results
    SET status = 'pending', updated_at = datetime('now')
    WHERE order_id = ? AND status = 'joining'
  `).run(orderId);

  const accounts = db.prepare('SELECT id FROM plugging_accounts WHERE order_id = ?').all(orderId);
  for (const row of accounts) {
    logPlugActivity(db, row.id, 'stopped', '[Join groups] Stopped by user');
  }

  return wasRunning;
}

function isJoinBatchRunning(orderId) {
  const queue = orderQueues.get(orderId);
  return !!(queue && queue.running);
}

module.exports = {
  MAX_JOIN_ATTEMPTS,
  parseJoinGroups,
  getJoinableAccounts,
  buildJoinGroupsStatus,
  pruneJoinResults,
  runJoinGroupsBatch,
  stopJoinBatch,
  isJoinBatchRunning,
  joinGroupForAccount
};
