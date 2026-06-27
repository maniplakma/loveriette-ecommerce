/** Live activity feed — masked buyer names + product summaries */

function maskBuyerName(raw) {
  const source = String(raw || '').trim();
  if (!source) return 'Someone';

  let token = source;
  if (source.includes('@')) {
    token = source.split('@')[0].replace(/[._+-]+/g, ' ').trim();
  } else {
    token = source.split(/\s+/)[0];
  }

  token = token.replace(/[^a-zA-Z0-9\u00C0-\u024F]/g, '');
  if (!token) return 'Someone';

  const name = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  if (name.length <= 1) return `${name}***`;
  if (name.length === 2) return `${name[0]}***`;
  const stars = '*'.repeat(Math.min(3, name.length - 2));
  return `${name[0]}${stars}${name[name.length - 1]}`;
}

function formatOrderItemsSummary(items) {
  const list = (items || []).filter((i) => i && i.name);
  if (!list.length) return 'an item';
  return list.map((item) => {
    const qty = Number(item.quantity) || 1;
    const pcs = qty === 1 ? '1 pc' : `${qty} pcs`;
    return `${item.name} (${pcs})`;
  }).join(', ');
}

function buildOrderActivityMessage(buyerName, items) {
  return `${maskBuyerName(buyerName)} bought ${formatOrderItemsSummary(items)}`;
}

function buildOrderActivityMeta(orderNumber, buyerName, items) {
  return {
    orderNumber,
    buyerMasked: maskBuyerName(buyerName),
    items: (items || []).map((i) => ({
      name: i.name,
      quantity: Number(i.quantity) || 1
    }))
  };
}

function mapActivityFeedRow(row) {
  let meta = {};
  try {
    meta = JSON.parse(row.metaJson ?? row.meta_json ?? '{}');
  } catch (_) {
    meta = {};
  }

  const type = row.type ?? row.feed_type;
  let message = row.message;

  if (type === 'order' && meta.buyerMasked && meta.items?.length) {
    message = `${meta.buyerMasked} bought ${formatOrderItemsSummary(meta.items)}`;
  } else if (type === 'order' && /^New order placed/i.test(message)) {
    const num = message.replace(/^New order placed\s*[—–-]\s*/i, '').trim();
    message = num ? `Someone placed order #${num}` : 'Someone placed a new order';
  }

  return {
    type,
    message,
    meta,
    createdAt: row.createdAt ?? row.created_at
  };
}

module.exports = {
  maskBuyerName,
  formatOrderItemsSummary,
  buildOrderActivityMessage,
  buildOrderActivityMeta,
  mapActivityFeedRow
};
