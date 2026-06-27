/**
 * In-process forwarding runners for plugging accounts.
 */
const { withAuthorizedClient } = require('./plugging-telegram');

const runners = new Map();

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
  const account = db.prepare('SELECT * FROM plugging_accounts WHERE id = ?').get(accountId);
  if (!account || !account.session_string) {
    throw new Error('Account is not logged in to Telegram yet');
  }
  const order = db.prepare('SELECT * FROM plugging_orders WHERE id = ? AND status = ?').get(account.order_id, 'approved');
  if (!order) throw new Error('Plugging subscription is not active');

  const state = { running: true, handler: null };
  runners.set(accountId, state);

  db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run('running', '', accountId);

  (async () => {
    try {
      const settings = getSettings();
      await withAuthorizedClient(settings, account.session_string, async (client) => {
        const { NewMessage } = require('telegram/events');
        const source = await resolveSourceEntity(client, account.source_link);
        const targets = await resolveTargetEntities(client, parseTargets(account.targets_text));
        if (!targets.length) throw new Error('Add at least one target group');

        const delayMs = Math.max(0, Number(account.delay_minutes) || 0) * 60 * 1000;
        const displayName = account.display_name || account.label || account.phone;

        const handler = async (event) => {
          if (!state.running) return;
          const msg = event.message;
          if (!msg || msg.out) return;
          try {
            db.prepare('UPDATE plugging_accounts SET cycles_count = cycles_count + 1, updated_at = datetime(\'now\') WHERE id = ?').run(accountId);
            if (delayMs) await sleep(delayMs);
            if (!state.running) return;
            const text = displayName ? `${displayName}:\n${msg.text || ''}` : (msg.text || '');
            for (const target of targets) {
              try {
                await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
                db.prepare('UPDATE plugging_accounts SET success_count = success_count + 1 WHERE id = ?').run(accountId);
              } catch (fwdErr) {
                db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ? WHERE id = ?')
                  .run(String(fwdErr.message || fwdErr).slice(0, 500), accountId);
              }
            }
          } catch (cycleErr) {
            db.prepare('UPDATE plugging_accounts SET failed_count = failed_count + 1, last_error = ? WHERE id = ?')
              .run(String(cycleErr.message || cycleErr).slice(0, 500), accountId);
          }
        };

        client.addEventHandler(handler, new NewMessage({ chats: [source.id] }));
        state.handler = handler;
        while (state.running) {
          await sleep(5000);
        }
        client.removeEventHandler(handler);
      });
    } catch (err) {
      db.prepare('UPDATE plugging_accounts SET runner_status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run('stopped', String(err.message || err).slice(0, 500), accountId);
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
