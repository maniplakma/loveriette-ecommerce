/**
 * Answer join-verification prompts in groups (math, bot checks, unmute buttons).
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const VERIFICATION_BUTTON_PATTERNS = [
  /unmute\s*me/i,
  /tap\s+to\s+unmute/i,
  /^unmute$/i,
  /^verify$/i,
  /^✅\s*verify/i,
  /^✅$/,
  /press\s+to\s+(verify|continue|join|unlock)/i,
  /click\s+to\s+(verify|join|continue|unlock)/i,
  /tap\s+to\s+(verify|join|continue|unlock)/i,
  /i\s*'?m\s+not\s+a\s+robot/i,
  /i\s*am\s+human/i,
  /not\s+a\s+bot/i,
  /^human$/i,
  /^yes,?\s*i\s*'?m\s+human/i,
  /^no,?\s*i\s*'?m\s+not\s+a\s+bot/i,
  /confirm\s+(join|entry|access)/i,
  /^accept$/i,
  /^continue$/i,
  /^start$/i,
  /^let\s+me\s+in$/i,
  /^enter$/i,
  /complete\s+verification/i,
  /solve\s+to\s+join/i
];

function isKnownVerificationButton(label) {
  const text = String(label || '').trim();
  if (!text) return false;
  return VERIFICATION_BUTTON_PATTERNS.some((re) => re.test(text));
}

function looksLikeVerificationMessage(text) {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return true;
  return /verif|unmute|captcha|bot|human|welcome|joined|join|spam|click|press|tap|solve|math|mute|robot|access|unlock|\+|\-|×|\*|answer|question|prove|anti/i.test(lower);
}

function iterMarkupButtons(markup) {
  if (!markup?.rows) return [];
  const out = [];
  for (const row of markup.rows) {
    for (const btn of row.buttons || []) {
      const text = String(btn.text || '').trim();
      if (text) out.push({ text, button: btn, row });
    }
  }
  return out;
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
  if (!markup?.rows) return null;
  const solved = solveVerificationText(messageText);
  const buttons = iterMarkupButtons(markup);

  if (solved) {
    for (const { text } of buttons) {
      if (text === solved) return { type: 'button', text };
    }
  }

  for (const { text } of buttons) {
    const label = text.toLowerCase();
    if (label.includes('not a bot') || label === 'human' || label.includes('i am human')) {
      return { type: 'button', text };
    }
    if (label.includes('yes') && /human/.test(label)) {
      return { type: 'button', text };
    }
    if (label.includes('no') && /bot/.test(label)) {
      return { type: 'button', text };
    }
  }

  const contextOk = looksLikeVerificationMessage(messageText)
    || buttons.some(({ text }) => isKnownVerificationButton(text));
  if (!contextOk) return null;

  for (const { text } of buttons) {
    if (isKnownVerificationButton(text)) {
      return { type: 'button', text };
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

async function pressVerificationButton(client, peer, message, buttonText, logFn, refLabel) {
  const label = String(buttonText || '').trim();
  if (!label) return false;

  const clicked = await clickInlineButton(client, message, label);
  if (clicked) {
    if (logFn) logFn(`Pressed verification button in ${refLabel}: ${label}`);
    return true;
  }

  try {
    await client.sendMessage(peer, { message: label });
    if (logFn) logFn(`Sent verification reply in ${refLabel}: ${label}`);
    return true;
  } catch (err) {
    if (logFn) {
      logFn(`Could not press verification in ${refLabel}: ${String(err.message || err).slice(0, 120)}`);
    }
    return false;
  }
}

async function tryAnswerMessage(client, peer, msg, refLabel, logFn) {
  const textAnswer = solveVerificationText(msg.message);
  if (textAnswer) {
    const button = extractButtonAnswer(msg.replyMarkup, msg.message);
    if (button?.type === 'button') {
      const pressed = await pressVerificationButton(client, peer, msg, button.text, logFn, refLabel);
      if (pressed) return true;
    }
    try {
      await client.sendMessage(peer, { message: textAnswer });
      if (logFn) logFn(`Answered verification in ${refLabel}: ${textAnswer}`);
      return true;
    } catch (err) {
      if (logFn) {
        logFn(`Could not send verification answer in ${refLabel}: ${String(err.message || err).slice(0, 120)}`);
      }
    }
  }

  const buttonOnly = extractButtonAnswer(msg.replyMarkup, msg.message);
  if (buttonOnly?.type === 'button') {
    return pressVerificationButton(client, peer, msg, buttonOnly.text, logFn, refLabel);
  }

  return false;
}

async function handlePostJoinVerification(client, peer, refLabel, logFn, { maxWaitMs = 22000 } = {}) {
  const started = Date.now();
  let answered = false;
  let firstPass = true;

  while (Date.now() - started < maxWaitMs) {
    if (!firstPass) await sleep(900);
    firstPass = false;
    let messages = [];
    try {
      messages = await client.getMessages(peer, { limit: 12 });
    } catch (_) {
      continue;
    }

    for (const msg of messages) {
      const ok = await tryAnswerMessage(client, peer, msg, refLabel, logFn);
      if (ok) {
        answered = true;
        break;
      }
    }

    if (answered) {
      await sleep(800);
      return true;
    }
  }

  return false;
}

module.exports = {
  solveVerificationText,
  extractButtonAnswer,
  isKnownVerificationButton,
  looksLikeVerificationMessage,
  handlePostJoinVerification
};
