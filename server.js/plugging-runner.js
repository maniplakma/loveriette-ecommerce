/**
 * In-process forwarding runners for plugging accounts.
 */
const { withAuthorizedClient } = require('./plugging-telegram');
const { logPlugActivity } = require('./plugging-activity');
const { ensureAccountProxy } = require('./plugging-proxy');
const { cycleDelayMs, groupSendDelayMs, formatDelayLabel } = require('./plugging-stealth');

const runners = new Map();
const MAX_SEEN_MESSAGES = 400;
const CONFIG_REFRESH_MS = 120000;
const POLL_INTERVAL_DEFAULT_MS = 8000;
const POLL_INTERVAL_PRIORITY_MS = 5000;
const RETRY_DELAY_MS = 15000;
const TARGET_RESOLVE_MAX_ATTEMPTS = 3;
const FORWARD_MAX_ATTEMPTS = 3;

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeRef(ref) {
  return String(ref || '').trim();
}

async function resolveEntityFromLink(client, link) {
  const raw = normalizeRef(link);
  if (!raw) throw new Error('Link is required');

  const privateMatch = raw.match(/(?:https?:\/\/)?t\.me\/c\/(\d+)(?:\/(\d+))?/i);
  if (privateMatch) {
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
    if (/^\d+$/.test(head) && parts.length >= 2) {
      return client.getEntity(BigInt(`-100${head}`));
    }
    const username = head.startsWith('@') ? head : `@${head}`;
    return client.getEntity(username);
  }

  return client.getEntity(raw.startsWith('@') ? raw : `@${raw}`);
}

function shouldProcessMessage(msg) {
  if (!msg) return false;
  if (msg.out && !msg.post) return false;
  return true;
}

function createTargetTracker() {
  return new Map();
}

function getTargetState(tracker, ref) {
  const key = normalizeRef(ref);
  if (!tracker.has(key)) {
    tracker.set(key, { attempts: 0, failCycles: 0, failed: false, entity: null, lastError: '' });
  }
  return tracker.get(key);
}

async function resolveOneTarget(client, ref, tracker, db, accountId) {
  const key = normalizeRef(ref);
  const state = getTargetState(tracker, key);
  if (state.entity) return { ref: key, entity: state.entity };
  if (state.failed && state.failCycles >= TARGET_RESOLVE_MAX_ATTEMPTS) return null;
  if (state.failed) return null;
  if (state.attempts >= TARGET_RESOLVE_MAX_ATTEMPTS) {
    state.failed = true;
    state.failCycles += 1;
    if (state.failCycles >= TARGET_RESOLVE_MAX_ATTEMPTS) {
      db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(`Target failed after ${TARGET_RESOLVE_MAX_ATTEMPTS} cycles: ${key}`, accountId);
      logPlugActivity(db, accountId, 'error', `Target "${key}" marked failed after ${TARGET_RESOLVE_MAX_ATTEMPTS} cycles — skipped`, key);
    } else {
      logPlugActivity(db, accountId, 'info', `Target "${key}" will retry on next cycle (${state.failCycles}/${TARGET_RESOLVE_MAX_ATTEMPTS})`, key);
    }
    return null;
  }

  state.attempts += 1;
  try {
    const entity = await resolveEntityFromLink(client, key);
    state.entity = entity;
    state.failed = false;
    state.attempts = 0;
    state.failCycles = 0;
    state.lastError = '';
    return { ref: key, entity };
  } catch (err) {
    const errMsg = String(err.message || err).slice(0, 500);
    state.lastError = errMsg;
    logPlugActivity(
      db, accountId, 'error',
      `Invalid target "${key}" (attempt ${state.attempts}/${TARGET_RESOLVE_MAX_ATTEMPTS}): ${errMsg}`,
      key
    );
    if (state.attempts >= TARGET_RESOLVE_MAX_ATTEMPTS) {
      state.failed = true;
      state.failCycles += 1;
      if (state.failCycles >= TARGET_RESOLVE_MAX_ATTEMPTS) {
        db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(`Target failed after ${TARGET_RESOLVE_MAX_ATTEMPTS} cycles: ${key}`, accountId);
        logPlugActivity(db, accountId, 'error', `Target "${key}" marked failed after ${TARGET_RESOLVE_MAX_ATTEMPTS} cycles — skipped`, key);
      } else {
        logPlugActivity(db, accountId, 'info', `Target "${key}" will retry on next cycle (${state.failCycles}/${TARGET_RESOLVE_MAX_ATTEMPTS})`, key);
      }
    }
    return null;
  }
}

function prepareTargetsForNextCycle(tracker) {
  for (const state of tracker.values()) {
    if (!state.entity && state.failed && state.failCycles < TARGET_RESOLVE_MAX_ATTEMPTS) {
      state.failed = false;
      state.attempts = 0;
    }
  }
}

async function buildTargetEntries(client, refs, tracker, db, accountId) {
  const entries = [];
  for (const ref of refs) {
    const entry = await resolveOneTarget(client, ref, tracker, db, accountId);
    if (entry) entries.push(entry);
  }
  return entries;
}

function pruneTargetTracker(tracker, refs) {
  const keep = new Set(refs.map(normalizeRef));
  for (const key of [...tracker.keys()]) {
    if (!keep.has(key)) tracker.delete(key);
  }
}

async function forwardWithRetries(client, target, source, msg, targetName, db, accountId, msgId) {
  let lastErr = null;
  for (let attempt = 1; attempt <= FORWARD_MAX_ATTEMPTS; attempt++) {
    try {
      await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
      return { ok: true };
    } catch (err) {
      lastErr = err;
      const errMsg = String(err.message || err).slice(0, 500);
      if (attempt < FORWARD_MAX_ATTEMPTS) {
        logPlugActivity(db, accountId, 'error', `Retry ${attempt}/${FORWARD_MAX_ATTEMPTS} → ${targetName}: ${errMsg}`, targetName);
        await sleep(groupSendDelayMs());
      }
    }
  }
  return { ok: false, error: lastErr };
}

function startRunner(db, accountId, getSettings) {
  stopRunner(accountId);
  let account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
  if (!account || !account.session_string) {
    throw new Error('Account is not logged in to Telegram yet');
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

  const pollIntervalMs = Number(order.plan_priority) > 0 ? POLL_INTERVAL_PRIORITY_MS : POLL_INTERVAL_DEFAULT_MS;

  const state = {
    running: true,
    handler: null,
    seenIds: new Set(),
    pollBusy: false,
    lastPollId: 0,
    lastCycleEndedAt: 0,
    lastRoutingKey: '',
    messageQueue: [],
    queueRunning: false,
    targetTracker: createTargetTracker(),
    targetsReady: false
  };
  runners.set(accountId, state);

  db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('running', '', accountId);

  logPlugActivity(db, accountId, 'started', 'Connecting to Telegram…');

  (async () => {
    while (state.running) {
      try {
        account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
        await withAuthorizedClient(settings, account.session_string, async (client) => {
          let source = null;
          let targetEntries = [];
          let pollTimer = null;
          let configTimer = null;

          async function syncTargets(force = false) {
            account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
            const targetRefs = parseTargets(account.targets_text);
            const routingKey = `${String(account.source_link || '').trim()}::${targetRefs.join('|')}`;
            if (!force && routingKey === state.lastRoutingKey && state.targetsReady) return;

            pruneTargetTracker(state.targetTracker, targetRefs);
            targetEntries = await buildTargetEntries(client, targetRefs, state.targetTracker, db, accountId);
            state.targetsReady = true;
            state.lastRoutingKey = routingKey;

            const failedCount = [...state.targetTracker.values()].filter((t) => t.failed).length;
            if (targetEntries.length) {
              logPlugActivity(
                db, accountId, 'info',
                `Targets ready — ${targetEntries.length} valid group(s)${failedCount ? ` · ${failedCount} failed (skipped)` : ''}`
              );
            } else {
              logPlugActivity(db, accountId, 'error', 'No valid target groups yet — fix links in settings (forwarder stays running)');
            }
          }

          async function syncSource(force = false) {
            account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
            const sourceLink = String(account.source_link || '').trim();
            const routingKey = `${sourceLink}::${parseTargets(account.targets_text).join('|')}`;

            if (!sourceLink) {
              source = null;
              logPlugActivity(db, accountId, 'error', 'Source chat / channel link is missing — add it in settings');
              return false;
            }

            if (!force && source && routingKey === state.lastRoutingKey) return true;

            try {
              source = await resolveEntityFromLink(client, sourceLink);
              const cycleDelay = cycleDelayMs(account.delay_minutes);
              const cycleNote = cycleDelay > 0
                ? `${formatDelayLabel(cycleDelay)} between cycles`
                : 'no wait between cycles';

              try {
                const recent = await client.getMessages(source, { limit: 1 });
                if (recent?.length && (force || !state.lastPollId)) {
                  state.lastPollId = recent[0].id;
                }
              } catch (_) { /* ignore */ }

              logPlugActivity(
                db, accountId, 'info',
                `Live — watching ${entityLabel(source)} · 3 sec per group · ${cycleNote}`
              );
              logPlugActivity(db, accountId, 'info', 'Ready — new posts forward immediately. Only posts after Start are sent.');
              return true;
            } catch (err) {
              source = null;
              const errMsg = String(err.message || err).slice(0, 500);
              db.prepare('UPDATE plugging_accounts SET last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(`Invalid source "${sourceLink}": ${errMsg}`, accountId);
              logPlugActivity(db, accountId, 'error', `Invalid source "${sourceLink}": ${errMsg}`);
              return false;
            }
          }

          async function waitForCycleDelay() {
            const waitMs = cycleDelayMs(account.delay_minutes);
            if (!waitMs || !state.lastCycleEndedAt) return;
            const elapsed = Date.now() - state.lastCycleEndedAt;
            const remaining = waitMs - elapsed;
            if (remaining > 0) {
              logPlugActivity(
                db, accountId, 'info',
                `Cycle delay — waiting ${formatDelayLabel(remaining)} before next forward cycle`
              );
              await sleep(remaining);
            }
          }

          async function processMessageCycle(msg) {
            if (!state.running || !msg || !source) return;
            if (!shouldProcessMessage(msg)) return;
            if (state.seenIds.has(msg.id)) return;

            if (!targetEntries.length) {
              prepareTargetsForNextCycle(state.targetTracker);
              await syncTargets(true);
            }
            if (!targetEntries.length) {
              logPlugActivity(db, accountId, 'error', `Cycle skipped — no valid targets for post #${msg.id}`);
              return;
            }

            state.seenIds.add(msg.id);
            if (state.seenIds.size > MAX_SEEN_MESSAGES) {
              [...state.seenIds].slice(0, 100).forEach((id) => state.seenIds.delete(id));
            }

            account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
            await waitForCycleDelay();
            if (!state.running) return;

            let okCount = 0;
            let failCount = 0;

            try {
              db.prepare('UPDATE plugging_accounts SET cycles_count = cycles_count + 1, updated_at = datetime(\'now\') WHERE id = ?').run(accountId);
              logPlugActivity(db, accountId, 'cycle', `Cycle started — post #${msg.id}`);

              for (let i = 0; i < targetEntries.length; i++) {
                if (i > 0) await sleep(groupSendDelayMs());
                if (!state.running) return;

                const { ref, entity: target } = targetEntries[i];
                const targetName = entityLabel(target) || ref;
                const result = await forwardWithRetries(client, target, source, msg, targetName, db, accountId, msg.id);
                if (result.ok) {
                  okCount += 1;
                  db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1, updated_at = datetime(\'now\') WHERE id = ?')
                    .run(accountId);
                  logPlugActivity(db, accountId, 'success', `Sent post #${msg.id} → ${targetName}`, targetName);
                } else {
                  failCount += 1;
                  const errMsg = String(result.error?.message || result.error || 'Forward failed').slice(0, 500);
                  db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
                    .run(errMsg, accountId);
                  logPlugActivity(db, accountId, 'error', `Failed → ${targetName}: ${errMsg}`, targetName);
                }
              }
            } catch (cycleErr) {
              failCount += 1;
              const errMsg = String(cycleErr.message || cycleErr).slice(0, 500);
              db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(errMsg, accountId);
              logPlugActivity(db, accountId, 'error', `Cycle error: ${errMsg}`);
            } finally {
              state.lastCycleEndedAt = Date.now();
              prepareTargetsForNextCycle(state.targetTracker);
              if (okCount > 0 && failCount === 0) {
                logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${msg.id} sent to ${okCount} group(s)`);
              } else if (okCount > 0) {
                logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${msg.id} (${okCount} sent, ${failCount} failed)`);
              } else if (failCount > 0) {
                logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${msg.id} failed on all groups (${failCount})`);
              } else {
                logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${msg.id}`);
              }
            }
          }

          async function drainMessageQueue() {
            if (state.queueRunning) return;
            state.queueRunning = true;
            try {
              while (state.running && state.messageQueue.length) {
                const msg = state.messageQueue.shift();
                await processMessageCycle(msg);
              }
            } finally {
              state.queueRunning = false;
            }
          }

          function enqueueMessage(msg) {
            if (!shouldProcessMessage(msg)) return;
            if (state.seenIds.has(msg.id)) return;
            if (state.messageQueue.some((m) => m.id === msg.id)) return;
            state.messageQueue.push(msg);
            drainMessageQueue().catch((err) => {
              logPlugActivity(db, accountId, 'error', `Queue error: ${String(err.message || err).slice(0, 500)}`);
            });
          }

          let newMessageFilter = null;

          const handler = async (event) => {
            enqueueMessage(event.message);
          };

          const sourceOk = await syncSource(true);
          if (sourceOk) {
            const { NewMessage } = require('telegram/events');
            newMessageFilter = new NewMessage({ chats: [source] });
            client.addEventHandler(handler, newMessageFilter);
            state.handler = handler;
          }

          syncTargets(true).catch((err) => {
            logPlugActivity(db, accountId, 'error', `Target sync: ${String(err.message || err).slice(0, 500)}`);
          });

          async function pollSource() {
            if (!state.running || !source || state.pollBusy) return;
            state.pollBusy = true;
            try {
              const messages = await client.getMessages(source, { limit: 15 });
              const sorted = [...(messages || [])].sort((a, b) => a.id - b.id);
              for (const msg of sorted) {
                if (msg.id <= state.lastPollId) continue;
                state.lastPollId = Math.max(state.lastPollId, msg.id);
                enqueueMessage(msg);
              }
            } catch (pollErr) {
              logPlugActivity(db, accountId, 'error', `Poll error: ${String(pollErr.message || pollErr).slice(0, 500)}`);
            } finally {
              state.pollBusy = false;
            }
          }

          if (source) {
            await pollSource();
            pollTimer = setInterval(pollSource, pollIntervalMs);
          }

          configTimer = setInterval(async () => {
            if (!state.running) return;
            try {
              await syncSource(false);
              await syncTargets(false);
            } catch (cfgErr) {
              logPlugActivity(db, accountId, 'error', `Config refresh: ${String(cfgErr.message || cfgErr).slice(0, 500)}`);
            }
          }, CONFIG_REFRESH_MS);

          while (state.running) {
            await sleep(5000);
          }

          if (pollTimer) clearInterval(pollTimer);
          if (configTimer) clearInterval(configTimer);
          if (state.handler && newMessageFilter) {
            try { client.removeEventHandler(state.handler, newMessageFilter); } catch (_) { /* ignore */ }
            state.handler = null;
          }
        }, account.proxy_url);
      } catch (err) {
        if (!state.running) break;
        const errMsg = String(err.message || err).slice(0, 500);
        db.prepare('UPDATE plugging_accounts SET last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(errMsg, accountId);
        logPlugActivity(db, accountId, 'error', `Connection issue (retrying): ${errMsg}`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    db.prepare('UPDATE plugging_accounts SET runner_status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run('stopped', accountId);
    logPlugActivity(db, accountId, 'stopped', 'Forwarder stopped');
    runners.delete(accountId);
  })();

  return { ok: true };
}

function stopRunner(accountId) {
  const state = runners.get(accountId);
  if (state) state.running = false;
}

function isRunning(accountId) {
  const state = runners.get(accountId);
  return !!(state && state.running);
}

module.exports = { startRunner, stopRunner, isRunning, parseTargets, resolveEntityFromLink };
