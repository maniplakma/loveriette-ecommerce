/**
 * Human-like timing to reduce Telegram spam / bot detection flags.
 */

function randomMs(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Base delay with jitter — never instant, never perfectly regular. */
function computeStealthDelayMs(delayMinutes) {
  const configured = Number(delayMinutes);
  const baseMin = configured > 0 ? configured : 3;
  const baseMs = baseMin * 60 * 1000;
  const jitterPct = 0.12 + Math.random() * 0.28;
  const sign = Math.random() > 0.45 ? 1 : -1;
  const withJitter = baseMs + sign * baseMs * jitterPct;
  return Math.max(60000, Math.round(withJitter));
}

function initialHumanPauseMs() {
  return randomMs(12000, 45000);
}

function staggerBetweenTargetsMs() {
  return randomMs(5000, 18000);
}

function formatWaitMinutes(ms) {
  const m = ms / 60000;
  return m >= 1 ? `${m.toFixed(1)} min` : `${Math.round(ms / 1000)} sec`;
}

module.exports = {
  computeStealthDelayMs,
  initialHumanPauseMs,
  staggerBetweenTargetsMs,
  formatWaitMinutes
};
