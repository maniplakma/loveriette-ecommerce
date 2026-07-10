/**
 * In-process forwarding runners — forwards one exact post link to target groups.
 * One active loop per account; overlapping starts are cancelled before a new loop runs.
 */
const { withAuthorizedClient } = require('./plugging-telegram');
const { logPlugActivity } = require('./plugging-activity');
const { ensureAccountProxy } = require('./plugging-proxy');
const { cycleDelayMs, groupSendDelayMs, formatDelayLabel } = require('./plugging-stealth');
const { joinTarget, extractInviteHash, isAlreadyMember } = require('./plugging-join');
const { handlePostJoinVerification } = require('./plugging-verify');
const { isPostLink, resolvePostMessage } = require('./plugging-post');
const { forwardPostWithRetries } = require('./plugging-forward');

const runners = new Map();
const RETRY_DELAY_MS = 12000;
const TARGET_RESOLVE_MAX_ATTEMPTS = 3;
const WAIT_POLL_MS = 500;

function entityLabel(entity) {
  if (!entity) return '';
  if (entity.username) return `@${entity.username}`;
  if (entity.title) return String(entity.title);
  return String(entity.id);
}

function parseTargets(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function computeNextCycleAt(cycleEndedAt, delayMinutes) {
  const delayMs = cycleDelayMs(delayMinutes);
  if (!delayMs || delayMs <= 0 || !cycleEndedAt) return 0;
  return cycleEndedAt + delayMs;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldRun(handle, accountId) {
  const current = runners.get(accountId);
  return !!(current && current === handle && handle.running);
}

async function waitWhileRunning(handle, accountId, ms) {
  if (!ms || ms <= 0) return;
  const endAt = Date.now() + ms;
  while (shouldRun(handle, accountId) && Date.now() < endAt) {
    await sleep(Math.min(WAIT_POLL_MS, Math.max(0, endAt - Date.now())));
  }
}

function normalizeRef(ref) {
  return String(ref || '').trim();
}

function loadGramJs() {
  try {
    const { Api } = require('telegram/tl');
    return { Api };
  } catch (_) {
    return null;
  }
}

async function resolveEntityFromLink(client, link) {
  const raw = normalizeRef(link);
  if (!raw) throw new Error('Link is required');

  const hash = extractInviteHash(raw);
  if (hash) {
    const gram = loadGramJs();
    if (gram) {
      try {
        const check = await client.invoke(new gram.Api.messages.CheckChatInvite({ hash }));
        if (check.chat) return check.chat;
      } catch (_) { /* join later */ }
    }
  }

  const privateMatch = raw.match(/(?:https?:\/\/)?t\.me\/c\/(\d+)(?:\/(\d+))?/i);
  if (privateMatch && !privateMatch[2]) {
    return client.getEntity(BigInt(`-100${privateMatch[1]}`));
  }

  if (/^-?\d+$/.test(raw)) {
    return client.getEntity(BigInt(raw));
  }

  if (/^https?:\/\//i.test(raw) || raw.startsWith('t.me/')) {
    const path = raw.replace(/^https?:\/\/(t\.me\/|telegram\.me\/)/i, '').replace(/^@/, '');
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) throw new Error('Invalid Telegram link');
    const head = parts[0];
    if (head.startsWith('+') || head === 'joinchat') {
      throw new Error('Use full invite link for private groups');
    }
    if (/^\d+$/.test(head) && parts.length >= 2) {
      return client.getEntity(BigInt(`-100${head}`));
    }
    const username = head.startsWith('@') ? head : `@${head}`;
    return client.getEntity(username);
  }

  return client.getEntity(raw.startsWith('@') ? raw : `@${raw}`);
}

function createTargetTracker() {
  return new Map();
}

function getTargetState(tracker, ref) {
  const key = normalizeRef(ref);
  if (!tracker.has(key)) {
    tracker.set(key, {
      attempts: 0,
      failCycles: 0,
      failed: false,
      joined: false,
      entity: null,
      lastError: ''
    });
  }
  return tracker.get(key);
}

async function ensureTargetJoined(client, ref, tracker, db, accountId, handle, { quiet = false } = {}) {
  const key = normalizeRef(ref);
  const state = getTargetState(tracker, key);

  if (state.entity && state.joined) {
    return { ref: key, entity: state.entity, wasMember: true };
  }

  if (state.failed && state.failCycles >= TARGET_RESOLVE_MAX_ATTEMPTS) return null;
  if (state.failed) return null;
  if (state.attempts >= TARGET_RESOLVE_MAX_ATTEMPTS) {
    state.failed = true;
    state.failCycles += 1;
    logPlugActivity(db, accountId, 'error', `Target "${key}" skipped after ${TARGET_RESOLVE_MAX_ATTEMPTS} failed attempts`, key);
    return null;
  }

  state.attempts += 1;
  try {
    let entity = state.entity;
    let wasMember = false;

    if (!entity) {
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
      const joined = await joinTarget(client, key, entity, quiet ? null : (msg) => {
        logPlugActivity(db, accountId, 'info', msg, key);
      }, { skipMemberCheck: true });
      entity = joined || beforeJoin || entity;
      if (entity) {
        await handlePostJoinVerification(client, entity, entityLabel(entity) || key, quiet ? null : (msg) => {
          logPlugActivity(db, accountId, 'info', msg, key);
        });
      }
    }

    if (!entity) throw new Error('Could not resolve target group');

    state.entity = entity;
    state.joined = true;
    state.failed = false;
    state.attempts = 0;
    state.failCycles = 0;
    if (!quiet && !wasMember) {
      logPlugActivity(db, accountId, 'info', `Joined ${entityLabel(entity) || key}`, key);
    }
    return { ref: key, entity, wasMember };
  } catch (err) {
    const errMsg = String(err.message || err).slice(0, 500);
    state.lastError = errMsg;
    logPlugActivity(
      db, accountId, 'error',
      `Invalid target "${key}" (attempt ${state.attempts}/${TARGET_RESOLVE_MAX_ATTEMPTS}): ${errMsg}`,
      key
    );
    if (state.attempts >= TARGET_RESOLVE_MAX_ATTEMPTS) state.failed = true;
    return null;
  }
}

function pruneTargetTracker(tracker, refs) {
  const keep = new Set(refs.map(normalizeRef));
  for (const key of [...tracker.keys()]) {
    if (!keep.has(key)) tracker.delete(key);
  }
}

async function runForwardCycle(client, db, accountId, account, handle) {
  if (!shouldRun(handle, accountId)) return { cancelled: true, cycleEndedAt: null };

  const postLinkNow = String(account.source_link || '').trim();
  if (!isPostLink(postLinkNow)) {
    throw new Error('Invalid post link — use https://t.me/channel/123');
  }

  const targetRefs = parseTargets(account.targets_text);
  pruneTargetTracker(handle.targetTracker, targetRefs);

  const resolved = await resolvePostMessage(client, postLinkNow, null);

  if (!shouldRun(handle, accountId)) return { cancelled: true, cycleEndedAt: Date.now() };

  let okCount = 0;
  let failCount = 0;
  let forwardedAny = false;

  db.prepare('UPDATE plugging_accounts SET cycles_count = cycles_count + 1, updated_at = datetime(\'now\') WHERE id = ?').run(accountId);
  logPlugActivity(db, accountId, 'cycle', `Cycle started — forwarding post #${resolved.messageId}`);

  for (let i = 0; i < targetRefs.length; i++) {
    if (!shouldRun(handle, accountId)) {
      return { okCount, failCount, cancelled: true, cycleEndedAt: Date.now() };
    }

    const ref = targetRefs[i];
    const state = getTargetState(handle.targetTracker, ref);
    const quiet = !!(state.entity && state.joined);
    const entry = await ensureTargetJoined(client, ref, handle.targetTracker, db, accountId, handle, { quiet });
    if (!entry) continue;

    if (forwardedAny) await sleep(groupSendDelayMs());
    forwardedAny = true;

    const targetName = entityLabel(entry.entity) || entry.ref;
    const result = await forwardPostWithRetries(
      client, resolved.source, entry.entity, resolved.message, targetName,
      (retryMsg) => logPlugActivity(db, accountId, 'error', retryMsg, targetName)
    );

    if (!shouldRun(handle, accountId)) {
      return { okCount, failCount, cancelled: true, cycleEndedAt: Date.now() };
    }

    if (result.ok) {
      okCount += 1;
      db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1, updated_at = datetime(\'now\') WHERE id = ?')
        .run(accountId);
      logPlugActivity(db, accountId, 'success', `Forwarded post #${resolved.messageId} → ${targetName}`, targetName);
    } else {
      failCount += 1;
      const errMsg = String(result.error || 'Forward failed').slice(0, 500);
      db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(errMsg, accountId);
      logPlugActivity(db, accountId, 'error', `Failed → ${targetName}: ${errMsg}`, targetName);
    }
  }

  if (!forwardedAny) {
    logPlugActivity(db, accountId, 'error', 'No valid target groups — add your test group links');
  } else if (okCount > 0 && failCount === 0) {
    logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${resolved.messageId} forwarded to ${okCount} group(s)`);
  } else if (okCount > 0) {
    logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${resolved.messageId} (${okCount} sent, ${failCount} failed)`);
  } else {
    logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${resolved.messageId} failed on all groups`);
  }

  return { okCount, failCount, cancelled: false, cycleEndedAt: Date.now() };
}

function createRunnerHandle(accountId, previous) {
  let doneResolve;
  const handle = {
    accountId,
    running: true,
    generation: (previous?.generation || 0) + 1,
    targetTracker: createTargetTracker(),
    done: new Promise((resolve) => { doneResolve = resolve; }),
    doneResolve
  };
  return handle;
}

async function stopRunnerGracefully(accountId) {
  const handle = runners.get(accountId);
  if (!handle) return;
  handle.running = false;
  handle.generation += 1;
  try {
    await Promise.race([
      handle.done,
      sleep(5000)
    ]);
  } catch (_) { /* ignore */ }
}

async function startRunner(db, accountId, getSettings) {
  await stopRunnerGracefully(accountId);

  let account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
  if (!account || !account.session_string) {
    throw new Error('Account is not logged in to Telegram yet');
  }

  const postLink = String(account.source_link || '').trim();
  if (!isPostLink(postLink)) {
    throw new Error('Post link must include a post number, e.g. https://t.me/channel/123');
  }

  const settings = getSettings();
  ensureAccountProxy(db, accountId, settings);
  account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);

  const order = db.prepare(`
    SELECT po.*, pp.priority AS plan_priority
    FROM plugging_orders po
    LEFT JOIN plugging_plans pp ON pp.id = po.plan_id
    WHERE po.id = ? AND po.status = 'approved'
  `).get(account.order_id);
  if (!order) throw new Error('Plugging subscription is not active');

  const handle = createRunnerHandle(accountId, null);
  runners.set(accountId, handle);

  db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('running', '', accountId);

  logPlugActivity(db, accountId, 'started', 'Forwarder started');

  (async () => {
    let nextCycleAt = 0;

    try {
      while (shouldRun(handle, accountId)) {
        account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
        if (!account) break;

        const now = Date.now();
        if (nextCycleAt > now) {
          await waitWhileRunning(handle, accountId, nextCycleAt - now);
        }
        if (!shouldRun(handle, accountId)) break;

        let cycleEndedAt = null;
        try {
          account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
          await withAuthorizedClient(settings, account.session_string, async (client) => {
            if (!shouldRun(handle, accountId)) return;
            const result = await runForwardCycle(client, db, accountId, account, handle);
            cycleEndedAt = result?.cycleEndedAt || null;
            if (result?.cancelled) return;
            account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
            const delayMin = Number(account?.delay_minutes) || 0;
            const delayMs = cycleDelayMs(delayMin);
            if (delayMs > 0 && cycleEndedAt) {
              nextCycleAt = computeNextCycleAt(cycleEndedAt, delayMin);
              const waitMs = nextCycleAt - Date.now();
              if (waitMs > 0) {
                logPlugActivity(
                  db, accountId, 'info',
                  `Cycle delay — waiting ${formatDelayLabel(waitMs)} (${delayMin} min after cycle end). Next at ${new Date(nextCycleAt).toLocaleTimeString()}`
                );
              }
            } else {
              nextCycleAt = 0;
              if (cycleEndedAt && delayMin <= 0) {
                logPlugActivity(db, accountId, 'info', 'Cycle delay is 0 — next cycle runs immediately');
              }
            }
          }, account.proxy_url);
        } catch (err) {
          if (!shouldRun(handle, accountId)) break;
          const errMsg = String(err.message || err).slice(0, 500);
          db.prepare('UPDATE plugging_accounts SET last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(errMsg, accountId);
          logPlugActivity(db, accountId, 'error', `Connection issue (retrying in ${Math.round(RETRY_DELAY_MS / 1000)}s): ${errMsg}`);
          await waitWhileRunning(handle, accountId, RETRY_DELAY_MS);
          continue;
        }

        if (!shouldRun(handle, accountId)) break;
      }
    } finally {
      if (runners.get(accountId) === handle) {
        runners.delete(accountId);
        db.prepare('UPDATE plugging_accounts SET runner_status = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run('stopped', accountId);
        logPlugActivity(db, accountId, 'stopped', 'Forwarder stopped');
      }
      handle.doneResolve?.();
    }
  })();

  return { ok: true };
}

function stopRunner(accountId) {
  const handle = runners.get(accountId);
  if (!handle) return;
  handle.running = false;
  handle.generation += 1;
}

function isRunning(accountId) {
  return shouldRun(runners.get(accountId), accountId);
}

function resumeRunnersOnBoot(db, getSettings) {
  const rows = db.prepare(`
    SELECT pa.*
    FROM plugging_accounts pa
    JOIN plugging_orders po ON po.id = pa.order_id
    WHERE pa.runner_status = 'running'
      AND pa.auth_status = 'authenticated'
      AND po.status = 'approved'
  `).all();

  return Promise.all(rows.map(async (row) => {
    if (isRunning(row.id)) return;
    if (!isPostLink(row.source_link)) return;
    if (!parseTargets(row.targets_text).length) return;
    try {
      await startRunner(db, row.id, getSettings);
      logPlugActivity(db, row.id, 'info', 'Forwarder resumed after server restart');
    } catch (err) {
      db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run('stopped', String(err.message || err).slice(0, 500), row.id);
      logPlugActivity(db, row.id, 'error', `Could not resume forwarder: ${String(err.message || err).slice(0, 200)}`);
    }
  }));
}

function setRunnerForTest(accountId, handle) {
  runners.set(accountId, handle);
}

function clearRunnerForTest(accountId) {
  runners.delete(accountId);
}

module.exports = {
  startRunner,
  stopRunner,
  stopRunnerGracefully,
  isRunning,
  resumeRunnersOnBoot,
  parseTargets,
  resolveEntityFromLink,
  waitWhileRunning,
  shouldRun,
  cycleDelayMs,
  computeNextCycleAt,
  setRunnerForTest,
  clearRunnerForTest
};
