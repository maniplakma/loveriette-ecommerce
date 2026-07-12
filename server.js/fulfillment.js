'use strict';

function pickAvailableStockForItem(item, pickByVariant, pickByProduct) {
  if (item.variant_id) {
    return pickByVariant.get(item.variant_id) || null;
  }
  return pickByProduct.get(item.product_id) || null;
}

function orderHasStockForRemaining(db, orderId, isApproved) {
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  if (!order || !isApproved(order.status)) return false;

  const items = db.prepare(`
    SELECT id, product_id, variant_id, quantity FROM order_items WHERE order_id = ?
  `).all(orderId);
  const countFulfilled = db.prepare('SELECT COUNT(*) AS c FROM order_fulfillments WHERE order_item_id = ?');
  const countVariant = db.prepare(`
    SELECT COUNT(*) AS c FROM stock_items WHERE status = 'available' AND variant_id = ?
  `);
  const countProduct = db.prepare(`
    SELECT COUNT(*) AS c FROM stock_items WHERE status = 'available' AND product_id = ?
  `);

  for (const item of items) {
    const already = countFulfilled.get(item.id).c;
    const need = item.quantity - already;
    if (need <= 0) continue;
    if (item.variant_id) {
      if (countVariant.get(item.variant_id).c > 0) return true;
      continue;
    }
    if (countProduct.get(item.product_id).c > 0) return true;
  }
  return false;
}

function waitingOrdersForVariant(db, variantId) {
  const vid = Number(variantId);
  if (!vid) return [];
  return db.prepare(`
    SELECT DISTINCT o.id
    FROM orders o
    INNER JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'approved'
      AND o.tingi_drop_enabled = 0
      AND oi.variant_id = ?
      AND (SELECT COUNT(*) FROM order_fulfillments f WHERE f.order_item_id = oi.id) < oi.quantity
    ORDER BY o.id ASC
  `).all(vid);
}

module.exports = {
  pickAvailableStockForItem,
  orderHasStockForRemaining,
  waitingOrdersForVariant
};
