'use strict';

function staggerMs(minutes, { enabled = true } = {}) {
  if (!enabled) return 0;
  const n = Number(minutes);
  if (!Number.isFinite(n) || n < 0) return 10 * 60 * 1000;
  return Math.round(n * 60 * 1000);
}

function readAutoStartSettings(orderRow) {
  return {
    enabled: !!orderRow.auto_start_enabled,
    staggerEnabled: orderRow.auto_start_stagger_enabled == null
      ? true
      : !!orderRow.auto_start_stagger_enabled,
    staggerMinutes: Number(orderRow.auto_start_stagger_minutes) || 10,
    dailyAt: String(orderRow.auto_start_daily_at || '').trim()
  };
}

module.exports = {
  staggerMs,
  readAutoStartSettings
};
