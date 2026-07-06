/**
 * In-process forwarding runners for plugging accounts.
 */
const { withAuthorizedClient } = require('./plugging-telegram');
const { logPlugActivity } = require('./plugging-activity');
const { ensureAccountProxy } = require('./plugging-proxy');
const {
  computeStealthDelayMs,
  initialHumanPauseMs,
  staggerBetweenTargetsMs,
  formatWaitMinutes
} = require('./plugging-stealth');

const runners = new Map();
const MAX_SEEN_MESSAGES = 400;

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

async function resolveSourceEntity(client, sourceLink) {
  const link = String(sourceLink || '').trim();
  if (!link) throw new Error('Source message link is required');
  if (/^https?:\/\//i.test(link) || link.startsWith('t.me/')) {
    const username = link.replace(/^https?:\/\/(t\.me\/|telegram\.me\/)/i, '').replace(/^@/, '').split('/')[0];
    return client.getEntity(username);
  }
  return client.getEntity(link.startsWith('@') ? link : `@${link}`);
}

async function resolveTargetEntities(client, targets) {
  const out = [];
  for (const t of targets) {
    try {
      let ref = t;
      if (/^https?:\/\//i.test(t) || t.startsWith('t.me/')) {
        ref = t.replace(/^https?:\/\/(t\.me\/|telegram\.me\/)/i, '').split('/')[0];
      }
      if (!ref.startsWith('@') && !/^-?\d/.test(ref)) ref = `@${ref}`;
      out.push(await client.getEntity(ref));
    } catch (err) {
      throw new Error(`Invalid target "${t}": ${err.message || 'not a group/channel'}`);
    }
  }
  return out;
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

  const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ? AND status = ?').get(account.order_id, 'approved');
  if (!order) throw new Error('Plugging subscription is not active');

  const state = { running: true, handler: null, seenIds: new Set() };
  runners.set(accountId, state);

  db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('running', '', accountId);

  logPlugActivity(db, accountId, 'started', 'Forwarder starting…');

  (async () => {
    try {
      await withAuthorizedClient(settings, account.session_string, async (client) => {
        const { NewMessage } = require('telegram/events');
        const source = await resolveSourceEntity(client, account.source_link);
        const targets = await resolveTargetEntities(client, parseTargets(account.targets_text));
        if (!targets.length) throw new Error('Add at least one target group');

        const proxyNote = account.proxy_url ? ' · proxy active' : '';
        logPlugActivity(
          db, accountId, 'info',
          `Watching ${entityLabel(source)} → ${targets.length} target(s) · stealth mode${proxyNote}`
        );

        const handler = async (event) => {
          if (!state.running) return;
          const msg = event.message;
          if (!msg || msg.out) return;
          if (state.seenIds.has(msg.id)) return;
          state.seenIds.add(msg.id);
          if (state.seenIds.size > MAX_SEEN_MESSAGES) {
            const drop = [...state.seenIds].slice(0, 100);
            drop.forEach((id) => state.seenIds.delete(id));
          }

          try {
            db.prepare('UPDATE plugging_accounts SET cycles_count = cycles_count + 1, updated_at = datetime(\'now\') WHERE id = ?').run(accountId);
            logPlugActivity(db, accountId, 'cycle', `New message detected (id ${msg.id})`);

            const stealthWait = computeStealthDelayMs(account.delay_minutes);
            const humanPause = initialHumanPauseMs();
            logPlugActivity(
              db, accountId, 'info',
              `Stealth wait ${formatWaitMinutes(humanPause + stealthWait)} (human-like timing)`
            );
            await sleep(humanPause);
            if (!state.running) return;
            await sleep(stealthWait);
            if (!state.running) return;

            for (let i = 0; i < targets.length; i++) {
              if (i > 0) await sleep(staggerBetweenTargetsMs());
              if (!state.running) return;
              const target = targets[i];
              const targetName = entityLabel(target);
              try {
                await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
                db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1 WHERE id = ?').run(accountId);
                logPlugActivity(db, accountId, 'success', `Forwarded message #${msg.id} to ${targetName}`, targetName);
              } catch (fwdErr) {
                const errMsg = String(fwdErr.message || fwdErr).slice(0, 500);
                db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ? WHERE id = ?')
                  .run(errMsg, accountId);
                logPlugActivity(db, accountId, 'error', `Failed → ${targetName}: ${errMsg}`, targetName);
              }
            }
          } catch (cycleErr) {
            const errMsg = String(cycleErr.message || cycleErr).slice(0, 500);
            db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ? WHERE id = ?')
              .run(errMsg, accountId);
            logPlugActivity(db, accountId, 'error', `Cycle error: ${errMsg}`);
          }
        };

        client.addEventHandler(handler, new NewMessage({ chats: [source.id] }));
        state.handler = handler;
        while (state.running) {
          await sleep(5000);
        }
        client.removeEventHandler(handler);
      }, account.proxy_url);
    } catch (err) {
      const errMsg = String(err.message || err).slice(0, 500);
      db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run('stopped', errMsg, accountId);
      logPlugActivity(db, accountId, 'error', `Forwarder stopped: ${errMsg}`);
      runners.delete(accountId);
    }
  })();

  return { ok: true };
}

function stopRunner(accountId) {
  const state = runners.get(accountId);
  if (state) {
    state.running = false;
    runners.delete(accountId);
  }
}

function isRunning(accountId) {
  return runners.has(accountId);
}

module.exports = { startRunner, stopRunner, isRunning, parseTargets };
