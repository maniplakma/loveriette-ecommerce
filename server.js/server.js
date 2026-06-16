const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const appConfig = require('./config');
const db = require('./db');
const { fetchLatestEmailForAccount } = require('./imap-fetch');

appConfig.ensurePortableDirs();

const app = express();
const port = appConfig.port;
const host = appConfig.host;

app.set('trust proxy', 1);
app.use(express.json({ limit: appConfig.jsonBodyLimit }));
app.use(express.static(appConfig.frontendDir));

const uploadsDir = appConfig.uploadsDir;
const avatarsDir = path.join(uploadsDir, 'avatars');
const reportProofsDir = path.join(uploadsDir, 'report-proofs');
const receiptsDir = path.join(uploadsDir, 'receipts');
const paymentQrDir = path.join(uploadsDir, 'payment-qr');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
if (!fs.existsSync(reportProofsDir)) fs.mkdirSync(reportProofsDir, { recursive: true });
if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
if (!fs.existsSync(paymentQrDir)) fs.mkdirSync(paymentQrDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

function emptyUploadDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const filePath = path.join(dir, name);
    try {
      if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
    } catch (_) { /* ignore */ }
  }
}

function saveProofImageFromDataUrl(dataUrl, filenameBase) {
  const str = String(dataUrl || '');
  const match = str.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : (match[1].replace(/[^a-z0-9]/gi, '') || 'png');
  const filename = `${filenameBase}.${ext}`;
  fs.writeFileSync(path.join(reportProofsDir, filename), Buffer.from(match[2], 'base64'));
  return `/uploads/report-proofs/${filename}`;
}

function saveReceiptImageFromDataUrl(dataUrl, filenameBase) {
  const str = String(dataUrl || '');
  const match = str.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : (match[1].replace(/[^a-z0-9]/gi, '') || 'png');
  const filename = `${filenameBase}.${ext}`;
  fs.writeFileSync(path.join(receiptsDir, filename), Buffer.from(match[2], 'base64'));
  return `/uploads/receipts/${filename}`;
}

function savePaymentQrImage(dataUrl, slug) {
  if (!dataUrl || !String(dataUrl).startsWith('data:image/')) {
    throw new Error('Please upload a valid QR image');
  }
  const match = String(dataUrl).match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1].replace(/[^a-z0-9]/gi, '') || 'png';
  const safeSlug = String(slug || 'method').replace(/[^a-z0-9_-]/gi, '') || 'method';
  const filename = `${safeSlug}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(paymentQrDir, filename), Buffer.from(match[2], 'base64'));
  return `/uploads/payment-qr/${filename}`;
}

const DEFAULT_PAYMENT_INSTRUCTIONS = 'Payment is accepted via QR only.\nPlease send the exact amount or your order may be rejected.\nMake sure you are paying to the correct QR code.\nUploaded receipts only — downloaded or edited receipts will not be accepted.';
const PAYMENT_METHOD_LIMIT = 10;

function getPaymentInstructionsText() {
  const raw = getSetting('payment_instructions_text', DEFAULT_PAYMENT_INSTRUCTIONS);
  return String(raw || DEFAULT_PAYMENT_INSTRUCTIONS);
}

function paymentInstructionsLines() {
  return getPaymentInstructionsText()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ORDER_STATUS = {
  PENDING_PAYMENT: 'pending_payment',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REFUNDED: 'refunded'
};

function isApprovedOrderStatus(status) {
  return status === ORDER_STATUS.APPROVED;
}

function isPendingReviewStatus(status) {
  return status === ORDER_STATUS.PENDING;
}

function isRejectedOrderStatus(status) {
  return status === ORDER_STATUS.REJECTED;
}

function parseProofUrls(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

app.use(session({
  secret: appConfig.resolveSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: appConfig.cookieSecure,
    sameSite: 'lax'
  }
}));

function getGuestCart(sessionData) {
  if (!sessionData.cart) sessionData.cart = [];
  return sessionData.cart;
}

function mergeGuestCartIntoUser(sessionData, userId) {
  const guestCart = sessionData.cart || [];
  if (guestCart.length === 0) return;

  const upsert = db.prepare(`
    INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, product_id) DO UPDATE SET
      quantity = quantity + excluded.quantity,
      variant_id = excluded.variant_id
  `);

  db.exec('BEGIN');
  try {
    for (const item of guestCart) {
      const variantId = item.variantId ? Number(item.variantId) : null;
      upsert.run(userId, item.productId, variantId, item.quantity);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  sessionData.cart = [];
}

function cartItemLabel(productName, variantId) {
  if (!variantId) return productName;
  const variant = db.prepare('SELECT name FROM product_variants WHERE id = ?').get(variantId);
  return variant?.name ? `${productName} — ${variant.name}` : productName;
}

function cartItemBasePrice(productId, variantId, productPrice) {
  if (!variantId) return Number(productPrice) || 0;
  const variant = db.prepare(
    'SELECT price FROM product_variants WHERE id = ? AND product_id = ?'
  ).get(variantId, productId);
  return variant ? Number(variant.price) || Number(productPrice) || 0 : Number(productPrice) || 0;
}

function mapCartEntry(productId, quantity, variantId, productRow) {
  const vid = variantId ? Number(variantId) : null;
  const basePrice = cartItemBasePrice(productId, vid, productRow.price);
  const unitPrice = unitPriceForQuantity(productId, vid, quantity, basePrice);
  return {
    productId,
    variantId: vid,
    quantity,
    name: cartItemLabel(productRow.name, vid),
    description: productRow.description,
    price: unitPrice,
    lineTotal: unitPrice * quantity,
    basePrice,
    status: productRow.status,
    category: productRow.category,
    bulkPricingEnabled: !!productRow.bulk_pricing_enabled
  };
}

function getCartPayload(req) {
  if (req.session.userId) {
    const rows = db.prepare(`
      SELECT ci.product_id AS productId, ci.variant_id AS variantId, ci.quantity,
             p.name, p.description, p.price, p.status, p.category, p.bulk_pricing_enabled
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.user_id = ?
    `).all(req.session.userId);

    const mapped = rows.map((row) => mapCartEntry(
      row.productId,
      row.quantity,
      row.variantId,
      row
    ));
    return {
      items: mapped,
      total: mapped.reduce((sum, item) => sum + item.lineTotal, 0),
      count: mapped.reduce((sum, item) => sum + item.quantity, 0)
    };
  }

  const guestCart = getGuestCart(req.session);
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');

  const items = guestCart
    .map((entry) => {
      const product = getProduct.get(entry.productId);
      if (!product) return null;
      return mapCartEntry(entry.productId, entry.quantity, entry.variantId, product);
    })
    .filter(Boolean);

  return {
    items,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
    count: items.reduce((sum, item) => sum + item.quantity, 0)
  };
}

function addToCart(req, productId, quantity = 1, variantId = null) {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) return false;

  const vid = variantId ? Number(variantId) : null;
  if (vid) {
    const variant = db.prepare(
      'SELECT id FROM product_variants WHERE id = ? AND product_id = ?'
    ).get(vid, productId);
    if (!variant) return false;
  }

  if (req.session.userId) {
    db.prepare(`
      INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, product_id) DO UPDATE SET
        quantity = quantity + excluded.quantity,
        variant_id = excluded.variant_id
    `).run(req.session.userId, productId, vid, quantity);
  } else {
    const cart = getGuestCart(req.session);
    const existing = cart.find((item) => item.productId === productId);
    if (existing) {
      existing.quantity += quantity;
      if (vid) existing.variantId = vid;
    } else {
      cart.push({ productId, variantId: vid, quantity });
    }
  }

  return true;
}

function removeFromCart(req, productId) {
  if (req.session.userId) {
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?')
      .run(req.session.userId, productId);
  } else {
    req.session.cart = getGuestCart(req.session).filter(
      (item) => item.productId !== productId
    );
  }
}

function setCartQuantity(req, productId, quantity) {
  if (req.session.userId) {
    db.prepare(`
      UPDATE cart_items SET quantity = ?
      WHERE user_id = ? AND product_id = ?
    `).run(quantity, req.session.userId, productId);
  } else {
    const item = getGuestCart(req.session).find((i) => i.productId === productId);
    if (item) item.quantity = quantity;
  }
}

function clearCart(req) {
  if (req.session.userId) {
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.session.userId);
  } else {
    req.session.cart = [];
  }
}

function getCheckoutItems(req, productId, variantId, directQuantity = 1) {
  if (productId) {
    const vid = variantId ? Number(variantId) : null;
    const cart = getCartPayload(req);
    const cartItem = cart.items.find((item) =>
      item.productId === productId && (item.variantId || null) === vid
    );
    if (cartItem) return [cartItem];

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return null;

    let name = product.name;
    let basePrice = product.price;
    if (vid) {
      const variant = db.prepare(
        'SELECT id, name, price FROM product_variants WHERE id = ? AND product_id = ?'
      ).get(vid, productId);
      if (variant) {
        name = `${product.name} — ${variant.name}`;
        basePrice = variant.price;
      }
    }

    const quantity = Math.max(1, Number(directQuantity) || 1);
    const unitPrice = unitPriceForQuantity(productId, vid, quantity, basePrice);

    return [{
      productId: product.id,
      variantId: vid,
      name,
      price: unitPrice,
      quantity
    }];
  }
  return getCartPayload(req).items;
}

function calculateDiscount(code, subtotal) {
  const row = db.prepare(`
    SELECT * FROM redeem_codes
    WHERE UPPER(code) = UPPER(?) AND is_active = 1
  `).get(code);

  if (!row) return { error: 'Invalid redeem code' };
  if (row.max_uses != null && row.used_count >= row.max_uses) {
    return { error: 'Redeem code has expired' };
  }

  let discount = row.discount_type === 'percent'
    ? Math.floor(subtotal * row.discount_value / 100)
    : row.discount_value;

  discount = Math.min(Math.max(discount, 0), subtotal);

  return {
    code: row.code,
    codeId: row.id,
    discount,
    discountType: row.discount_type,
    discountValue: row.discount_value
  };
}

function parseBulkTiers(json) {
  try {
    const arr = JSON.parse(json || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.map((t) => ({
      minQty: Number(t.minQty ?? t.min ?? 1),
      maxQty: t.maxQty != null || t.max != null ? Number(t.maxQty ?? t.max) : null,
      price: Number(t.price) || 0
    })).filter((t) => t.price > 0).sort((a, b) => a.minQty - b.minQty);
  } catch (_) {
    return [];
  }
}

function unitPriceForQuantity(productId, variantId, quantity, fallbackPrice) {
  const qty = Math.max(1, Number(quantity) || 1);
  let basePrice = Number(fallbackPrice) || 0;
  let tiers = [];
  let enabled = false;

  if (variantId) {
    const v = db.prepare(
      'SELECT price, bulk_pricing_enabled, bulk_tiers FROM product_variants WHERE id = ? AND product_id = ?'
    ).get(variantId, productId);
    if (v) {
      basePrice = Number(v.price) || basePrice;
      if (v.bulk_pricing_enabled) {
        enabled = true;
        tiers = parseBulkTiers(v.bulk_tiers);
      } else {
        return basePrice;
      }
    }
  }
  if (!enabled) {
    const p = db.prepare('SELECT price, bulk_pricing_enabled, bulk_tiers FROM products WHERE id = ?').get(productId);
    if (p?.bulk_pricing_enabled) {
      enabled = true;
      tiers = parseBulkTiers(p.bulk_tiers);
      basePrice = Number(p.price) || basePrice;
    }
  }
  if (!enabled || !tiers.length) return basePrice;

  for (const tier of tiers) {
    const max = tier.maxQty == null ? Infinity : tier.maxQty;
    if (qty >= tier.minQty && qty <= max) return tier.price;
  }
  return basePrice;
}

function bulkTiersForItem(productId, variantId) {
  let basePrice = 0;
  let tiers = [];
  let enabled = false;

  if (variantId) {
    const v = db.prepare(
      'SELECT price, bulk_pricing_enabled, bulk_tiers FROM product_variants WHERE id = ? AND product_id = ?'
    ).get(variantId, productId);
    if (v) {
      basePrice = Number(v.price) || 0;
      if (v.bulk_pricing_enabled) {
        enabled = true;
        tiers = parseBulkTiers(v.bulk_tiers);
      } else {
        return { basePrice, enabled: false, tiers: [] };
      }
    }
  }
  if (!enabled) {
    const p = db.prepare('SELECT price, bulk_pricing_enabled, bulk_tiers FROM products WHERE id = ?').get(productId);
    if (p) {
      if (!variantId) basePrice = Number(p.price) || 0;
      if (p.bulk_pricing_enabled) {
        enabled = true;
        tiers = parseBulkTiers(p.bulk_tiers);
      }
    }
  }
  return { basePrice, enabled, tiers };
}

function lowestUnitPrice(productId, variantId, fallbackPrice) {
  const cfg = bulkTiersForItem(productId, variantId);
  const base = cfg.basePrice || Number(fallbackPrice) || 0;
  if (!cfg.enabled || !cfg.tiers.length) return base;
  return Math.min(base, ...cfg.tiers.map((t) => t.price));
}

function lineTotalForItem(productId, variantId, quantity, fallbackPrice) {
  const qty = Math.max(1, Number(quantity) || 1);
  const unit = unitPriceForQuantity(productId, variantId, qty, fallbackPrice);
  return unit * qty;
}

function readTingiSettings() {
  return {
    checkoutEnabled: getSetting('tingi_checkout_enabled', '1') === '1',
    minQty: Number(getSetting('tingi_min_qty', '2')) || 2,
    maxQty: Number(getSetting('tingi_max_qty', '50')) || 50,
    holdDays: Number(getSetting('tingi_hold_days', '10')) || 10,
    minAutoDrop: Number(getSetting('tingi_min_auto_drop', '5')) || 5
  };
}

function resolveFulfillmentMode(tingiDropEnabled, totalQuantity) {
  if (tingiDropEnabled) return 'manual';
  return 'auto';
}

function setTingiHoldUntil(orderId) {
  const holdDays = readTingiSettings().holdDays;
  db.prepare('UPDATE orders SET tingi_hold_until = datetime(\'now\', ?) WHERE id = ?')
    .run(`+${holdDays} days`, orderId);
}

function tingiHoldIsActive(orderId) {
  const row = db.prepare('SELECT tingi_hold_until FROM orders WHERE id = ?').get(orderId);
  if (!row?.tingi_hold_until) return true;
  return db.prepare('SELECT datetime(?) > datetime(\'now\') AS active').get(row.tingi_hold_until).active === 1;
}

function orderFulfillmentSummary(orderId) {
  const items = db.prepare('SELECT quantity FROM order_items WHERE order_id = ?').all(orderId);
  const expected = items.reduce((s, i) => s + i.quantity, 0);
  const fulfilled = db.prepare('SELECT COUNT(*) AS c FROM order_fulfillments WHERE order_id = ?').get(orderId).c;
  return { expected, fulfilled, remaining: Math.max(0, expected - fulfilled) };
}

function orderHasStockForRemaining(orderId) {
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  if (!order || !isApprovedOrderStatus(order.status)) return false;

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
    if (item.variant_id && countVariant.get(item.variant_id).c > 0) return true;
    if (countProduct.get(item.product_id).c > 0) return true;
  }
  return false;
}

function buyerOrderPhase(orderRow, fulfillment, stockAvailable) {
  if (orderRow.status === ORDER_STATUS.REJECTED) return 'rejected';
  if (orderRow.status === ORDER_STATUS.REFUNDED) return 'refunded';
  if (!isApprovedOrderStatus(orderRow.status)) return 'pending_approval';
  if (fulfillment.expected > 0 && fulfillment.fulfilled >= fulfillment.expected) return 'delivered';
  if (fulfillment.remaining > 0 && !stockAvailable) return 'waiting_for_stock';
  if (
    orderRow.fulfillment_mode === 'manual'
    && orderRow.tingi_drop_enabled
    && stockAvailable
    && fulfillment.remaining > 0
    && tingiHoldIsActive(orderRow.id)
  ) {
    return 'tingi_claim';
  }
  if (fulfillment.fulfilled > 0) return 'delivered';
  return 'approved';
}

function claimOneStockForOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !isApprovedOrderStatus(order.status)) return { error: 'Order is not approved' };
  if (order.fulfillment_mode !== 'manual') return { error: 'This order does not require manual claim' };

  const summary = orderFulfillmentSummary(orderId);
  if (summary.remaining <= 0) return { error: 'All stock has already been claimed for this order' };
  if (!tingiHoldIsActive(orderId)) {
    return { error: 'The Tingi Drop hold period has ended. Remaining accounts are delivered automatically.' };
  }

  const buyerKey = buyerKeyForOrder(order);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(orderId);

  const pickByVariant = db.prepare(`
    SELECT id FROM stock_items WHERE status='available' AND variant_id = ? ORDER BY id ASC LIMIT 1
  `);
  const pickByProduct = db.prepare(`
    SELECT id FROM stock_items WHERE status='available' AND product_id = ? ORDER BY id ASC LIMIT 1
  `);
  const countFulfilled = db.prepare('SELECT COUNT(*) AS c FROM order_fulfillments WHERE order_item_id = ?');
  const insertFulfillment = db.prepare(`
    INSERT INTO order_fulfillments (order_id, order_item_id, stock_item_id) VALUES (?, ?, ?)
  `);
  const markSold = db.prepare(`
    UPDATE stock_items SET status='sold', sold_to=?, sold_at=datetime('now') WHERE id=?
  `);

  let assignedStockId = null;

  db.exec('BEGIN');
  try {
    for (const item of items) {
      const already = countFulfilled.get(item.id).c;
      const need = item.quantity - already;
      if (need <= 0) continue;

      let stockRow = item.variant_id ? pickByVariant.get(item.variant_id) : null;
      if (!stockRow) stockRow = pickByProduct.get(item.product_id);
      if (!stockRow) {
        db.exec('ROLLBACK');
        return { error: 'No stock available to claim right now. Contact the seller.' };
      }

      markSold.run(buyerKey, stockRow.id);
      insertFulfillment.run(orderId, item.id, stockRow.id);
      const stockCred = db.prepare('SELECT email, password, profiles FROM stock_items WHERE id = ?').get(stockRow.id);
      if (stockCred) {
        let profiles = [];
        try { profiles = JSON.parse(stockCred.profiles || '[]'); } catch (_) { profiles = []; }
        upsertEmailAccess(stockRow.id, {
          email: stockCred.email,
          password: stockCred.password,
          profileData: profiles
        });
      }
      assignedStockId = stockRow.id;
      db.exec('COMMIT');
      const postSummary = orderFulfillmentSummary(orderId);
      if (postSummary.remaining <= 0) {
        db.prepare('UPDATE orders SET tingi_hold_until = NULL WHERE id = ?').run(orderId);
      }
      return {
        ok: true,
        stockItemId: assignedStockId,
        summary: orderFulfillmentSummary(orderId)
      };
    }
    db.exec('ROLLBACK');
    return { error: 'Nothing left to claim on this order' };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function nextOrderSeq() {
  return db.prepare('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders').get().n;
}

function findOrderByRef(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const bySeq = db.prepare('SELECT * FROM orders WHERE order_seq = ?').get(Number(raw));
    if (bySeq) return bySeq;
  }
  return db.prepare('SELECT * FROM orders WHERE order_number = ?').get(raw);
}

function orderDisplayId(order) {
  if (!order) return '—';
  return order.order_seq != null ? String(order.order_seq) : String(order.order_number || '—');
}

function generateOrderNumber() {
  return String(nextOrderSeq());
}

function formatOrder(orderRef) {
  const base = findOrderByRef(orderRef);
  if (!base) return null;

  const order = db.prepare(`
    SELECT o.*, pm.name AS payment_method_name, pm.slug AS payment_method_slug,
           pm.qr_image_url, pm.account_number AS payment_account_number,
           rc.code AS redeem_code, u.name AS user_name
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id
    LEFT JOIN redeem_codes rc ON rc.id = o.redeem_code_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `).get(base.id);

  const items = db.prepare(`
    SELECT id AS orderItemId, product_id AS productId, variant_id AS variantId, product_name AS name, quantity, price
    FROM order_items WHERE order_id = ?
  `).all(order.id).map((item) => {
    const stock = lineItemStockStatusForOrder(
      order.status,
      item.orderItemId,
      item.productId,
      item.variantId,
      item.quantity
    );
    return { ...item, stockState: stock.state, stockLabel: stock.label };
  });

  const fulfillment = orderFulfillmentSummary(order.id);

  const createdMs = order.created_at
    ? new Date(order.created_at.includes('T') ? order.created_at : `${order.created_at.replace(' ', 'T')}Z`).getTime()
    : Date.now();
  const paymentExpiresAt = new Date(createdMs + 30 * 60 * 1000).toISOString();

  return {
    orderNumber: order.order_number,
    orderId: order.order_seq,
    displayId: orderDisplayId(order),
    buyerName: order.buyer_name || order.user_name || (order.email ? order.email.split('@')[0] : 'Guest'),
    email: order.email,
    userId: order.user_id || null,
    user: {
      id: order.user_id || null,
      name: order.buyer_name || order.user_name || null,
      email: order.email
    },
    status: order.status,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    paymentMethod: order.payment_method_name,
    paymentMethodId: order.payment_method_id,
    paymentMethodSlug: order.payment_method_slug,
    paymentInstructions: paymentInstructionsLines(),
    paymentInstructionsText: getPaymentInstructionsText(),
    qrImageUrl: order.qr_image_url,
    accountNumber: order.payment_account_number || '',
    redeemCode: order.redeem_code,
    receiptUrl: order.receipt_url || null,
    rejectReason: order.reject_reason || null,
    items,
    tingiDropEnabled: !!order.tingi_drop_enabled,
    tingiHoldDays: readTingiSettings().holdDays,
    fulfillmentMode: order.fulfillment_mode || 'auto',
    fulfillmentExpected: fulfillment.expected,
    fulfillmentClaimed: fulfillment.fulfilled,
    fulfillmentRemaining: fulfillment.remaining,
    canClaimStock: isApprovedOrderStatus(order.status)
      && order.fulfillment_mode === 'manual'
      && fulfillment.remaining > 0,
    tingiHoldUntil: order.tingi_hold_until || null,
    createdAt: order.created_at,
    paymentExpiresAt
  };
}

function buyerKeyForOrder(order) {
  if (order.user_id) return `user:${order.user_id}`;
  return `email:${String(order.email || '').toLowerCase()}`;
}

function fulfillOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !isApprovedOrderStatus(order.status)) return { assigned: 0 };
  if (order.fulfillment_mode === 'manual') return { assigned: 0, manual: true };
  return fulfillOrderRemaining(orderId);
}

function fulfillOrderRemaining(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !isApprovedOrderStatus(order.status)) return { assigned: 0 };

  const buyerKey = buyerKeyForOrder(order);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  let assigned = 0;

  const pickByVariant = db.prepare(`
    SELECT id FROM stock_items WHERE status='available' AND variant_id = ? ORDER BY id ASC LIMIT 1
  `);
  const pickByProduct = db.prepare(`
    SELECT id FROM stock_items WHERE status='available' AND product_id = ? ORDER BY id ASC LIMIT 1
  `);
  const countFulfilled = db.prepare(`
    SELECT COUNT(*) AS c FROM order_fulfillments WHERE order_item_id = ?
  `);
  const insertFulfillment = db.prepare(`
    INSERT INTO order_fulfillments (order_id, order_item_id, stock_item_id) VALUES (?, ?, ?)
  `);
  const markSold = db.prepare(`
    UPDATE stock_items SET status='sold', sold_to=?, sold_at=datetime('now') WHERE id=?
  `);

  db.exec('BEGIN');
  try {
    for (const item of items) {
      const already = countFulfilled.get(item.id).c;
      const need = item.quantity - already;
      for (let i = 0; i < need; i++) {
        let stockRow = item.variant_id ? pickByVariant.get(item.variant_id) : null;
        if (!stockRow) stockRow = pickByProduct.get(item.product_id);
        if (!stockRow) break;
        markSold.run(buyerKey, stockRow.id);
        insertFulfillment.run(orderId, item.id, stockRow.id);
        const stockCred = db.prepare('SELECT email, password, profiles FROM stock_items WHERE id = ?').get(stockRow.id);
        if (stockCred) {
          let profiles = [];
          try { profiles = JSON.parse(stockCred.profiles || '[]'); } catch (_) { profiles = []; }
          upsertEmailAccess(stockRow.id, {
            email: stockCred.email,
            password: stockCred.password,
            profileData: profiles
          });
        }
        assigned++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const remaining = orderFulfillmentSummary(orderId).remaining;
  if (remaining <= 0) {
    db.prepare('UPDATE orders SET tingi_hold_until = NULL WHERE id = ?').run(orderId);
  }
  return { assigned };
}

function processExpiredTingiHolds() {
  const expired = db.prepare(`
    SELECT id, order_number, user_id, email FROM orders
    WHERE status = 'approved' AND fulfillment_mode = 'manual'
      AND tingi_hold_until IS NOT NULL
      AND datetime(tingi_hold_until) <= datetime('now')
  `).all();

  for (const order of expired) {
    const summary = orderFulfillmentSummary(order.id);
    if (summary.remaining <= 0) continue;
    const result = fulfillOrderRemaining(order.id);
    if (result.assigned > 0 && order.user_id) {
      const full = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      createUserNotification(
        order.user_id,
        'order',
        'Tingi Drop auto-delivered',
        `${result.assigned} remaining account(s) from order #${orderDisplayId(full)} were automatically delivered after the ${readTingiSettings().holdDays}-day hold.`
      );
    }
  }
}

function creditLoyaltyWallet(order) {
  if (getSetting('loyalty_enabled', '1') !== '1' || !order.user_id) return;
  const exists = db.prepare(`
    SELECT id FROM wallet_transactions WHERE order_number = ? AND user_id = ? AND type = 'loyalty'
  `).get(order.order_number, order.user_id);
  if (exists) return;
  const earnRate = Number(getSetting('loyalty_earn_rate', '0.25'));
  const redeemRate = Number(getSetting('loyalty_redeem_rate', '100')) || 100;
  const points = Math.floor(order.total * earnRate);
  if (points <= 0) return;
  const credit = Math.floor(points / redeemRate);
  if (credit <= 0) return;

  db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(credit, order.user_id);
  db.prepare(`
    INSERT INTO wallet_transactions (user_id, type, amount, order_number, description)
    VALUES (?, 'loyalty', ?, ?, ?)
  `).run(order.user_id, credit, order.order_number, `Loyalty credit for order ${order.order_number}`);
}

function parseAccessProfileDetails(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => (typeof p === 'object' && p != null ? p.detail : p)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function mainCredentialsDuplicateEmailAccess(mainEmail, mainPassword, mainProfiles, accessEmail, accessPassword, accessProfileDetails) {
  const mainProf = (mainProfiles || []).map(String).join(', ');
  const accessProf = (accessProfileDetails || []).map(String).join(', ');
  const dupEmail = String(accessEmail || '').trim() === String(mainEmail || '').trim();
  const dupPass = String(accessPassword || '').trim() === String(mainPassword || '').trim();
  const dupProf = !accessProf || accessProf === mainProf || accessProf === (mainProfiles || []).join(',');
  return dupEmail && dupPass && dupProf;
}

function buildDistinctEmailAccess(row, mainProfiles, profileState) {
  const accessEmail = row.accessEmail || row.email || '';
  const accessPassword = row.accessPassword || row.password || '';
  const accessProfileDetails = profileState
    ? profileState.map((p) => p.detail)
    : parseAccessProfileDetails(row.accessProfileData);
  const mainProfList = mainProfiles || [];

  if (
    mainCredentialsDuplicateEmailAccess(
      row.email,
      row.password,
      mainProfList,
      accessEmail,
      accessPassword,
      accessProfileDetails
    )
  ) {
    return null;
  }

  if (!accessEmail && !accessPassword) return null;

  return {
    email: row.accessEmail || row.email,
    password: row.accessPassword || row.password,
    profileData: profileState
      ? profileState.map((p) => ({ detail: p.detail, reported: p.reported }))
      : accessProfileDetails
  };
}

function getUserPurchasedAccounts(userId, email) {
  const emailLower = String(email || '').toLowerCase();
  const rows = db.prepare(`
    SELECT s.id, s.service_name AS serviceName, s.email, s.password, s.profiles, s.rules,
           s.valid_start AS validStart, s.valid_end AS validEnd,
           o.order_number AS orderNumber, o.order_seq AS orderId, f.created_at AS deliveredAt,
           p.name AS productName, v.name AS variantName,
           e.email AS accessEmail, e.password AS accessPassword, e.profile_data AS accessProfileData
    FROM order_fulfillments f
    JOIN stock_items s ON s.id = f.stock_item_id
    JOIN orders o ON o.id = f.order_id
    LEFT JOIN products p ON p.id = s.product_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    LEFT JOIN email_access_credentials e ON e.stock_item_id = s.id
    WHERE o.status = 'approved'
      AND (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?))
    ORDER BY f.created_at DESC
  `).all(userId, emailLower);

  return rows.map((r) => {
    const profiles = JSON.parse(r.profiles || '[]');
    const name = r.serviceName || `${r.productName || 'Account'}${r.variantName ? ` — ${r.variantName}` : ''}`;
    const emailAccess = buildDistinctEmailAccess(r, profiles, null);
    return {
      id: r.id,
      serviceName: name,
      email: r.email,
      password: r.password,
      profiles,
      emailAccess,
      rules: r.rules || '',
      validStart: r.validStart,
      validEnd: r.validEnd,
      orderNumber: r.orderNumber,
      orderId: r.orderId,
      displayId: r.orderId != null ? String(r.orderId) : r.orderNumber,
      deliveredAt: r.deliveredAt,
      label: `${name} (${r.email})`
    };
  });
}

function userOwnsOrder(order, userId, email) {
  if (!order) return false;
  const emailLower = String(email || '').toLowerCase();
  return order.user_id === userId
    || (!order.user_id && String(order.email || '').toLowerCase() === emailLower);
}

function getOrderCredentialsForUser(orderRef, userId, email) {
  const order = findOrderByRef(orderRef);
  if (!order) return { error: 'not_found' };

  const orderRow = db.prepare(`
    SELECT o.id, o.order_number AS orderNumber, o.order_seq AS orderId, o.status, o.user_id, o.email, o.created_at AS createdAt,
           o.fulfillment_mode AS fulfillmentMode, o.tingi_drop_enabled AS tingiDropEnabled,
           o.tingi_hold_until AS tingiHoldUntil, o.reject_reason AS rejectReason
    FROM orders o WHERE o.id = ?
  `).get(order.id);

  if (!userOwnsOrder(orderRow, userId, email)) return { error: 'forbidden' };

  const isPaid = isApprovedOrderStatus(orderRow.status);
  if (isPaid) {
    const orderFull = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderRow.id);
    if (!orderFull.tingi_drop_enabled && orderFull.fulfillment_mode !== 'manual') {
      fulfillOrderRemaining(orderRow.id);
    }
  }

  const accounts = isPaid ? db.prepare(`
    SELECT f.id AS fulfillmentId, f.order_item_id AS orderItemId,
           s.id AS stockItemId, s.service_name AS serviceName, s.email, s.password, s.profiles, s.rules,
           s.product_id AS productId, s.variant_id AS variantId, s.credential_report_status AS credentialReportStatus,
           p.name AS productName, v.name AS variantName, v.rules AS variantRules,
           f.created_at AS deliveredAt,
           e.email AS accessEmail, e.password AS accessPassword, e.profile_data AS accessProfileData
    FROM order_fulfillments f
    JOIN stock_items s ON s.id = f.stock_item_id
    LEFT JOIN products p ON p.id = s.product_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    LEFT JOIN email_access_credentials e ON e.stock_item_id = s.id
    WHERE f.order_id = ?
    ORDER BY f.id ASC
  `).all(orderRow.id).map((r, i) => {
    const profileState = getCredentialProfileState(r.stockItemId);
    const profiles = profileState.map((p) => p.detail);
    const emailAccess = buildDistinctEmailAccess(r, profiles, profileState);
    return {
      index: i + 1,
      label: `Account ${String(i + 1).padStart(2, '0')}`,
      fulfillmentId: r.fulfillmentId,
      orderItemId: r.orderItemId,
      stockItemId: r.stockItemId,
      email: r.email,
      password: r.password,
      profiles,
      profileEntries: profileState,
      profile: profiles.length ? profiles.join(', ') : '—',
      emailAccess,
      credentialReportStatus: r.credentialReportStatus || 'ok',
      rules: String(r.rules || r.variantRules || '').trim(),
      serviceName: r.serviceName || `${r.productName || 'Account'}${r.variantName ? ` — ${r.variantName}` : ''}`,
      productId: r.productId,
      variantId: r.variantId,
      deliveredAt: r.deliveredAt
    };
  }) : [];

  const items = db.prepare(`
    SELECT product_id AS productId, variant_id AS variantId, product_name AS name, quantity, price
    FROM order_items WHERE order_id = ?
  `).all(orderRow.id);

  const rulesParts = accounts.map((a) => a.rules).filter(Boolean);
  if (!rulesParts.length && items[0]?.variantId) {
    const vr = db.prepare('SELECT rules FROM product_variants WHERE id = ?').get(items[0].variantId);
    if (vr?.rules) rulesParts.push(vr.rules);
  }

  const fulfillment = orderFulfillmentSummary(orderRow.id);
  const expectedCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const stockAvailable = isPaid ? orderHasStockForRemaining(orderRow.id) : false;
  const buyerPhase = buyerOrderPhase(
    {
      status: orderRow.status,
      fulfillment_mode: orderRow.fulfillmentMode,
      tingi_drop_enabled: orderRow.tingiDropEnabled,
      id: orderRow.id
    },
    fulfillment,
    stockAvailable
  );

  return {
    orderNumber: orderRow.orderNumber,
    orderId: orderRow.orderId,
    displayId: orderRow.orderId != null ? String(orderRow.orderId) : orderRow.orderNumber,
    status: orderRow.status,
    rejectReason: orderRow.rejectReason || null,
    createdAt: orderRow.createdAt,
    accounts,
    items,
    rules: rulesParts.join('\n\n') || 'Follow the product rules provided at purchase. Contact support if you need help.',
    accountCount: accounts.length,
    expectedCount,
    tingiDropEnabled: !!orderRow.tingiDropEnabled,
    tingiHoldUntil: orderRow.tingiHoldUntil || null,
    tingiHoldDays: readTingiSettings().holdDays,
    fulfillmentMode: orderRow.fulfillmentMode || 'auto',
    fulfillmentExpected: fulfillment.expected,
    fulfillmentClaimed: fulfillment.fulfilled,
    fulfillmentRemaining: fulfillment.remaining,
    stockAvailable,
    buyerPhase,
    isApproved: isPaid,
    canClaimStock: isPaid
      && orderRow.fulfillmentMode === 'manual'
      && fulfillment.remaining > 0
      && tingiHoldIsActive(orderRow.id)
      && stockAvailable
  };
}

function userOwnsStockItem(stockItemId, userId, email) {
  const emailLower = String(email || '').toLowerCase();
  const row = db.prepare(`
    SELECT s.id FROM stock_items s
    JOIN order_fulfillments f ON f.stock_item_id = s.id
    JOIN orders o ON o.id = f.order_id
    WHERE s.id = ? AND o.status = 'approved'
      AND (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?))
  `).get(stockItemId, userId, emailLower);
  return !!row;
}

function parseProfilesInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [raw];
    } catch (_) { /* fall through */ }
  }
  return raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}

function parseProfileDetail(entry) {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry.trim();
  if (typeof entry === 'object') return String(entry.detail || entry.name || '').trim();
  return String(entry).trim();
}

function profileEntriesFromRaw(raw) {
  let parsed = [];
  if (Array.isArray(raw)) parsed = raw;
  else {
    try { parsed = JSON.parse(raw || '[]'); } catch (_) { parsed = []; }
  }
  if (!Array.isArray(parsed)) parsed = [];
  return parsed.map((entry, index) => ({
    index,
    detail: parseProfileDetail(entry) || `Profile ${index + 1}`
  }));
}

function getCredentialProfileEntries(stockItemId) {
  const stock = db.prepare('SELECT profiles FROM stock_items WHERE id = ?').get(stockItemId);
  const access = getEmailAccessForStock(stockItemId);
  let entries = profileEntriesFromRaw(stock?.profiles);
  if (access?.profileData?.length) {
    entries = profileEntriesFromRaw(access.profileData);
  }
  if (!entries.length) entries = [{ index: 0, detail: 'Profile 1' }];
  return entries;
}

function getCredentialProfileState(stockItemId) {
  const stock = db.prepare(`
    SELECT profiles, credential_report_status FROM stock_items WHERE id = ?
  `).get(stockItemId);
  const access = getEmailAccessForStock(stockItemId);
  const entries = getCredentialProfileEntries(stockItemId);
  const accessRaw = access?.profileData || [];
  const flagged = stock?.credential_report_status === 'reported';
  return entries.map((entry, i) => {
    const accessEntry = accessRaw[i];
    const reported = flagged
      || (typeof accessEntry === 'object' && accessEntry?.reported)
      || false;
    return { index: entry.index, detail: entry.detail, reported };
  });
}

function flagCredentialProfilesReported(stockItemId, triggerProfileIndex = 0) {
  const stock = db.prepare('SELECT email, password, profiles FROM stock_items WHERE id = ?').get(stockItemId);
  if (!stock) return [];
  const entries = getCredentialProfileEntries(stockItemId);
  const flaggedProfiles = entries.map((e) => ({
    detail: e.detail,
    reported: true,
    trigger: e.index === Number(triggerProfileIndex)
  }));
  const profilesJson = JSON.stringify(flaggedProfiles.map((p) => p.detail));
  db.prepare(`
    UPDATE stock_items SET profiles = ?, credential_report_status = 'reported' WHERE id = ?
  `).run(profilesJson, stockItemId);
  upsertEmailAccess(stockItemId, {
    email: stock.email,
    password: stock.password,
    profileData: flaggedProfiles
  });
  return flaggedProfiles.map((p) => p.detail);
}

function stockItemHasActiveReport(stockItemId) {
  return !!db.prepare(`
    SELECT id FROM product_reports
    WHERE status = 'active' AND (
      stock_item_id = ?
      OR (reported_items IS NOT NULL AND reported_items LIKE ?)
    )
    LIMIT 1
  `).get(stockItemId, `%\"stockItemId\":${stockItemId}%`);
}

function buildReportTargetRow(row) {
  const profiles = getCredentialProfileState(row.stockItemId);
  const productName = row.serviceName || `${row.productName || 'Account'}${row.variantName ? ` — ${row.variantName}` : ''}`;
  return {
    fulfillmentId: row.fulfillmentId,
    orderItemId: row.orderItemId,
    stockItemId: row.stockItemId,
    orderNumber: row.orderNumber,
    label: row.label || `Account ${String(row.accountIndex || 1).padStart(2, '0')}`,
    productName,
    productId: row.productId,
    variantId: row.variantId,
    email: row.email,
    profiles,
    credentialStatus: row.credentialReportStatus || 'ok',
    hasActiveReport: stockItemHasActiveReport(row.stockItemId)
  };
}

function listReportTargetsForUser(userId, email, orderNumber) {
  const emailLower = String(email || '').toLowerCase();
  const params = [userId, emailLower];
  let orderFilter = '';
  if (orderNumber) {
    orderFilter = ' AND o.order_number = ?';
    params.push(String(orderNumber).trim());
  }
  const rows = db.prepare(`
    SELECT f.id AS fulfillmentId, f.order_item_id AS orderItemId, f.stock_item_id AS stockItemId,
           o.order_number AS orderNumber, s.email, s.service_name AS serviceName,
           s.product_id AS productId, s.variant_id AS variantId,
           s.credential_report_status AS credentialReportStatus,
           p.name AS productName, v.name AS variantName,
           oi.product_name AS lineName, oi.quantity AS lineQuantity
    FROM order_fulfillments f
    JOIN orders o ON o.id = f.order_id
    JOIN stock_items s ON s.id = f.stock_item_id
    JOIN order_items oi ON oi.id = f.order_item_id
    LEFT JOIN products p ON p.id = s.product_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    WHERE o.status = 'approved'
      AND (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?))
      ${orderFilter}
    ORDER BY f.id ASC
  `).all(...params);

  const accountIndexByOrder = {};
  return rows.map((r) => {
    const key = r.orderNumber || 'all';
    accountIndexByOrder[key] = (accountIndexByOrder[key] || 0) + 1;
    return buildReportTargetRow({
      ...r,
      serviceName: r.serviceName || r.lineName,
      accountIndex: accountIndexByOrder[key]
    });
  });
}

function resolveReportSelections(req, reportType) {
  const body = req.body || {};
  let selections = Array.isArray(body.selections) ? body.selections : [];
  if (!selections.length && body.stockItemId) {
    selections = [{
      stockItemId: Number(body.stockItemId),
      profileIndex: body.profileIndex != null ? Number(body.profileIndex) : 0
    }];
  }
  if (!selections.length) {
    return { error: 'Select at least one product or account to report', status: 400 };
  }

  const normalized = [];
  for (const sel of selections) {
    const stockItemId = Number(sel.stockItemId);
    if (!stockItemId) {
      return { error: 'Invalid report selection', status: 400 };
    }
    if (!userOwnsStockItem(stockItemId, req.session.userId, req.authUser.email)) {
      return { error: 'One or more selected accounts were not found', status: 403 };
    }
    if (stockItemHasActiveReport(stockItemId)) {
      return { error: 'One or more selected accounts already have an active report', status: 400 };
    }
    const profileIndex = sel.profileIndex != null ? Number(sel.profileIndex) : 0;
    const entries = getCredentialProfileEntries(stockItemId);
    if (entries.length > 1 && sel.profileIndex == null && body.profileIndex == null) {
      return { error: 'Select which profile to report for shared credentials', status: 400 };
    }
    if (profileIndex < 0 || profileIndex >= entries.length) {
      return { error: 'Invalid profile selection', status: 400 };
    }
    normalized.push({ stockItemId, profileIndex });
  }

  const uniqueStock = new Set(normalized.map((s) => s.stockItemId));
  if (uniqueStock.size !== normalized.length) {
    return { error: 'Duplicate account selected', status: 400 };
  }

  return { selections: normalized };
}

function buildReportedItemsMeta(selections) {
  const items = [];
  for (const sel of selections) {
    const row = db.prepare(`
      SELECT f.id AS fulfillmentId, f.order_item_id AS orderItemId, f.order_id,
             s.id AS stockItemId, s.email, s.service_name AS serviceName,
             s.product_id AS productId, s.variant_id AS variantId,
             p.name AS productName, v.name AS variantName,
             o.order_number AS orderNumber, oi.product_name AS lineName
      FROM stock_items s
      JOIN order_fulfillments f ON f.stock_item_id = s.id
      JOIN orders o ON o.id = f.order_id
      JOIN order_items oi ON oi.id = f.order_item_id
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN product_variants v ON v.id = s.variant_id
      WHERE s.id = ?
    `).get(sel.stockItemId);
    if (!row) continue;
    const profilesFlagged = getCredentialProfileEntries(sel.stockItemId).map((e) => e.detail);
    const productName = row.serviceName || row.lineName || `${row.productName || 'Account'}${row.variantName ? ` — ${row.variantName}` : ''}`;
    items.push({
      stockItemId: row.stockItemId,
      fulfillmentId: row.fulfillmentId,
      orderItemId: row.orderItemId,
      orderNumber: row.orderNumber,
      productName,
      email: row.email,
      triggerProfileIndex: sel.profileIndex,
      profilesFlagged
    });
  }
  return items;
}

function formatProductReportRow(row) {
  let reportedItems = [];
  try { reportedItems = JSON.parse(row.reported_items || '[]'); } catch (_) { reportedItems = []; }
  if (!reportedItems.length && row.stock_item_id) {
    reportedItems = [{
      stockItemId: row.stock_item_id,
      productName: row.service,
      orderNumber: row.order_number
    }];
  }
  const productNames = [...new Set(reportedItems.map((i) => i.productName).filter(Boolean))];
  const credentialEmails = [...new Set(reportedItems.map((i) => i.email).filter(Boolean))];
  let reportedProfiles = [];
  try { reportedProfiles = JSON.parse(row.reported_profiles || '[]'); } catch (_) { reportedProfiles = []; }
  if (!reportedProfiles.length) {
    reportedProfiles = reportedItems.flatMap((i) => i.profilesFlagged || []);
  }
  return {
    ...row,
    reportedItems,
    reportQuantity: row.report_quantity || reportedItems.length || 1,
    productSummary: productNames.join(', ') || row.service || '—',
    credentialSummary: credentialEmails.join(', ') || '—',
    profilesAffected: reportedProfiles.length,
    reportedProfiles,
    adminNote: row.admin_note || '',
    issueText: (row.detail || '').split('\n')[0] || '',
    remainingDays: row.remaining_days || '',
    selectedItemsSummary: reportedItems.map((i) => i.productName || i.email || 'Item').join(', '),
    buyerName: row.buyer_name || row.email || ''
  };
}

function formatBuyerReportRow(row) {
  const formatted = formatProductReportRow(row);
  return {
    id: formatted.id,
    orderNumber: formatted.order_number,
    reportType: formatted.report_type,
    status: formatted.status,
    product: formatted.service || formatted.productSummary,
    productSummary: formatted.productSummary,
    issue: formatted.issueText,
    remainingDays: formatted.remainingDays,
    selectedItems: formatted.reportedItems,
    selectedItemsSummary: formatted.selectedItemsSummary,
    reportQuantity: formatted.reportQuantity,
    adminNote: formatted.adminNote,
    createdAt: formatted.created_at,
    resolvedAt: formatted.resolved_at
  };
}

function getEmailAccessRow(stockItemId) {
  return db.prepare('SELECT * FROM email_access_credentials WHERE stock_item_id = ?').get(stockItemId);
}

function formatEmailAccess(row) {
  if (!row) return null;
  let profileData = [];
  try { profileData = JSON.parse(row.profile_data || '[]'); } catch (_) { profileData = []; }
  return {
    email: row.email || '',
    password: row.password || '',
    profileData: Array.isArray(profileData) ? profileData : []
  };
}

function getEmailAccessForStock(stockItemId) {
  return formatEmailAccess(getEmailAccessRow(stockItemId));
}

function upsertEmailAccess(stockItemId, { email, password, profileData }) {
  const profilesJson = JSON.stringify(profileData || []);
  const existing = getEmailAccessRow(stockItemId);
  if (existing) {
    db.prepare(`
      UPDATE email_access_credentials
      SET email = ?, password = ?, profile_data = ?, updated_at = datetime('now')
      WHERE stock_item_id = ?
    `).run(email || '', password || '', profilesJson, stockItemId);
  } else {
    db.prepare(`
      INSERT INTO email_access_credentials (stock_item_id, email, password, profile_data)
      VALUES (?, ?, ?, ?)
    `).run(stockItemId, email || '', password || '', profilesJson);
  }
}

function snapshotCredentials(stockItemId) {
  const stock = db.prepare('SELECT email, password, profiles FROM stock_items WHERE id = ?').get(stockItemId);
  const access = getEmailAccessForStock(stockItemId);
  let profiles = [];
  try { profiles = JSON.parse(stock?.profiles || '[]'); } catch (_) { profiles = []; }
  return {
    email: stock?.email || '',
    password: stock?.password || '',
    profiles: Array.isArray(profiles) ? profiles : [],
    emailAccess: access || { email: '', password: '', profileData: [] }
  };
}

function replacePurchasedAccountCredentials(stockItemId, payload, meta = {}) {
  const before = snapshotCredentials(stockItemId);
  const profiles = payload.profiles != null ? payload.profiles : before.profiles;
  const profilesJson = JSON.stringify(profiles);

  db.prepare(`
    UPDATE stock_items SET email = ?, password = ?, profiles = ? WHERE id = ?
  `).run(payload.email || '', payload.password || '', profilesJson, stockItemId);

  const accessEmail = payload.emailAccessEmail != null ? payload.emailAccessEmail : payload.email || before.email;
  const accessPassword = payload.emailAccessPassword != null ? payload.emailAccessPassword : payload.password || before.password;
  const accessProfiles = payload.emailAccessProfileData != null ? payload.emailAccessProfileData : profiles;
  upsertEmailAccess(stockItemId, {
    email: accessEmail,
    password: accessPassword,
    profileData: accessProfiles
  });

  const after = snapshotCredentials(stockItemId);
  db.prepare(`
    INSERT INTO account_replacement_history (
      report_id, stock_item_id, order_number, user_id,
      old_email, old_password, old_profiles, old_email_access,
      new_email, new_password, new_profiles, new_email_access,
      admin_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    meta.reportId || null,
    stockItemId,
    meta.orderNumber || null,
    meta.userId || null,
    before.email,
    before.password,
    JSON.stringify(before.profiles),
    JSON.stringify(before.emailAccess),
    after.email,
    after.password,
    JSON.stringify(after.profiles),
    JSON.stringify(after.emailAccess),
    meta.adminUserId || null
  );

  return after;
}

function createUserNotification(userId, type, title, body) {
  if (!userId) return;
  const user = db.prepare('SELECT notify_orders FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const kind = type || 'system';
  if (kind === 'order' && !user.notify_orders) return;
  db.prepare(`
    INSERT INTO user_notifications (user_id, type, title, body, is_read)
    VALUES (?, ?, ?, ?, 0)
  `).run(userId, kind, title, body || '');
}

function buyerNoteFromResolveFields(fields) {
  const { rejectReason, adminNotes, resolution } = fields;
  return String(rejectReason || adminNotes || resolution || '').trim();
}

function resolveReportsForStock(stockItemId, fields) {
  const { resolution, resolutionAction, adminNotes, stockDescription, rejectReason } = fields;
  const buyerNote = buyerNoteFromResolveFields(fields);
  const reports = db.prepare(`
    SELECT id FROM product_reports WHERE stock_item_id = ? AND status = 'active'
  `).all(stockItemId);
  const upd = db.prepare(`
    UPDATE product_reports SET
      status = 'resolved',
      resolution = ?,
      resolution_action = ?,
      admin_notes = ?,
      admin_note = CASE WHEN ? != '' THEN ? ELSE admin_note END,
      stock_description = ?,
      reject_reason = ?,
      resolved_at = datetime('now')
    WHERE id = ?
  `);
  for (const r of reports) {
    upd.run(
      resolution || '',
      resolutionAction || null,
      adminNotes || null,
      buyerNote,
      buyerNote,
      stockDescription || null,
      rejectReason || null,
      r.id
    );
  }
  return reports.map((r) => r.id);
}

function resolveSingleReport(reportId, fields) {
  const { resolution, resolutionAction, adminNotes, stockDescription, rejectReason } = fields;
  const buyerNote = buyerNoteFromResolveFields(fields);
  db.prepare(`
    UPDATE product_reports SET
      status = 'resolved',
      resolution = ?,
      resolution_action = ?,
      admin_notes = ?,
      admin_note = CASE WHEN ? != '' THEN ? ELSE admin_note END,
      stock_description = ?,
      reject_reason = ?,
      resolved_at = datetime('now')
    WHERE id = ?
  `).run(
    resolution || '',
    resolutionAction || null,
    adminNotes || null,
    buyerNote,
    buyerNote,
    stockDescription || null,
    rejectReason || null,
    reportId
  );
}

function countPreOrders(userId, email) {
  const emailLower = String(email || '').toLowerCase();
  return db.prepare(`
    SELECT COUNT(DISTINCT o.id) AS c FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?))
      AND o.status = 'approved'
      AND (SELECT COUNT(*) FROM order_fulfillments f WHERE f.order_item_id = oi.id) < oi.quantity
  `).get(userId, emailLower).c;
}

function getUserOrderStats(userId, email) {
  const emailLower = String(email || '').toLowerCase();
  const row = db.prepare(`
    SELECT
      (SELECT wallet_balance FROM users WHERE id = ?) AS balance,
      (SELECT COUNT(*) FROM orders o
        WHERE (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?)) AND o.status = 'approved') AS totalOrders,
      (SELECT COALESCE(SUM(o.total), 0) FROM orders o
        WHERE (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?)) AND o.status = 'approved') AS totalSpent,
      (SELECT COUNT(*) FROM product_reports WHERE user_id = ? OR LOWER(email) = ?) AS reports,
      (SELECT COALESCE(SUM(o.total), 0) FROM orders o
        WHERE (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?)) AND o.status = 'refunded') AS refundsReceived,
      (SELECT COUNT(*) FROM order_fulfillments f
        JOIN orders o ON o.id = f.order_id
        WHERE o.status = 'approved'
          AND (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?))) AS accountCount
  `).get(
    userId, userId, emailLower, userId, emailLower,
    userId, emailLower, userId, emailLower, userId, emailLower
  );
  return {
    balance: row?.balance || 0,
    totalOrders: row?.totalOrders || 0,
    totalSpent: row?.totalSpent || 0,
    preOrders: countPreOrders(userId, email),
    reports: row?.reports || 0,
    refundsReceived: row?.refundsReceived || 0,
    accountCount: row?.accountCount || 0
  };
}

function buildOrdersList(userId, email) {
  const emailLower = String(email || '').toLowerCase();
  const rows = db.prepare(`
    SELECT o.id, o.order_number AS orderNumber, o.order_seq AS orderId, o.status, o.total, o.subtotal,
           o.discount, o.created_at AS createdAt, pm.name AS paymentMethod, o.receipt_url AS receiptUrl,
           o.tingi_drop_enabled AS tingiDropEnabled, o.fulfillment_mode AS fulfillmentMode,
           o.buyer_name AS buyerName, u.name AS userName, o.reject_reason AS rejectReason
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?)
    ORDER BY datetime(o.created_at) DESC
  `).all(userId, emailLower);

  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');

  const allItems = db.prepare(`
    SELECT order_id AS orderId, product_id AS productId, variant_id AS variantId,
           product_name AS name, quantity, price
    FROM order_items WHERE order_id IN (${ph})
  `).all(...ids);

  const itemsByOrder = {};
  for (const item of allItems) {
    const oid = item.orderId;
    if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
    itemsByOrder[oid].push({
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      quantity: item.quantity,
      price: item.price
    });
  }

  const fulfillCounts = db.prepare(`
    SELECT order_id AS orderId, COUNT(*) AS c
    FROM order_fulfillments WHERE order_id IN (${ph}) GROUP BY order_id
  `).all(...ids);
  const fcMap = Object.fromEntries(fulfillCounts.map((r) => [r.orderId, r.c]));

  return rows.map((order) => {
    const items = itemsByOrder[order.id] || [];
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
    const fulfilled = fcMap[order.id] || 0;
    const remaining = Math.max(0, totalQuantity - fulfilled);
    return {
      ...order,
      items,
      accountCount: fulfilled,
      totalQuantity,
      fulfillmentExpected: totalQuantity,
      fulfillmentClaimed: fulfilled,
      fulfillmentRemaining: remaining,
      canClaimStock: isApprovedOrderStatus(order.status)
        && order.fulfillmentMode === 'manual'
        && remaining > 0,
      tingiDropEnabled: !!order.tingiDropEnabled,
      displayId: order.orderId != null ? String(order.orderId) : order.orderNumber,
      buyerName: order.buyerName || order.userName || (order.email ? order.email.split('@')[0] : 'Guest')
    };
  });
}

function batchOrderItemsByNumber(orderNumbers) {
  if (!orderNumbers.length) return {};
  const ph = orderNumbers.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT o.order_number AS orderNumber, oi.product_name AS name, oi.quantity, oi.price
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.order_number IN (${ph})
  `).all(...orderNumbers);
  const map = {};
  for (const r of rows) {
    if (!map[r.orderNumber]) map[r.orderNumber] = [];
    map[r.orderNumber].push({ name: r.name, quantity: r.quantity, price: r.price });
  }
  return map;
}

function backfillPaidOrderFulfillments() {
  const paid = db.prepare("SELECT id FROM orders WHERE status = 'approved'").all();
  for (const o of paid) {
    const has = db.prepare('SELECT COUNT(*) AS c FROM order_fulfillments WHERE order_id = ?').get(o.id).c;
    if (!has) {
      try { fulfillOrder(o.id); } catch (_) { /* ignore */ }
    }
  }
}

function backfillNonTingiPaidOrders() {
  const orders = db.prepare(`
    SELECT id FROM orders
    WHERE status = 'approved' AND tingi_drop_enabled = 0
  `).all();
  for (const o of orders) {
    const summary = orderFulfillmentSummary(o.id);
    if (summary.remaining <= 0) continue;
    db.prepare('UPDATE orders SET fulfillment_mode = ?, tingi_hold_until = NULL WHERE id = ?')
      .run('auto', o.id);
    try { fulfillOrderRemaining(o.id); } catch (_) { /* ignore */ }
  }
}

backfillPaidOrderFulfillments();
backfillNonTingiPaidOrders();

function markOrderApprovedAndFulfill(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return { error: 'Order not found' };
  if (isApprovedOrderStatus(order.status)) return { ok: true, alreadyApproved: true };
  if (isRejectedOrderStatus(order.status) || order.status === ORDER_STATUS.REFUNDED) {
    return { error: 'This order can no longer be approved' };
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(ORDER_STATUS.APPROVED, orderId);

  const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(orderId);
  const bumpSold = db.prepare('UPDATE products SET sold_count = sold_count + ? WHERE id = ?');
  for (const item of items) {
    bumpSold.run(item.quantity, item.product_id);
  }

  const fullOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (fullOrder.tingi_drop_enabled) {
    setTingiHoldUntil(orderId);
  } else {
    if (fullOrder.fulfillment_mode === 'manual') {
      db.prepare('UPDATE orders SET fulfillment_mode = ?, tingi_hold_until = NULL WHERE id = ?')
        .run('auto', orderId);
    }
    fulfillOrderRemaining(orderId);
  }
  processExpiredTingiHolds();
  return { ok: true };
}

function orderItemFulfillmentRemaining(orderItemId, quantity) {
  const fulfilled = db.prepare(
    'SELECT COUNT(*) AS c FROM order_fulfillments WHERE order_item_id = ?'
  ).get(orderItemId).c;
  return Math.max(0, Number(quantity) - fulfilled);
}

function lineItemStockStatus(productId, variantId, quantity) {
  const qty = Math.max(1, Number(quantity) || 1);
  let available = 0;
  if (variantId) {
    available = db.prepare(
      "SELECT COUNT(*) AS c FROM stock_items WHERE variant_id = ? AND status='available'"
    ).get(variantId).c;
  } else {
    available = db.prepare(
      "SELECT COUNT(*) AS c FROM stock_items WHERE product_id = ? AND status='available'"
    ).get(productId).c;
  }
  if (available >= qty) {
    return { state: 'available', label: 'Available' };
  }
  return { state: 'preorder', label: 'Preorder' };
}

function lineItemStockStatusForOrder(orderStatus, orderItemId, productId, variantId, quantity) {
  let qtyNeeded = Math.max(1, Number(quantity) || 1);
  if (isApprovedOrderStatus(orderStatus)) {
    qtyNeeded = orderItemFulfillmentRemaining(orderItemId, quantity);
    if (qtyNeeded <= 0) return { state: 'dropped', label: null };
  }
  return lineItemStockStatus(productId, variantId, qtyNeeded);
}

function orderItemsStockStatus(orderId, orderStatus) {
  const items = db.prepare(
    'SELECT id, product_id, variant_id, quantity FROM order_items WHERE order_id = ?'
  ).all(orderId);
  if (!items.length) return { state: 'available', label: null };

  if (isApprovedOrderStatus(orderStatus)) {
    let anyRemaining = false;
    for (const item of items) {
      const remaining = orderItemFulfillmentRemaining(item.id, item.quantity);
      if (remaining <= 0) continue;
      anyRemaining = true;
      const status = lineItemStockStatus(item.product_id, item.variant_id, remaining);
      if (status.state === 'preorder') return status;
    }
    if (!anyRemaining) return { state: 'dropped', label: null };
    return { state: 'available', label: 'Available' };
  }

  for (const item of items) {
    const status = lineItemStockStatus(item.product_id, item.variant_id, item.quantity);
    if (status.state === 'preorder') return status;
  }
  return { state: 'available', label: 'Available' };
}

// Derive availability for a specific variant (or whole product when variantId is null).
function variantAvailability(product, variantId) {
  let stock;
  if (variantId) {
    stock = db.prepare(
      "SELECT COUNT(*) AS c FROM stock_items WHERE variant_id = ? AND status='available'"
    ).get(variantId).c;
  } else {
    stock = db.prepare(
      "SELECT COUNT(*) AS c FROM stock_items WHERE product_id = ? AND status='available'"
    ).get(product.id).c;
  }
  let state; let label;
  if (String(product.status || '').toUpperCase() === 'COMING SOON') {
    state = 'coming_soon'; label = 'Coming Soon';
  } else if (stock > 0) {
    state = 'available'; label = 'Available';
  } else if (product.allow_pre_order) {
    state = 'preorder'; label = 'Preorder';
  } else {
    state = 'sold_out'; label = 'Sold Out';
  }
  return { stock, state, label };
}

function productAvailability(product) {
  return variantAvailability(product, null);
}

// Attach stock + availability label to a product row for the storefront
function withAvailability(product) {
  const a = productAvailability(product);
  const listingStockState = a.stock > 0 ? 'available' : 'preorder';
  const listingStockLabel = a.stock > 0 ? 'Available' : 'Preorder';
  return {
    ...product,
    stock: a.stock,
    availability: a.label,
    availability_state: a.state,
    listingStockState,
    listingStockLabel
  };
}

function withPlanListing(product) {
  const base = withAvailability(product);
  const variants = getVariants(product.id).map((v) => {
    const a = variantAvailability(product, v.id);
    const displayPrice = lowestUnitPrice(product.id, v.id, v.price);
    return {
      id: v.id,
      name: v.name,
      duration: v.duration,
      price: v.price,
      displayPrice,
      description: v.description,
      availability: a.label,
      availability_state: a.state
    };
  });
  const prices = variants.length
    ? variants.map((v) => v.displayPrice ?? v.price)
    : [lowestUnitPrice(product.id, null, base.price)];
  return {
    ...base,
    variants,
    variantCount: variants.length,
    startingPrice: prices.length ? Math.min(...prices) : 0
  };
}

app.get('/products', (req, res) => {
  const { search, category } = req.query;
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  if (category && category.toLowerCase() !== 'all') {
    query += ' AND LOWER(category) = LOWER(?)';
    params.push(category);
  }

  if (search) {
    query += ' AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ?)';
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term);
  }

  query += ' ORDER BY id ASC';
  if (!search && (!category || String(category).toLowerCase() === 'all')) {
    res.set('Cache-Control', 'public, max-age=30');
  }
  const products = db.prepare(query).all(...params).map(withPlanListing);
  res.json(products);
});

app.get('/categories', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(db.prepare('SELECT id, name, slug FROM categories ORDER BY sort_order ASC, name ASC').all());
});

app.get('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const a = productAvailability(product);
  product.stock = a.stock;
  product.availability = a.label;
  product.availability_state = a.state;
  const rows = db.prepare(
    'SELECT id, name, duration, price, description, bulk_pricing_enabled AS bulkPricingEnabled, bulk_tiers AS bulkTiers FROM product_variants WHERE product_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(product.id);
  product.variants = rows.map((v) => {
    const va = variantAvailability(product, v.id);
    const displayPrice = lowestUnitPrice(product.id, v.id, v.price);
    return {
      ...v,
      bulkTiers: parseBulkTiers(v.bulkTiers),
      displayPrice,
      availability: va.label,
      availability_state: va.state
    };
  });
  product.bulkPricingEnabled = !!product.bulk_pricing_enabled;
  product.bulkTiers = parseBulkTiers(product.bulk_tiers);
  product.displayPrice = lowestUnitPrice(product.id, null, product.price);
  res.json(product);
});

app.post('/products/:id/view', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Valid id is required' });

  db.prepare('UPDATE products SET views = views + 1 WHERE id = ?').run(id);
  const row = db.prepare('SELECT views FROM products WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Product not found' });

  res.json({ views: row.views });
});

app.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const strengthErr = passwordStrengthError(password);
  if (strengthErr) return res.status(400).json({ error: strengthErr });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (email, password_hash, name)
    VALUES (?, ?, ?)
  `).run(email.toLowerCase(), passwordHash, name.trim());

  req.session.userId = result.lastInsertRowid;
  mergeGuestCartIntoUser(req.session, req.session.userId);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  startUserSession(req, user);

  res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin },
    cart: getCartPayload(req)
  });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.suspended) {
    return res.status(403).json({ error: 'Account suspended' });
  }

  startUserSession(req, user);
  mergeGuestCartIntoUser(req.session, user.id);

  res.json({
    user: { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin },
    cart: getCartPayload(req)
  });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  const user = db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?')
    .get(req.session.userId);

  if (!user) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }

  res.json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin } });
});

app.get('/cart', (req, res) => {
  res.json(getCartPayload(req));
});

app.post('/cart', (req, res) => {
  const productId = Number(req.body.productId);
  const quantity = Number(req.body.quantity) || 1;
  const variantId = req.body.variantId != null ? Number(req.body.variantId) : null;

  if (!productId || quantity < 1) {
    return res.status(400).json({ error: 'Valid productId is required' });
  }

  const added = addToCart(req, productId, quantity, variantId);
  if (!added) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json(getCartPayload(req));
});

app.delete('/cart/:productId', (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId) {
    return res.status(400).json({ error: 'Valid productId is required' });
  }

  removeFromCart(req, productId);
  res.json(getCartPayload(req));
});

app.put('/cart/:productId', (req, res) => {
  const productId = Number(req.params.productId);
  const quantity = Number(req.body.quantity);

  if (!productId || !quantity || quantity < 1) {
    return res.status(400).json({ error: 'Valid productId and quantity are required' });
  }

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const cart = getCartPayload(req);
  const inCart = cart.items.find((item) => item.productId === productId);
  if (!inCart) {
    return res.status(404).json({ error: 'Item not in cart' });
  }

  setCartQuantity(req, productId, quantity);
  res.json(getCartPayload(req));
});

app.get('/faqs', (req, res) => {
  res.set('Cache-Control', 'public, max-age=120');
  const faqs = db.prepare('SELECT id, question, answer FROM faqs ORDER BY sort_order ASC').all();
  res.json(faqs);
});

app.get('/guide', (req, res) => {
  res.set('Cache-Control', 'public, max-age=120');
  try {
    const raw = getSetting('order_guide_steps', '[]');
    const steps = JSON.parse(raw);
    if (!Array.isArray(steps)) {
      return res.status(500).json({ error: 'Invalid guide data' });
    }
    res.json(steps);
  } catch (_) {
    res.status(500).json({ error: 'Could not load guide' });
  }
});

app.get('/contact', (req, res) => {
  const channels = db.prepare(`
    SELECT id, icon, title, description, link_text, link_url
    FROM contact_channels ORDER BY sort_order ASC
  `).all();
  res.json(channels);
});

app.get('/terms', (req, res) => {
  const sections = db.prepare(`
    SELECT id, title, body FROM terms_sections ORDER BY sort_order ASC
  `).all();
  res.json(sections);
});

app.get('/privacy', (req, res) => {
  const sections = db.prepare(`
    SELECT id, title, body FROM privacy_sections ORDER BY sort_order ASC
  `).all();
  res.json(sections);
});

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = db.prepare('SELECT id, email, name, is_admin FROM users WHERE id = ?')
    .get(req.session.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.adminUser = user;
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const user = db.prepare(`
    SELECT id, email, name, session_version, suspended FROM users WHERE id = ?
  `).get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (user.suspended) {
    return res.status(403).json({ error: 'Account suspended' });
  }
  const sessionVer = req.session.sessionVersion ?? 0;
  if (sessionVer !== (user.session_version ?? 0)) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.authUser = user;
  next();
}

function parseSocialLinks(raw) {
  try { return JSON.parse(raw || '{}'); } catch (_) { return {}; }
}

function maskIp(ip) {
  if (!ip) return '';
  const parts = String(ip).replace('::ffff:', '').split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  return String(ip).slice(0, 12) + '…';
}

function passwordStrengthError(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Za-z]/.test(password)) return 'Password must include at least one letter';
  if (!/\d/.test(password)) return 'Password must include at least one number';
  return null;
}

function recordLogin(req, userId) {
  const ip = req.ip || req.headers['x-forwarded-for'] || '';
  db.prepare("UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?")
    .run(String(ip).slice(0, 64), userId);
}

function startUserSession(req, user) {
  req.session.userId = user.id;
  req.session.sessionVersion = user.session_version ?? 0;
  recordLogin(req, user.id);
}

function formatUserSettings(userId) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  const social = parseSocialLinks(row.social_links);
  const stats = getUserOrderStats(userId, row.email);

  return {
    profile: {
      id: row.id,
      name: row.name,
      username: row.username || '',
      email: row.email,
      phone: row.phone || '',
      avatarUrl: row.avatar_url || '',
      country: row.country || '',
      timezone: row.timezone || '',
      createdAt: row.created_at
    },
    security: {
      lastLoginAt: row.last_login_at || null,
      lastLoginIp: row.last_login_ip ? maskIp(row.last_login_ip) : null
    },
    social: {
      facebook: social.facebook || '',
      instagram: social.instagram || '',
      tiktok: social.tiktok || '',
      twitter: social.twitter || '',
      youtube: social.youtube || '',
      telegram: social.telegram || '',
      discord: social.discord || ''
    },
    preferences: {
      notifyEmail: !!row.notify_email,
      notifyOrders: !!row.notify_orders,
      notifyMarketing: !!row.notify_marketing,
      language: row.language || 'en',
      darkMode: row.dark_mode || 'system'
    },
    purchase: {
      totalOrders: stats.totalOrders,
      completedOrders: stats.totalOrders,
      totalSpent: stats.totalSpent,
      accountStatus: row.suspended ? 'suspended' : 'active',
      membershipLevel: row.membership_level || 'member'
    }
  };
}

function formatUserAdminPublic(userId) {
  const row = db.prepare('SELECT id, email, name, is_admin, suspended FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  const stats = getUserOrderStats(userId, row.email);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    spent: stats.totalSpent,
    orders: stats.totalOrders,
    status: row.suspended ? 'suspended' : 'active',
    suspended: !!row.suspended,
    role: row.is_admin ? 'admin' : 'buyer'
  };
}

function formatAdminUserDetail(userId) {
  const row = db.prepare(`
    SELECT id, is_admin, suspended, created_at, last_login_at, last_login_ip FROM users WHERE id = ?
  `).get(userId);
  if (!row) return null;
  const settings = formatUserSettings(userId);
  if (!settings) return null;
  return {
    ...settings,
    role: row.is_admin ? 'admin' : 'buyer',
    suspended: !!row.suspended,
    registrationDate: row.created_at,
    lastLogin: row.last_login_at,
    lastLoginIp: row.last_login_ip ? maskIp(row.last_login_ip) : null,
    totalPurchases: settings.purchase.completedOrders
  };
}

function saveAvatarFromDataUrl(userId, dataUrl) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
  if (!match) throw new Error('Invalid image format. Use PNG, JPG, or WebP.');
  const ext = match[1].replace('jpeg', 'jpg');
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 512000) throw new Error('Image must be under 500 KB');
  const filename = `user-${userId}.${ext}`;
  fs.writeFileSync(path.join(avatarsDir, filename), buf);
  return `/uploads/avatars/${filename}`;
}

app.get('/account/orders', requireAuth, (req, res) => {
  const email = req.authUser.email.toLowerCase();
  const orders = buildOrdersList(req.session.userId, email);
  res.json({
    user: {
      id: req.authUser.id,
      name: req.authUser.name,
      email: req.authUser.email
    },
    orders
  });
});

app.get('/account/dashboard', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const email = req.authUser.email.toLowerCase();
  const stats = getUserOrderStats(userId, email);
  const orders = buildOrdersList(userId, email);
  res.json({
    user: { id: userId, name: req.authUser.name, email: req.authUser.email },
    orders,
    stats: {
      balance: stats.balance,
      totalOrders: stats.totalOrders,
      totalSpent: stats.totalSpent,
      preOrders: stats.preOrders,
      reports: stats.reports,
      refundsReceived: stats.refundsReceived,
      accountCount: stats.accountCount
    }
  });
});

app.get('/account/orders/:orderNumber/credentials', requireAuth, (req, res) => {
  const result = getOrderCredentialsForUser(
    req.params.orderNumber,
    req.session.userId,
    req.authUser.email
  );
  if (result.error === 'not_found') return res.status(404).json({ error: 'Order not found' });
  if (result.error === 'forbidden') return res.status(403).json({ error: 'Access denied' });
  res.json(result);
});

app.get('/account/report-targets', requireAuth, (req, res) => {
  const targets = listReportTargetsForUser(
    req.session.userId,
    req.authUser.email,
    req.query.orderNumber || null
  );
  res.json({ targets });
});

app.get('/account/orders/:orderNumber/report-targets', requireAuth, (req, res) => {
  const result = getOrderCredentialsForUser(
    req.params.orderNumber,
    req.session.userId,
    req.authUser.email
  );
  if (result.error === 'not_found') return res.status(404).json({ error: 'Order not found' });
  if (result.error === 'forbidden') return res.status(403).json({ error: 'Access denied' });
  const targets = listReportTargetsForUser(
    req.session.userId,
    req.authUser.email,
    result.orderNumber
  );
  res.json({ orderNumber: result.orderNumber, targets });
});

app.get('/account/summary', requireAuth, (req, res) => {
  const stats = getUserOrderStats(req.session.userId, req.authUser.email);
  res.json({
    balance: stats.balance,
    totalOrders: stats.totalOrders,
    totalSpent: stats.totalSpent,
    preOrders: stats.preOrders,
    accounts: stats.accountCount
  });
});

app.get('/account/purchases', requireAuth, (req, res) => {
  res.json({
    accounts: getUserPurchasedAccounts(req.session.userId, req.authUser.email)
  });
});

app.post('/account/orders/:orderNumber/claim', requireAuth, (req, res) => {
  processExpiredTingiHolds();
  const order = findOrderByRef(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!userOwnsOrder(order, req.session.userId, req.authUser.email)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const result = claimOneStockForOrder(order.id);
  if (result.error) return res.status(400).json({ error: result.error });

  createUserNotification(
    req.session.userId,
    'order',
    'Stock delivered',
    `1 account from order #${order.order_number} has been delivered. Check My Purchases for credentials.`
  );

  const credentials = getOrderCredentialsForUser(order.order_number, req.session.userId, req.authUser.email);
  res.json({
    ok: true,
    stockItemId: result.stockItemId,
    summary: result.summary,
    order: formatOrder(order.order_number),
    credentials: credentials.error ? null : credentials
  });
});

app.get('/account/wallet', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const email = req.authUser.email.toLowerCase();
  const stats = getUserOrderStats(userId, email);

  const purchasedOrders = db.prepare(`
    SELECT o.order_number AS orderNumber, o.status, o.total, o.subtotal, o.discount,
           o.created_at AS createdAt, pm.name AS paymentMethod
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id
    WHERE (o.user_id = ? OR (o.user_id IS NULL AND LOWER(o.email) = ?))
      AND o.status IN ('approved', 'refunded')
    ORDER BY datetime(o.created_at) DESC
  `).all(userId, email);

  const itemsMap = batchOrderItemsByNumber(purchasedOrders.map((o) => o.orderNumber));

  const topUps = db.prepare(`
    SELECT id, type, amount, order_number AS orderNumber, description, created_at AS createdAt
    FROM wallet_transactions WHERE user_id = ?
    ORDER BY id DESC LIMIT 100
  `).all(userId);

  res.json({
    stats: {
      balance: stats.balance,
      totalOrders: stats.totalOrders,
      preOrders: stats.preOrders,
      reports: stats.reports,
      refundsReceived: stats.refundsReceived
    },
    purchasedOrders: purchasedOrders.map((o) => ({
      ...o,
      items: itemsMap[o.orderNumber] || []
    })),
    topUps
  });
});

app.post('/account/email/fetch', requireAuth, async (req, res) => {
  const stockItemId = Number(req.body.stockItemId);
  if (!stockItemId) return res.status(400).json({ error: 'Please select an account' });

  if (!userOwnsStockItem(stockItemId, req.session.userId, req.authUser.email)) {
    return res.status(403).json({ error: 'Account not found' });
  }

  const account = db.prepare(`
    SELECT s.email, e.email AS accessEmail
    FROM stock_items s
    LEFT JOIN email_access_credentials e ON e.stock_item_id = s.id
    WHERE s.id = ?
  `).get(stockItemId);
  const imap = getIntegration('imap');
  if (imap.enabled === false) {
    return res.status(400).json({ error: 'Email fetcher is disabled. Contact the seller.' });
  }

  const fetchEmail = account?.accessEmail || account?.email;
  try {
    const result = await fetchLatestEmailForAccount(imap, fetchEmail);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not fetch email' });
  }
});

function submitProductReport(req, reportType) {
  const {
    orderNumber,
    name,
    issue,
    remainingDays,
    subscription,
    bankAccount,
    vouchImage,
    proofImages
  } = req.body || {};
  const issueText = String(issue || req.body.detail || '').trim();
  if (!issueText) {
    return { status: 400, error: 'Issue details are required' };
  }
  const buyerName = String(name || '').trim();
  if (!buyerName) {
    return { status: 400, error: 'Name is required' };
  }
  const remaining = String(remainingDays || '').trim();
  if (!remaining) {
    return { status: 400, error: 'Remaining days is required' };
  }
  const productLabel = String(subscription || '').trim();
  if (!productLabel) {
    return { status: 400, error: 'Subscription / product is required' };
  }
  if (reportType === 'refund' && !String(bankAccount || '').trim()) {
    return { status: 400, error: 'Bank account details are required for refund requests' };
  }

  const selectionResult = resolveReportSelections(req, reportType);
  if (selectionResult.error) {
    return { status: selectionResult.status, error: selectionResult.error };
  }
  const { selections } = selectionResult;
  const reportedItems = buildReportedItemsMeta(selections);
  if (!reportedItems.length) {
    return { status: 400, error: 'Could not resolve selected accounts' };
  }

  const vouchData = String(vouchImage || '').trim();
  const extraProofs = Array.isArray(proofImages) ? proofImages : [];
  if (!vouchData.startsWith('data:image/')) {
    return { status: 400, error: 'Vouch screenshot is required (no vouch = voided)' };
  }
  if (extraProofs.length < 1) {
    return { status: 400, error: 'Upload at least one additional proof photo (minimum 2 photos total)' };
  }
  for (const img of extraProofs) {
    if (!String(img || '').startsWith('data:image/')) {
      return { status: 400, error: 'All proof photos must be valid images' };
    }
  }

  const primary = reportedItems[0];
  const orderNum = String(orderNumber || primary.orderNumber || '').trim();
  if (!orderNum) {
    return { status: 400, error: 'Order or account is required' };
  }

  const service = productLabel;
  const reportedProfiles = reportedItems.flatMap((i) => i.profilesFlagged || []);
  const detail = [
    issueText,
    `Remaining days: ${remaining}`,
    reportType === 'refund' ? `Bank: ${String(bankAccount || '').trim()}` : '',
    `Reported items: ${reportedItems.length}`,
    'Proof: vouch screenshot + additional photos'
  ].filter(Boolean).join('\n');

  const result = db.prepare(`
    INSERT INTO product_reports (
      order_number, email, service, detail, user_id, stock_item_id,
      report_type, remaining_days, bank_account, buyer_name, proof_note,
      order_item_id, fulfillment_id, reported_items, report_quantity, reported_profiles
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderNum,
    req.authUser.email,
    service,
    detail,
    req.session.userId,
    primary.stockItemId,
    reportType,
    remaining,
    bankAccount ? String(bankAccount).trim() : null,
    buyerName,
    'Vouch + additional proof photos',
    primary.orderItemId || null,
    primary.fulfillmentId || null,
    JSON.stringify(reportedItems),
    reportedItems.length,
    JSON.stringify(reportedProfiles)
  );

  const reportId = result.lastInsertRowid;
  const vouchUrl = saveProofImageFromDataUrl(vouchData, `${reportId}-vouch`);
  const photoUrls = extraProofs
    .map((img, i) => saveProofImageFromDataUrl(img, `${reportId}-proof-${i}`))
    .filter(Boolean);

  if (!vouchUrl || photoUrls.length < 1) {
    db.prepare('DELETE FROM product_reports WHERE id = ?').run(reportId);
    return { status: 400, error: 'Could not save proof images. Please try again.' };
  }

  db.prepare('UPDATE product_reports SET proof_urls = ? WHERE id = ?').run(
    JSON.stringify({ vouch: vouchUrl, photos: photoUrls }),
    reportId
  );

  for (const sel of selections) {
    flagCredentialProfilesReported(sel.stockItemId, sel.profileIndex);
  }

  const title = reportType === 'refund'
    ? `Refund request from ${req.authUser.name}`
    : `Report from ${req.authUser.name}`;
  db.prepare('INSERT INTO admin_notifications (type, title, body, is_read) VALUES (?, ?, ?, 0)')
    .run('report', title, issueText.slice(0, 200));

  const message = reportType === 'refund'
    ? 'Refund report submitted successfully!'
    : 'Report submitted successfully!';
  return { reportId, message, adminNote: '' };
}

app.post('/reports', requireAuth, (req, res) => {
  const out = submitProductReport(req, 'report');
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.status(201).json({
    id: out.reportId,
    ok: true,
    message: out.message,
    adminNote: out.adminNote || ''
  });
});

app.post('/refunds', requireAuth, (req, res) => {
  const out = submitProductReport(req, 'refund');
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.status(201).json({
    id: out.reportId,
    ok: true,
    message: out.message,
    adminNote: out.adminNote || ''
  });
});

app.post('/account/reports', requireAuth, (req, res) => {
  const out = submitProductReport(req, 'report');
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.status(201).json({ id: out.reportId, ok: true, message: out.message, adminNote: out.adminNote || '' });
});

app.post('/refund-report', requireAuth, (req, res) => {
  const out = submitProductReport(req, 'refund');
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.status(201).json({ id: out.reportId, ok: true, message: out.message, adminNote: out.adminNote || '' });
});

app.get('/account/reports', requireAuth, (req, res) => {
  const params = [req.session.userId, req.authUser.email.toLowerCase()];
  let query = `
    SELECT r.* FROM product_reports r
    WHERE r.user_id = ? OR LOWER(r.email) = ?
  `;
  if (req.query.orderNumber) {
    query += ' AND r.order_number = ?';
    params.push(String(req.query.orderNumber).trim());
  }
  query += ' ORDER BY r.id DESC LIMIT 100';
  res.json({
    reports: db.prepare(query).all(...params).map(formatBuyerReportRow)
  });
});

app.get('/account/notifications', requireAuth, (req, res) => {
  const list = db.prepare(`
    SELECT id, type, title, body, is_read AS isRead, created_at AS createdAt
    FROM user_notifications WHERE user_id = ?
    ORDER BY id DESC LIMIT 50
  `).all(req.session.userId);
  const unread = db.prepare(`
    SELECT COUNT(*) AS c FROM user_notifications WHERE user_id = ? AND is_read = 0
  `).get(req.session.userId).c;
  res.json({ unread, notifications: list });
});

app.post('/account/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE user_notifications SET is_read = 1 WHERE user_id = ?').run(req.session.userId);
  res.json({ ok: true });
});

app.get('/account/settings', requireAuth, (req, res) => {
  const settings = formatUserSettings(req.session.userId);
  if (!settings) return res.status(404).json({ error: 'User not found' });
  res.json(settings);
});

app.put('/account/settings/profile', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { name, username, email, phone, country, timezone, avatarDataUrl, removeAvatar } = req.body || {};
  const updates = {};

  if (name != null) {
    const n = String(name).trim();
    if (n.length < 2) return res.status(400).json({ error: 'Full name must be at least 2 characters' });
    updates.name = n;
  }
  if (username != null) {
    const u = String(username).trim().replace(/^@/, '');
    if (u && !/^[a-zA-Z0-9_]{3,24}$/.test(u)) {
      return res.status(400).json({ error: 'Username must be 3–24 letters, numbers, or underscores' });
    }
    if (u) {
      const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(u, userId);
      if (taken) return res.status(409).json({ error: 'Username already taken' });
    }
    updates.username = u || null;
  }
  if (email != null) {
    const e = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(e, userId);
    if (taken) return res.status(409).json({ error: 'Email already in use' });
    updates.email = e;
  }
  if (phone != null) updates.phone = String(phone).trim().slice(0, 32);
  if (country != null) updates.country = String(country).trim().slice(0, 64);
  if (timezone != null) updates.timezone = String(timezone).trim().slice(0, 64);

  let avatarUrl = existing.avatar_url;
  if (removeAvatar) avatarUrl = '';
  if (avatarDataUrl) {
    try {
      avatarUrl = saveAvatarFromDataUrl(userId, avatarDataUrl);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  if (removeAvatar || avatarDataUrl) updates.avatar_url = avatarUrl;

  const fields = Object.keys(updates);
  if (!fields.length) return res.json(formatUserSettings(userId));

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...fields.map((f) => updates[f]), userId);
  res.json(formatUserSettings(userId));
});

app.put('/account/settings/social', requireAuth, (req, res) => {
  const social = {
    facebook: String(req.body.facebook || '').trim().slice(0, 200),
    instagram: String(req.body.instagram || '').trim().slice(0, 200),
    tiktok: String(req.body.tiktok || '').trim().slice(0, 200),
    twitter: String(req.body.twitter || '').trim().slice(0, 200),
    youtube: String(req.body.youtube || '').trim().slice(0, 200),
    telegram: String(req.body.telegram || '').trim().slice(0, 200),
    discord: String(req.body.discord || '').trim().slice(0, 200)
  };
  db.prepare('UPDATE users SET social_links = ? WHERE id = ?')
    .run(JSON.stringify(social), req.session.userId);
  res.json(formatUserSettings(req.session.userId));
});

app.put('/account/settings/preferences', requireAuth, (req, res) => {
  const { notifyEmail, notifyOrders, notifyMarketing, language, darkMode } = req.body || {};
  const user = db.prepare('SELECT notify_email, notify_orders, notify_marketing, language, dark_mode FROM users WHERE id = ?')
    .get(req.session.userId);
  const langs = ['en', 'fil', 'es'];
  const modes = ['system', 'light', 'dark'];
  db.prepare(`
    UPDATE users SET
      notify_email = ?,
      notify_orders = ?,
      notify_marketing = ?,
      language = ?,
      dark_mode = ?
    WHERE id = ?
  `).run(
    notifyEmail != null ? (notifyEmail ? 1 : 0) : user.notify_email,
    notifyOrders != null ? (notifyOrders ? 1 : 0) : user.notify_orders,
    notifyMarketing != null ? (notifyMarketing ? 1 : 0) : user.notify_marketing,
    langs.includes(language) ? language : user.language,
    modes.includes(darkMode) ? darkMode : user.dark_mode,
    req.session.userId
  );
  res.json(formatUserSettings(req.session.userId));
});

app.post('/account/settings/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'All password fields are required' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New passwords do not match' });
  }
  const strengthErr = passwordStrengthError(newPassword);
  if (strengthErr) return res.status(400).json({ error: strengthErr });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), req.session.userId);
  const updated = db.prepare('SELECT session_version FROM users WHERE id = ?').get(req.session.userId);
  req.session.sessionVersion = updated.session_version;
  res.json({ ok: true, message: 'Password updated. Other devices have been logged out.' });
});

app.post('/account/settings/logout-all', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?')
    .run(req.session.userId);
  const updated = db.prepare('SELECT session_version FROM users WHERE id = ?').get(req.session.userId);
  req.session.sessionVersion = updated.session_version;
  res.json({ ok: true, message: 'Logged out from all other devices.' });
});

app.post('/account/support/ticket', requireAuth, (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!subject || !body) {
    return res.status(400).json({ error: 'Subject and message are required' });
  }
  const result = db.prepare(`
    INSERT INTO support_tickets (user_id, subject, body) VALUES (?, ?, ?)
  `).run(req.session.userId, subject.slice(0, 120), body.slice(0, 4000));

  const ticketId = result.lastInsertRowid;
  db.prepare('INSERT INTO admin_notifications (type, title, body, is_read) VALUES (?, ?, ?, 0)')
    .run('ticket', `Support ticket from ${req.authUser.name}`, `Ticket #${ticketId}: ${subject.slice(0, 180)}`);

  res.status(201).json({ id: ticketId, ok: true });
});

function getOrCreateSellerThread(user) {
  let thread = db.prepare('SELECT * FROM dm_threads WHERE user_id = ?').get(user.id);
  if (!thread) {
    const result = db.prepare(
      'INSERT INTO dm_threads (user_id, customer_name, last_message) VALUES (?, ?, ?)'
    ).run(user.id, user.name, '');
    thread = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(result.lastInsertRowid);
  } else if (thread.customer_name !== user.name) {
    db.prepare('UPDATE dm_threads SET customer_name = ? WHERE id = ?').run(user.name, thread.id);
    thread.customer_name = user.name;
  }
  return thread;
}

const CHAT_SELLER_WELCOME_DEFAULT = 'Hi! Thanks for messaging loveriette. Leave your message here and our team will reply as soon as possible. For warranty claims, check Vouch Seller in the sidebar first.';
const CHAT_SELLER_AUTO_REPLY_DEFAULT = 'Thanks for your message! Our team has been notified and will reply here shortly.';

function getChatSellerBotSettings() {
  try {
    const d = JSON.parse(getSetting('integration_chat_seller', '{}'));
    return {
      enabled: d.enabled == null ? true : !!d.enabled,
      welcome: String(d.welcome || CHAT_SELLER_WELCOME_DEFAULT).trim(),
      autoReply: String(d.autoReply || CHAT_SELLER_AUTO_REPLY_DEFAULT).trim()
    };
  } catch (_) {
    return {
      enabled: true,
      welcome: CHAT_SELLER_WELCOME_DEFAULT,
      autoReply: CHAT_SELLER_AUTO_REPLY_DEFAULT
    };
  }
}

function insertSellerChatAdminMessage(threadId, body) {
  const text = String(body || '').trim().slice(0, 2000);
  if (!text) return;
  db.prepare('INSERT INTO dm_messages (thread_id, sender, body) VALUES (?, ?, ?)')
    .run(threadId, 'admin', text);
  db.prepare("UPDATE dm_threads SET last_message = ?, updated_at = datetime('now') WHERE id = ?")
    .run(text.slice(0, 200), threadId);
}

function seedSellerChatWelcome(threadId) {
  const settings = getChatSellerBotSettings();
  if (!settings.enabled || !settings.welcome) return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM dm_messages WHERE thread_id = ?').get(threadId).c;
  if (count > 0) return;
  insertSellerChatAdminMessage(threadId, settings.welcome);
}

function maybeSellerChatAutoReply(threadId) {
  const settings = getChatSellerBotSettings();
  if (!settings.enabled || !settings.autoReply) return;
  const last = db.prepare(
    'SELECT sender FROM dm_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1'
  ).get(threadId);
  if (!last || last.sender !== 'customer') return;
  insertSellerChatAdminMessage(threadId, settings.autoReply);
}

app.get('/account/seller-chat', requireAuth, (req, res) => {
  const thread = getOrCreateSellerThread(req.authUser);
  seedSellerChatWelcome(thread.id);
  const since = Number(req.query.since) || 0;
  let messages;
  if (since > 0) {
    messages = db.prepare(
      'SELECT id, sender, body, created_at AS createdAt FROM dm_messages WHERE thread_id = ? AND id > ? ORDER BY id ASC'
    ).all(thread.id, since);
  } else {
    messages = db.prepare(
      'SELECT id, sender, body, created_at AS createdAt FROM dm_messages WHERE thread_id = ? ORDER BY id ASC'
    ).all(thread.id);
  }
  res.json({ thread: { id: thread.id, customerName: thread.customer_name }, messages });
});

app.post('/account/seller-chat', requireAuth, (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message is required' });

  const thread = getOrCreateSellerThread(req.authUser);
  db.prepare('INSERT INTO dm_messages (thread_id, sender, body) VALUES (?, ?, ?)')
    .run(thread.id, 'customer', body);
  db.prepare("UPDATE dm_threads SET last_message = ?, updated_at = datetime('now') WHERE id = ?")
    .run(body, thread.id);

  db.prepare('INSERT INTO admin_notifications (type, title, body, is_read) VALUES (?, ?, ?, 0)')
    .run('message', `Message from ${req.authUser.name}`, body.slice(0, 200));

  maybeSellerChatAutoReply(thread.id);

  const messages = db.prepare(
    'SELECT id, sender, body, created_at AS createdAt FROM dm_messages WHERE thread_id = ? ORDER BY id ASC'
  ).all(thread.id);
  res.json({ thread: { id: thread.id, customerName: req.authUser.name }, messages });
});

app.get('/admin/me', requireAdmin, (req, res) => {
  res.json({ admin: { id: req.adminUser.id, email: req.adminUser.email, name: req.adminUser.name } });
});

app.get('/admin/stats', requireAdmin, (req, res) => {
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const pendingCount = db.prepare(
    "SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending_payment', 'pending')"
  ).get().c;
  const paidCount = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'approved'").get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(total), 0) AS s FROM orders WHERE status = 'approved'").get().s;
  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  res.json({ orderCount, pendingCount, paidCount, revenue, productCount });
});

app.get('/admin/overview', requireAdmin, (req, res) => {
  const sum = (sql, ...params) => db.prepare(sql).get(...params);

  const netSales = sum("SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE status = 'approved'").v;
  const estCost = sum(`
    SELECT COALESCE(SUM(p.cost * oi.quantity), 0) AS v
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'approved'
  `).v;
  const refundTotal = sum("SELECT COALESCE(SUM(total), 0) AS v FROM orders WHERE status = 'refunded'").v;
  const refundCount = sum("SELECT COUNT(*) AS v FROM orders WHERE status = 'refunded'").v;

  const totalOrders = sum("SELECT COUNT(*) AS v FROM orders WHERE status = 'approved'").v;
  const pending = sum("SELECT COUNT(*) AS v FROM orders WHERE status = 'pending'").v;
  const rejected = sum("SELECT COUNT(*) AS v FROM orders WHERE status = 'rejected'").v;
  const totalUsers = sum('SELECT COUNT(*) AS v FROM users WHERE is_admin = 0').v;

  const trendRows = db.prepare(`
    SELECT date(created_at) AS day, COALESCE(SUM(total), 0) AS amount
    FROM orders
    WHERE status = 'approved' AND date(created_at) >= date('now', '-29 days')
    GROUP BY day
  `).all();
  const trendMap = Object.fromEntries(trendRows.map((r) => [r.day, r.amount]));
  const salesTrend = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    salesTrend.push({ date: key, amount: trendMap[key] || 0 });
  }

  const topSellers = db.prepare(`
    SELECT oi.product_name AS name,
           COALESCE(SUM(oi.price * oi.quantity), 0) AS revenue,
           COALESCE(SUM(oi.quantity), 0) AS sold
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status = 'approved'
    GROUP BY oi.product_name
    ORDER BY revenue DESC
    LIMIT 5
  `).all();

  res.json({
    netSales,
    estCost,
    refundTotal,
    refundCount,
    netProfit: netSales - estCost - refundTotal,
    totalOrders,
    pending,
    rejected,
    totalReports: sum('SELECT COUNT(*) AS v FROM product_reports').v,
    resolvedReports: sum("SELECT COUNT(*) AS v FROM product_reports WHERE status='resolved'").v,
    totalUsers,
    salesTrend,
    topSellers
  });
});

app.get('/admin/orders', requireAdmin, (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT o.order_number AS orderNumber, o.email, o.subtotal, o.discount, o.total,
           o.status, o.created_at AS createdAt, pm.name AS paymentMethod
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id
    WHERE o.status IN ('approved', 'refunded')
      AND o.receipt_url IS NOT NULL AND TRIM(o.receipt_url) != ''
  `;
  const params = [];
  if (status && status !== 'all') {
    if (status === 'approved' || status === 'refunded') {
      query += ' AND o.status = ?';
      params.push(status);
    }
  }
  query += ' ORDER BY o.id DESC LIMIT 200';
  res.json(db.prepare(query).all(...params));
});

app.get('/admin/orders/:orderNumber', requireAdmin, (req, res) => {
  const order = formatOrder(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (isRejectedOrderStatus(order.status) || order.status === ORDER_STATUS.REFUNDED) {
    return res.json(order);
  }
  if (!isApprovedOrderStatus(order.status) && !isPendingReviewStatus(order.status)) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (isPendingReviewStatus(order.status) || isApprovedOrderStatus(order.status)) {
    if (!order.receiptUrl) {
      return res.status(404).json({ error: 'Order not found' });
    }
  }
  res.json(order);
});

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
}

// Resolve a category name into a categories row (creating it if needed). Returns {id, name}.
function resolveCategory(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  let row = db.prepare('SELECT id, name FROM categories WHERE LOWER(name) = LOWER(?)').get(clean);
  if (!row) {
    const sort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories').get().n;
    let slug = slugify(clean);
    if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) slug = `${slug}-${Date.now()}`;
    const r = db.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)').run(clean, slug, sort);
    row = { id: r.lastInsertRowid, name: clean };
  }
  return row;
}

// Replace all plans/variants for a product with the supplied array
function saveVariants(productId, variants) {
  if (!Array.isArray(variants)) return;
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
  const ins = db.prepare(`
    INSERT INTO product_variants (
      product_id, name, duration, price, cost, description, rules, sort_order,
      bulk_pricing_enabled, bulk_tiers
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  variants
    .filter((v) => v && String(v.name || '').trim())
    .forEach((v, i) => {
      const catalogText = String(v.description || v.duration || '').trim();
      ins.run(
        productId,
        String(v.name).trim(),
        catalogText,
        Number(v.price) || 0,
        Number(v.cost) || 0,
        catalogText,
        String(v.rules || '').trim(),
        i,
        (v.bulkPricingEnabled || v.bulk_pricing_enabled) ? 1 : 0,
        JSON.stringify(v.bulkTiers || v.bulk_tiers || [])
      );
    });
}

function getVariants(productId) {
  return db.prepare(`
    SELECT id, name, duration, price, cost, description, rules, sort_order,
           bulk_pricing_enabled AS bulkPricingEnabled, bulk_tiers AS bulkTiers
    FROM product_variants WHERE product_id = ? ORDER BY sort_order ASC, id ASC
  `).all(productId).map((v) => ({
    ...v,
    bulkTiers: parseBulkTiers(v.bulkTiers)
  }));
}

function batchVariantsByProductIds(productIds) {
  const map = {};
  if (!productIds.length) return map;
  const placeholders = productIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, product_id, name, duration, price, cost, description, rules, sort_order
    FROM product_variants WHERE product_id IN (${placeholders})
    ORDER BY product_id ASC, sort_order ASC, id ASC
  `).all(...productIds);
  rows.forEach((v) => {
    const { product_id, ...rest } = v;
    if (!map[product_id]) map[product_id] = [];
    map[product_id].push(rest);
  });
  return map;
}

app.get('/admin/products', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id ASC').all();
  rows.forEach((p) => { p.variants = getVariants(p.id); });
  res.json(rows);
});

app.post('/admin/products', requireAdmin, (req, res) => {
  const {
    name, description, long_description, price, status, category, warranty, cost, variants,
    allow_pre_order, icon, bulkPricingEnabled, bulk_pricing_enabled, bulkTiers, bulk_tiers
  } = req.body;
  if (!name || price == null || !category) {
    return res.status(400).json({ error: 'Name, price, and category are required' });
  }
  const cat = resolveCategory(category);
  const result = db.prepare(`
    INSERT INTO products (
      name, description, long_description, price, cost, status, category, category_id,
      warranty, allow_pre_order, icon, bulk_pricing_enabled, bulk_tiers, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    name.trim(),
    description || '',
    long_description || '',
    Number(price),
    cost != null && cost !== '' ? Number(cost) : 0,
    status || 'AVAILABLE',
    cat ? cat.name : category,
    cat ? cat.id : null,
    warranty || '30 days',
    allow_pre_order ? 1 : 0,
    String(icon || '').trim(),
    (bulkPricingEnabled || bulk_pricing_enabled) ? 1 : 0,
    JSON.stringify(bulkTiers || bulk_tiers || [])
  );
  saveVariants(result.lastInsertRowid, variants);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  product.variants = getVariants(product.id);
  res.status(201).json(product);
});

app.put('/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const { name, description, long_description, price, status, category, warranty, cost, variants, allow_pre_order, icon, bulkPricingEnabled, bulk_pricing_enabled, bulkTiers, bulk_tiers } = req.body;
  const cat = category != null ? resolveCategory(category) : null;
  const bulkEnabled = bulkPricingEnabled != null || bulk_pricing_enabled != null
    ? (bulkPricingEnabled || bulk_pricing_enabled) ? 1 : 0
    : existing.bulk_pricing_enabled;
  const bulkTierJson = bulkTiers != null || bulk_tiers != null
    ? JSON.stringify(bulkTiers || bulk_tiers || [])
    : existing.bulk_tiers;
  db.prepare(`
    UPDATE products
    SET name = ?, description = ?, long_description = ?, price = ?, cost = ?,
        status = ?, category = ?, category_id = ?, warranty = ?, allow_pre_order = ?, icon = ?,
        bulk_pricing_enabled = ?, bulk_tiers = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? existing.name,
    description ?? existing.description,
    long_description ?? existing.long_description,
    price != null ? Number(price) : existing.price,
    cost != null && cost !== '' ? Number(cost) : existing.cost,
    status ?? existing.status,
    cat ? cat.name : existing.category,
    cat ? cat.id : existing.category_id,
    warranty ?? existing.warranty,
    allow_pre_order != null ? (allow_pre_order ? 1 : 0) : existing.allow_pre_order,
    icon != null ? String(icon).trim() : existing.icon,
    bulkEnabled,
    bulkTierJson,
    id
  );
  if (variants !== undefined) saveVariants(id, variants);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  product.variants = getVariants(id);
  res.json(product);
});

app.delete('/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/admin/payment-methods', requireAdmin, (req, res) => {
  const methods = db.prepare('SELECT * FROM payment_methods ORDER BY sort_order ASC').all();
  methods.forEach((m) => { m.instructions = JSON.parse(m.instructions || '[]'); });
  res.json({
    instructionsText: getPaymentInstructionsText(),
    methods,
    maxMethods: PAYMENT_METHOD_LIMIT,
    methodCount: methods.length
  });
});

function slugifyPaymentMethodName(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'method';
  let slug = base;
  let n = 0;
  while (db.prepare('SELECT id FROM payment_methods WHERE slug = ?').get(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

app.post('/admin/payment-methods', requireAdmin, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM payment_methods').get().c;
  if (count >= PAYMENT_METHOD_LIMIT) {
    return res.status(400).json({ error: `Maximum of ${PAYMENT_METHOD_LIMIT} payment methods allowed` });
  }
  const name = String(req.body?.name || 'New payment method').trim();
  if (!name) return res.status(400).json({ error: 'Payment method name is required' });

  const slug = slugifyPaymentMethodName(name);
  const maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM payment_methods').get().m || 0;
  const result = db.prepare(`
    INSERT INTO payment_methods (name, slug, instructions, qr_image_url, is_active, sort_order, account_number)
    VALUES (?, ?, '[]', '', 1, ?, '')
  `).run(name, slug, maxSort + 1);

  const created = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(result.lastInsertRowid);
  created.instructions = [];
  res.status(201).json(created);
});

app.get('/admin/payment-settings', requireAdmin, (req, res) => {
  res.json({ instructionsText: getPaymentInstructionsText() });
});

app.put('/admin/payment-settings', requireAdmin, (req, res) => {
  const text = String(req.body?.instructionsText ?? '').trim();
  setSetting('payment_instructions_text', text || DEFAULT_PAYMENT_INSTRUCTIONS);
  res.json({ instructionsText: getPaymentInstructionsText() });
});

app.post('/admin/payment-methods/:id/qr', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Payment method not found' });
  try {
    const qrUrl = savePaymentQrImage(req.body?.dataUrl, existing.slug);
    db.prepare('UPDATE payment_methods SET qr_image_url = ? WHERE id = ?').run(qrUrl, id);
    res.json({ qrImageUrl: qrUrl });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid QR image' });
  }
});

app.get('/admin/redeem-codes', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM redeem_codes ORDER BY id ASC').all());
});

app.post('/admin/redeem-codes', requireAdmin, (req, res) => {
  const { code, discount_type, discount_value, max_uses } = req.body;
  if (!code || discount_value == null) {
    return res.status(400).json({ error: 'Code and discount value are required' });
  }
  const exists = db.prepare('SELECT id FROM redeem_codes WHERE UPPER(code) = UPPER(?)').get(code);
  if (exists) return res.status(409).json({ error: 'Code already exists' });

  const result = db.prepare(`
    INSERT INTO redeem_codes (code, discount_type, discount_value, is_active, max_uses)
    VALUES (?, ?, ?, 1, ?)
  `).run(
    code.trim().toUpperCase(),
    discount_type === 'percent' ? 'percent' : 'fixed',
    Number(discount_value),
    max_uses != null && max_uses !== '' ? Number(max_uses) : null
  );
  res.status(201).json(db.prepare('SELECT * FROM redeem_codes WHERE id = ?').get(result.lastInsertRowid));
});

app.get('/admin/contact', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT id, icon, title, description, link_text, link_url
    FROM contact_channels ORDER BY sort_order ASC
  `).all());
});

app.put('/admin/contact/:id', requireAdmin, (req, res) => {
  const { title, description, link_text, link_url } = req.body;
  const id = Number(req.params.id);

  if (!id) {
    return res.status(400).json({ error: 'Valid id is required' });
  }

  const existing = db.prepare('SELECT * FROM contact_channels WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Contact channel not found' });
  }

  db.prepare(`
    UPDATE contact_channels
    SET title = ?, description = ?, link_text = ?, link_url = ?
    WHERE id = ?
  `).run(
    title ?? existing.title,
    description ?? existing.description,
    link_text ?? existing.link_text,
    link_url ?? existing.link_url,
    id
  );

  const updated = db.prepare(`
    SELECT id, icon, title, description, link_text, link_url
    FROM contact_channels WHERE id = ?
  `).get(id);

  res.json(updated);
});

app.get('/payment-methods', (req, res) => {
  const methods = db.prepare(`
    SELECT id, name, slug, qr_image_url, account_number, sort_order
    FROM payment_methods WHERE is_active = 1
    ORDER BY sort_order ASC
  `).all();
  res.json({
    instructionsText: getPaymentInstructionsText(),
    methods: methods.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      qrImageUrl: m.qr_image_url || '',
      accountNumber: m.account_number || '',
      sortOrder: m.sort_order
    }))
  });
});

app.get('/payment-settings', (req, res) => {
  res.json({ instructionsText: getPaymentInstructionsText() });
});

app.post('/redeem/validate', (req, res) => {
  const { code, subtotal } = req.body;
  if (!code || subtotal == null) {
    return res.status(400).json({ error: 'Code and subtotal are required' });
  }
  const result = calculateDiscount(code, Number(subtotal));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post('/orders', (req, res) => {
  const { email, paymentMethodId, redeemCode, productId, variantId, quantity, tingiDrop } = req.body;

  if (!email || !paymentMethodId) {
    return res.status(400).json({ error: 'Email and payment method are required' });
  }

  const paymentMethod = db.prepare(`
    SELECT id FROM payment_methods WHERE id = ? AND is_active = 1
  `).get(paymentMethodId);

  if (!paymentMethod) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  const items = getCheckoutItems(
    req,
    productId ? Number(productId) : null,
    variantId ? Number(variantId) : null,
    quantity ? Number(quantity) : 1
  );
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'No items to checkout' });
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const tingiDropEnabled = tingiDrop === true || tingiDrop === 1 || tingiDrop === '1';
  const tingiCfg = readTingiSettings();
  if (tingiDropEnabled) {
    if (!tingiCfg.checkoutEnabled) {
      return res.status(400).json({ error: 'Tingi Drop is not available at checkout' });
    }
    if (totalQuantity < tingiCfg.minQty) {
      return res.status(400).json({ error: `Tingi Drop requires at least ${tingiCfg.minQty} units` });
    }
    if (totalQuantity > tingiCfg.maxQty) {
      return res.status(400).json({ error: `Tingi Drop allows up to ${tingiCfg.maxQty} units per order` });
    }
  }
  const fulfillmentMode = resolveFulfillmentMode(tingiDropEnabled, totalQuantity);
  let discount = 0;
  let redeemCodeId = null;

  if (redeemCode) {
    const redeem = calculateDiscount(redeemCode, subtotal);
    if (redeem.error) return res.status(400).json({ error: redeem.error });
    discount = redeem.discount;
    redeemCodeId = redeem.codeId;
  }

  const total = subtotal - discount;
  const orderSeq = nextOrderSeq();
  const orderNumber = String(orderSeq);

  db.exec('BEGIN');
  try {
    const orderResult = db.prepare(`
      INSERT INTO orders (
        order_number, order_seq, user_id, email, payment_method_id, redeem_code_id,
        subtotal, discount, total, status, tingi_drop_enabled, fulfillment_mode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)
    `).run(
      orderNumber,
      orderSeq,
      req.session.userId || null,
      email.trim().toLowerCase(),
      paymentMethodId,
      redeemCodeId,
      subtotal,
      discount,
      total,
      tingiDropEnabled ? 1 : 0,
      fulfillmentMode
    );

    const orderId = orderResult.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, variant_id, product_name, quantity, price)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(orderId, item.productId, item.variantId || null, item.name, item.quantity, item.price);
    }

    if (redeemCodeId) {
      db.prepare('UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?')
        .run(redeemCodeId);
    }

    db.exec('COMMIT');

    if (productId) {
      removeFromCart(req, Number(productId));
    } else {
      clearCart(req);
    }

    res.status(201).json(formatOrder(orderNumber));
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: 'Could not create order' });
  }
});

app.get('/orders/:orderNumber', (req, res) => {
  const order = formatOrder(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.put('/orders/:orderNumber/payment-method', (req, res) => {
  const order = findOrderByRef(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
    return res.status(400).json({ error: 'Payment method can only be changed before confirming payment' });
  }

  const paymentMethodId = Number(req.body?.paymentMethodId);
  if (!paymentMethodId) return res.status(400).json({ error: 'Payment method is required' });

  const paymentMethod = db.prepare(
    'SELECT id FROM payment_methods WHERE id = ? AND is_active = 1'
  ).get(paymentMethodId);
  if (!paymentMethod) return res.status(400).json({ error: 'Invalid payment method' });

  db.prepare('UPDATE orders SET payment_method_id = ? WHERE id = ?').run(paymentMethodId, order.id);
  res.json(formatOrder(req.params.orderNumber));
});

app.post('/orders/:orderNumber/receipt', (req, res) => {
  const order = findOrderByRef(req.params.orderNumber);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (isApprovedOrderStatus(order.status) || isRejectedOrderStatus(order.status) || order.status === ORDER_STATUS.REFUNDED) {
    return res.status(400).json({ error: 'This order can no longer accept receipts' });
  }
  if (isPendingReviewStatus(order.status) && order.receipt_url) {
    return res.status(400).json({ error: 'Receipt already submitted for this order' });
  }

  const receiptImage = req.body?.receiptImage;
  if (!receiptImage || typeof receiptImage !== 'string') {
    return res.status(400).json({ error: 'Please upload a receipt image before confirming' });
  }

  const saved = saveReceiptImageFromDataUrl(receiptImage, `order-${order.id}-${Date.now()}`);
  if (!saved) {
    return res.status(400).json({ error: 'Invalid receipt image. Upload a JPG, PNG, or WebP screenshot.' });
  }

  db.prepare('UPDATE orders SET status = ?, receipt_url = ? WHERE id = ?')
    .run(ORDER_STATUS.PENDING, saved, order.id);
  res.json(formatOrder(req.params.orderNumber));
});

app.post('/admin/orders/:orderNumber/approve', requireAdmin, (req, res) => {
  const order = findOrderByRef(req.params.orderNumber);

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (isApprovedOrderStatus(order.status)) {
    return res.json(formatOrder(req.params.orderNumber));
  }
  if (!isPendingReviewStatus(order.status)) {
    return res.status(400).json({ error: 'Only pending orders can be approved' });
  }
  if (!order.receipt_url) {
    return res.status(400).json({ error: 'Cannot approve — buyer has not uploaded a payment receipt yet' });
  }

  const result = markOrderApprovedAndFulfill(order.id);
  if (result.error) return res.status(400).json({ error: result.error });

  if (order.user_id) {
    createUserNotification(
      order.user_id,
      'order',
      'Order approved',
      `Order #${orderDisplayId(order)} has been approved. Check My Account for your credentials.`
    );
  }

  res.json(formatOrder(req.params.orderNumber));
});

app.post('/admin/orders/:orderNumber/fulfill', requireAdmin, (req, res) => {
  const order = findOrderByRef(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!isApprovedOrderStatus(order.status)) return res.status(400).json({ error: 'Order must be approved first' });
  const result = order.fulfillment_mode === 'manual'
    ? fulfillOrderRemaining(order.id)
    : fulfillOrder(order.id);
  res.json({ ok: true, assigned: result.assigned });
});

app.put('/admin/payment-methods/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, instructions, qr_image_url, is_active, account_number } = req.body;
  const existing = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Payment method not found' });

  let nextName = existing.name;
  if (name !== undefined) {
    nextName = String(name).trim();
    if (!nextName) return res.status(400).json({ error: 'Payment method name is required' });
  }

  db.prepare(`
    UPDATE payment_methods
    SET name = ?, instructions = ?, qr_image_url = ?, is_active = ?, account_number = ?
    WHERE id = ?
  `).run(
    nextName,
    instructions != null ? JSON.stringify(instructions) : existing.instructions,
    qr_image_url ?? existing.qr_image_url,
    is_active ?? existing.is_active,
    account_number !== undefined ? String(account_number || '').trim() : existing.account_number,
    id
  );

  const updated = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  updated.instructions = JSON.parse(updated.instructions || '[]');
  res.json(updated);
});

app.put('/admin/redeem-codes/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { code, discount_type, discount_value, is_active, max_uses } = req.body;
  const existing = db.prepare('SELECT * FROM redeem_codes WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Redeem code not found' });

  db.prepare(`
    UPDATE redeem_codes
    SET code = ?, discount_type = ?, discount_value = ?, is_active = ?, max_uses = ?
    WHERE id = ?
  `).run(
    code ?? existing.code,
    discount_type ?? existing.discount_type,
    discount_value ?? existing.discount_value,
    is_active ?? existing.is_active,
    max_uses !== undefined ? max_uses : existing.max_uses,
    id
  );

  res.json(db.prepare('SELECT * FROM redeem_codes WHERE id = ?').get(id));
});

/* ============================================================
   Settings helpers (loyalty, theme, store profile)
   ============================================================ */
function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}
function notify(type, title, body = '') {
  try {
    db.prepare('INSERT INTO admin_notifications (type, title, body) VALUES (?, ?, ?)')
      .run(type, title, body);
  } catch (_) { /* ignore */ }
}

function normalizeThemeHex(hex) {
  const h = String(hex || '').trim();
  const m = h.match(/^#?([a-fA-F0-9]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : null;
}

function parseColorhuntPalette(url) {
  const str = String(url || '').trim();
  const match = str.match(/colorhunt\.co\/palette\/([a-fA-F0-9\-]+)/i);
  if (!match) return null;
  const chunk = match[1].replace(/-/g, '');
  const hexes = [];
  for (let i = 0; i < chunk.length; i += 6) {
    const part = chunk.slice(i, i + 6);
    if (/^[a-fA-F0-9]{6}$/.test(part)) hexes.push(`#${part.toLowerCase()}`);
  }
  return hexes.length >= 2 ? hexes : null;
}

function hexLuminance(hex) {
  const h = normalizeThemeHex(hex)?.slice(1);
  if (!h) return 0;
  const chan = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function mapColorhuntToTheme(hexes) {
  const unique = [...new Set(hexes.map((h) => normalizeThemeHex(h)).filter(Boolean))];
  if (unique.length < 2) return null;
  const sorted = unique.map((hex) => ({ hex, lum: hexLuminance(hex) })).sort((a, b) => a.lum - b.lum);
  const darkest = sorted[0].hex;
  const lightest = sorted[sorted.length - 1].hex;
  const mids = sorted.slice(1, -1).map((x) => x.hex);
  const primary = mids[0] || lightest;
  let secondary = mids[1] || mids[0] || lightest;
  return {
    background: lightest,
    font: darkest,
    primary,
    secondary
  };
}

function getThemeColorSettings() {
  const primary = getSetting('theme_primary', getSetting('theme_light_primary', '#8d7b68'));
  return {
    background: getSetting('theme_bg', '#f1dec9'),
    font: getSetting('theme_font', '#4a3c2e'),
    primary: normalizeThemeHex(primary) || '#8d7b68',
    secondary: getSetting('theme_secondary', '#a4907c'),
    colorhuntUrl: getSetting('theme_colorhunt_url', '')
  };
}

function saveThemeColorSettings(colors) {
  if (colors.background != null) setSetting('theme_bg', normalizeThemeHex(colors.background) || colors.background);
  if (colors.font != null) setSetting('theme_font', normalizeThemeHex(colors.font) || colors.font);
  if (colors.primary != null) {
    const p = normalizeThemeHex(colors.primary) || colors.primary;
    setSetting('theme_primary', p);
    setSetting('theme_light_primary', p);
  }
  if (colors.secondary != null) setSetting('theme_secondary', normalizeThemeHex(colors.secondary) || colors.secondary);
  if (colors.colorhuntUrl != null) setSetting('theme_colorhunt_url', String(colors.colorhuntUrl).trim());
}

/* ============================================================
   ALL ORDERS — pending / approved / rejected + search + date
   ============================================================ */
function orderCard(o) {
  const items = db.prepare(
    'SELECT product_name AS name, quantity FROM order_items WHERE order_id = ?'
  ).all(o.id);
  const first = items[0];
  const buyerName = o.buyer_name || o.user_name || (o.email ? o.email.split('@')[0] : 'Guest');
  const stock = orderItemsStockStatus(o.id, o.status);
  return {
    id: o.id,
    orderNumber: o.order_number,
    orderId: o.order_seq,
    displayId: orderDisplayId(o),
    buyerName,
    email: o.email,
    userId: o.user_id || null,
    user: {
      id: o.user_id || null,
      name: o.buyer_name || o.user_name || buyerName,
      email: o.email
    },
    itemName: first ? first.name : '—',
    itemQty: first ? first.quantity : 0,
    itemCount: items.length,
    stockState: stock.state,
    stockLabel: stock.label,
    total: o.total,
    paymentMethod: o.payment_method_name,
    status: o.status,
    receiptUrl: o.receipt_url || null,
    rejectReason: o.reject_reason || null,
    createdAt: o.created_at
  };
}

const ALL_ORDER_TABS = {
  pending: [ORDER_STATUS.PENDING],
  approved: [ORDER_STATUS.APPROVED],
  rejected: [ORDER_STATUS.REJECTED]
};

app.get('/admin/all-orders', requireAdmin, (req, res) => {
  const tab = ALL_ORDER_TABS[req.query.tab] ? req.query.tab : 'pending';
  const statuses = ALL_ORDER_TABS[tab];
  const params = [...statuses];
  let query = `
    SELECT o.*, pm.name AS payment_method_name, u.name AS user_name
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.status IN (${statuses.map(() => '?').join(',')})
  `;
  if (req.query.search) {
    query += ` AND (o.order_number LIKE ? OR LOWER(o.email) LIKE ?
                OR o.id IN (SELECT order_id FROM order_items WHERE LOWER(product_name) LIKE ?))`;
    const term = `%${req.query.search.toLowerCase()}%`;
    params.push(term, term, term);
  }
  if (req.query.from) { query += ' AND date(o.created_at) >= date(?)'; params.push(req.query.from); }
  if (req.query.to) { query += ' AND date(o.created_at) <= date(?)'; params.push(req.query.to); }
  query += ' ORDER BY o.id DESC';
  res.json(db.prepare(query).all(...params).map(orderCard));
});

app.post('/admin/orders/:orderNumber/reject', requireAdmin, (req, res) => {
  const order = findOrderByRef(req.params.orderNumber);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!isPendingReviewStatus(order.status)) {
    return res.status(400).json({ error: 'Only pending orders awaiting approval can be rejected' });
  }
  const reason = String(req.body?.reason || req.body?.rejectReason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });

  db.prepare('UPDATE orders SET status = ?, reject_reason = ? WHERE id = ?')
    .run(ORDER_STATUS.REJECTED, reason, order.id);

  if (order.user_id) {
    createUserNotification(
      order.user_id,
      'order',
      'Order rejected',
      `Order #${orderDisplayId(order)} was rejected. Reason: ${reason}`
    );
  }

  res.json(formatOrder(req.params.orderNumber));
});

/* ============================================================
   TRANSACTIONS — summary + ledger
   ============================================================ */
app.get('/admin/transactions', requireAdmin, (req, res) => {
  const v = (sql, ...p) => db.prepare(sql).get(...p).v;
  const netRevenue = v("SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status='approved'");
  const orders = v("SELECT COUNT(*) AS v FROM orders WHERE status='approved'").v;
  const refundTotal = v("SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE status='refunded'");
  const refundCount = v("SELECT COUNT(*) AS v FROM orders WHERE status='refunded'");
  const totalReports = v('SELECT COUNT(*) AS v FROM product_reports');
  const goodReports = v("SELECT COUNT(*) AS v FROM product_reports WHERE status='active'");
  const fixedReports = v("SELECT COUNT(*) AS v FROM product_reports WHERE status='resolved'");

  const params = [];
  let query = `
    SELECT o.*, pm.name AS payment_method_name, u.name AS user_name
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.status IN ('approved', 'refunded')
      AND o.receipt_url IS NOT NULL AND TRIM(o.receipt_url) != ''
  `;
  if (req.query.status && req.query.status !== 'all') {
    if (req.query.status === 'approved' || req.query.status === 'refunded') {
      query += ' AND o.status = ?';
      params.push(req.query.status);
    }
  }
  if (req.query.search) {
    query += ' AND (o.order_number LIKE ? OR LOWER(o.email) LIKE ?)';
    const term = `%${req.query.search.toLowerCase()}%`;
    params.push(term, term);
  }
  if (req.query.from) { query += ' AND date(o.created_at) >= date(?)'; params.push(req.query.from); }
  if (req.query.to) { query += ' AND date(o.created_at) <= date(?)'; params.push(req.query.to); }
  query += ' ORDER BY o.id DESC LIMIT 200';
  const ledger = db.prepare(query).all(...params).map(orderCard);

  res.json({
    summary: { netRevenue, orders, refundTotal, refundCount, totalReports, goodReports, fixedReports },
    ledger
  });
});

/* ============================================================
   CATALOG — products with live stock counts
   ============================================================ */
app.get('/admin/product-logos', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, category, icon FROM products ORDER BY category ASC, name ASC, id ASC
  `).all();
  res.json(rows.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    logo: p.icon || '',
    logoUrl: p.icon
      ? `https://api.iconify.design/${encodeURIComponent(p.icon)}.svg?color=%23ffffff`
      : ''
  })));
});

app.get('/admin/catalog', requireAdmin, (req, res) => {
  const { search, category } = req.query;
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (category && category.toLowerCase() !== 'all') { query += ' AND LOWER(category)=LOWER(?)'; params.push(category); }
  if (search) {
    query += ' AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ?)';
    const t = `%${search.toLowerCase()}%`;
    params.push(t, t);
  }
  query += ' ORDER BY category ASC, id ASC';
  const products = db.prepare(query).all(...params);
  const productIds = products.map((p) => p.id);
  const stockMap = {};
  if (productIds.length) {
    const placeholders = productIds.map(() => '?').join(',');
    db.prepare(`
      SELECT product_id, COUNT(*) AS c FROM stock_items
      WHERE status = 'available' AND product_id IN (${placeholders})
      GROUP BY product_id
    `).all(...productIds).forEach((r) => { stockMap[r.product_id] = r.c; });
  }
  const variantsMap = batchVariantsByProductIds(productIds);
  const rows = products.map((p) => ({
    ...p, stock: stockMap[p.id] || 0, variants: variantsMap[p.id] || []
  }));
  res.json(rows);
});

/* ============================================================
   CATEGORIES — groups that products live under
   ============================================================ */
app.get('/admin/categories', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.slug, c.description, c.sort_order,
           (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id OR LOWER(p.category) = LOWER(c.name)) AS product_count
    FROM categories c
    ORDER BY c.sort_order ASC, c.name ASC
  `).all();
  res.json(rows);
});

app.post('/admin/categories', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  if (db.prepare('SELECT 1 FROM categories WHERE LOWER(name) = LOWER(?)').get(name)) {
    return res.status(409).json({ error: 'A category with that name already exists' });
  }
  let slug = slugify(name);
  if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) slug = `${slug}-${Date.now()}`;
  const sort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories').get().n;
  const r = db.prepare('INSERT INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)')
    .run(name, slug, String(req.body.description || '').trim(), sort);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/admin/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const name = req.body.name != null ? String(req.body.name).trim() : existing.name;
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const clash = db.prepare('SELECT 1 FROM categories WHERE LOWER(name) = LOWER(?) AND id <> ?').get(name, id);
  if (clash) return res.status(409).json({ error: 'A category with that name already exists' });
  db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?')
    .run(name, req.body.description != null ? String(req.body.description).trim() : existing.description, id);
  // Keep the denormalised product.category text in sync after a rename
  db.prepare('UPDATE products SET category = ? WHERE category_id = ? OR LOWER(category) = LOWER(?)')
    .run(name, id, existing.name);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
});

app.delete('/admin/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM products WHERE category_id = ? OR LOWER(category) = LOWER(?)').get(id, existing.name).c;
  if (count > 0) {
    return res.status(409).json({ error: `Move or delete the ${count} product(s) in this category first.` });
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============================================================
   INVENTORY — stock items + sold history
   Hierarchy: variant → account (email/password) → profile slots.
   Each profile is one individually-sellable stock item.
   ============================================================ */

// Flat list of every variant across products, for the Add Stock "Select Variant" dropdown
app.get('/admin/variants', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT v.id, v.name AS variant_name, v.duration, v.price, v.cost, v.rules,
           p.id AS product_id, p.name AS product_name, p.category AS category
    FROM product_variants v JOIN products p ON p.id = v.product_id
    ORDER BY p.category ASC, p.name ASC, v.sort_order ASC, v.id ASC
  `).all();
  res.json(rows.map((r) => ({
    ...r,
    service_name: `${r.product_name} ${r.variant_name}`.trim(),
    label: `${r.product_name} — ${r.variant_name}`
  })));
});

const INV_SELECT = `
  SELECT s.*, p.name AS product_name, p.category AS category, p.icon AS product_icon,
         v.name AS variant_name, v.duration AS variant_duration
  FROM stock_items s
  JOIN products p ON p.id = s.product_id
  LEFT JOIN product_variants v ON v.id = s.variant_id
`;

function variantInventoryLabel(productName, variant) {
  const dur = variant.duration ? ` (${variant.duration})` : '';
  return `${productName} – ${variant.name}${dur}`;
}

function buildInventoryCatalogTree(stockStatus, searchRaw) {
  const search = String(searchRaw || '').trim().toLowerCase();
  const catRows = db.prepare('SELECT id, name FROM categories ORDER BY sort_order ASC, name ASC').all();
  const products = db.prepare('SELECT * FROM products ORDER BY category ASC, name ASC').all();
  const variantsMap = batchVariantsByProductIds(products.map((p) => p.id));

  const stockRows = db.prepare(`${INV_SELECT} WHERE s.status = ? ORDER BY s.id DESC`).all(stockStatus);
  stockRows.forEach((r) => {
    try { r.profiles = JSON.parse(r.profiles || '[]'); } catch (_) { r.profiles = []; }
  });

  const stockByVariant = new Map();
  for (const row of stockRows) {
    const key = row.variant_id || `p${row.product_id}`;
    if (!stockByVariant.has(key)) stockByVariant.set(key, []);
    stockByVariant.get(key).push(row);
  }

  const categoryTree = new Map();
  const ensureCat = (name, id = null) => {
    const key = name || 'Uncategorized';
    if (!categoryTree.has(key)) {
      categoryTree.set(key, { id, name: key, products: [], totalCount: 0 });
    }
    return categoryTree.get(key);
  };

  catRows.forEach((c) => ensureCat(c.name, c.id));
  ensureCat('Uncategorized');

  const productCatKeys = new Set(catRows.map((c) => c.name.toLowerCase()));

  for (const p of products) {
    const catName = p.category && productCatKeys.has(String(p.category).toLowerCase())
      ? p.category
      : (p.category || 'Uncategorized');
    const cat = ensureCat(catName);

    const variants = variantsMap[p.id] || [];
    const productNode = {
      id: p.id,
      name: p.name,
      icon: p.icon || '',
      variants: [],
      totalCount: 0
    };

    const variantDefs = variants.length
      ? variants
      : [{ id: null, name: 'Default', duration: '', sort_order: 0 }];

    for (const v of variantDefs) {
      const key = v.id || `p${p.id}`;
      let items = stockByVariant.get(key) || [];
      if (search) {
        items = items.filter((s) => {
          const hay = `${s.email} ${s.service_name} ${p.name} ${v.name} ${v.duration || ''} ${(s.profiles || []).join(' ')}`.toLowerCase();
          return hay.includes(search);
        });
      }
      const label = v.id ? variantInventoryLabel(p.name, v) : p.name;
      const nameHay = `${p.name} ${v.name} ${v.duration || ''}`.toLowerCase();
      if (search && items.length === 0 && !nameHay.includes(search)) continue;

      productNode.variants.push({
        id: v.id,
        name: v.name,
        duration: v.duration || '',
        label,
        stockCount: items.length,
        items
      });
      productNode.totalCount += items.length;
    }

    if (search && productNode.totalCount === 0 && productNode.variants.length === 0) {
      if (!p.name.toLowerCase().includes(search)) continue;
    }

    cat.products.push(productNode);
    cat.totalCount += productNode.totalCount;
  }

  const result = [];
  for (const c of catRows) {
    const node = categoryTree.get(c.name) || { id: c.id, name: c.name, products: [], totalCount: 0 };
    if (search && node.totalCount === 0 && node.products.length === 0 && !c.name.toLowerCase().includes(search)) continue;
    result.push(node);
  }
  const uncategorized = categoryTree.get('Uncategorized');
  if (uncategorized?.products.length > 0) result.push(uncategorized);

  return result;
}

app.get('/admin/inventory/tree', requireAdmin, (req, res) => {
  const sold = req.query.tab === 'sold';
  const status = sold ? 'sold' : 'available';
  res.json(buildInventoryCatalogTree(status, req.query.search));
});

app.get('/admin/inventory', requireAdmin, (req, res) => {
  const rows = db.prepare(`${INV_SELECT} WHERE s.status = 'available' ORDER BY p.category, p.name, s.id DESC`).all();
  rows.forEach((r) => { r.profiles = JSON.parse(r.profiles || '[]'); });
  res.json(rows);
});

app.get('/admin/inventory/sold', requireAdmin, (req, res) => {
  const rows = db.prepare(`${INV_SELECT} WHERE s.status = 'sold' ORDER BY s.sold_at DESC`).all();
  rows.forEach((r) => { r.profiles = JSON.parse(r.profiles || '[]'); });
  res.json(rows);
});

app.post('/admin/inventory', requireAdmin, (req, res) => {
  const { variant_id, service_name, email, password, profiles, cost, price, valid_start, valid_end, rules } = req.body;
  if (!variant_id) return res.status(400).json({ error: 'Please select a variant' });
  const variant = db.prepare('SELECT v.*, p.name AS product_name FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').get(Number(variant_id));
  if (!variant) return res.status(404).json({ error: 'Variant not found' });

  // Each profile slot becomes its own sellable stock item. No profiles => a single slot.
  const slots = Array.isArray(profiles) ? profiles.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (slots.length === 0) slots.push('');

  const svc = service_name || `${variant.product_name} ${variant.name}`.trim();
  const stockRules = rules != null ? String(rules).trim() : String(variant.rules || '').trim();
  const insert = db.prepare(`
    INSERT INTO stock_items (product_id, variant_id, service_name, email, password, profiles, cost, price, valid_start, valid_end, rules)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const created = [];
  db.exec('BEGIN');
  try {
    for (const slot of slots) {
      const r = insert.run(
        variant.product_id, variant.id, svc,
        email || '', password || '',
        JSON.stringify(slot ? [slot] : []),
        Number(cost) || 0, Number(price) || 0,
        valid_start || null, valid_end || null,
        stockRules
      );
      const stockId = r.lastInsertRowid;
      upsertEmailAccess(stockId, {
        email: email || '',
        password: password || '',
        profileData: slot ? [slot] : []
      });
      created.push(stockId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to create stock' });
  }
  res.status(201).json({ ok: true, created: created.length });
});

app.put('/admin/inventory/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Stock item not found' });
  const { service_name, email, password, profiles, cost, price, valid_start, valid_end, rules } = req.body;
  db.prepare(`
    UPDATE stock_items SET service_name=?, email=?, password=?, profiles=?, cost=?, price=?, valid_start=?, valid_end=?, rules=?
    WHERE id = ?
  `).run(
    service_name ?? existing.service_name,
    email ?? existing.email,
    password ?? existing.password,
    profiles != null ? JSON.stringify(profiles) : existing.profiles,
    cost != null ? Number(cost) : existing.cost,
    price != null ? Number(price) : existing.price,
    valid_start ?? existing.valid_start,
    valid_end ?? existing.valid_end,
    rules != null ? String(rules).trim() : existing.rules,
    id
  );
  const updated = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
  let parsedProfiles = [];
  try { parsedProfiles = JSON.parse(updated.profiles || '[]'); } catch (_) { parsedProfiles = []; }
  upsertEmailAccess(id, {
    email: updated.email,
    password: updated.password,
    profileData: parsedProfiles
  });
  res.json(updated);
});

app.delete('/admin/inventory/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM stock_items WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============================================================
   MANAGE USERS
   ============================================================ */
app.get('/users/:id', requireAdmin, (req, res) => {
  const detail = formatUserAdminPublic(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: 'User not found' });
  res.json(detail);
});

app.get('/admin/users', requireAdmin, (req, res) => {
  const params = [];
  let query = `
    SELECT u.id, u.email, u.name, u.username, u.is_admin, u.suspended, u.created_at,
           (SELECT COUNT(*) FROM orders o
             WHERE o.user_id = u.id OR (o.user_id IS NULL AND LOWER(o.email) = LOWER(u.email))) AS orders,
           (SELECT COALESCE(SUM(o.total),0) FROM orders o
             WHERE (o.user_id = u.id OR (o.user_id IS NULL AND LOWER(o.email) = LOWER(u.email)))
               AND o.status='approved') AS spent
    FROM users u WHERE 1=1
  `;
  if (req.query.search) {
    query += ' AND (LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.username) LIKE ?)';
    const t = `%${req.query.search.toLowerCase()}%`;
    params.push(t, t, t);
  }
  query += ' ORDER BY u.id DESC LIMIT 100';
  const total = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({ total, users: db.prepare(query).all(...params) });
});

app.get('/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const detail = formatAdminUserDetail(id);
  if (!detail) return res.status(404).json({ error: 'User not found' });
  res.json(detail);
});

app.put('/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const { suspended, is_admin } = req.body;
  db.prepare('UPDATE users SET suspended = ?, is_admin = ? WHERE id = ?').run(
    suspended != null ? (suspended ? 1 : 0) : existing.suspended,
    is_admin != null ? (is_admin ? 1 : 0) : existing.is_admin,
    id
  );
  const user = formatUserAdminPublic(id);
  res.json({ ok: true, user });
});

/* ============================================================
   REDEEM — bulk generation
   ============================================================ */
app.post('/admin/redeem-codes/bulk', requireAdmin, (req, res) => {
  const count = Math.min(Math.max(Number(req.body.count) || 5, 1), 100);
  const type = req.body.discount_type === 'percent' ? 'percent' : 'fixed';
  const value = Number(req.body.discount_value) || 0;
  const maxUses = req.body.max_uses != null && req.body.max_uses !== '' ? Number(req.body.max_uses) : 1;
  const insert = db.prepare(`
    INSERT INTO redeem_codes (code, discount_type, discount_value, is_active, max_uses)
    VALUES (?, ?, ?, 1, ?)
  `);
  const created = [];
  for (let i = 0; i < count; i++) {
    let code;
    do { code = 'CMB' + Math.random().toString(36).slice(2, 10).toUpperCase(); }
    while (db.prepare('SELECT id FROM redeem_codes WHERE code = ?').get(code));
    const r = insert.run(code, type, value, maxUses);
    created.push(db.prepare('SELECT * FROM redeem_codes WHERE id = ?').get(r.lastInsertRowid));
  }
  res.status(201).json(created);
});

app.delete('/admin/redeem-codes/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM redeem_codes WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/* ============================================================
   DIRECT MESSAGE
   ============================================================ */
app.get('/admin/messages', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM dm_threads ORDER BY updated_at DESC').all());
});
app.get('/admin/messages/:id', requireAdmin, (req, res) => {
  const thread = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(Number(req.params.id));
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  const messages = db.prepare('SELECT * FROM dm_messages WHERE thread_id = ? ORDER BY id ASC').all(thread.id);
  res.json({ thread, messages });
});
app.post('/admin/messages/:id/reply', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!req.body.body) return res.status(400).json({ error: 'Message body required' });
  db.prepare('INSERT INTO dm_messages (thread_id, sender, body) VALUES (?, ?, ?)').run(id, 'admin', req.body.body);
  db.prepare("UPDATE dm_threads SET last_message = ?, updated_at = datetime('now') WHERE id = ?").run(req.body.body, id);
  res.json(db.prepare('SELECT * FROM dm_messages WHERE thread_id = ? ORDER BY id ASC').all(id));
});

/* ============================================================
   NOTIFICATIONS
   ============================================================ */
app.get('/admin/notifications', requireAdmin, (req, res) => {
  const list = db.prepare('SELECT * FROM admin_notifications ORDER BY id DESC LIMIT 50').all();
  const unread = db.prepare('SELECT COUNT(*) AS c FROM admin_notifications WHERE is_read = 0').get().c;
  res.json({ unread, notifications: list });
});
app.post('/admin/notifications/read-all', requireAdmin, (req, res) => {
  db.prepare('UPDATE admin_notifications SET is_read = 1').run();
  res.json({ ok: true });
});

/* ============================================================
   SUPPORT TICKETS
   ============================================================ */
function formatSupportTicketRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    buyerName: row.buyer_name || row.name || '—',
    buyerEmail: row.buyer_email || row.email || '',
    buyerUsername: row.buyer_username || row.username || ''
  };
}

app.get('/admin/support-tickets', requireAdmin, (req, res) => {
  const status = req.query.status;
  const params = [];
  let query = `
    SELECT t.*, u.name AS buyer_name, u.email AS buyer_email, u.username AS buyer_username
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE 1=1
  `;
  if (status === 'open' || status === 'closed') {
    query += ' AND t.status = ?';
    params.push(status);
  }
  if (req.query.search) {
    query += ' AND (LOWER(t.subject) LIKE ? OR LOWER(t.body) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.name) LIKE ?)';
    const term = `%${String(req.query.search).toLowerCase()}%`;
    params.push(term, term, term, term);
  }
  query += ' ORDER BY t.id DESC LIMIT 100';
  const tickets = db.prepare(query).all(...params).map(formatSupportTicketRow);
  const openCount = db.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE status = 'open'").get().c;
  res.json({ openCount, tickets });
});

app.get('/admin/support-tickets/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT t.*, u.name AS buyer_name, u.email AS buyer_email, u.username AS buyer_username
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ error: 'Ticket not found' });
  res.json(formatSupportTicketRow(row));
});

app.put('/admin/support-tickets/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '').trim();
  if (!['open', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Status must be open or closed' });
  }
  const existing = db.prepare('SELECT id FROM support_tickets WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare('UPDATE support_tickets SET status = ? WHERE id = ?').run(status, id);
  const row = db.prepare(`
    SELECT t.*, u.name AS buyer_name, u.email AS buyer_email, u.username AS buyer_username
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = ?
  `).get(id);
  res.json(formatSupportTicketRow(row));
});

/* ============================================================
   PRODUCT REPORTS
   ============================================================ */
app.get('/admin/reports', requireAdmin, (req, res) => {
  const status = req.query.tab === 'history' ? 'resolved' : 'active';
  const params = [status];
  let query = `
    SELECT r.*, u.username, u.name AS user_name
    FROM product_reports r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.status = ?
  `;
  if (req.query.search) {
    query += ' AND (LOWER(r.email) LIKE ? OR LOWER(r.service) LIKE ? OR LOWER(r.detail) LIKE ? OR LOWER(r.buyer_name) LIKE ?)';
    const t = `%${req.query.search.toLowerCase()}%`;
    params.push(t, t, t, t);
  }
  query += ' ORDER BY r.id DESC';
  res.json(db.prepare(query).all(...params).map(formatProductReportRow));
});

app.put('/admin/reports/:id/note', requireAdmin, (req, res) => {
  const reportId = Number(req.params.id);
  const report = db.prepare('SELECT * FROM product_reports WHERE id = ?').get(reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const adminNote = String(req.body.adminNote || req.body.admin_note || '').trim();
  db.prepare('UPDATE product_reports SET admin_note = ? WHERE id = ?').run(adminNote, reportId);
  if (report.user_id && adminNote) {
    createUserNotification(
      report.user_id,
      'report',
      'Update on your report',
      adminNote.slice(0, 240)
    );
  }
  res.json({ ok: true, adminNote });
});

app.get('/admin/reports/:id/detail', requireAdmin, (req, res) => {
  const reportId = Number(req.params.id);
  const report = db.prepare('SELECT * FROM product_reports WHERE id = ?').get(reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const formatted = formatProductReportRow(report);
  const reportedItems = formatted.reportedItems || [];

  let stockItem = null;
  let emailAccess = null;
  const credentialGroups = [];

  for (const item of reportedItems) {
    const sid = item.stockItemId;
    if (!sid) continue;
    const row = db.prepare(`
      SELECT s.*, p.name AS product_name, v.name AS variant_name
      FROM stock_items s
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN product_variants v ON v.id = s.variant_id
      WHERE s.id = ?
    `).get(sid);
    if (!row) continue;
    const profiles = getCredentialProfileState(sid);
    credentialGroups.push({
      stockItemId: sid,
      productName: item.productName || row.service_name || row.product_name,
      email: row.email,
      credentialStatus: row.credential_report_status || 'ok',
      triggerProfileIndex: item.triggerProfileIndex,
      profiles,
      profilesFlagged: item.profilesFlagged || profiles.filter((p) => p.reported).map((p) => p.detail)
    });
    if (!stockItem && sid === report.stock_item_id) {
      stockItem = row;
      emailAccess = getEmailAccessForStock(sid);
    }
  }

  if (!stockItem && report.stock_item_id) {
    stockItem = db.prepare(`
      SELECT s.*, p.name AS product_name, v.name AS variant_name
      FROM stock_items s
      LEFT JOIN products p ON p.id = s.product_id
      LEFT JOIN product_variants v ON v.id = s.variant_id
      WHERE s.id = ?
    `).get(report.stock_item_id);
    emailAccess = getEmailAccessForStock(report.stock_item_id);
  }

  const affectedReports = report.stock_item_id
    ? db.prepare(`
      SELECT r.*, u.username FROM product_reports r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.stock_item_id = ? AND r.status = 'active'
      ORDER BY r.id ASC
    `).all(report.stock_item_id)
    : [];

  const order = report.order_number
    ? db.prepare('SELECT * FROM orders WHERE order_number = ?').get(report.order_number)
    : null;

  let legacyProfiles = [];
  if (stockItem) {
    try { legacyProfiles = JSON.parse(stockItem.profiles || '[]'); } catch (_) { legacyProfiles = []; }
  }

  res.json({
    report: formatted,
    reportedItems,
    credentialGroups,
    stockItem: stockItem ? {
      id: stockItem.id,
      serviceName: stockItem.service_name || `${stockItem.product_name || 'Account'}${stockItem.variant_name ? ` — ${stockItem.variant_name}` : ''}`,
      email: stockItem.email,
      password: stockItem.password,
      profiles: legacyProfiles,
      credentialReportStatus: stockItem.credential_report_status || 'ok',
      rules: stockItem.rules || ''
    } : null,
    emailAccess: emailAccess || { email: '', password: '', profileData: [] },
    affectedReports,
    order: order ? {
      orderNumber: order.order_number,
      status: order.status,
      total: order.total,
      email: order.email
    } : null
  });
});

app.post('/admin/reports/:id/action', requireAdmin, (req, res) => {
  const reportId = Number(req.params.id);
  const report = db.prepare('SELECT * FROM product_reports WHERE id = ?').get(reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (report.status !== 'active') return res.status(400).json({ error: 'Report is already resolved' });

  const action = String(req.body.action || '').toLowerCase();
  const adminNotes = String(req.body.adminNotes || '').trim();
  const stockDescription = String(req.body.stockDescription || '').trim();
  const rejectReason = String(req.body.rejectReason || req.body.reason || '').trim();
  const userId = report.user_id;
  const stockItemId = report.stock_item_id;

  const notifyBuyer = (title, body, type = 'report') => {
    createUserNotification(userId, type, title, body);
  };

  if (action === 'fix_active') {
    if (!stockItemId) return res.status(400).json({ error: 'No purchased account linked to this report' });

    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '').trim();
    if (!email || !password) {
      return res.status(400).json({ error: 'Replacement email and password are required' });
    }

    const profiles = req.body.profiles != null
      ? parseProfilesInput(req.body.profiles)
      : parseProfilesInput(req.body.profileData);

    const emailAccessEmail = String(req.body.emailAccessEmail || req.body.emailAccess?.email || email).trim();
    const emailAccessPassword = String(req.body.emailAccessPassword || req.body.emailAccess?.password || password).trim();
    const emailAccessProfileData = req.body.emailAccessProfileData != null
      ? (Array.isArray(req.body.emailAccessProfileData) ? req.body.emailAccessProfileData : parseProfilesInput(req.body.emailAccessProfileData))
      : (req.body.emailAccess?.profileData ? req.body.emailAccess.profileData : profiles);

    replacePurchasedAccountCredentials(stockItemId, {
      email,
      password,
      profiles,
      emailAccessEmail,
      emailAccessPassword,
      emailAccessProfileData
    }, {
      reportId,
      orderNumber: report.order_number,
      userId,
      adminUserId: req.adminUser.id
    });

    const resolution = adminNotes || 'Account replaced and activated';
    resolveReportsForStock(stockItemId, {
      resolution,
      resolutionAction: 'fix_active',
      adminNotes,
      stockDescription
    });

    notifyBuyer(
      'Account credentials updated',
      `Your account for order #${report.order_number || '—'} has been replaced with new credentials. Check My Purchases or Email Access for the updated details.`
    );

    db.prepare('INSERT INTO admin_notifications (type, title, body, is_read) VALUES (?, ?, ?, 0)')
      .run('report', 'Account replaced', `Report #${reportId} — credentials updated for stock #${stockItemId}`);

    return res.json({ ok: true, action: 'fix_active' });
  }

  if (action === 'refund') {
    let order = null;
    if (report.order_number) {
      order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(report.order_number);
    }

    const amount = order?.total || 0;
    db.prepare(`
      INSERT INTO refund_records (report_id, order_id, order_number, user_id, amount, bank_account, status)
      VALUES (?, ?, ?, ?, ?, ?, 'processed')
    `).run(
      reportId,
      order?.id || null,
      report.order_number || null,
      userId,
      amount,
      report.bank_account || req.body.bankAccount || null
    );

    if (order) {
      db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(order.id);
    }

    if (userId && amount > 0) {
      db.prepare('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?').run(amount, userId);
      db.prepare(`
        INSERT INTO wallet_transactions (user_id, type, amount, order_number, description)
        VALUES (?, 'refund', ?, ?, ?)
      `).run(userId, amount, report.order_number || order?.order_number || '', `Refund credited for order #${report.order_number || order?.order_number || '—'}`);
    }
    const resolution = adminNotes || 'Refund processed';
    resolveSingleReport(reportId, {
      resolution,
      resolutionAction: 'refund',
      adminNotes,
      stockDescription
    });

    notifyBuyer(
      'Refund processed',
      `Your refund request for order #${report.order_number || '—'} has been approved. Amount: ${peso(amount)}.`,
      'refund'
    );

    db.prepare('INSERT INTO admin_notifications (type, title, body, is_read) VALUES (?, ?, ?, 0)')
      .run('payout', 'Refund processed', `Report #${reportId} — ${peso(amount)} for order #${report.order_number || '—'}`);

    return res.json({ ok: true, action: 'refund', amount });
  }

  if (action === 'void') {
    const resolution = adminNotes || 'Report voided — no changes made';
    resolveSingleReport(reportId, {
      resolution,
      resolutionAction: 'void',
      adminNotes,
      stockDescription
    });

    notifyBuyer(
      'Report closed',
      `Your report for order #${report.order_number || '—'} was closed without credential changes.`,
      'report'
    );

    return res.json({ ok: true, action: 'void' });
  }

  if (action === 'reject') {
    if (!rejectReason) return res.status(400).json({ error: 'Rejection reason is required' });
    const resolution = rejectReason;
    resolveSingleReport(reportId, {
      resolution,
      resolutionAction: 'reject',
      adminNotes,
      stockDescription,
      rejectReason
    });

    notifyBuyer(
      'Report rejected',
      `Your report for order #${report.order_number || '—'} was rejected. Reason: ${rejectReason}`,
      'report'
    );

    return res.json({ ok: true, action: 'reject' });
  }

  return res.status(400).json({ error: 'Invalid action. Use fix_active, refund, void, or reject.' });
});

function peso(n) {
  return `₱${Number(n || 0).toLocaleString()}`;
}

app.post('/admin/reports/:id/resolve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const report = db.prepare('SELECT * FROM product_reports WHERE id = ?').get(id);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  resolveSingleReport(id, {
    resolution: req.body.resolution || 'Resolved',
    resolutionAction: 'void',
    adminNotes: req.body.resolution || 'Resolved'
  });

  if (report.user_id) {
    createUserNotification(
      report.user_id,
      'report',
      'Report resolved',
      `Your report for order #${report.order_number || '—'} has been resolved.`
    );
  }

  res.json({ ok: true });
});

/* ============================================================
   ACCOUNT SETTINGS — change password
   ============================================================ */
app.post('/admin/account/password', requireAdmin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Both passwords are required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.adminUser.id);
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Old password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  res.json({ ok: true });
});

app.post('/admin/reset-website', requireAdmin, (req, res) => {
  const confirm = String(req.body?.confirm || '').trim();
  if (confirm !== 'RESET') {
    return res.status(400).json({ error: 'Type RESET in the confirmation field to proceed' });
  }
  try {
    const { adminEmail } = db.resetWebsiteData();
    emptyUploadDir(reportProofsDir);
    emptyUploadDir(receiptsDir);
    emptyUploadDir(avatarsDir);
    res.json({ ok: true, message: 'Website reset to fresh state', adminEmail });
  } catch (err) {
    console.error('reset-website failed:', err);
    res.status(500).json({ error: err.message || 'Reset failed' });
  }
});

/* ============================================================
   STORE PROFILE / LOYALTY / SITE THEME (settings)
   ============================================================ */
app.get('/admin/store-profile', requireAdmin, (req, res) => {
  res.json({
    displayName: getSetting('store_display_name', ''),
    bio: getSetting('store_bio', ''),
    location: getSetting('store_location', ''),
    photoUrl: getSetting('store_profile_photo', ''),
    vouchSellerTelegram: getSetting('vouch_seller_telegram', '@skyloverie')
  });
});
app.put('/admin/store-profile', requireAdmin, (req, res) => {
  if (req.body.displayName != null) setSetting('store_display_name', req.body.displayName);
  if (req.body.bio != null) setSetting('store_bio', req.body.bio);
  if (req.body.location != null) setSetting('store_location', req.body.location);
  if (req.body.photoUrl != null) setSetting('store_profile_photo', String(req.body.photoUrl).trim());
  if (req.body.vouchSellerTelegram != null) {
    setSetting('vouch_seller_telegram', String(req.body.vouchSellerTelegram).trim().slice(0, 120));
  }
  res.json({ ok: true });
});

app.post('/admin/store-profile/photo', requireAdmin, (req, res) => {
  const { dataUrl } = req.body || {};
  if (!dataUrl || !String(dataUrl).startsWith('data:image/')) {
    return res.status(400).json({ error: 'Please upload a valid image file' });
  }
  const match = String(dataUrl).match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image data' });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1].replace(/[^a-z0-9]/gi, '') || 'png';
  const uploadsDir = appConfig.brandingUploadsDir;
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `store-profile-photo.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(match[2], 'base64'));
  const photoUrl = `/uploads/${filename}`;
  setSetting('store_profile_photo', photoUrl);
  res.json({ photoUrl });
});

app.get('/store-profile', (req, res) => {
  const photoUrl = getSetting('store_profile_photo', '');
  const logoUrl = getSetting('store_logo_url', '/assets/store-logo.png');
  res.json({
    displayName: getSetting('store_display_name', ''),
    bio: getSetting('store_bio', ''),
    location: getSetting('store_location', ''),
    photoUrl: photoUrl || logoUrl,
    brandName: getSetting('store_brand_name', 'loveriette')
  });
});

function formatTelegramHandle(raw) {
  const value = String(raw || '').trim();
  if (!value) return { label: '', url: '' };
  if (/^https?:\/\//i.test(value)) {
    const label = value.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '@');
    return { label: label.startsWith('@') ? label : `@${label}`, url: value };
  }
  const handle = value.replace(/^@/, '');
  return { label: `@${handle}`, url: `https://t.me/${handle}` };
}

app.get('/vouch-settings', (req, res) => {
  const telegram = formatTelegramHandle(getSetting('vouch_seller_telegram', '@skyloverie'));
  const tgLabel = telegram.label || '@seller';
  res.json({
    telegramLabel: telegram.label,
    telegramUrl: telegram.url,
    format: 'vouch + seller tg usn + product + feedback',
    formatExample: `vouch ${tgLabel} Netflix Shared Profile — legit and fast`,
    steps: [
      'Open My Purchases and view your order credentials.',
      'Take a clear screenshot showing your purchase or successful transaction.',
      'Send your vouch to seller Telegram using the message format below (with your screenshot).',
      'Keep your proof saved — warranty claims require a valid vouch.'
    ]
  });
});

function formatStoreUpdateRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isPublished: !!row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function notifyAllBuyersStoreUpdate(title, body) {
  const preview = String(body || '').trim().slice(0, 280);
  const buyers = db.prepare('SELECT id FROM users WHERE is_admin = 0').all();
  for (const buyer of buyers) {
    createUserNotification(buyer.id, 'store_update', title, preview);
  }
}

app.get('/account/store-updates', requireAuth, (req, res) => {
  const updates = db.prepare(`
    SELECT id, title, body, created_at AS createdAt
    FROM store_updates
    WHERE is_published = 1
    ORDER BY id DESC
    LIMIT 50
  `).all();
  res.json({ updates });
});

app.get('/admin/store-updates', requireAdmin, (req, res) => {
  const updates = db.prepare(`
    SELECT id, title, body, is_published, created_at, updated_at
    FROM store_updates
    ORDER BY id DESC
    LIMIT 100
  `).all().map(formatStoreUpdateRow);
  res.json({ updates });
});

app.post('/admin/store-updates', requireAdmin, (req, res) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const notifyBuyers = req.body.notifyBuyers !== false;
  if (!title || !body) {
    return res.status(400).json({ error: 'Title and message are required' });
  }
  const result = db.prepare(`
    INSERT INTO store_updates (title, body, is_published, created_by)
    VALUES (?, ?, 1, ?)
  `).run(title, body, req.session.userId);
  if (notifyBuyers) notifyAllBuyersStoreUpdate(title, body);
  const row = db.prepare('SELECT * FROM store_updates WHERE id = ?').get(result.lastInsertRowid);
  res.json({ update: formatStoreUpdateRow(row), notified: notifyBuyers });
});

app.put('/admin/store-updates/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM store_updates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Update not found' });
  const title = String(req.body.title ?? existing.title).trim();
  const body = String(req.body.body ?? existing.body).trim();
  const isPublished = req.body.isPublished !== undefined
    ? (req.body.isPublished ? 1 : 0)
    : existing.is_published;
  if (!title || !body) {
    return res.status(400).json({ error: 'Title and message are required' });
  }
  db.prepare(`
    UPDATE store_updates
    SET title = ?, body = ?, is_published = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, body, isPublished, id);
  const row = db.prepare('SELECT * FROM store_updates WHERE id = ?').get(id);
  res.json({ update: formatStoreUpdateRow(row) });
});

app.delete('/admin/store-updates/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM store_updates WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Update not found' });
  db.prepare('DELETE FROM store_updates WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/admin/tingi-settings', requireAdmin, (req, res) => {
  res.json(readTingiSettings());
});
app.put('/admin/tingi-settings', requireAdmin, (req, res) => {
  const minQty = Number(req.body.minQty);
  const maxQty = Number(req.body.maxQty);
  const holdDays = Number(req.body.holdDays);
  const minAutoDrop = Number(req.body.minAutoDrop);
  if (minQty && minQty < 2) return res.status(400).json({ error: 'Minimum quantity must be at least 2' });
  if (maxQty && maxQty < minQty) return res.status(400).json({ error: 'Maximum must be greater than minimum' });
  if (holdDays && holdDays < 1) return res.status(400).json({ error: 'Hold period must be at least 1 day' });
  if (minAutoDrop && minAutoDrop < 1) return res.status(400).json({ error: 'Auto-drop threshold must be at least 1' });

  if (req.body.checkoutEnabled != null) {
    setSetting('tingi_checkout_enabled', req.body.checkoutEnabled ? '1' : '0');
  }
  if (minQty) setSetting('tingi_min_qty', String(minQty));
  if (maxQty) setSetting('tingi_max_qty', String(maxQty));
  if (holdDays) setSetting('tingi_hold_days', String(holdDays));
  if (minAutoDrop) setSetting('tingi_min_auto_drop', String(minAutoDrop));

  res.json(readTingiSettings());
});

app.get('/tingi-drop', (req, res) => {
  const cfg = readTingiSettings();
  res.json({
    checkoutEnabled: cfg.checkoutEnabled,
    minQty: cfg.minQty,
    maxQty: cfg.maxQty,
    holdDays: cfg.holdDays
  });
});

app.get('/theme-colors', (req, res) => {
  res.json(getThemeColorSettings());
});

app.get('/branding', (req, res) => {
  res.json({
    name: getSetting('store_brand_name', 'loveriette'),
    logoUrl: getSetting('store_logo_url', '/assets/store-logo.png'),
    nameFont: getSetting('store_name_font', 'Pacifico'),
    logoAutoTheme: getSetting('store_logo_auto_theme', '1') === '1'
  });
});

app.get('/admin/theme', requireAdmin, (req, res) => {
  const colors = getThemeColorSettings();
  res.json({
    ...colors,
    lightPrimary: colors.primary,
    darkPrimary: getSetting('theme_dark_primary', '#a29bfe'),
    forceMode: getSetting('theme_force_mode', 'light'),
    brandName: getSetting('store_brand_name', 'loveriette'),
    logoUrl: getSetting('store_logo_url', '/assets/store-logo.png'),
    nameFont: getSetting('store_name_font', 'Pacifico'),
    logoAutoTheme: getSetting('store_logo_auto_theme', '1') === '1'
  });
});

app.post('/admin/theme/colorhunt', requireAdmin, (req, res) => {
  const hexes = parseColorhuntPalette(req.body?.url || req.body?.colorhuntUrl);
  if (!hexes) return res.status(400).json({ error: 'Invalid Colorhunt palette link. Paste a URL like https://colorhunt.co/palette/40513b6099669ec8b9cdecdc' });
  const colors = mapColorhuntToTheme(hexes);
  if (!colors) return res.status(400).json({ error: 'Could not read colors from that palette link.' });
  res.json({ hexes, colors });
});

app.put('/admin/theme', requireAdmin, (req, res) => {
  saveThemeColorSettings({
    background: req.body.background,
    font: req.body.font,
    primary: req.body.primary ?? req.body.lightPrimary,
    secondary: req.body.secondary,
    colorhuntUrl: req.body.colorhuntUrl
  });
  if (req.body.darkPrimary != null) setSetting('theme_dark_primary', req.body.darkPrimary);
  if (req.body.forceMode != null) setSetting('theme_force_mode', req.body.forceMode || 'light');
  if (req.body.brandName != null) setSetting('store_brand_name', String(req.body.brandName).trim());
  if (req.body.logoUrl != null) setSetting('store_logo_url', String(req.body.logoUrl).trim());
  if (req.body.nameFont != null) setSetting('store_name_font', String(req.body.nameFont).trim());
  if (req.body.logoAutoTheme != null) setSetting('store_logo_auto_theme', req.body.logoAutoTheme ? '1' : '0');
  res.json({ ok: true, colors: getThemeColorSettings() });
});

app.post('/admin/theme/logo', requireAdmin, (req, res) => {
  const { dataUrl } = req.body || {};
  if (!dataUrl || !String(dataUrl).startsWith('data:image/')) {
    return res.status(400).json({ error: 'Please upload a valid image file' });
  }
  const match = String(dataUrl).match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image data' });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1].replace(/[^a-z0-9]/gi, '') || 'png';
  const uploadsDir = appConfig.brandingUploadsDir;
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `store-logo.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(match[2], 'base64'));
  const logoUrl = `/uploads/${filename}`;
  setSetting('store_logo_url', logoUrl);
  res.json({ logoUrl });
});

/* ============================================================
   SOCIAL LINKS — shown on Contact page & footer (auto logos)
   ============================================================ */
const DEFAULT_SOCIAL = appConfig.parseDefaultSocialLinks();
function getSocialLinks() {
  const raw = getSetting('social_links', '');
  if (!raw) return DEFAULT_SOCIAL;
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : DEFAULT_SOCIAL; } catch (_) { return DEFAULT_SOCIAL; }
}

// Public — buyer storefront (only enabled links)
app.get('/social', (req, res) => {
  res.json(getSocialLinks().filter((l) => l.enabled && l.url));
});

app.get('/admin/social', requireAdmin, (req, res) => {
  res.json(getSocialLinks());
});

app.put('/admin/social', requireAdmin, (req, res) => {
  const links = Array.isArray(req.body && req.body.links) ? req.body.links : [];
  const clean = links
    .map((l) => ({
      key: String(l.key || '').trim().toLowerCase(),
      label: String(l.label || '').trim(),
      url: String(l.url || '').trim(),
      enabled: !!l.enabled
    }))
    .filter((l) => l.key || l.label || l.url);
  setSetting('social_links', JSON.stringify(clean));
  res.json({ ok: true, links: clean });
});

app.get('/admin/chat-seller-bot', requireAdmin, (req, res) => {
  res.json(getChatSellerBotSettings());
});

app.put('/admin/chat-seller-bot', requireAdmin, (req, res) => {
  const payload = req.body || {};
  setSetting('integration_chat_seller', JSON.stringify({
    enabled: payload.enabled == null ? true : !!payload.enabled,
    welcome: String(payload.welcome || '').trim(),
    autoReply: String(payload.autoReply || '').trim()
  }));
  res.json({ ok: true, ...getChatSellerBotSettings() });
});

/* ============================================================
   INTEGRATIONS — SMTP, Tawk.to, Telegram Bot, IMAP Fetcher
   ============================================================ */
const INTEGRATION_KEYS = ['imap', 'smtp', 'tawk', 'telegram', 'chat-seller'];
function getIntegration(name) {
  try { return JSON.parse(getSetting('integration_' + name, '{}')); } catch (_) { return {}; }
}

app.get('/admin/integrations', requireAdmin, (req, res) => {
  res.json({
    imap: getIntegration('imap'),
    smtp: getIntegration('smtp'),
    tawk: getIntegration('tawk'),
    telegram: getIntegration('telegram'),
    'chat-seller': { ...getChatSellerBotSettings(), ...getIntegration('chat_seller') }
  });
});

app.put('/admin/integrations/:name', requireAdmin, (req, res) => {
  if (!INTEGRATION_KEYS.includes(req.params.name)) {
    return res.status(400).json({ error: 'Unknown integration' });
  }
  const key = req.params.name === 'chat-seller' ? 'chat_seller' : req.params.name;
  setSetting('integration_' + key, JSON.stringify(req.body || {}));
  res.json({ ok: true });
});

// Live IMAP login test (used by the "Test Fetcher" button)
app.post('/admin/integrations/test-imap', requireAdmin, (req, res) => {
  const tls = require('tls');
  const net = require('net');
  const { host, port, username, password, enc, validateSsl } = req.body || {};
  if (!host || !username || !password) {
    return res.status(400).json({ error: 'Host, email username and app password are required' });
  }
  const p = Number(port) || 993;
  const useTls = (enc || 'SSL').toUpperCase() !== 'NONE';
  let done = false;
  let stage = 0;

  const finish = (ok, message) => {
    if (done) return;
    done = true;
    try { socket.destroy(); } catch (_) { /* ignore */ }
    res.json({ ok, message });
  };

  const opts = { host, port: p, servername: host, rejectUnauthorized: !!validateSsl };
  const socket = useTls
    ? tls.connect(opts, () => {})
    : net.connect({ host, port: p }, () => {});

  socket.setTimeout(8000);
  socket.on('timeout', () => finish(false, 'Connection timed out'));
  socket.on('error', (e) => finish(false, e.message || 'Connection failed'));
  socket.on('data', (buf) => {
    const s = buf.toString();
    if (stage === 0 && s.includes('* OK')) {
      stage = 1;
      socket.write(`a1 LOGIN "${username}" "${password}"\r\n`);
    } else if (stage === 1) {
      if (/a1 OK/i.test(s)) finish(true, 'Login successful — mailbox reachable.');
      else if (/a1 (NO|BAD)/i.test(s)) finish(false, 'Login rejected — check email & app password.');
    }
  });
});

function getLocalNetworkUrls() {
  const urls = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}

app.listen(port, host, () => {
  if (appConfig.publicUrl) {
    console.log(`Server listening — public URL: ${appConfig.publicUrl}`);
  } else {
    console.log(`Server listening on ${host}:${port}`);
    if (host === '0.0.0.0' || host === '::') {
      console.log(`  Local: http://127.0.0.1:${port}`);
      const networkUrls = getLocalNetworkUrls();
      if (networkUrls.length) {
        console.log('  LAN:');
        networkUrls.forEach((url) => console.log(`    ${url}`));
      }
    }
  }
  processExpiredTingiHolds();
  setInterval(processExpiredTingiHolds, 15 * 60 * 1000);
});
