'use strict';

const { RIETTE_GAME_PATHS } = require('./games-paths');

const DEFAULT_GUIDES = {
  wheel: '/guide.html#game-wheel',
  scratch: '/guide.html#game-scratch',
  mystery: '/guide.html#game-mystery',
  dice: '/guide.html#game-dice',
  pick: '/guide.html#game-pick',
  vault: '/guide.html#game-vault'
};

const DEFAULT_SHOP_LINKS = {
  wheel: '/shop',
  scratch: '/shop',
  mystery: '/shop',
  dice: '/shop',
  pick: '/shop',
  vault: '/shop'
};

const GAME_KEYS = Object.keys(DEFAULT_GUIDES);

function readSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function writeSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw || '');
    return v ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function getGamesRules(db) {
  const productIds = parseJson(readSetting(db, 'games_required_product_ids', '[]'), []);
  const requiredQuantity = Math.max(1, Number(readSetting(db, 'games_required_quantity', '3')) || 3);
  const telegramHandle = readSetting(db, 'games_telegram_handle', '@loveriette').trim() || '@loveriette';
  const guides = { ...DEFAULT_GUIDES, ...parseJson(readSetting(db, 'games_guides', '{}'), {}) };
  const shopLinks = { ...DEFAULT_SHOP_LINKS, ...parseJson(readSetting(db, 'games_shop_links', '{}'), {}) };
  const strict = readSetting(db, 'games_strict_eligibility', '1') === '1';
  return {
    productIds: productIds.map((id) => Number(id)).filter((id) => id > 0),
    requiredQuantity,
    telegramHandle,
    guides,
    shopLinks,
    strict
  };
}

function getEligibleProducts(db, productIds) {
  if (!productIds.length) return [];
  const placeholders = productIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, name FROM products WHERE id IN (${placeholders}) ORDER BY name ASC
  `).all(...productIds);
}

function getQualifyingOrderItems(db, orderId) {
  const rules = getGamesRules(db);
  const items = db.prepare(`
    SELECT id, product_id, quantity FROM order_items WHERE order_id = ?
  `).all(orderId);
  if (!rules.strict || !rules.productIds.length) return items;
  return items.filter((line) =>
    rules.productIds.includes(Number(line.product_id))
    && Number(line.quantity) >= rules.requiredQuantity
  );
}

function orderIsDeliveredForGames(db, orderId) {
  const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'approved') return false;

  const relevant = getQualifyingOrderItems(db, orderId);
  if (!relevant.length) return false;

  for (const item of relevant) {
    const fulfilled = db.prepare(
      'SELECT COUNT(*) AS c FROM order_fulfillments WHERE order_item_id = ?'
    ).get(item.id).c;
    if (fulfilled < Number(item.quantity)) return false;
  }
  return true;
}

function orderQualifiesForGames(db, orderId) {
  const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'approved') return false;
  if (!orderIsDeliveredForGames(db, orderId)) return false;

  const rules = getGamesRules(db);
  if (!rules.strict || !rules.productIds.length) return true;
  return getQualifyingOrderItems(db, orderId).length > 0;
}

function getGrandDrawOrderItems(db, orderId) {
  const rules = getGamesRules(db);
  const items = db.prepare(`
    SELECT id, product_id, quantity FROM order_items WHERE order_id = ?
  `).all(orderId);
  if (!rules.strict || !rules.productIds.length) return items;
  return items.filter((line) =>
    rules.productIds.includes(Number(line.product_id))
    && Number(line.quantity) >= rules.requiredQuantity
  );
}

function orderQualifiesForGrandDraw(db, orderId) {
  const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status !== 'approved') return false;
  return getGrandDrawOrderItems(db, orderId).length > 0;
}

function eligibilityMessage(db) {
  const rules = getGamesRules(db);
  const products = getEligibleProducts(db, rules.productIds);
  const choiceNote = 'Each qualifying purchase unlocks ONE game — pick yours after delivery.';
  if (!rules.strict || !rules.productIds.length) {
    return `Purchase from the shop — ${choiceNote}`;
  }
  const names = products.map((p) => p.name).join(', ') || 'selected account products';
  return `Buy at least ${rules.requiredQuantity} quantity of ${names} — ${choiceNote}`;
}

function buildEligibilityHub(db) {
  const rules = getGamesRules(db);
  const products = getEligibleProducts(db, rules.productIds);
  return {
    strict: rules.strict && rules.productIds.length > 0,
    requiredQuantity: rules.requiredQuantity,
    products: products.map((p) => ({ id: p.id, name: p.name })),
    telegramHandle: rules.telegramHandle,
    guides: rules.guides,
    shopLinks: rules.shopLinks,
    gameLinks: { ...RIETTE_GAME_PATHS },
    message: eligibilityMessage(db),
    oneGamePerPurchase: true
  };
}

function saveGamesRules(db, body) {
  if (body.requiredQuantity != null) {
    writeSetting(db, 'games_required_quantity', Math.max(1, Number(body.requiredQuantity) || 3));
  }
  if (body.productIds != null) {
    const ids = (Array.isArray(body.productIds) ? body.productIds : [])
      .map((id) => Number(id)).filter((id) => id > 0);
    writeSetting(db, 'games_required_product_ids', JSON.stringify(ids));
  }
  if (body.telegramHandle != null) {
    writeSetting(db, 'games_telegram_handle', String(body.telegramHandle).trim() || '@loveriette');
  }
  if (body.guides != null && typeof body.guides === 'object') {
    writeSetting(db, 'games_guides', JSON.stringify({ ...DEFAULT_GUIDES, ...body.guides }));
  }
  if (body.shopLinks != null && typeof body.shopLinks === 'object') {
    const merged = { ...DEFAULT_SHOP_LINKS };
    for (const key of GAME_KEYS) {
      const raw = String(body.shopLinks[key] || '').trim();
      if (raw) merged[key] = raw;
    }
    writeSetting(db, 'games_shop_links', JSON.stringify(merged));
  }
  if (body.strictEligibility != null) {
    writeSetting(db, 'games_strict_eligibility', body.strictEligibility ? '1' : '0');
  }
}

module.exports = {
  DEFAULT_GUIDES,
  DEFAULT_SHOP_LINKS,
  GAME_KEYS,
  getGamesRules,
  getEligibleProducts,
  getQualifyingOrderItems,
  getGrandDrawOrderItems,
  orderIsDeliveredForGames,
  orderQualifiesForGames,
  orderQualifiesForGrandDraw,
  eligibilityMessage,
  buildEligibilityHub,
  saveGamesRules
};
