/**
 * Answer simple join-verification prompts in groups (math, bot checks).
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function solveVerificationText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const plus = lower.match(/(?:what\s+is\s+)?(\d{1,3})\s*\+\s*(\d{1,3})/i)
    || lower.match(/(\d{1,3})\s*plus\s*(\d{1,3})/i);
  if (plus) return String(Number(plus[1]) + Number(plus[2]));

  const minus = lower.match(/(?:what\s+is\s+)?(\d{1,3})\s*-\s*(\d{1,3})/i);
  if (minus) return String(Number(minus[1]) - Number(minus[2]));

  const times = lower.match(/(?:what\s+is\s+)?(\d{1,3})\s*[x×*]\s*(\d{1,3})/i);
  if (times) return String(Number(times[1]) * Number(times[2]));

  if (/(are\s+you|you\s+a)\s+(a\s+)?bot/.test(lower) || /bot\?/.test(lower)) return 'No';
  if (/(are\s+you|you\s+a)\s+human/.test(lower)) return 'Yes';
  if (/not\s+a\s+bot/.test(lower)) return 'I am not a bot';

  return null;
}

function extractButtonAnswer(markup, messageText) {
  if (!markup || !markup.rows) return null;
  const solved = solveVerificationText(messageText);

  if (solved) {
    for (const row of markup.rows) {
      for (const btn of row.buttons || []) {
        const label = String(btn.text || '').trim();
        if (label === solved) return { type: 'button', text: btn.text };
      }
    }
  }

  for (const row of markup.rows) {
    for (const btn of row.buttons || []) {
      const label = String(btn.text || '').toLowerCase();
      if (label.includes('not a bot') || label === 'human' || label.includes('i am human')) {
        return { type: 'button', text: btn.text };
      }
      if (label.includes('yes') && /human/.test(label)) {
        return { type: 'button', text: btn.text };
      }
      if (label.includes('no') && /bot/.test(label)) {
        return { type: 'button', text: btn.text };
      }
    }
  }

  return null;
}

async function clickInlineButton(client, message, buttonText) {
  const gram = (() => {
    try { return require('telegram/tl').Api; } catch (_) { return null; }
  })();
  if (!gram || !message?.replyMarkup?.rows) return false;

  for (const row of message.replyMarkup.rows) {
    for (let i = 0; i < (row.buttons || []).length; i += 1) {
      const btn = row.buttons[i];
      if (String(btn.text) !== String(buttonText)) continue;
      try {
        await client.invoke(new gram.Api.messages.GetBotCallbackAnswer({
          peer: message.peerId,
          msgId: message.id,
          data: btn.data
        }));
        return true;
      } catch (_) {
        try {
          await message.click({ i, j: row.buttons.indexOf(btn) });
          return true;
        } catch (_2) { /* ignore */ }
      }
    }
  }
  return false;
}

async function handlePostJoinVerification(client, peer, refLabel, logFn, { maxWaitMs = 12000 } = {}) {
  const started = Date.now();
  let answered = false;
  let firstPass = true;

  while (Date.now() - started < maxWaitMs) {
    if (!firstPass) await sleep(800);
    firstPass = false;
    let messages = [];
    try {
      messages = await client.getMessages(peer, { limit: 8 });
    } catch (_) {
      continue;
    }

    for (const msg of messages) {
      const textAnswer = solveVerificationText(msg.message);
      if (textAnswer) {
        const button = extractButtonAnswer(msg.replyMarkup, msg.message);
        if (button?.type === 'button') {
          const clicked = await clickInlineButton(client, msg, button.text);
          if (clicked) {
            if (logFn) logFn(`Pressed verification button in ${refLabel}: ${button.text}`);
            answered = true;
            break;
          }
        }
        try {
          await client.sendMessage(peer, { message: textAnswer });
          if (logFn) logFn(`Answered verification in ${refLabel}: ${textAnswer}`);
          answered = true;
          break;
        } catch (err) {
          if (logFn) logFn(`Could not send verification answer in ${refLabel}: ${String(err.message || err).slice(0, 120)}`);
        }
      }

      const buttonOnly = extractButtonAnswer(msg.replyMarkup, msg.message);
      if (buttonOnly?.type === 'button') {
        const clicked = await clickInlineButton(client, msg, buttonOnly.text);
        if (clicked) {
          if (logFn) logFn(`Pressed verification button in ${refLabel}: ${buttonOnly.text}`);
          answered = true;
          break;
        }
      }
    }

    if (answered) {
      await sleep(500);
      return true;
    }
  }

  return false;
}

module.exports = {
  solveVerificationText,
  extractButtonAnswer,
  handlePostJoinVerification
};
