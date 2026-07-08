/**
 * In-process forwarding runners — forwards one exact post link to target groups.
 */
const { withAuthorizedClient } = require('./plugging-telegram');
const { logPlugActivity } = require('./plugging-activity');
const { ensureAccountProxy } = require('./plugging-proxy');
const { cycleDelayMs, groupSendDelayMs, formatDelayLabel } = require('./plugging-stealth');
const { joinTarget, extractInviteHash } = require('./plugging-join');
const { isPostLink, resolvePostMessage } = require('./plugging-post');
const { forwardPostWithRetries } = require('./plugging-forward');

const runners = new Map();
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
    logPlugActivity(db, accountId, 'error', `Target "${key}" skipped after ${TARGET_RESOLVE_MAX_ATTEMPTS} failed attempts`, key);
    return null;
  }

  state.attempts += 1;
  try {
    let entity = null;
    const hash = extractInviteHash(key);
    if (hash) {
      entity = await joinTarget(client, key, null, (msg) => {
        logPlugActivity(db, accountId, 'info', msg, key);
      });
    }
    if (!entity) {
      entity = await resolveEntityFromLink(client, key);
      await joinTarget(client, key, entity, (msg) => {
        logPlugActivity(db, accountId, 'info', msg, key);
      });
    }
    state.entity = entity;
    state.failed = false;
    state.attempts = 0;
    state.failCycles = 0;
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
    if (state.attempts >= TARGET_RESOLVE_MAX_ATTEMPTS) state.failed = true;
    return null;
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

async function forwardPostToTargets(client, db, accountId, account, source, msg, targetEntries, { skipDelay = false } = {}) {
  if (!targetEntries.length) {
    logPlugActivity(db, accountId, 'error', 'No valid target groups — add your test group links');
    return { okCount: 0, failCount: 0 };
  }

  if (!skipDelay) {
    const waitMs = cycleDelayMs(account.delay_minutes);
    if (waitMs > 0) {
      logPlugActivity(db, accountId, 'info', `Cycle delay — waiting ${formatDelayLabel(waitMs)}`);
      await sleep(waitMs);
    }
  }

  let okCount = 0;
  let failCount = 0;

  db.prepare('UPDATE plugging_accounts SET cycles_count = cycles_count + 1, updated_at = datetime(\'now\') WHERE id = ?').run(accountId);
  logPlugActivity(db, accountId, 'cycle', `Cycle started — forwarding post #${msg.id}`);

  for (let i = 0; i < targetEntries.length; i++) {
    if (i > 0) await sleep(groupSendDelayMs());
    const { entity: target } = targetEntries[i];
    const targetName = entityLabel(target) || targetEntries[i].ref;
    const result = await forwardPostWithRetries(
      client, source, target, msg, targetName,
      (retryMsg) => logPlugActivity(db, accountId, 'error', retryMsg, targetName)
    );
    if (result.ok) {
      okCount += 1;
      db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1, updated_at = datetime(\'now\') WHERE id = ?')
        .run(accountId);
      logPlugActivity(db, accountId, 'success', `Forwarded post #${msg.id} → ${targetName}`, targetName);
    } else {
      failCount += 1;
      const errMsg = String(result.error || 'Forward failed').slice(0, 500);
      db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(errMsg, accountId);
      logPlugActivity(db, accountId, 'error', `Failed → ${targetName}: ${errMsg}`, targetName);
    }
  }

  if (okCount > 0 && failCount === 0) {
    logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${msg.id} forwarded to ${okCount} group(s)`);
  } else if (okCount > 0) {
    logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${msg.id} (${okCount} sent, ${failCount} failed)`);
  } else {
    logPlugActivity(db, accountId, 'complete', `Cycle complete — post #${msg.id} failed on all groups`);
  }

  return { okCount, failCount };
}

function startRunner(db, accountId, getSettings) {
  stopRunner(accountId);
  let account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
  if (!account || !account.session_string) {
    throw new Error('Account is not logged in to Telegram yet');
  }

  const postLink = String(account.source_link || '').trim();
  if (!isPostLink(postLink)) {
    throw new Error('Post link required — use https://t.me/channelname/123 (not channel-only link)');
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

  const state = {
    running: true,
    targetTracker: createTargetTracker()
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
          logPlugActivity(db, accountId, 'info', 'Telegram connected — loading post & targets');

          let firstCycle = true;

          while (state.running) {
            account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
            const postLinkNow = String(account.source_link || '').trim();
            if (!isPostLink(postLinkNow)) {
              logPlugActivity(db, accountId, 'error', 'Invalid post link — use https://t.me/channelname/123');
              await sleep(RETRY_DELAY_MS);
              continue;
            }

            const targetRefs = parseTargets(account.targets_text);
            try {
              const resolved = await resolvePostMessage(client, postLinkNow, (msg) => {
                logPlugActivity(db, accountId, 'info', msg);
              });

              if (firstCycle) {
                logPlugActivity(
                  db, accountId, 'info',
                  `Post ready — ${resolved.label} (only this post will be forwarded)`
                );
              }

              pruneTargetTracker(state.targetTracker, targetRefs);
              const targetEntries = await buildTargetEntries(client, targetRefs, state.targetTracker, db, accountId);
              if (firstCycle && targetEntries.length) {
                logPlugActivity(db, accountId, 'info', `Targets ready — ${targetEntries.length} group(s)`);
              }

              await forwardPostToTargets(
                client, db, accountId, account,
                resolved.source, resolved.message, targetEntries,
                { skipDelay: firstCycle }
              );
              firstCycle = false;
            } catch (cycleErr) {
              logPlugActivity(db, accountId, 'error', String(cycleErr.message || cycleErr).slice(0, 500));
            }

            if (!state.running) break;

            const waitMs = cycleDelayMs(account.delay_minutes);
            if (waitMs > 0) {
              logPlugActivity(db, accountId, 'info', `Next cycle in ${formatDelayLabel(waitMs)}`);
              const endAt = Date.now() + waitMs;
              while (state.running && Date.now() < endAt) {
                await sleep(2000);
              }
            }
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

  const postLink = String(account.source_link || '').trim();
  if (!isPostLink(postLink)) {
    throw new Error('Post link required — use https://t.me/channelname/123');
  }

  const targetRefs = parseTargets(account.targets_text);
  if (!targetRefs.length) throw new Error('Add at least one target group');

  const settings = getSettings();
  ensureAccountProxy(db, accountId, settings);
  account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);

  const results = [];

  await withAuthorizedClient(settings, account.session_string, async (client) => {
    const resolved = await resolvePostMessage(client, postLink, (msg) => {
      logPlugActivity(db, accountId, 'info', msg);
    });

    logPlugActivity(
      db, accountId, 'info',
      `Test forward — post #${resolved.messageId} from ${resolved.label}`
    );

    const tracker = createTargetTracker();
    const entries = await buildTargetEntries(client, targetRefs, tracker, db, accountId);
    if (!entries.length) throw new Error('No valid target groups — check your group links');

    const testTargets = entries.slice(0, Math.max(1, Math.min(maxTargets, entries.length)));
    let okCount = 0;

    for (let i = 0; i < testTargets.length; i++) {
      if (i > 0) await sleep(groupSendDelayMs());
      const { entity: target } = testTargets[i];
      const targetName = entityLabel(target) || testTargets[i].ref;
      const result = await forwardPostWithRetries(
        client, resolved.source, target, resolved.message, targetName,
        (retryMsg) => logPlugActivity(db, accountId, 'error', retryMsg, targetName)
      );
      if (result.ok) {
        okCount += 1;
        db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1, updated_at = datetime(\'now\') WHERE id = ?')
          .run(accountId);
        logPlugActivity(db, accountId, 'success', `Test forwarded post #${resolved.messageId} → ${targetName}`, targetName);
        results.push({ target: targetName, ok: true, mode: 'forward' });
      } else {
        const errMsg = String(result.error || 'Forward failed').slice(0, 500);
        logPlugActivity(db, accountId, 'error', `Test failed → ${targetName}: ${errMsg}`, targetName);
        results.push({ target: targetName, ok: false, error: errMsg });
      }
    }

    if (okCount === 0) {
      throw new Error('Test forward failed — see Live Activity for details');
    }
  }, account.proxy_url);

  return { ok: true, results };
}

module.exports = { startRunner, stopRunner, isRunning, parseTargets, resolveEntityFromLink, runTestForward };
