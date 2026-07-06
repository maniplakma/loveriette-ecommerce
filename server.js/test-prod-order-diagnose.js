/**
 * Diagnose production-like order failures — run: node server.js/test-prod-order-diagnose.js
 */
const db = require('./db');

const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
const itemCols = db.prepare('PRAGMA table_info(order_items)').all().map((c) => c.name);
console.log('orders columns:', cols.join(', '));
console.log('order_items columns:', itemCols.join(', '));

const schema = db.ensureCriticalSchema?.();
console.log('ensureCriticalSchema:', schema);

const pm = db.prepare('SELECT id FROM payment_methods WHERE is_active = 1 LIMIT 1').get();
const product = db.prepare('SELECT id FROM products WHERE id = 1').get();
const variant = db.prepare('SELECT id FROM product_variants WHERE id = 4').get();
console.log('pm:', pm?.id, 'product:', product?.id, 'variant:', variant?.id);

const orderSeq = db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
const orderNumber = String(orderSeq);
console.log('next order_seq:', orderSeq);

db.exec('BEGIN');
try {
  const r = db.prepare(`
    INSERT INTO orders (
      order_number, order_seq, user_id, email, payment_method_id, redeem_code_id,
      subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)
  `).run(orderNumber, orderSeq, null, 'diag@test.local', pm.id, null, 85, 0, 85, 0, 'auto');
  const orderId = r.lastInsertRowid;
  db.prepare(`
    INSERT INTO order_items (order_id, product_id, variant_id, product_name, quantity, price)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orderId, 1, 4, 'Netflix Test', 1, 85);
  db.exec('ROLLBACK');
  console.log('DIAG: order insert simulation OK');
} catch (err) {
  db.exec('ROLLBACK');
  console.log('DIAG: order insert FAILED:', err.message);
  process.exit(1);
}
