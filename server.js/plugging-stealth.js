/**
 * Plugging forward timing:
 * - no pause between target groups within a cycle
 * - configurable delay (minutes) between cycles, measured from cycle end
 */

const GROUP_SEND_DELAY_MS = 0;

function cycleDelayMs(delayMinutes) {
  const min = Number(delayMinutes);
  if (!min || min <= 0) return 0;
  return min * 60 * 1000;
}

function groupSendDelayMs() {
  return GROUP_SEND_DELAY_MS;
}

function formatDelayLabel(ms) {
  if (!ms || ms <= 0) return '0 sec';
  const m = ms / 60000;
  if (m >= 1) return `${m.toFixed(1)} min`;
  return `${Math.round(ms / 1000)} sec`;
}

module.exports = {
  GROUP_SEND_DELAY_MS,
  cycleDelayMs,
  groupSendDelayMs,
  formatDelayLabel
};
