const STATUS_LABEL = {
  approved: 'Approved — enjoy ♡',
  pending: 'Pending review',
  pending_payment: 'Awaiting payment',
  rejected: 'Declined',
  refunded: 'Refunded'
};

const STATUS_CLASS = {
  approved: 'status-paid',
  pending: 'status-receipt',
  pending_payment: 'status-pending',
  rejected: 'status-cancelled',
  refunded: 'status-refunded'
};

let accountData = { user: null, orders: [] };
let walletData = { stats: {}, purchasedOrders: [] };
let purchaseAccounts = [];
let chatPollTimer = null;
let lastChatMessageId = 0;
let purchasesLoaded = false;
let purchasesLoadPromise = null;
let walletLoaded = false;
let walletLoadPromise = null;
let walletFilterTimer = null;
let chatInitialized = false;

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatMoney(n) {
  return `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentLink(order) {
  return `payment.html?order=${order.orderNumber}`;
}

function orderNeedsPayment(order) {
  return order.status === 'pending_payment';
}

function orderActionHtml(order, label) {
  if (orderNeedsPayment(order)) {
    return `<a href="${paymentLink(order)}" class="btn-view dashboard-order-link">${label}</a>`;
  }
  return `<button type="button" class="btn-view dashboard-order-link dashboard-order-view-btn" data-view-order="${escapeHtml(order.orderNumber)}">${label}</button>`;
}

function bindOrderViewButtons(root) {
  root.querySelectorAll('.dashboard-order-view-btn, .buyer-wallet-view-order').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPurchaseDetail(btn.dataset.viewOrder);
    });
  });
}

function bindPurchaseEyeButtons(root) {
  root.querySelectorAll('.buyer-purchase-view').forEach((btn) => {
    if (btn.dataset.boundEye) return;
    btn.dataset.boundEye = '1';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.buyer-purchase-card');
      if (!card) return;
      const credEl = card.querySelector('.buyer-purchase-credentials');
      const willShow = credEl?.hidden ?? true;
      if (!card.classList.contains('is-open')) {
        setPurchaseCardOpen(card, true);
      }
      await showPurchaseCredentials(card, willShow);
    });
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatOrderLabel(orderOrRef) {
  if (!orderOrRef) return '—';
  if (typeof orderOrRef === 'object') {
    const id = orderOrRef.displayId || orderOrRef.orderId || orderOrRef.orderNumber;
    return `#${id}`;
  }
  return `#${orderOrRef}`;
}

function credField(label, value, mono = true) {
  const display = value && String(value).trim() ? String(value) : '—';
  const safe = escapeHtml(display);
  const canCopy = display !== '—';
  const tag = mono ? 'code' : 'span';
  return `
    <div class="buyer-cred-field">
      <span class="buyer-cred-label">${escapeHtml(label)}</span>
      <div class="buyer-cred-value-row">
        <${tag} class="buyer-cred-value">${safe}</${tag}>
        ${canCopy ? `<button type="button" class="buyer-cred-copy" title="Copy ${escapeHtml(label)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>` : ''}
      </div>
    </div>`;
}

function bindCredCopy(root) {
  root.querySelectorAll('.buyer-cred-copy').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const row = btn.closest('.buyer-cred-value-row');
      const valEl = row?.querySelector('.buyer-cred-value');
      const text = valEl?.textContent?.trim();
      if (!text || text === '—') return;
      const label = btn.closest('.buyer-cred-field')?.querySelector('.buyer-cred-label')?.textContent?.trim();
      try {
        await navigator.clipboard.writeText(text);
        showToast(`${label || 'Value'} copied`);
        btn.classList.add('is-copied');
        setTimeout(() => btn.classList.remove('is-copied'), 1400);
      } catch {
        showToast('Could not copy', 'info');
      }
    });
  });
}

function renderOrderRejectNote(order) {
  if (order.status !== 'rejected' || !order.rejectReason) return '';
  return `<p class="dashboard-order-reject-note"><strong>Rejection reason:</strong> ${escapeHtml(order.rejectReason)}</p>`;
}

function renderOrderCard(order, actionLabel) {
  const itemSummary = order.items?.length
    ? order.items.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')
    : '—';
  const statusHtml = window.buyerProofBadge
    ? buyerProofBadge(order)
    : `<span class="dashboard-status ${STATUS_CLASS[order.status] || 'status-pending'}">${STATUS_LABEL[order.status] || order.status}</span>`;
  const label = actionLabel
    || (order.status === 'pending_payment' ? 'View / Pay' : 'View order');

  return `
    <article class="dashboard-order-card info-card">
      <div class="dashboard-order-top">
        <div>
          <p class="dashboard-order-number">Order ${formatOrderLabel(order)}</p>
          <p class="dashboard-order-date">${formatDate(order.createdAt)}</p>
        </div>
        ${statusHtml}
      </div>
      <p class="dashboard-order-items">${escapeHtml(itemSummary)}</p>
      ${renderOrderRejectNote(order)}
      <div class="dashboard-order-bottom">
        <div>
          <span class="dashboard-order-total">${formatMoney(order.total)}</span>
          <span class="dashboard-order-payment">${escapeHtml(order.paymentMethod || '')}</span>
        </div>
        ${orderActionHtml(order, label)}
      </div>
    </article>
  `;
}

function renderStats(summary, orders) {
  const pending = orders.filter((o) => o.status === 'pending_payment' || o.status === 'pending').length;
  document.getElementById('dash-stats').innerHTML = `
    <div class="buyer-stat-card buyer-stat-balance">
      <span>Available Balance</span>
      <strong>${formatMoney(summary.balance || 0)}</strong>
    </div>
    <div class="buyer-stat-card">
      <span>Total Orders</span>
      <strong>${summary.totalOrders ?? orders.length}</strong>
    </div>
    <div class="buyer-stat-card">
      <span>Total Spent</span>
      <strong>${formatMoney(summary.totalSpent || 0)}</strong>
    </div>
    <div class="buyer-stat-card">
      <span>Pre-Orders</span>
      <strong>${summary.preOrders || 0}</strong>
    </div>
  `;
}

function renderRecentOrders(orders) {
  const list = document.getElementById('dash-recent-orders');
  const empty = document.getElementById('dash-recent-empty');
  const recent = orders.slice(0, 5);
  if (!recent.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = recent.map((o) => renderOrderCard(o)).join('');
  bindOrderViewButtons(list);
}

let reportTab = 'report';
let reportVouchFile = null;
let reportExtraFiles = [];
let reportTargets = [];
let reportSelections = [];
let buyerReportsData = [];
let buyerReportsLoaded = false;
let currentPurchaseContext = null;
let servicesData = { plugging: [], loans: [], webtech: [] };
let servicesLoaded = false;
let servicesLoadPromise = null;

const PLUGGING_STATUS = {
  pending_payment: 'Awaiting payment',
  pending_approval: 'Pending approval',
  approved: 'Active',
  rejected: 'Rejected'
};

const LOAN_STATUS = {
  pending: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected'
};

const WEBTECH_STATUS = {
  new: 'New inquiry',
  reviewed: 'In progress',
  contacted: 'Contacted',
  closed: 'Closed'
};

function serviceStatusBadge(status, map) {
  const label = map[status] || status;
  const cls = status === 'approved' || status === 'closed' ? 'buyer-service-status-ok'
    : status === 'rejected' ? 'buyer-service-status-bad'
    : 'buyer-service-status-pending';
  return `<span class="buyer-service-status ${cls}">${escapeHtml(label)}</span>`;
}

function renderServiceCard({ icon, title, meta, statusHtml, actions }) {
  return `
    <article class="info-card buyer-service-card">
      <div class="buyer-service-card-head">
        <div class="buyer-service-card-icon" aria-hidden="true">${icon}</div>
        <div class="buyer-service-card-main">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(meta)}</span>
        </div>
        ${statusHtml}
      </div>
      ${actions ? `<div class="buyer-service-card-actions">${actions}</div>` : ''}
    </article>`;
}

function renderPluggingServices(items) {
  const list = document.getElementById('plugging-service-list');
  const empty = document.getElementById('plugging-service-empty');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = items.map((o) => {
    let actions = '';
    if (o.status === 'pending_payment') {
      actions = `<a href="/plugging/payment?order=${encodeURIComponent(o.orderRef)}" class="btn-view">Complete Payment</a>`;
    } else if (o.status === 'pending_approval') {
      actions = `<a href="/plugging/status?order=${encodeURIComponent(o.orderRef)}" class="btn-view">View Status</a>`;
    } else if (o.status === 'approved') {
      actions = `
        <a href="/plugging/workspace" class="btn-primary">Open Workspace</a>
        <a href="/plugging/status?order=${encodeURIComponent(o.orderRef)}" class="btn-view">View Key</a>`;
    }
    const keyLine = o.accessKey
      ? `<p class="buyer-service-key">Access key: <code>${escapeHtml(o.accessKey)}</code></p>`
      : '';
    return renderServiceCard({
      icon: '⚡',
      title: o.planName || 'Plugging Plan',
      meta: `${o.orderRef} · ${formatDate(o.createdAt)} · ${formatMoney(o.total)}`,
      statusHtml: serviceStatusBadge(o.status, PLUGGING_STATUS),
      actions: `${keyLine}${actions}`
    });
  }).join('');
}

function renderLoanServices(items) {
  const list = document.getElementById('loan-service-list');
  const empty = document.getElementById('loan-service-empty');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = items.map((a) => renderServiceCard({
    icon: '💳',
    title: a.planName || 'Loan Application',
    meta: `${a.applicationId} · ${formatDate(a.createdAt)}`,
    statusHtml: serviceStatusBadge(a.status, LOAN_STATUS),
    actions: `<a href="/lending/application/${encodeURIComponent(a.applicationId)}" class="btn-view">View Application</a>`
  })).join('');
}

function renderWebtechServices(items) {
  const list = document.getElementById('webtech-service-list');
  const empty = document.getElementById('webtech-service-empty');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = items.map((q) => {
    const msg = q.message ? `<p class="buyer-service-message">${escapeHtml(q.message)}</p>` : '';
    return renderServiceCard({
      icon: '🖥',
      title: q.packageName || 'Website Inquiry',
      meta: `${formatDate(q.createdAt)}${q.name ? ` · ${q.name}` : ''}`,
      statusHtml: serviceStatusBadge(q.status, WEBTECH_STATUS),
      actions: msg
    });
  }).join('');
}

function renderAllServices() {
  renderPluggingServices(servicesData.plugging || []);
  renderLoanServices(servicesData.loans || []);
  renderWebtechServices(servicesData.webtech || []);
}

async function loadServices() {
  servicesData = await api('/account/services');
  servicesLoaded = true;
  renderAllServices();
}

async function ensureServicesLoaded() {
  if (servicesLoaded) {
    renderAllServices();
    return;
  }
  if (servicesLoadPromise) return servicesLoadPromise;
  servicesLoadPromise = loadServices()
    .catch((err) => { if (window.showToast) showToast(err.message, 'error'); })
    .finally(() => { servicesLoadPromise = null; });
  return servicesLoadPromise;
}

function purchaseItemLabel(order) {
  const item = order.items?.[0];
  if (!item) return `Order ${formatOrderLabel(order)}`;
  return item.name;
}

function purchaseItemCount(order) {
  return order.totalQuantity || order.items?.reduce((s, i) => s + i.quantity, 0) || 0;
}

function purchaseStatusLabel(order) {
  if (order.status === 'rejected') {
    return { html: window.themeBadge ? themeBadge('cancelled', 'Rejected') : 'REJECTED', cls: 'buyer-purchase-rejected' };
  }
  if (order.status === 'approved') {
    return { html: window.themeBadge ? themeBadge('approved', 'Completed') : 'COMPLETED', cls: 'buyer-purchase-completed' };
  }
  if (order.status === 'pending') {
    return { html: window.themeBadge ? themeBadge('pending') : 'PENDING', cls: 'buyer-purchase-pending' };
  }
  if (order.status === 'pending_payment') {
    return { html: window.buyerProofBadge ? buyerProofBadge(order) : 'NO PROOF', cls: 'buyer-purchase-pending' };
  }
  const text = (STATUS_LABEL[order.status] || order.status).toUpperCase();
  return { html: window.orderStatusBadge ? orderStatusBadge(order.status) : text, cls: 'buyer-purchase-pending' };
}

function findPurchaseCard(orderRef) {
  const ref = String(orderRef || '').trim().replace(/^#/, '');
  if (!ref) return null;
  const cards = document.querySelectorAll('.buyer-purchase-card[data-order]');
  for (const card of cards) {
    if (card.dataset.order === ref) return card;
  }
  const orders = accountData.orders || [];
  const match = orders.find((o) =>
    o.orderNumber === ref
    || String(o.displayId || '') === ref
    || String(o.orderId ?? '') === ref
  );
  if (!match) return null;
  return document.querySelector(`.buyer-purchase-card[data-order="${match.orderNumber}"]`);
}

const purchaseCardDataCache = new Map();

function clearPurchaseCardCache(orderNumber) {
  if (orderNumber) purchaseCardDataCache.delete(orderNumber);
  else purchaseCardDataCache.clear();
}

async function loadPurchaseCardData(orderNumber) {
  if (purchaseCardDataCache.has(orderNumber)) {
    return purchaseCardDataCache.get(orderNumber);
  }
  const data = await fetchOrderCredentials(orderNumber);
  await loadBuyerReports(true);
  purchaseCardDataCache.set(orderNumber, data);
  return data;
}

async function fetchOrderCredentials(orderNumber) {
  let data = await api(`/account/orders/${encodeURIComponent(orderNumber)}/credentials`);
  if (
    data.isApproved
    && data.buyerPhase !== 'pending_approval'
    && data.buyerPhase !== 'waiting_for_stock'
    && !(data.accounts?.length)
  ) {
    await new Promise((r) => setTimeout(r, 400));
    data = await api(`/account/orders/${encodeURIComponent(orderNumber)}/credentials`);
  }
  return data;
}

function setPurchaseCardOpen(card, open) {
  const btn = card.querySelector('.buyer-purchase-toggle');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  card.classList.toggle('is-open', open);
}

async function showPurchaseCredentials(card, show) {
  const credEl = card.querySelector('.buyer-purchase-credentials');
  const metaEl = card.querySelector('.buyer-purchase-meta');
  const eyeBtn = card.querySelector('.buyer-purchase-view');
  if (!credEl) return;

  if (!show) {
    card.classList.remove('is-details-open');
    credEl.hidden = true;
    credEl.setAttribute('aria-hidden', 'true');
    if (metaEl) {
      metaEl.hidden = true;
      metaEl.setAttribute('aria-hidden', 'true');
    }
    if (eyeBtn) {
      eyeBtn.setAttribute('aria-expanded', 'false');
      eyeBtn.classList.remove('is-active');
      eyeBtn.setAttribute('title', 'Show credentials');
      eyeBtn.setAttribute('aria-label', 'Show credentials');
    }
    return;
  }

  const orderNumber = card.dataset.order;
  const needsLoad = credEl.dataset.loaded !== orderNumber;

  if (needsLoad) {
    credEl.innerHTML = '<p class="dashboard-loading">Loading credentials…</p>';
    if (metaEl) metaEl.innerHTML = '';
    credEl.hidden = false;
    card.classList.add('is-details-open');
    try {
      const data = await loadPurchaseCardData(orderNumber);
      currentPurchaseContext = data;
      credEl.innerHTML = renderPurchaseCredentialsHtml(data);
      if (metaEl) {
        metaEl.innerHTML = renderPurchaseMetaContent(data);
        metaEl.dataset.loaded = orderNumber;
        bindPurchaseDetailActions(metaEl, null);
      }
      credEl.dataset.loaded = orderNumber;
      bindCredCopy(credEl);
    } catch (err) {
      credEl.innerHTML = `<p class="dashboard-error">${escapeHtml(err.message)}</p>`;
      if (metaEl) metaEl.innerHTML = '';
    }
  }

  card.classList.add('is-details-open');
  credEl.hidden = false;
  credEl.setAttribute('aria-hidden', 'false');
  if (metaEl) {
    metaEl.hidden = false;
    metaEl.setAttribute('aria-hidden', 'false');
  }
  if (eyeBtn) {
    eyeBtn.setAttribute('aria-expanded', 'true');
    eyeBtn.classList.add('is-active');
    eyeBtn.setAttribute('title', 'Hide credentials');
    eyeBtn.setAttribute('aria-label', 'Hide credentials');
  }
}

async function togglePurchaseCard(card) {
  if (!card) return;
  if (card.classList.contains('is-open')) {
    setPurchaseCardOpen(card, false);
    await showPurchaseCredentials(card, false);
    return;
  }
  setPurchaseCardOpen(card, true);
}

async function focusPurchaseOrder(orderRef) {
  const card = findPurchaseCard(orderRef);
  if (!card) return;
  card.classList.add('is-targeted');
  setPurchaseCardOpen(card, true);
  await showPurchaseCredentials(card, true);
  requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  setTimeout(() => card.classList.remove('is-targeted'), 2600);
}

function renderActivePurchases(orders) {
  const list = document.getElementById('active-purchases-list');
  const empty = document.getElementById('active-purchases-empty');
  const statsEl = document.getElementById('purchase-stats');

  const completed = orders.filter((o) => o.status === 'approved');
  const pending = orders.filter((o) => o.status === 'pending' || o.status === 'pending_payment');
  const rejected = orders.filter((o) => o.status === 'rejected' || o.status === 'refunded');

  if (statsEl) {
    statsEl.hidden = !orders.length;
    statsEl.innerHTML = `
      <span>Completed <strong>${completed.length}</strong></span>
      <span>Pending <strong>${pending.length}</strong></span>
      <span>Rejected <strong>${rejected.length}</strong></span>
    `;
  }

  const display = [...completed, ...pending];
  if (!display.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  clearPurchaseCardCache();

  list.innerHTML = display.map((order) => {
    const qty = purchaseItemCount(order);
    const status = purchaseStatusLabel(order);
    const title = purchaseItemLabel(order);
    const initial = title.charAt(0).toUpperCase();
    const canView = order.status === 'approved'
      || order.status === 'pending'
      || order.status === 'pending_payment';
    return `
      <article class="buyer-purchase-card info-card" data-order="${escapeHtml(order.orderNumber)}">
        <button type="button" class="buyer-purchase-toggle" aria-expanded="false">
          <div class="buyer-purchase-icon">${escapeHtml(initial)}</div>
          <div class="buyer-purchase-summary">
            <strong>${escapeHtml(title)}</strong>
            <span>${qty} item${qty === 1 ? '' : 's'}</span>
          </div>
          <svg class="buyer-purchase-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="buyer-purchase-foot">
          <span class="buyer-purchase-date">${formatDate(order.createdAt)}</span>
          <span class="buyer-purchase-qty">×${qty}</span>
          <span class="buyer-purchase-status ${status.cls}">${status.html}</span>
          ${canView ? `
            <button type="button" class="buyer-purchase-view" data-view-order="${escapeHtml(order.orderNumber)}" aria-label="Show credentials" title="Show credentials" aria-expanded="false">
              <svg class="buyer-purchase-eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          ` : ''}
        </div>
        <div class="buyer-purchase-expand">
          <div class="buyer-purchase-credentials" hidden aria-hidden="true"></div>
          <div class="buyer-purchase-meta" hidden aria-hidden="true"></div>
        </div>
      </article>
    `;
  }).join('');

  list.querySelectorAll('.buyer-purchase-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      togglePurchaseCard(btn.closest('.buyer-purchase-card'));
    });
  });

  bindPurchaseEyeButtons(list);
}

function buyAgainUrl(items) {
  const item = items?.[0];
  if (!item?.productId) return 'index.html#products';
  let url = `checkout.html?product=${item.productId}`;
  if (item.variantId) url += `&plan=${item.variantId}`;
  return url;
}

function isTingiDropOrder(data) {
  return data?.buyerPhase === 'tingi_claim'
    || (data?.status === 'approved' && data?.fulfillmentMode === 'manual' && data?.tingiDropEnabled && data?.canClaimStock);
}

function renderBuyerOrderStatusPanel(data) {
  if (data?.buyerPhase === 'tingi_claim') return '';

  if (data?.status === 'rejected' || data?.buyerPhase === 'rejected') {
    const reason = data.rejectReason
      ? `<p class="buyer-order-reject-reason"><strong>Reason:</strong> ${escapeHtml(data.rejectReason)}</p>`
      : '';
    return `
      <section class="buyer-order-status-panel" aria-label="Order status">
        <div class="buyer-order-status-badges">${window.themeBadge ? themeBadge('cancelled', 'Rejected') : 'REJECTED'}</div>
        ${reason}
      </section>
    `;
  }

  const accountCount = data?.accounts?.length || 0;
  if (accountCount > 0 && data.buyerPhase === 'delivered') return '';

  const badges = [];
  if (!data?.isApproved) {
    badges.push(window.themeBadge ? themeBadge('pending') : 'Pending approval');
  } else {
    badges.push(window.themeBadge ? themeBadge('approved') : 'Approved');
    if (data.buyerPhase === 'waiting_for_stock') {
      badges.push(window.themeBadge ? themeBadge('waiting') : 'Waiting for stock');
    } else if (data.buyerPhase === 'delivered' && !accountCount) {
      badges.push(window.themeBadge ? themeBadge('waiting', 'Preparing credentials') : 'Preparing credentials');
    }
  }

  if (!badges.length) return '';

  return `
    <section class="buyer-order-status-panel" aria-label="Order status">
      <div class="buyer-order-status-badges">${badges.join('')}</div>
    </section>
  `;
}

function tingiDeliveredCount(data) {
  return data.fulfillmentClaimed ?? data.accountCount ?? 0;
}

function tingiTotalCount(data) {
  return data.fulfillmentExpected || data.expectedCount || 0;
}

function tingiProgressPct(delivered, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((delivered / total) * 100));
}

function renderTingiDropPanel(data) {
  if (data?.buyerPhase !== 'tingi_claim') return '';

  const total = tingiTotalCount(data);
  const delivered = tingiDeliveredCount(data);
  const waiting = data.fulfillmentRemaining ?? Math.max(0, total - delivered);
  const pct = tingiProgressPct(delivered, total);
  const holdDays = data.tingiHoldDays || 10;
  const isComplete = waiting <= 0 && delivered >= total;

  let actionHtml = '';
  if (data.canClaimStock) {
    actionHtml = `
      <div class="tingi-status-callout">
        <p>Request accounts one at a time during your ${holdDays}-day hold. Unclaimed units auto-deliver after expiry.</p>
        <button type="button" class="tingi-request-btn buyer-action-claim" data-claim-order="${escapeHtml(data.orderNumber)}">
          Request One Account
        </button>
      </div>`;
  } else if (waiting > 0 && data.tingiHoldUntil && !data.canClaimStock) {
    actionHtml = `
      <div class="tingi-status-callout tingi-status-callout--muted">
        <p>Hold period ended. Remaining ${waiting} unit(s) are being auto-delivered to your account.</p>
      </div>`;
  } else if (isComplete) {
    actionHtml = `
      <div class="tingi-status-callout tingi-status-callout--muted">
        <p>All ${total} units delivered. View your credentials below.</p>
      </div>`;
  } else if (waiting > 0) {
    actionHtml = `
      <div class="tingi-status-callout tingi-status-callout--muted">
        <p>${waiting} unit(s) pending — stock may still be processing.</p>
      </div>`;
  }

  const holdNote = data.tingiHoldUntil && !isComplete
    ? `<p class="tingi-hold-note">Hold until ${formatDate(data.tingiHoldUntil)}</p>`
    : '';

  const partialCard = !isComplete
    ? `
      <div class="tingi-status-card tingi-status-card--partial">
        <div class="tingi-status-head">
          <span class="tingi-status-partial-label">Partially fulfilled</span>
          <span class="tingi-status-count">${delivered}/${total} delivered</span>
        </div>
        <div class="tingi-progress tingi-progress--muted" aria-hidden="true">
          <div class="tingi-progress-fill" style="width: ${pct}%"></div>
        </div>
        <p class="tingi-status-sub">${waiting} item(s) waiting for delivery</p>
      </div>`
    : '';

  return `
    <section class="tingi-status-panel" aria-label="Tingi Drop status">
      <div class="tingi-status-card tingi-status-card--primary">
        <div class="tingi-status-head">
          <span class="tingi-status-label">
            <span class="tingi-status-glyph" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/>
                <path d="M4 7h16l-1.5 5H5.5L4 7z"/>
                <path d="M12 7V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v3"/>
              </svg>
            </span>
            Tingi Drop — Auto-Claim
          </span>
          <span class="tingi-status-count">${delivered}/${total} delivered</span>
        </div>
        ${holdNote}
        <div class="tingi-progress" aria-hidden="true">
          <div class="tingi-progress-fill" style="width: ${pct}%"></div>
        </div>
        ${actionHtml}
      </div>
      ${partialCard}
      <div class="tingi-account-status">
        <span class="tingi-account-status-label">Account status</span>
        <span class="tingi-status-badge">Good</span>
      </div>
    </section>
  `;
}

function purchaseModalTitle(data) {
  return data?.buyerPhase === 'tingi_claim' ? 'Details' : `Order ${formatOrderLabel(data)}`;
}

function bindPurchaseDetailActions(body, titleEl) {
  body.querySelector('.buyer-action-report')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    openReportModal({
      orderNumber: btn.dataset.reportOrder
    });
  });

  body.querySelector('.buyer-action-vouch')?.addEventListener('click', () => {
    document.getElementById('purchase-detail-modal').hidden = true;
    switchPanel('vouch-seller');
  });

  body.querySelector('.buyer-action-claim')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const result = await api(`/account/orders/${encodeURIComponent(btn.dataset.claimOrder)}/claim`, { method: 'POST' });
      showToast('Account delivered — credentials updated');
      if (result.credentials) {
        clearPurchaseCardCache(result.credentials.orderNumber);
        currentPurchaseContext = result.credentials;
        if (titleEl) titleEl.textContent = purchaseModalTitle(result.credentials);
        body.innerHTML = renderPurchaseDetailContent(result.credentials);
        bindCredCopy(body);
        bindPurchaseDetailActions(body, titleEl);
      }
      purchasesLoaded = false;
      loadPurchases(true);
      loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

function renderAccountReportNotes(stockItemId) {
  const matches = buyerReportsData.filter((r) =>
    (r.selectedItems || []).some((i) => Number(i.stockItemId) === Number(stockItemId))
  );
  if (!matches.length) return '';
  const latest = matches[0];
  return `
    <div class="buyer-account-report-note">
      <span class="buyer-report-admin-note-label">${latest.reportType === 'refund' ? 'Refund' : 'Report'} · ${escapeHtml(latest.status)}</span>
      ${latest.adminNote
        ? `<p class="buyer-account-report-note-text"><strong>Admin:</strong> ${escapeHtml(latest.adminNote)}</p>`
        : '<p class="buyer-account-report-note-text muted">Submitted — awaiting admin note.</p>'}
    </div>`;
}

function shouldShowEmailAccessSection(acc) {
  const access = acc.emailAccess;
  if (!access || !(access.email || access.password)) return false;
  const accessProf = (access.profileData || [])
    .map((p) => (typeof p === 'string' ? p : p?.detail))
    .filter(Boolean)
    .join(', ');
  const mainProf = String(acc.profile || '—').trim();
  const dupEmail = String(access.email || '').trim() === String(acc.email || '').trim();
  const dupPass = String(access.password || '').trim() === String(acc.password || '').trim();
  const dupProf = !accessProf || accessProf === mainProf;
  return !(dupEmail && dupPass && dupProf);
}

function renderPurchaseAccountsHtml(data) {
  const accounts = data.accounts || [];
  if (!accounts.length) return '';
  return accounts.map((acc) => {
    const access = acc.emailAccess;
    const accessHtml = shouldShowEmailAccessSection(acc)
      ? `
        <div class="buyer-cred-subsection">
          <h4>Email Access</h4>
          <div class="buyer-cred-grid">
            ${credField('Email', access.email)}
            ${credField('Password', access.password)}
            ${access.profileData?.length ? credField('Profile', access.profileData.map((p) => typeof p === 'string' ? p : p.detail).join(', '), false) : ''}
          </div>
        </div>
      `
      : '';
    return `
      <section class="buyer-account-block">
        <h3>${escapeHtml(acc.label)}</h3>
        ${renderAccountReportNotes(acc.stockItemId)}
        <div class="buyer-cred-grid">
          ${credField('Email', acc.email)}
          ${credField('Password', acc.password)}
          ${credField('Profile', acc.profile, false)}
        </div>
        ${accessHtml}
      </section>
    `;
  }).join('');
}

function renderPurchaseCredentialsHtml(data) {
  const accountsHtml = renderPurchaseAccountsHtml(data);
  if (!accountsHtml) {
    return '<p class="dashboard-empty">No credentials available yet.</p>';
  }
  return `<div class="buyer-purchase-accounts">${accountsHtml}</div>`;
}

function renderPurchaseRulesAndActions(data) {
  const accounts = data.accounts || [];
  const rulesHtml = accounts.length
    ? `
    <section class="buyer-rules-box">
      <div class="buyer-rules-head">📄 RULES &amp; REGULATIONS</div>
      <p>${escapeHtml(data.rules)}</p>
    </section>`
    : '';

  const reportBtn = accounts.length
    ? `<button type="button" class="buyer-action-btn buyer-action-report" data-report-order="${escapeHtml(data.orderNumber)}">Report Issue</button>`
    : '';
  const vouchBtn = accounts.length
    ? `<button type="button" class="buyer-action-btn buyer-action-vouch" data-goto-vouch="1">Vouch Seller</button>`
    : '';

  return `
    ${rulesHtml}
    <div class="buyer-purchase-actions">
      <a href="${buyAgainUrl(data.items)}" class="buyer-action-btn buyer-action-buy">Buy Again</a>
      ${reportBtn}
      ${vouchBtn}
    </div>
  `;
}

function renderPurchaseMetaContent(data) {
  return `
    ${renderBuyerOrderStatusPanel(data)}
    ${renderTingiDropPanel(data)}
    ${renderPurchaseRulesAndActions(data)}
  `;
}

function renderPurchaseDetailContent(data) {
  return `
    ${renderBuyerOrderStatusPanel(data)}
    ${renderTingiDropPanel(data)}
    ${renderPurchaseCredentialsHtml(data)}
    ${renderPurchaseRulesAndActions(data)}
  `;
}

async function openPurchaseDetail(orderNumber) {
  const modal = document.getElementById('purchase-detail-modal');
  const body = document.getElementById('purchase-modal-body');
  const title = document.getElementById('purchase-modal-title');
  modal.hidden = false;
  title.textContent = `Order ${formatOrderLabel({ orderNumber })}`;
  body.innerHTML = '<p class="dashboard-loading">Loading credentials…</p>';

  try {
    const data = await loadPurchaseCardData(orderNumber);
    currentPurchaseContext = data;
    title.textContent = purchaseModalTitle(data);
    body.innerHTML = renderPurchaseDetailContent(data);
    bindCredCopy(body);
    bindPurchaseDetailActions(body, title);
  } catch (err) {
    body.innerHTML = `<p class="dashboard-error">${escapeHtml(err.message)}</p>`;
  }
}

function closePurchaseDetail() {
  document.getElementById('purchase-detail-modal').hidden = true;
  currentPurchaseContext = null;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

function clearReportFormErrors() {
  document.querySelectorAll('.buyer-report-error').forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
}

function showReportFieldError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function resetReportFormFields() {
  document.getElementById('report-order-number').value = '';
  document.getElementById('report-stock-item-id').value = '';
  document.getElementById('report-name').value = '';
  document.getElementById('report-issue').value = '';
  document.getElementById('report-remaining').value = '';
  document.getElementById('report-subscription').value = '';
  document.getElementById('refund-issue').value = '';
  document.getElementById('refund-bank').value = '';
  reportTargets = [];
  reportSelections = [];
  const targetList = document.getElementById('report-target-list');
  if (targetList) targetList.innerHTML = '';
  resetReportProofUploads();
  clearReportFormErrors();
}

function syncReportSelectionsFromPicker() {
  reportSelections = [];
  document.querySelectorAll('.report-target-check:checked').forEach((cb) => {
    const stockItemId = Number(cb.dataset.stock);
    const target = reportTargets.find((t) => t.stockItemId === stockItemId);
    let profileIndex = 0;
    if (target?.profiles?.length > 1) {
      const radio = document.querySelector(`input[name="report-profile-${stockItemId}"]:checked`);
      profileIndex = radio ? Number(radio.value) : null;
    }
    reportSelections.push({ stockItemId, profileIndex });
  });
  document.querySelectorAll('[data-profile-group]').forEach((group) => {
    const stockItemId = Number(group.dataset.profileGroup);
    const checked = document.querySelector(`.report-target-check[data-stock="${stockItemId}"]:checked`);
    group.hidden = !checked;
  });
}

function renderReportTargetPicker(ctx = {}) {
  const wrap = document.getElementById('report-target-list');
  if (!wrap) return;
  if (!reportTargets.length) {
    wrap.innerHTML = '<p class="buyer-report-target-empty">No delivered accounts available to report for this order.</p>';
    return;
  }

  const preselectStock = Number(ctx.stockItemId) || 0;
  wrap.innerHTML = reportTargets.map((t) => {
    const disabled = t.hasActiveReport;
    const shouldCheck = !disabled && (
      reportSelections.some((s) => s.stockItemId === t.stockItemId)
      || (preselectStock && preselectStock === t.stockItemId && reportTargets.length === 1)
    );
    const profilePick = t.profiles.length > 1
      ? `
        <div class="buyer-report-profile-pick" data-profile-group="${t.stockItemId}" ${shouldCheck ? '' : 'hidden'}>
          <span class="buyer-report-form-label" style="font-size:11px;margin:0">Profile to report</span>
          ${t.profiles.map((p) => `
            <label class="buyer-report-profile-option">
              <input type="radio" name="report-profile-${t.stockItemId}" value="${p.index}" ${shouldCheck && p.index === 0 ? 'checked' : ''}>
              <span>${escapeHtml(p.detail)}${p.reported ? ' · reported' : ''}</span>
            </label>
          `).join('')}
        </div>`
      : '';
    return `
      <div class="buyer-report-target ${disabled ? 'is-disabled' : ''}">
        <label class="buyer-report-target-main">
          <input type="checkbox" class="report-target-check" data-stock="${t.stockItemId}" ${disabled ? 'disabled' : ''} ${shouldCheck ? 'checked' : ''}>
          <div>
            <strong>${escapeHtml(t.label)} — ${escapeHtml(t.productName)}</strong>
            <small class="admin-card-meta">${escapeHtml(t.email || '')}${disabled ? ' · active report exists' : ''}</small>
          </div>
        </label>
        ${profilePick}
      </div>`;
  }).join('');

  wrap.querySelectorAll('.report-target-check').forEach((cb) => {
    cb.addEventListener('change', syncReportSelectionsFromPicker);
  });
  wrap.querySelectorAll('input[type="radio"][name^="report-profile-"]').forEach((radio) => {
    radio.addEventListener('change', syncReportSelectionsFromPicker);
  });
  syncReportSelectionsFromPicker();
}

async function loadReportTargets(ctx = {}) {
  const orderNum = ctx.orderNumber || currentPurchaseContext?.orderNumber || '';
  const wrap = document.getElementById('report-target-list');
  if (wrap) wrap.innerHTML = '<p class="buyer-report-target-empty">Loading accounts…</p>';
  try {
    const path = orderNum
      ? `/account/orders/${encodeURIComponent(orderNum)}/report-targets`
      : '/account/report-targets';
    const data = await api(path);
    reportTargets = data.targets || [];
    if (ctx.stockItemId && reportTargets.length === 1) {
      reportSelections = [{ stockItemId: Number(ctx.stockItemId), profileIndex: 0 }];
    }
    renderReportTargetPicker(ctx);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<p class="buyer-report-target-empty">${escapeHtml(err.message)}</p>`;
    reportTargets = [];
    reportSelections = [];
  }
}

function validateReportForm(type) {
  clearReportFormErrors();
  let valid = true;

  const name = document.getElementById('report-name').value.trim();
  const remaining = document.getElementById('report-remaining').value.trim();
  const subscription = document.getElementById('report-subscription').value.trim();

  if (!name) {
    showReportFieldError('report-error-name', 'Name is required.');
    valid = false;
  }
  if (!remaining) {
    showReportFieldError('report-error-remaining', 'Remaining days is required.');
    valid = false;
  }
  if (!subscription) {
    showReportFieldError('report-error-subscription', 'Subscription / product is required.');
    valid = false;
  }

  if (type === 'refund') {
    const refundIssue = document.getElementById('refund-issue').value.trim();
    const bank = document.getElementById('refund-bank').value.trim();
    if (!refundIssue) {
      showReportFieldError('report-error-refund-issue', 'Describe why you are requesting a refund.');
      valid = false;
    }
    if (!bank) {
      showReportFieldError('report-error-refund-bank', 'Bank account details are required for refunds.');
      valid = false;
    }
  } else {
    const issue = document.getElementById('report-issue').value.trim();
    if (!issue) {
      showReportFieldError('report-error-issue', 'Describe the issue with this account.');
      valid = false;
    }
  }

  if (!reportVouchFile) {
    showReportFieldError('report-error-vouch', 'Upload a vouch screenshot — no vouch = voided.');
    valid = false;
  }
  if (reportExtraFiles.length < 1) {
    showReportFieldError('report-error-extra', 'Upload at least one additional proof photo (minimum 2 photos total).');
    valid = false;
  }

  syncReportSelectionsFromPicker();
  if (!reportSelections.length) {
    showReportFieldError('report-error-targets', 'Select at least one account or product to report.');
    valid = false;
  } else {
    for (const sel of reportSelections) {
      const target = reportTargets.find((t) => t.stockItemId === sel.stockItemId);
      if (target?.profiles?.length > 1 && sel.profileIndex == null) {
        showReportFieldError('report-error-targets', 'Select which profile to report for shared credentials.');
        valid = false;
        break;
      }
    }
  }

  return valid;
}

function resetReportProofUploads() {
  reportVouchFile = null;
  reportExtraFiles = [];
  const vouchInput = document.getElementById('report-proof-vouch');
  const extraInput = document.getElementById('report-proof-extra');
  if (vouchInput) vouchInput.value = '';
  if (extraInput) extraInput.value = '';
  renderReportProofPreviews();
}

function renderReportProofThumb(file, { extraIndex } = {}) {
  const url = URL.createObjectURL(file);
  const removeAttrs = extraIndex != null
    ? `data-extra-remove="${extraIndex}"`
    : 'data-vouch-remove="1"';
  return `
    <div class="buyer-report-thumb">
      <button type="button" class="buyer-report-thumb-remove" ${removeAttrs} aria-label="Remove photo">&times;</button>
      <img src="${url}" alt="Proof preview">
    </div>`;
}

function renderReportProofPreviews() {
  const vouchPrev = document.getElementById('report-vouch-preview');
  const extraPrev = document.getElementById('report-extra-preview');
  if (!vouchPrev || !extraPrev) return;
  vouchPrev.innerHTML = reportVouchFile ? renderReportProofThumb(reportVouchFile) : '';
  extraPrev.innerHTML = reportExtraFiles.map((file, i) => renderReportProofThumb(file, { extraIndex: i })).join('');
}

function bindReportProofPreviewActions() {
  document.getElementById('report-vouch-preview')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-vouch-remove]');
    if (!btn) return;
    reportVouchFile = null;
    document.getElementById('report-proof-vouch').value = '';
    renderReportProofPreviews();
  });
  document.getElementById('report-extra-preview')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-extra-remove]');
    if (!btn) return;
    const idx = Number(btn.dataset.extraRemove);
    if (Number.isNaN(idx)) return;
    reportExtraFiles.splice(idx, 1);
    document.getElementById('report-proof-extra').value = '';
    renderReportProofPreviews();
  });
}

function openReportModal(ctx = {}) {
  reportTab = 'report';
  const orderNum = ctx.orderNumber || currentPurchaseContext?.orderNumber || '';
  document.getElementById('report-order-number').value = orderNum;
  document.getElementById('report-stock-item-id').value = '';
  document.getElementById('report-name').value = accountData.user?.name || '';
  document.getElementById('report-subscription').value = ctx.subscription || currentPurchaseContext?.items?.[0]?.name || '';
  document.getElementById('report-issue').value = '';
  document.getElementById('report-remaining').value = '';
  document.getElementById('refund-issue').value = '';
  document.getElementById('refund-bank').value = '';
  reportTargets = [];
  reportSelections = [];
  resetReportProofUploads();
  clearReportFormErrors();
  setReportTab('report');
  document.getElementById('report-issue-modal').hidden = false;
  loadReportTargets(ctx);
}

function closeReportModal() {
  document.getElementById('report-issue-modal').hidden = true;
  resetReportFormFields();
}

function setReportTab(tab) {
  reportTab = tab;
  clearReportFormErrors();
  document.querySelectorAll('.buyer-report-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.rtab === tab);
  });
  document.querySelectorAll('.buyer-report-panel').forEach((p) => {
    p.hidden = p.dataset.rpanel !== tab;
    p.classList.toggle('active', p.dataset.rpanel === tab);
  });
  const submitBtn = document.querySelector('.buyer-report-submit');
  if (submitBtn) {
    submitBtn.textContent = tab === 'refund' ? 'Submit Refund Request' : 'Submit Report';
  }
}

async function submitReportForm(e) {
  e.preventDefault();
  const type = reportTab;

  if (!validateReportForm(type)) {
    showToast('Please fix the errors below', 'error');
    return;
  }

  const issue = type === 'refund'
    ? document.getElementById('refund-issue').value.trim()
    : document.getElementById('report-issue').value.trim();

  const submitBtn = document.querySelector('.buyer-report-submit');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const vouchImage = await readFileAsDataUrl(reportVouchFile);
    const proofImages = await Promise.all(reportExtraFiles.map((file) => readFileAsDataUrl(file)));

    const payload = {
      orderNumber: document.getElementById('report-order-number').value,
      name: document.getElementById('report-name').value.trim(),
      issue,
      remainingDays: document.getElementById('report-remaining').value.trim(),
      subscription: document.getElementById('report-subscription').value.trim(),
      selections: reportSelections.map((s) => ({
        stockItemId: s.stockItemId,
        profileIndex: s.profileIndex != null ? s.profileIndex : 0
      })),
      vouchImage,
      proofImages
    };

    if (type === 'refund') {
      payload.bankAccount = document.getElementById('refund-bank').value.trim();
    }

    const endpoint = type === 'refund' ? '/refunds' : '/reports';
    const res = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    showToast(res.message || (type === 'refund' ? 'Refund report submitted successfully!' : 'Report submitted successfully!'));
    closeReportModal();
    loadBuyerReports(true);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadBuyerReports(silent) {
  try {
    const data = await api('/account/reports');
    buyerReportsData = data.reports || [];
    buyerReportsLoaded = true;
    renderBuyerReports();
    const detailModal = document.getElementById('purchase-detail-modal');
    if (currentPurchaseContext?.orderNumber && detailModal && !detailModal.hidden) {
      const body = document.getElementById('purchase-modal-body');
      const title = document.getElementById('purchase-modal-title');
      if (body && title) {
        body.innerHTML = renderPurchaseDetailContent(currentPurchaseContext);
        bindCredCopy(body);
        bindPurchaseDetailActions(body, title);
      }
    }
  } catch (err) {
    if (!silent) showToast(err.message, 'error');
  }
}

function renderBuyerReports() {
  const list = document.getElementById('buyer-reports-list');
  const empty = document.getElementById('buyer-reports-empty');
  if (!list) return;
  if (!buyerReportsData.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = buyerReportsData.map((r) => `
    <article class="buyer-report-card info-card">
      <header class="buyer-report-card-head">
        <div>
          <strong>${escapeHtml(r.productSummary || r.product || 'Product')}</strong>
          <span class="buyer-report-card-meta">Order #${escapeHtml(r.orderNumber || '—')} · ${r.reportType === 'refund' ? 'Refund' : 'Report'}</span>
        </div>
        <span class="buyer-status-pill ${r.status === 'active' ? 'pending' : 'done'}">${escapeHtml(r.status)}</span>
      </header>
      <dl class="buyer-report-card-grid">
        <div><dt>Issue</dt><dd>${escapeHtml(r.issue || '—')}</dd></div>
        <div><dt>Remaining days</dt><dd>${escapeHtml(r.remainingDays || '—')}</dd></div>
        <div><dt>Selected item(s)</dt><dd>${escapeHtml(r.selectedItemsSummary || '—')}</dd></div>
      </dl>
      <div class="buyer-report-admin-note ${r.adminNote ? 'has-note' : ''}">
        <span class="buyer-report-admin-note-label">Admin note</span>
        <p>${r.adminNote ? escapeHtml(r.adminNote) : 'No admin note yet — check back later.'}</p>
      </div>
      <footer class="buyer-report-card-foot">
        <small>Submitted ${formatDate(r.createdAt)}</small>
      </footer>
    </article>
  `).join('');
}

function walletFilters() {
  return {
    search: document.getElementById('wallet-search')?.value.trim().toLowerCase() || '',
    from: document.getElementById('wallet-from')?.value || '',
    to: document.getElementById('wallet-to')?.value || ''
  };
}

function inDateRange(dateStr, from, to) {
  if (!dateStr) return true;
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return true;
  if (from && d < new Date(`${from}T00:00:00`)) return false;
  if (to && d > new Date(`${to}T23:59:59`)) return false;
  return true;
}

function renderWalletStats() {
  const s = walletData.stats || {};
  document.getElementById('wallet-stats').innerHTML = `
    <div class="buyer-wallet-stat buyer-wallet-stat-balance">
      <span>Balance</span>
      <strong>${formatMoney(s.balance || 0)}</strong>
    </div>
    <div class="buyer-wallet-stat">
      <span>Total Orders</span>
      <strong>${s.totalOrders || 0}</strong>
    </div>
    <div class="buyer-wallet-stat buyer-wallet-stat-pre">
      <span>Pre-Orders</span>
      <strong>${s.preOrders || 0}</strong>
    </div>
    <div class="buyer-wallet-stat buyer-wallet-stat-reports">
      <span>Reports</span>
      <strong>${s.reports || 0}</strong>
    </div>
    <div class="buyer-wallet-stat buyer-wallet-stat-refund">
      <span>Refunds Rcvd</span>
      <strong>${formatMoney(s.refundsReceived || 0)}</strong>
    </div>
  `;
}

function renderWallet() {
  renderWalletStats();
  const list = document.getElementById('wallet-list');
  const empty = document.getElementById('wallet-empty');
  const { search, from, to } = walletFilters();

  const rows = (walletData.purchasedOrders || []).filter((o) => {
    const hay = `${o.orderNumber} ${o.paymentMethod} ${(o.items || []).map((i) => i.name).join(' ')}`.toLowerCase();
    return (!search || hay.includes(search)) && inDateRange(o.createdAt, from, to);
  }).map((o) => ({
    kind: 'order',
    amount: o.total,
    label: STATUS_LABEL[o.status] || o.status,
    ref: o.displayId || o.orderId || o.orderNumber,
    date: o.createdAt,
    detail: (o.items || []).map((i) => i.name).join(', '),
    href: orderNeedsPayment(o) ? paymentLink(o) : null,
    viewOrder: orderNeedsPayment(o) ? null : o.orderNumber
  }));

  if (!rows.length) {
    list.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No purchased orders yet.';
    return;
  }
  empty.hidden = true;
  list.innerHTML = rows.map((r) => `
    <div class="buyer-wallet-row info-card">
      <div>
        <strong>${formatMoney(r.amount)}</strong>
        <span>${escapeHtml(r.label)}</span>
        <small>${escapeHtml(r.detail)}</small>
      </div>
      <div class="buyer-wallet-meta">
        <span>#${escapeHtml(r.ref)}</span>
        <span>${formatDate(r.date)}</span>
      </div>
      ${r.viewOrder ? `<button type="button" class="btn-view buyer-wallet-view-order" data-view-order="${escapeHtml(r.viewOrder)}">View account</button>` : ''}
      ${r.href ? `<a href="${r.href}" class="btn-view">Pay</a>` : ''}
    </div>
  `).join('');
  bindOrderViewButtons(list);
}

function renderEmailAccountSelect() {
  const select = document.getElementById('email-account-select');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Select account…</option>'
    + purchaseAccounts.map((a) => `<option value="${a.id}">${escapeHtml(a.email || '—')}</option>`).join('');
  if (current && purchaseAccounts.some((a) => String(a.id) === current)) {
    select.value = current;
  }
  const noAccountsEl = document.getElementById('email-fetcher-no-accounts');
  if (noAccountsEl) noAccountsEl.hidden = purchaseAccounts.length > 0;
}

function showEmailFetchResult(data) {
  const emptyEl = document.getElementById('email-fetch-empty');
  const loadedEl = document.getElementById('email-fetch-loaded');
  if (!data?.found) {
    emptyEl.hidden = false;
    loadedEl.hidden = true;
    emptyEl.querySelector('strong').textContent = 'No email loaded';
    emptyEl.querySelector('p').textContent = data?.message || 'Select an account first.';
    return;
  }
  emptyEl.hidden = true;
  loadedEl.hidden = false;
  document.getElementById('email-from').textContent = data.from || '—';
  document.getElementById('email-subject').textContent = data.subject || '—';
  document.getElementById('email-date').textContent = data.date || '—';
  document.getElementById('email-body').textContent = data.body || '';
}

async function fetchEmailForAccount() {
  const stockItemId = Number(document.getElementById('email-account-select').value);
  if (!stockItemId) {
    showToast('Select an account first', 'error');
    return;
  }
  const btn = document.getElementById('email-fetch-btn');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  try {
    const result = await api('/account/email/fetch', {
      method: 'POST',
      body: JSON.stringify({ stockItemId })
    });
    showEmailFetchResult(result);
    if (result.found) showToast('Email fetched');
    else showToast(result.message || 'No email found', 'error');
  } catch (err) {
    showEmailFetchResult({ found: false, message: err.message });
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Fetch`;
  }
}

function renderNotificationsFromApi(notifications) {
  const list = document.getElementById('notif-list');
  const empty = document.getElementById('notif-empty');
  if (!notifications.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = notifications.map((n) => `
      <article class="buyer-notif-item info-card ${n.isRead ? '' : 'is-unread'}">
        <p class="flirty-prose"><strong>${escapeHtml(n.title)}</strong></p>
        <p class="flirty-prose">${escapeHtml(n.body)}</p>
        <small>${formatDate(n.createdAt)}</small>
        ${n.type === 'store_update'
          ? `<button type="button" class="buyer-notif-view" data-goto-panel="updates">View in Updates</button>`
          : ''}
      </article>
    `).join('');
  list.querySelectorAll('[data-goto-panel]').forEach((btn) => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.gotoPanel));
  });
}

async function loadStoreUpdates() {
  const list = document.getElementById('buyer-updates-list');
  const empty = document.getElementById('updates-empty');
  if (!list) return;
  list.innerHTML = '<p class="dashboard-loading">Loading updates…</p>';
  try {
    const { updates } = await api('/account/store-updates');
    if (!updates?.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = updates.map((u) => `
      <article class="info-card buyer-update-card">
        <h3>${escapeHtml(u.title)}</h3>
        <p>${escapeHtml(u.body)}</p>
        <small class="buyer-update-date">${formatDate(u.createdAt)}</small>
      </article>
    `).join('');
  } catch {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
  }
}

async function loadBuyerNotifications() {
  try {
    const { notifications } = await api('/account/notifications');
    renderNotificationsFromApi(notifications || []);
  } catch {
    renderNotifications(accountData.orders || []);
  }
}

function renderNotifications(orders) {
  const list = document.getElementById('notif-list');
  const empty = document.getElementById('notif-empty');
  if (!orders.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = orders.map((o) => {
    const label = window.flirtCopy?.orderNotifText(formatOrderLabel(o), o.status)
      || `Order ${formatOrderLabel(o)} — ${STATUS_LABEL[o.status] || o.status}`;
    return `
      <article class="buyer-notif-item info-card">
        <p class="flirty-prose">${label}</p>
        <small>${formatDate(o.createdAt)}</small>
        ${orderNeedsPayment(o)
          ? `<a href="${paymentLink(o)}">View</a>`
          : `<button type="button" class="buyer-notif-view dashboard-order-view-btn" data-view-order="${escapeHtml(o.orderNumber)}">View account</button>`}
      </article>
    `;
  }).join('');
  bindOrderViewButtons(list);
}

function renderChatMessages(messages) {
  const wrap = document.getElementById('seller-chat-messages');
  if (!messages.length) {
    wrap.innerHTML = '<p class="buyer-chat-empty">No messages yet. Say hello to the seller!</p>';
    lastChatMessageId = 0;
    return;
  }
  wrap.innerHTML = messages.map((m) => `
    <div class="buyer-chat-bubble ${m.sender === 'customer' ? 'is-mine' : 'is-seller'}" data-msg-id="${m.id}">
      ${m.sender !== 'customer' ? '<span class="buyer-chat-sender">Seller</span>' : ''}
      <p>${escapeHtml(m.body)}</p>
      <time>${formatDate(m.createdAt)}</time>
    </div>
  `).join('');
  wrap.scrollTop = wrap.scrollHeight;
  lastChatMessageId = Math.max(...messages.map((m) => m.id));
}

function appendChatMessages(messages) {
  if (!messages.length) return;
  const wrap = document.getElementById('seller-chat-messages');
  wrap.querySelector('.buyer-chat-empty')?.remove();
  const html = messages.map((m) => `
    <div class="buyer-chat-bubble ${m.sender === 'customer' ? 'is-mine' : 'is-seller'}" data-msg-id="${m.id}">
      ${m.sender !== 'customer' ? '<span class="buyer-chat-sender">Seller</span>' : ''}
      <p>${escapeHtml(m.body)}</p>
      <time>${formatDate(m.createdAt)}</time>
    </div>
  `).join('');
  wrap.insertAdjacentHTML('beforeend', html);
  wrap.scrollTop = wrap.scrollHeight;
  lastChatMessageId = Math.max(lastChatMessageId, ...messages.map((m) => m.id));
}

async function pollSellerChat() {
  if (document.hidden || !chatInitialized) return;
  try {
    const url = lastChatMessageId > 0
      ? `/account/seller-chat?since=${lastChatMessageId}`
      : '/account/seller-chat';
    const { messages } = await api(url);
    if (lastChatMessageId > 0) {
      appendChatMessages(messages);
    } else if (messages.length) {
      renderChatMessages(messages);
    }
  } catch { /* ignore transient poll errors */ }
}

async function loadSellerChat() {
  const { messages } = await api('/account/seller-chat');
  renderChatMessages(messages);
  chatInitialized = true;
}

function startChatPolling() {
  clearInterval(chatPollTimer);
  chatPollTimer = setInterval(pollSellerChat, 12000);
}

function stopChatPolling() {
  clearInterval(chatPollTimer);
  chatPollTimer = null;
}

async function sendSellerChat(text) {
  const { messages } = await api('/account/seller-chat', {
    method: 'POST',
    body: JSON.stringify({ body: text })
  });
  renderChatMessages(messages);
  showToast('Message sent');
}

async function ensureWalletLoaded() {
  if (walletLoaded) {
    renderWallet();
    return;
  }
  if (walletLoadPromise) return walletLoadPromise;
  walletLoadPromise = loadWallet()
    .then(() => { walletLoaded = true; })
    .finally(() => { walletLoadPromise = null; });
  return walletLoadPromise;
}

async function ensurePurchasesLoaded() {
  purchasesLoadPromise = loadPurchases(true)
    .then(() => { purchasesLoaded = true; })
    .finally(() => { purchasesLoadPromise = null; });
  return purchasesLoadPromise;
}

function scheduleWalletRender() {
  clearTimeout(walletFilterTimer);
  walletFilterTimer = setTimeout(() => renderWallet(), 200);
}

function switchPanel(panelId) {
  document.querySelectorAll('.buyer-dash-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === panelId);
  });
  document.querySelectorAll('.buyer-dash-panel').forEach((panel) => {
    const isActive = panel.id === `panel-${panelId}`;
    panel.hidden = !isActive;
    panel.classList.toggle('active', isActive);
  });

  clearInterval(chatPollTimer);
  chatPollTimer = null;

  if (panelId === 'chat-seller') {
    loadSellerChat().then(startChatPolling);
  }
  if (panelId === 'vouch-seller') {
    loadVouchSeller();
  }
  if (panelId === 'wallet') {
    ensureWalletLoaded();
  }
  if (panelId === 'email-access') {
    ensurePurchasesLoaded();
  }
  if (panelId === 'notifications') {
    loadBuyerNotifications();
  }
  if (panelId === 'updates') {
    loadStoreUpdates();
  }
  if (panelId === 'reports') {
    loadBuyerReports();
  }
  if (panelId === 'plugging' || panelId === 'loan' || panelId === 'webtech') {
    ensureServicesLoaded();
  }
  if (panelId === 'settings' && typeof loadSettings === 'function') {
    loadSettings();
  }

  document.querySelector('.buyer-dash-layout')?.classList.remove('sidebar-open');
}

window.switchPanel = switchPanel;

async function loadVouchSeller() {
  const wrap = document.getElementById('vouch-seller-content');
  if (!wrap) return;

  const defaultData = {
    telegramLabel: '@skyloverie',
    telegramUrl: 'https://t.me/skyloverie',
    format: 'vouch + seller tg usn + product + feedback',
    formatExample: 'vouch @skyloverie Netflix Shared Profile — legit and fast',
    steps: [
      'Open My Purchases and view your order credentials.',
      'Take a clear screenshot showing your purchase or successful transaction.',
      'Send your vouch to seller Telegram using the message format below (with your screenshot).',
      'Keep your proof saved — warranty claims require a valid vouch.'
    ]
  };

  let data = defaultData;
  try {
    data = await api('/vouch-settings');
  } catch {
    /* use defaults if API unavailable (e.g. server needs restart) */
  }

  renderVouchSellerContent(wrap, data);
}

function renderVouchSellerContent(wrap, data) {
  const stepsHtml = (data.steps || []).map((step, i) => `
    <li class="buyer-vouch-step">
      <span class="buyer-vouch-step-num">${i + 1}</span>
      <span>${escapeHtml(step)}</span>
    </li>
  `).join('');
  const telegramHtml = data.telegramUrl
    ? `<a class="buyer-vouch-telegram-link" href="${escapeHtml(data.telegramUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(data.telegramLabel || data.telegramUrl)}</a>`
    : '<span class="buyer-vouch-telegram-missing">Not configured yet — contact support.</span>';
  const formatText = data.format || 'vouch + seller tg usn + product + feedback';
  const formatExample = data.formatExample || '';

  wrap.innerHTML = `
    <div class="buyer-vouch-warning">
      <strong>No vouch, no warranty.</strong>
      <p>Warranty claims and replacements require a valid vouch screenshot sent to our seller Telegram.</p>
    </div>
    <h3 class="buyer-vouch-section-title">How to vouch</h3>
    <ol class="buyer-vouch-steps">${stepsHtml}</ol>
    <div class="buyer-vouch-format">
      <p class="buyer-vouch-section-title">Message format</p>
      <p class="buyer-vouch-format-rule">${escapeHtml(formatText)}</p>
      ${formatExample ? `<p class="buyer-vouch-format-example"><span>Example:</span> ${escapeHtml(formatExample)}</p>` : ''}
    </div>
    <div class="buyer-vouch-send">
      <p class="buyer-vouch-send-label">Send your vouch to</p>
      ${telegramHtml}
    </div>
  `;
}

async function loadPurchases(silent) {
  try {
    const { accounts } = await api('/account/purchases');
    purchaseAccounts = accounts;
    renderEmailAccountSelect();
    renderActivePurchases(accountData.orders || []);
  } catch (err) {
    if (!silent) showToast(err.message, 'error');
  }
}

async function loadWallet() {
  walletData = await api('/account/wallet');
  renderWallet();
}

function bindNav() {
  document.querySelectorAll('.buyer-dash-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });

  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => switchPanel(el.dataset.goto));
  });

  document.getElementById('buyer-dash-menu-toggle')?.addEventListener('click', () => {
    document.querySelector('.buyer-dash-layout')?.classList.toggle('sidebar-open');
  });

  ['wallet-search', 'wallet-from', 'wallet-to'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', scheduleWalletRender);
  });

  document.getElementById('email-fetch-btn')?.addEventListener('click', fetchEmailForAccount);

  document.getElementById('purchase-modal-close')?.addEventListener('click', closePurchaseDetail);
  document.getElementById('purchase-detail-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'purchase-detail-modal') closePurchaseDetail();
  });

  document.getElementById('report-modal-close')?.addEventListener('click', closeReportModal);
  document.getElementById('report-cancel-btn')?.addEventListener('click', closeReportModal);
  document.getElementById('report-issue-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'report-issue-modal') closeReportModal();
  });
  document.getElementById('report-issue-form')?.addEventListener('submit', submitReportForm);
  document.getElementById('report-vouch-select')?.addEventListener('click', () => {
    document.getElementById('report-proof-vouch')?.click();
  });
  document.getElementById('report-extra-select')?.addEventListener('click', () => {
    document.getElementById('report-proof-extra')?.click();
  });
  document.getElementById('report-proof-vouch')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      e.target.value = '';
      return;
    }
    reportVouchFile = file;
    clearReportFormErrors();
    renderReportProofPreviews();
  });
  document.getElementById('report-proof-extra')?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length < (e.target.files?.length || 0)) {
      showToast('Some files were skipped — images only', 'info');
    }
    reportExtraFiles = files;
    clearReportFormErrors();
    renderReportProofPreviews();
  });
  bindReportProofPreviewActions();
  document.querySelectorAll('.buyer-report-tab').forEach((tab) => {
    tab.addEventListener('click', () => setReportTab(tab.dataset.rtab));
  });

  document.getElementById('seller-chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('seller-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await sendSellerChat(text);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.querySelector('.logout-btn')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });
}

let welcomeLoaderTimer = null;
let welcomeLoaderFinishTimer = null;
let welcomeLoaderProgress = 0;
let welcomeLoaderDone = false;

function updateWelcomeLoaderProgress(pct) {
  const bar = document.getElementById('dash-welcome-progress-bar');
  const label = document.getElementById('dash-welcome-progress-pct');
  const clamped = Math.max(0, Math.min(100, pct));
  welcomeLoaderProgress = clamped;
  if (bar) bar.style.width = `${clamped}%`;
  if (label) label.textContent = `${clamped}%`;
}

function setAccountLoadingShell(active) {
  const layout = document.getElementById('buyer-dash-layout');
  const sidebar = document.getElementById('buyer-dash-sidebar');
  if (layout) layout.classList.toggle('buyer-dash-account-loading', active);
  if (sidebar) sidebar.setAttribute('aria-hidden', active ? 'true' : 'false');
}

function showWelcomeLoader() {
  welcomeLoaderDone = false;
  welcomeLoaderProgress = 0;
  clearInterval(welcomeLoaderTimer);
  clearTimeout(welcomeLoaderFinishTimer);

  setAccountLoadingShell(true);

  const screen = document.getElementById('dash-account-load-screen');
  const main = document.getElementById('buyer-dash-main');
  if (screen) {
    screen.hidden = false;
    screen.classList.remove('is-fading');
    screen.setAttribute('aria-busy', 'true');
  }
  if (main) main.hidden = true;
  updateWelcomeLoaderProgress(0);

  welcomeLoaderTimer = setInterval(() => {
    if (welcomeLoaderDone) return;
    const step = welcomeLoaderProgress < 60 ? 4 : welcomeLoaderProgress < 85 ? 2 : 1;
    const next = Math.min(95, welcomeLoaderProgress + step);
    updateWelcomeLoaderProgress(next);
  }, 200);
}

function revealDashboardShell() {
  const screen = document.getElementById('dash-account-load-screen');
  const main = document.getElementById('buyer-dash-main');
  if (screen) {
    screen.setAttribute('aria-busy', 'false');
    screen.hidden = true;
    screen.classList.remove('is-fading');
  }
  if (main) {
    main.hidden = false;
    main.style.animation = 'none';
    void main.offsetHeight;
    main.style.animation = '';
  }
  setAccountLoadingShell(false);
}

function finishWelcomeLoader() {
  welcomeLoaderDone = true;
  clearInterval(welcomeLoaderTimer);

  const screen = document.getElementById('dash-account-load-screen');

  const tickToComplete = () => {
    if (welcomeLoaderProgress < 100) {
      updateWelcomeLoaderProgress(Math.min(100, welcomeLoaderProgress + 5));
      welcomeLoaderFinishTimer = setTimeout(tickToComplete, 40);
      return;
    }
    if (screen) screen.classList.add('is-fading');
    welcomeLoaderFinishTimer = setTimeout(() => {
      revealDashboardShell();
    }, 350);
  };
  tickToComplete();
}

function hideWelcomeLoaderOnError() {
  welcomeLoaderDone = true;
  clearInterval(welcomeLoaderTimer);
  clearTimeout(welcomeLoaderFinishTimer);
  revealDashboardShell();
}

async function loadDashboard() {
  const errorEl = document.getElementById('dashboard-error');
  showWelcomeLoader();

  try {
    let data;
    try {
      data = await api('/account/dashboard');
    } catch {
      const ordersRes = await api('/account/orders');
      const summaryRes = await api('/account/summary').catch(() => ({}));
      data = { user: ordersRes.user, orders: ordersRes.orders, stats: summaryRes };
    }

    const { user, orders, stats: summaryRes = {} } = data;
    accountData = { user, orders };

    errorEl.hidden = true;

    document.getElementById('dash-welcome-name').textContent = user.name;

    renderStats(summaryRes, orders);
    renderRecentOrders(orders);
    renderActivePurchases(orders);
    loadBuyerNotifications();

    window.dashboardPurchaseStats = {
      totalOrders: summaryRes.totalOrders ?? orders.length,
      completedOrders: orders.filter((o) => o.status === 'approved').length,
      totalSpent: summaryRes.totalSpent || 0
    };

    finishWelcomeLoader();
  } catch (err) {
    if (err.message === 'Not authenticated') {
      window.location.href = 'login.html';
      return;
    }
    hideWelcomeLoaderOnError();
    errorEl.textContent = err.message || 'Could not load account';
    errorEl.hidden = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.getElementById('panel-chat-seller')?.classList.contains('active')) {
    pollSellerChat();
  }
});

bindNav();
loadDashboard().then(() => {
  const params = new URLSearchParams(window.location.search);
  const orderRef = params.get('order');
  const hashPanel = window.location.hash.replace('#', '');
  if (hashPanel && document.getElementById(`panel-${hashPanel}`)) {
    switchPanel(hashPanel);
  }
  if (orderRef) {
    focusPurchaseOrder(orderRef);
  }
});
