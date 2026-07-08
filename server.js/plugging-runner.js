/**
 * In-process forwarding runners for plugging accounts.
 */
const { withAuthorizedClient } = require('./plugging-telegram');
const { logPlugActivity } = require('./plugging-activity');
const { ensureAccountProxy } = require('./plugging-proxy');
const { cycleDelayMs, groupSendDelayMs, formatDelayLabel } = require('./plugging-stealth');
const { joinTargetWithCaptcha, extractInviteHash } = require('./plugging-join');
const {
  shouldProcessMessage,
  joinSourceChannel,
  inspectSource,
  forwardPostWithRetries,
  normalizeCustomLink
} = require('./plugging-forward');

const runners = new Map();
const MAX_SEEN_MESSAGES = 400;
const CONFIG_REFRESH_MS = 120000;
const POLL_INTERVAL_DEFAULT_MS = 3000;
const POLL_INTERVAL_PRIORITY_MS = 2000;
const RETRY_DELAY_MS = 12000;
const TARGET_RESOLVE_MAX_ATTEMPTS = 3;

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
  const gram = loadGramJs();

  const hash = extractInviteHash(raw);
  if (hash && gram) {
    try {
      const check = await client.invoke(new gram.Api.messages.CheckChatInvite({ hash }));
      if (check.chat) return check.chat;
    } catch (_) { /* will join later */ }
  }

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
    if (head.startsWith('+') || head === 'joinchat') {
      throw new Error('Use full invite link — joining handled separately');
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
    let entity = null;
    const hash = extractInviteHash(key);
    if (hash) {
      entity = await joinTargetWithCaptcha(client, key, null, (msg) => {
        logPlugActivity(db, accountId, 'info', msg, key);
      });
    }
    if (!entity) {
      entity = await resolveEntityFromLink(client, key);
      await joinTargetWithCaptcha(client, key, entity, (msg) => {
        logPlugActivity(db, accountId, 'info', msg, key);
      });
    }
    state.entity = entity;
    state.failed = false;
    state.attempts = 0;
    state.failCycles = 0;
    state.lastError = '';
    logPlugActivity(db, accountId, 'info', `Target ready — ${entityLabel(entity) || key}`, key);
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
    targetsReady: false,
    pollCount: 0,
    bootstrapped: false
  };
  runners.set(accountId, state);

  db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('running', '', accountId);

  logPlugActivity(db, accountId, 'started', 'Connecting to Telegram…');

  (async () => {
    while (state.running) {
      try {
        account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
        await withAuthorizedClient(settings, account.session_string, async (client, meta) => {
          let source = null;
          let targetEntries = [];
          let pollTimer = null;
          let configTimer = null;

          logPlugActivity(
            db, accountId, 'info',
            `Telegram connected${meta?.usedProxy ? '' : ' (direct VPS IP)'} — loading source & targets`
          );

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
              logPlugActivity(db, accountId, 'error', 'No valid target groups — check your 2 test group links');
            }
          }

          async function syncSource(force = false) {
            account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
            const sourceLink = String(account.source_link || '').trim();
            if (!sourceLink) {
              source = null;
              logPlugActivity(db, accountId, 'error', 'Source chat / channel link is missing — add it in settings');
              return false;
            }

            try {
              source = await resolveEntityFromLink(client, sourceLink);
              const cycleDelay = cycleDelayMs(account.delay_minutes);
              const cycleNote = cycleDelay > 0
                ? `${formatDelayLabel(cycleDelay)} between cycles`
                : 'no wait between cycles';

              await joinSourceChannel(client, source, (msg) => {
                logPlugActivity(db, accountId, 'info', msg);
              });

              const inspection = await inspectSource(client, source);
              if (!inspection.ok) {
                logPlugActivity(
                  db, accountId, 'error',
                  `Cannot read source ${entityLabel(source)}: ${inspection.error}`
                );
              } else if (!inspection.canRead) {
                logPlugActivity(db, accountId, 'info', `Source ${entityLabel(source)} joined — waiting for posts`);
              } else {
                logPlugActivity(
                  db, accountId, 'info',
                  `Source OK — latest post #${inspection.latestId} visible`
                );
              }

              logPlugActivity(
                db, accountId, 'info',
                `Live — watching ${entityLabel(source)} · 3 sec per group · ${cycleNote}`
              );

              const customLink = normalizeCustomLink(account.display_name);
              if (customLink) {
                logPlugActivity(db, accountId, 'info', `Your link active — all URLs replaced with ${customLink}`);
              } else if (String(account.display_name || '').trim()) {
                logPlugActivity(db, accountId, 'error', 'Custom link missing https:// — add full URL in "Your shop / affiliate link" field');
              } else {
                logPlugActivity(db, accountId, 'error', 'No custom link set — add your https:// link in settings or wrong URLs will be sent');
              }

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

          async function processMessageCycle(msg, { skipDelay = false } = {}) {
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
            if (!skipDelay) await waitForCycleDelay();
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
                const result = await forwardPostWithRetries(
                  client, source, target, msg, targetName,
                  (retryMsg) => logPlugActivity(db, accountId, 'error', retryMsg, targetName),
                  { displayName: account.display_name }
                );
                if (result.ok) {
                  okCount += 1;
                  db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1, updated_at = datetime(\'now\') WHERE id = ?')
                    .run(accountId);
                  const modeNote = result.mode === 'relink'
                    ? ` · your link applied${result.replacedLinks ? ` (${result.replacedLinks} replaced)` : ''}`
                    : '';
                  logPlugActivity(db, accountId, 'success', `Sent post #${msg.id} → ${targetName}${modeNote}`, targetName);
                } else {
                  failCount += 1;
                  const errMsg = String(result.error || 'Forward failed').slice(0, 500);
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
              }
            }
          }

          async function drainMessageQueue() {
            if (state.queueRunning) return;
            state.queueRunning = true;
            try {
              while (state.running && state.messageQueue.length) {
                const item = state.messageQueue.shift();
                await processMessageCycle(item.msg, { skipDelay: item.skipDelay });
              }
            } finally {
              state.queueRunning = false;
            }
          }

          function enqueueMessage(msg, { skipDelay = false } = {}) {
            if (!shouldProcessMessage(msg)) return;
            if (state.seenIds.has(msg.id)) return;
            if (state.messageQueue.some((m) => m.msg?.id === msg.id)) return;
            state.messageQueue.push({ msg, skipDelay });
            drainMessageQueue().catch((err) => {
              logPlugActivity(db, accountId, 'error', `Queue error: ${String(err.message || err).slice(0, 500)}`);
            });
          }

          let newMessageFilter = null;
          const handler = async (event) => {
            if (!source) return;
            try {
              const peer = await client.getPeerId(event.message?.peerId || event.message?.chatId);
              const sourcePeer = await client.getPeerId(source);
              if (String(peer) !== String(sourcePeer)) return;
            } catch (_) { /* fall through */ }
            enqueueMessage(event.message);
          };

          await syncSource(true);
          await syncTargets(true);

          if (source) {
            const { NewMessage } = require('telegram/events');
            newMessageFilter = new NewMessage({});
            client.addEventHandler(handler, newMessageFilter);
            state.handler = handler;
          }

          async function bootstrapForwardLatest() {
            if (!source || state.bootstrapped || !targetEntries.length) return;
            state.bootstrapped = true;
            try {
              const messages = await client.getMessages(source, { limit: 1 });
              const latest = messages?.[0];
              if (!latest || !shouldProcessMessage(latest)) {
                logPlugActivity(db, accountId, 'info', 'No post to forward yet — publish in source channel');
                return;
              }
              logPlugActivity(db, accountId, 'info', `Start forward — sending latest post #${latest.id} now`);
              state.lastPollId = latest.id;
              await processMessageCycle(latest, { skipDelay: true });
            } catch (bootErr) {
              logPlugActivity(db, accountId, 'error', `Start forward failed: ${String(bootErr.message || bootErr).slice(0, 500)}`);
            }
          }

          await bootstrapForwardLatest();

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
            pollTimer = setInterval(pollSource, pollIntervalMs);
          }

          configTimer = setInterval(async () => {
            if (!state.running) return;
            try {
              await syncTargets(false);
            } catch (cfgErr) {
              logPlugActivity(db, accountId, 'error', `Config refresh: ${String(cfgErr.message || cfgErr).slice(0, 500)}`);
            }
          }, CONFIG_REFRESH_MS);

          while (state.running) {
            await sleep(2000);
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

async function runTestForward(db, accountId, getSettings, maxTargets = 3) {
  let account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
  if (!account || !account.session_string) {
    throw new Error('Account is not logged in to Telegram yet');
  }
  const settings = getSettings();
  ensureAccountProxy(db, accountId, settings);
  account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);

  const sourceLink = String(account.source_link || '').trim();
  const targetRefs = parseTargets(account.targets_text);
  if (!sourceLink) throw new Error('Source chat / channel link is missing');
  if (!targetRefs.length) throw new Error('Add at least one target group');

  const customLink = normalizeCustomLink(account.display_name);
  if (!customLink) {
    throw new Error('Set your full https:// shop link in "Your shop / affiliate link" before testing');
  }

  const results = [];

  await withAuthorizedClient(settings, account.session_string, async (client) => {
    const source = await resolveEntityFromLink(client, sourceLink);
    await joinSourceChannel(client, source, (msg) => {
      logPlugActivity(db, accountId, 'info', msg);
    });

    const inspection = await inspectSource(client, source);
    if (!inspection.ok) {
      throw new Error(`Cannot read source: ${inspection.error}`);
    }
    if (!inspection.latestId) {
      throw new Error('No posts found in source channel — publish a message first');
    }

    const messages = await client.getMessages(source, { limit: 1 });
    const msg = messages?.[0];
    if (!msg || !shouldProcessMessage(msg)) {
      throw new Error('Latest source post cannot be forwarded (empty or system message)');
    }

    logPlugActivity(
      db, accountId, 'info',
      `Test forward — post #${msg.id} from ${entityLabel(source)} · link → ${customLink}`
    );

    const tracker = createTargetTracker();
    const entries = await buildTargetEntries(client, targetRefs, tracker, db, accountId);
    if (!entries.length) throw new Error('No valid target groups — check your 2 test group links');

    const testTargets = entries.slice(0, Math.max(1, Math.min(maxTargets, entries.length)));
    let okCount = 0;

    for (let i = 0; i < testTargets.length; i++) {
      if (i > 0) await sleep(groupSendDelayMs());
      const { ref, entity: target } = testTargets[i];
      const targetName = entityLabel(target) || ref;
      const result = await forwardPostWithRetries(
        client, source, target, msg, targetName,
        (retryMsg) => logPlugActivity(db, accountId, 'error', retryMsg, targetName),
        { displayName: account.display_name }
      );
      if (result.ok) {
        okCount += 1;
        db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1, updated_at = datetime(\'now\') WHERE id = ?')
          .run(accountId);
        const modeNote = result.mode === 'relink'
          ? ` · your link applied${result.replacedLinks ? ` (${result.replacedLinks} replaced)` : ''}`
          : '';
        logPlugActivity(
          db, accountId, 'success',
          `Test sent post #${msg.id} → ${targetName} (${result.mode || 'copy'})${modeNote}`,
          targetName
        );
        results.push({ target: targetName, ok: true, mode: result.mode || 'copy' });
      } else {
        const errMsg = String(result.error || 'Forward failed').slice(0, 500);
        db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(errMsg, accountId);
        logPlugActivity(db, accountId, 'error', `Test failed → ${targetName}: ${errMsg}`, targetName);
        results.push({ target: targetName, ok: false, error: errMsg });
      }
    }

    if (okCount === 0) {
      throw new Error(`Test forward failed on all ${testTargets.length} target(s) — see Live Activity`);
    }
  }, account.proxy_url);

  return { ok: true, results };
}

module.exports = { startRunner, stopRunner, isRunning, parseTargets, resolveEntityFromLink, runTestForward };
