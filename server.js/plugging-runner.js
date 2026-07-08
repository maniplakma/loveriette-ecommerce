/**
 * In-process forwarding runners for plugging accounts.
 */
const { withAuthorizedClient } = require('./plugging-telegram');
const { logPlugActivity } = require('./plugging-activity');
const { ensureAccountProxy } = require('./plugging-proxy');
const { cycleDelayMs, groupSendDelayMs, formatDelayLabel } = require('./plugging-stealth');

const runners = new Map();
const MAX_SEEN_MESSAGES = 400;
const CONFIG_REFRESH_MS = 60000;
const POLL_INTERVAL_DEFAULT_MS = 10000;
const POLL_INTERVAL_PRIORITY_MS = 5000;
const RETRY_DELAY_MS = 15000;

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

async function resolveEntityFromLink(client, link) {
  const raw = String(link || '').trim();
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

async function resolveTargetEntries(client, targets, db, accountId, invalidLogged) {
  const entries = [];
  for (const ref of targets) {
    try {
      entries.push({ ref, entity: await resolveEntityFromLink(client, ref) });
    } catch (err) {
      const errMsg = String(err.message || err).slice(0, 500);
      if (!invalidLogged.has(ref)) {
        invalidLogged.add(ref);
        db.prepare('UPDATE plugging_accounts SET last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(`Invalid target "${ref}": ${errMsg}`, accountId);
        logPlugActivity(db, accountId, 'error', `Invalid target "${ref}": ${errMsg}`, ref);
      }
    }
  }
  return entries;
}

function shouldProcessMessage(msg) {
  if (!msg) return false;
  if (msg.out && !msg.post) return false;
  return true;
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
    invalidTargetsLogged: new Set(),
    lastRoutingKey: '',
    messageQueue: [],
    queueRunning: false
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
          let sourcePeerId = null;

          async function refreshRouting(force = false) {
            account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
            const sourceLink = String(account.source_link || '').trim();
            const targetRefs = parseTargets(account.targets_text);
            const routingKey = `${sourceLink}::${targetRefs.join('|')}`;
            const routingChanged = force || routingKey !== state.lastRoutingKey;

            if (!routingChanged) return;

            state.lastRoutingKey = routingKey;
            state.invalidTargetsLogged.clear();

            if (!sourceLink) {
              source = null;
              targetEntries = [];
              sourcePeerId = null;
              logPlugActivity(db, accountId, 'error', 'Source chat / channel link is missing — add it in settings');
              return;
            }

            let nextSource = null;
            try {
              nextSource = await resolveEntityFromLink(client, sourceLink);
              sourcePeerId = await client.getPeerId(nextSource);
            } catch (err) {
              const errMsg = String(err.message || err).slice(0, 500);
              db.prepare('UPDATE plugging_accounts SET last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(`Invalid source "${sourceLink}": ${errMsg}`, accountId);
              logPlugActivity(db, accountId, 'error', `Invalid source "${sourceLink}": ${errMsg}`);
              source = null;
              targetEntries = [];
              sourcePeerId = null;
              return;
            }

            source = nextSource;
            targetEntries = await resolveTargetEntries(client, targetRefs, db, accountId, state.invalidTargetsLogged);

            const cycleDelay = cycleDelayMs(account.delay_minutes);
            const cycleNote = cycleDelay > 0
              ? `${formatDelayLabel(cycleDelay)} between cycles`
              : 'no wait between cycles';

            if (targetEntries.length) {
              try {
                const recent = await client.getMessages(source, { limit: 1 });
                if (recent?.length) state.lastPollId = recent[0].id;
              } catch (_) { /* ignore */ }

              logPlugActivity(
                db, accountId, 'info',
                `Live — ${entityLabel(source)} → ${targetEntries.length} group(s) · 3 sec per group · ${cycleNote}`
              );
              logPlugActivity(db, accountId, 'info', 'Forwarding starts immediately on new posts. Only posts after Start are sent.');
            } else {
              logPlugActivity(db, accountId, 'error', 'No valid target groups — fix links in settings (forwarder stays running)');
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
            if (!state.running || !msg || !source || !targetEntries.length) return;
            if (!shouldProcessMessage(msg)) return;
            if (state.seenIds.has(msg.id)) return;

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
                try {
                  await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
                  okCount += 1;
                  db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1, updated_at = datetime(\'now\') WHERE id = ?')
                    .run(accountId);
                  logPlugActivity(db, accountId, 'success', `Sent post #${msg.id} → ${targetName}`, targetName);
                } catch (fwdErr) {
                  failCount += 1;
                  const errMsg = String(fwdErr.message || fwdErr).slice(0, 500);
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

          const handler = async (event) => {
            try {
              if (sourcePeerId && event.chatId && String(event.chatId) !== String(sourcePeerId)) return;
            } catch (_) { /* ignore */ }
            enqueueMessage(event.message);
          };

          await refreshRouting(true);

          if (source) {
            const { NewMessage } = require('telegram/events');
            client.addEventHandler(handler, new NewMessage({}));
            state.handler = handler;
          }

          async function pollSource() {
            if (!state.running || !source || state.pollBusy) return;
            state.pollBusy = true;
            try {
              const messages = await client.getMessages(source, { limit: 12 });
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

          await pollSource();
          pollTimer = setInterval(pollSource, pollIntervalMs);

          configTimer = setInterval(async () => {
            if (!state.running) return;
            try {
              await refreshRouting(false);
            } catch (cfgErr) {
              logPlugActivity(db, accountId, 'error', `Config refresh: ${String(cfgErr.message || cfgErr).slice(0, 500)}`);
            }
          }, CONFIG_REFRESH_MS);

          while (state.running) {
            await sleep(5000);
          }

          if (pollTimer) clearInterval(pollTimer);
          if (configTimer) clearInterval(configTimer);
          if (state.handler) {
            try { client.removeEventHandler(state.handler); } catch (_) { /* ignore */ }
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
