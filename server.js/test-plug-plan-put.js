/**
 * Reproduce plugging plan PUT update locally.
 */
const db = require('./db');

function bindSql(value) {
  return value === undefined ? null : value;
}

function bool01(value) {
  if (value == null) return null;
  return value ? 1 : 0;
}

const plan = db.prepare('SELECT id FROM plugging_plans ORDER BY id DESC LIMIT 1').get();
if (!plan) {
  console.log('No plans in DB — seed first');
  process.exit(0);
}

const id = plan.id;
const b = {
  name: '30 Days',
  duration: '30 Days',
  description: 'test',
  price: 2499,
  priceLabel: '₱2,499',
  maxSources: 99,
  maxDestinations: 99,
  sortOrder: 0,
  priority: true,
  isEnabled: true
};

try {
  db.prepare(`
    UPDATE plugging_plans SET product_id = COALESCE(?, product_id), name = COALESCE(?, name),
      description = COALESCE(?, description), price = COALESCE(?, price),
      price_label = COALESCE(?, price_label), duration = COALESCE(?, duration),
      max_sources = COALESCE(?, max_sources), max_destinations = COALESCE(?, max_destinations),
      features = COALESCE(?, features), sort_order = COALESCE(?, sort_order),
      is_enabled = COALESCE(?, is_enabled), priority = COALESCE(?, priority) WHERE id = ?
  `).run(
    bindSql(b.productId),
    bindSql(b.name),
    bindSql(b.description),
    bindSql(b.price),
    bindSql(b.priceLabel),
    bindSql(b.duration),
    bindSql(b.maxSources),
    bindSql(b.maxDestinations),
    b.features != null ? JSON.stringify(b.features) : null,
    bindSql(b.sortOrder),
    bool01(b.isEnabled),
    bool01(b.priority),
    id
  );
  console.log('OK plan', id);
} catch (err) {
  console.error('FAIL:', err.message);
  const cols = db.prepare('PRAGMA table_info(plugging_plans)').all().map((c) => c.name);
  console.error('Columns:', cols.join(', '));
  process.exit(1);
}
