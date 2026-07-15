/**
 * Plugging plan limits, expiry, and tier helpers.
 */
const UNLIMITED_THRESHOLD = 999;

function isUnlimited(value) {
  const n = Number(value);
  return n >= UNLIMITED_THRESHOLD || n === 0;
}

function normalizeLimit(value, fallback = 1) {
  if (isUnlimited(value)) return UNLIMITED_THRESHOLD;
  const n = Number(value);
  return n > 0 ? n : fallback;
}

function normalizePlugOrder(order) {
  if (!order) return null;
  if (order.order_ref === 'PLG-MASTER') {
    return {
      ...order,
      maxSources: UNLIMITED_THRESHOLD,
      maxDestinations: UNLIMITED_THRESHOLD,
      planPriority: 1,
      expiresAt: null,
      isMaster: true
    };
  }
  return {
    ...order,
    maxSources: normalizeLimit(order.maxSources, 1),
    maxDestinations: normalizeLimit(order.maxDestinations, 3),
    planPriority: Number(order.planPriority || order.priority || 0),
    expiresAt: order.expires_at || order.expiresAt || null,
    isMaster: false
  };
}

function computeExpiresAtFromDuration(durationText, fromDate = new Date()) {
  const raw = String(durationText || '').trim();
  if (!raw) return null;
  if (/lifetime|unlimited|no expiry/i.test(raw)) return null;

  const match = raw.match(/(\d+)\s*(day|days|week|weeks|month|months|year|years)/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!amount || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  const d = new Date(fromDate);
  if (unit.startsWith('day')) d.setDate(d.getDate() + amount);
  else if (unit.startsWith('week')) d.setDate(d.getDate() + amount * 7);
  else if (unit.startsWith('month')) d.setMonth(d.getMonth() + amount);
  else if (unit.startsWith('year')) d.setFullYear(d.getFullYear() + amount);
  return d.toISOString();
}

function isOrderExpired(order) {
  if (!order) return true;
  if (order.order_ref === 'PLG-MASTER' || order.isMaster) return false;
  const exp = order.expires_at || order.expiresAt;
  if (!exp) return false;
  return new Date(exp).getTime() <= Date.now();
}

function formatLimitLabel(value) {
  return isUnlimited(value) ? 'Unlimited' : String(normalizeLimit(value));
}

/** VIP+ (priority) and master workspace — auto join + start all batch tools. */
function hasBatchWorkspace(order) {
  const o = normalizePlugOrder(order);
  if (!o) return false;
  return !!(o.isMaster || Number(o.planPriority) >= 1);
}

const ORDER_SELECT = `
  SELECT po.*,
    pp.name AS plan_name,
    pp.max_sources AS maxSources,
    pp.max_destinations AS maxDestinations,
    pp.priority AS planPriority,
    pp.duration AS planDuration
  FROM plugging_orders po
  LEFT JOIN plugging_plans pp ON pp.id = po.plan_id
`;

module.exports = {
  UNLIMITED_THRESHOLD,
  isUnlimited,
  normalizeLimit,
  normalizePlugOrder,
  computeExpiresAtFromDuration,
  isOrderExpired,
  formatLimitLabel,
  hasBatchWorkspace,
  ORDER_SELECT
};
