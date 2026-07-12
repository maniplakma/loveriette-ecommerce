'use strict';

/**
 * Detect and repair fulfillments where stock variant ≠ ordered variant.
 */
function findMisdeliveredFulfillments(db) {
  return db.prepare(`
    SELECT f.id AS fulfillmentId, f.order_id AS wrongOrderId, f.order_item_id AS wrongItemId,
           f.stock_item_id AS stockItemId,
           oi.variant_id AS orderedVariantId, s.variant_id AS stockVariantId,
           o.user_id AS wrongUserId, o.email AS wrongEmail,
           v.name AS stockVariantName, vo.name AS orderedVariantName
    FROM order_fulfillments f
    JOIN order_items oi ON oi.id = f.order_item_id
    JOIN stock_items s ON s.id = f.stock_item_id
    JOIN orders o ON o.id = f.order_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    LEFT JOIN product_variants vo ON vo.id = oi.variant_id
    WHERE o.status = 'approved'
      AND oi.variant_id IS NOT NULL
      AND s.variant_id IS NOT NULL
      AND oi.variant_id != s.variant_id
    ORDER BY f.id ASC
  `).all();
}

function findWaitingOrderItemForVariant(db, variantId, excludeOrderIds = []) {
  const exclude = (excludeOrderIds || []).filter(Boolean).map(Number);
  const params = [variantId];
  let excludeSql = '';
  if (exclude.length) {
    excludeSql = ` AND o.id NOT IN (${exclude.map(() => '?').join(',')})`;
    params.push(...exclude);
  }
  return db.prepare(`
    SELECT o.id AS orderId, oi.id AS orderItemId, o.user_id AS userId, o.email,
           oi.quantity,
           (SELECT COUNT(*) FROM order_fulfillments f WHERE f.order_item_id = oi.id) AS fulfilled
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'approved'
      AND o.tingi_drop_enabled = 0
      AND oi.variant_id = ?
      AND (SELECT COUNT(*) FROM order_fulfillments f WHERE f.order_item_id = oi.id) < oi.quantity
      ${excludeSql}
    ORDER BY o.id ASC
    LIMIT 1
  `).get(...params);
}

function transferFulfillmentCore(db, payload, hooks = {}) {
  const {
    fulfillmentId, stockItemId, fromUserId,
    toOrderId, toOrderItemId, toUserId
  } = payload;
  const targetOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(toOrderId);
  if (!targetOrder || String(targetOrder.status).toLowerCase() !== 'approved') return false;

  const targetItem = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(toOrderItemId, toOrderId);
  const stock = db.prepare('SELECT variant_id FROM stock_items WHERE id = ?').get(stockItemId);
  if (!targetItem || !stock) return false;
  if (targetItem.variant_id && stock.variant_id && targetItem.variant_id !== stock.variant_id) return false;

  const buyerKey = hooks.buyerKeyForOrder
    ? hooks.buyerKeyForOrder(targetOrder)
    : (targetOrder.user_id ? `user:${targetOrder.user_id}` : `email:${String(targetOrder.email || '').toLowerCase()}`);

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM order_fulfillments WHERE id = ?').run(fulfillmentId);
    db.prepare(`
      INSERT INTO order_fulfillments (order_id, order_item_id, stock_item_id) VALUES (?, ?, ?)
    `).run(toOrderId, toOrderItemId, stockItemId);
    db.prepare(`
      UPDATE stock_items SET status = 'sold', sold_to = ?, sold_at = datetime('now') WHERE id = ?
    `).run(buyerKey, stockItemId);
    if (fromUserId && hooks.clearGmailAssignment) {
      hooks.clearGmailAssignment(db, stockItemId, fromUserId);
    }
    if (toUserId && hooks.assignGmail) {
      hooks.assignGmail(db, { buyerId: toUserId, orderId: toOrderId, stockItemId });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (hooks.afterTransfer) hooks.afterTransfer(db, toOrderId);
  return true;
}

function releaseMisdeliveryCore(db, row, hooks = {}) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM order_fulfillments WHERE id = ?').run(row.fulfillmentId);
    db.prepare(`
      UPDATE stock_items SET status = 'available', sold_to = NULL, sold_at = NULL WHERE id = ?
    `).run(row.stockItemId);
    if (row.wrongUserId && hooks.clearGmailAssignment) {
      hooks.clearGmailAssignment(db, row.stockItemId, row.wrongUserId);
    }
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function repairMisdeliveredFulfillments(db, deps) {
  const mismatches = findMisdeliveredFulfillments(db);
  if (!mismatches.length) return { repaired: 0, details: [] };

  const details = [];
  let repaired = 0;

  for (const row of mismatches) {
    const target = findWaitingOrderItemForVariant(db, row.stockVariantId, [row.wrongOrderId]);
    if (!target) {
      const released = deps.releaseMisdelivery(db, row);
      details.push({
        fulfillmentId: row.fulfillmentId,
        action: released ? 'released_from_wrong_buyer' : 'skipped',
        stockVariantId: row.stockVariantId,
        stockItemId: row.stockItemId,
        wrongOrderId: row.wrongOrderId
      });
      if (released) repaired += 1;
      continue;
    }

    const ok = deps.transferFulfillment(db, {
      fulfillmentId: row.fulfillmentId,
      stockItemId: row.stockItemId,
      fromOrderId: row.wrongOrderId,
      fromUserId: row.wrongUserId,
      toOrderId: target.orderId,
      toOrderItemId: target.orderItemId,
      toUserId: target.userId,
      toEmail: target.email
    });
    details.push({
      fulfillmentId: row.fulfillmentId,
      action: ok ? 'transferred' : 'failed',
      fromOrderId: row.wrongOrderId,
      toOrderId: target.orderId,
      stockVariant: row.stockVariantName,
      orderedVariant: row.orderedVariantName
    });
    if (ok) repaired += 1;
  }

  return { repaired, details };
}

module.exports = {
  findMisdeliveredFulfillments,
  findWaitingOrderItemForVariant,
  transferFulfillmentCore,
  releaseMisdeliveryCore,
  repairMisdeliveredFulfillments
};
