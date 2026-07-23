async function api(url, options = {}) {
  const body = options.body != null
    ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
    : undefined;
  const res = await fetch(url, {
    ...options,
    body,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error || data.message || (typeof data === 'string' ? data : '');
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data;
}

const peso = (n) => `\u20b1${Number(n || 0).toLocaleString()}`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const STATUS_LABEL = {
  approved: 'Approved',
  pending: 'Pending',
  pending_payment: 'Awaiting payment',
  rejected: 'Rejected',
  refunded: 'Refunded'
};

const loginSection = document.getElementById('admin-login');
const shell = document.getElementById('admin-shell');

const icon = (name, cls) => window.adminIconHtml?.(name, cls) || '';

function initAdminNavIcons() {
  window.hydrateAdminIcons?.(document);
}

initAdminNavIcons();

/* ---------------- Auth ---------------- */
async function checkAdmin() {
  try {
    const { admin } = await api('/admin/me');
    document.getElementById('admin-user').textContent = admin.email;
    loginSection.hidden = true;
    shell.hidden = false;
    initDashboard();
  } catch {
    shell.hidden = true;
    loginSection.hidden = false;
  }
}

document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('admin-login-error');
  errEl.hidden = true;
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('admin-email').value.trim(),
        password: document.getElementById('admin-password').value
      })
    });
    if (!data.user?.isAdmin) {
      throw new Error('This account is not an admin.');
    }
    checkAdmin();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('admin-logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

/* ---------------- Tabs ---------------- */
const $ = (id) => document.getElementById(id);
const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };

function debounce(fn, ms = 300) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => { clearTimeout(timer); };
  debounced.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return debounced;
}

function runAsyncAction(action, { busyEl = null, busyLabel = 'Loading…', errorMessage = 'Action failed' } = {}) {
  return (async (...args) => {
    if (busyEl?.dataset?.busy === '1') return;
    const prevText = busyEl?.textContent;
    if (busyEl) {
      busyEl.dataset.busy = '1';
      busyEl.disabled = true;
      if (busyLabel) busyEl.textContent = busyLabel;
    }
    try {
      await action(...args);
    } catch (err) {
      showToast(err?.message || errorMessage, 'error');
    } finally {
      if (busyEl) {
        delete busyEl.dataset.busy;
        busyEl.disabled = false;
        if (prevText != null) busyEl.textContent = prevText;
      }
    }
  })();
}

function ensureAdminModalsClosed() {
  document.querySelectorAll('.admin-modal, .admin-report-resolve-modal').forEach((el) => {
    el.hidden = true;
  });
  shell?.classList.remove('menu-open');
}

let dashboardReady = false;
function initDashboard() {
  initAdminNavIcons();
  window.reapplySidebarTheme?.();
  ensureAdminModalsClosed();
  if (dashboardReady) { loadOverview(); return; }
  dashboardReady = true;

  const gmailStatus = new URLSearchParams(location.search).get('gmail');
  if (gmailStatus === 'connected') showToast('Gmail connected — email fetcher is ready', 'approved');
  else if (gmailStatus === 'error') {
    const msg = new URLSearchParams(location.search).get('msg');
    showToast(msg ? decodeURIComponent(msg) : 'Gmail connection failed', 'error');
  }
  if (gmailStatus) {
    history.replaceState({}, '', location.pathname);
  }

  document.querySelectorAll('.admin-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  on('admin-menu-toggle', 'click', () => shell.classList.toggle('menu-open'));
  on('admin-modal-close', 'click', closeModal);
  on('admin-modal', 'click', (e) => { if (e.target.id === 'admin-modal') closeModal(); });
  on('report-resolve-close', 'click', closeReportResolveModal);
  on('report-resolve-modal', 'click', (e) => { if (e.target.id === 'report-resolve-modal') closeReportResolveModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modal && !modal.hidden) closeModal();
    else if ($('report-resolve-modal') && !$('report-resolve-modal').hidden) closeReportResolveModal();
    else shell?.classList.remove('menu-open');
  });

  // All Orders
  on('orders-tabs', 'click', (e) => {
    const b = e.target.closest('.admin-subtab'); if (!b) return;
    if (b.classList.contains('active')) return;
    switchOrdersTab(b.dataset.otab);
  });

  document.querySelector('#catalog-table tbody')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const product = catalogProductsCache.find((p) => p.id == editBtn.dataset.edit);
      if (!product) {
        showToast('Product not found — refresh catalog', 'error');
        return;
      }
      openProductModal(product).catch((err) => showToast(err.message || 'Could not open editor', 'error'));
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) deleteProduct(delBtn.dataset.del);
  });

  $('orders-list')?.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-del-order]');
    if (delBtn) {
      const orderRef = delBtn.dataset.delOrder;
      if (!orderRef || !confirm(`Delete order #${orderRef}? This cannot be undone.`)) return;
      delBtn.disabled = true;
      try {
        await api(`/admin/orders/${encodeURIComponent(orderRef)}`, { method: 'DELETE' });
        showToast(`Order #${orderRef} deleted`, 'approved');
        invalidateOrdersCache();
        await loadAllOrders();
      } catch (err) {
        showToast(err.message, 'error');
        delBtn.disabled = false;
      }
      return;
    }
    const btn = e.target.closest('[data-order]');
    if (btn) openOrderModal(btn.dataset.order);
  });

  on('orders-apply', 'click', () => { invalidateOrdersCache(); loadAllOrders(); });
  on('orders-search', 'keydown', (e) => { if (e.key === 'Enter') { invalidateOrdersCache(); loadAllOrders(); } });

  // Transactions
  on('tx-apply', 'click', loadTransactions);
  on('tx-reset', 'click', () => { ['tx-search', 'tx-from', 'tx-to'].forEach((i) => { if ($(i)) $(i).value = ''; }); $('tx-status').value = 'all'; loadTransactions(); });

  // Catalog
  on('catalog-tabs', 'click', (e) => {
    const b = e.target.closest('.admin-subtab'); if (!b) return;
    document.querySelectorAll('#catalog-tabs .admin-subtab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    switchCatalogTab(b.dataset.ctab);
  });
  on('catalog-add', 'click', () => runAsyncAction(() => openProductModal(), { errorMessage: 'Could not open product form' }));
  on('catalog-search', 'keydown', (e) => { if (e.key === 'Enter') loadCatalog(); });
  on('catalog-category', 'change', loadCatalog);
  on('category-add', 'click', () => runAsyncAction(() => openCategoryModal(), { errorMessage: 'Could not open category form' }));

  // Inventory
  const scheduleInventoryLoad = debounce(() => loadInventory(), 320);
  on('inv-tabs', 'click', (e) => {
    const b = e.target.closest('.admin-subtab'); if (!b) return;
    document.querySelectorAll('#inv-tabs .admin-subtab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    loadInventory();
  });
  on('inv-add', 'click', () => runAsyncAction(
    () => openStockModal(),
    { busyEl: $('inv-add'), busyLabel: 'Opening…', errorMessage: 'Could not open Add Stock' }
  ));
  on('inv-search', 'keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      scheduleInventoryLoad.cancel();
      loadInventory();
    }
  });
  on('inv-search', 'input', scheduleInventoryLoad);

  // Users
  on('users-search-btn', 'click', loadUsers);
  on('users-search', 'keydown', (e) => { if (e.key === 'Enter') loadUsers(); });

  // Redeem
  on('redeem-add', 'click', () => runAsyncAction(() => openRedeemModal(), { errorMessage: 'Could not open redeem form' }));
  on('redeem-bulk', 'click', () => runAsyncAction(() => openBulkModal(), { errorMessage: 'Could not open bulk generator' }));
  on('redeem-search', 'keydown', (e) => { if (e.key === 'Enter') loadRedeem(); });

  // Notifications
  on('notif-read-all', 'click', async () => { await api('/admin/notifications/read-all', { method: 'POST' }); loadNotifications(); refreshNotifBadge(); });

  // Store updates
  on('store-update-publish', 'click', publishStoreUpdate);

  // Support tickets
  on('tickets-tabs', 'click', (e) => {
    const b = e.target.closest('.admin-subtab'); if (!b) return;
    document.querySelectorAll('#tickets-tabs .admin-subtab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    loadSupportTickets();
  });
  on('tickets-search-btn', 'click', loadSupportTickets);
  on('tickets-search', 'keydown', (e) => { if (e.key === 'Enter') loadSupportTickets(); });

  // Reports
  on('reports-tabs', 'click', (e) => {
    const b = e.target.closest('.admin-subtab'); if (!b) return;
    document.querySelectorAll('#reports-tabs .admin-subtab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    loadReports();
  });
  on('reports-search', 'keydown', (e) => { if (e.key === 'Enter') loadReports(); });

  // Account sub-tabs
  on('account-tabs', 'click', (e) => {
    const b = e.target.closest('.admin-subtab'); if (!b) return;
    document.querySelectorAll('#account-tabs .admin-subtab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    showAccountPane(b.dataset.atab);
  });
  on('pw-form', 'submit', submitPassword);
  on('reset-website-btn', 'click', resetWebsite);
  on('intg-list', 'click', (e) => {
    const b = e.target.closest('.admin-intg-item'); if (!b) return;
    renderIntegration(b.dataset.intg);
  });
  bindIntegrationFormHandlers();
  on('social-add', 'click', () => addSocialRow());
  on('social-save', 'click', saveSocial);

  // Store profile / theme / tingi
  on('store-save', 'click', saveStoreProfile);
  $('store-photo-clear')?.addEventListener('click', () => {
    $('store-photo-url').value = '';
    updateStorePhotoPreview('');
    showToast('Photo cleared — save to apply');
  });
  $('store-photo-file')?.addEventListener('change', uploadStoreProfilePhoto);
  on('tingi-save', 'click', saveTingiSettings);
  on('theme-save', 'click', saveTheme);
  bindThemeColorInputs();
  on('theme-colorhunt-apply', 'click', applyColorhuntPalette);
  on('theme-brand-name', 'input', updateThemeBrandPreview);
  on('theme-brand-font', 'change', updateThemeBrandPreview);
  on('theme-brand-font-bold', 'change', updateThemeBrandPreview);
  on('theme-logo-auto', 'change', updateThemeBrandPreview);
  on('theme-logo-url', 'input', updateThemeBrandPreview);
  on('theme-logo-clear', 'click', () => {
    $('theme-logo-url').value = '';
    $('theme-logo-file').value = '';
    updateThemeBrandPreview();
  });
  $('theme-logo-file')?.addEventListener('change', uploadThemeLogo);

  refreshNotifBadge();
  refreshTicketsBadge();
  loadOverview();
}

const TAB_TITLES = {
  overview: 'Dashboard', 'all-orders': 'All Orders', transactions: 'Transactions',
  catalog: 'Catalog', inventory: 'Inventory', users: 'Manage Users', redeem: 'Redeem',
  'store-updates': 'Store Updates', 'direct-message': 'Direct Message', 'support-tickets': 'Support Tickets', notifications: 'Notifications',
  reports: 'Product Reports', account: 'Account Settings', 'store-profile': 'Store Profile',
  theme: 'Site Theme',
  cms: 'Content Management',
  'website-making': 'Website Making',
  plugging: 'Plugging',
  games: 'Shop Games',
  'platform-analytics': 'Platform Analytics'
};

const loaded = {};
function switchTab(tab, force = false) {
  document.querySelectorAll('.admin-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.admin-tab').forEach((s) => { s.hidden = s.id !== `tab-${tab}`; });
  document.getElementById('admin-title').textContent = TAB_TITLES[tab] || 'Dashboard';
  shell.classList.remove('menu-open');
  ensureAdminModalsClosed();

  const loaders = {
    overview: loadOverview,
    'all-orders': () => loadAllOrders({ preferCache: !!loaded['all-orders'] && !force }),
    transactions: loadTransactions,
    catalog: loadCatalog,
    inventory: loadInventory,
    users: loadUsers,
    redeem: loadRedeem,
    'store-updates': loadStoreUpdates,
    'direct-message': loadDM,
    'support-tickets': loadSupportTickets,
    notifications: loadNotifications,
    reports: loadReports,
    account: loadAccount,
    'store-profile': loadStoreProfile,
    theme: loadTheme,
    cms: () => window.loadPlatformCms?.(),
    'website-making': () => window.loadPlatformWebsite?.(),
    plugging: () => window.loadPlatformPlugging?.(),
    games: () => window.loadPlatformGames?.(),
    'platform-analytics': () => window.loadPlatformAnalytics?.()
  };

  if (!loaders[tab]) return;
  if (loaded[tab] && !force) {
    if (tab === 'all-orders') loaders[tab]();
    return;
  }
  loaded[tab] = true;
  loaders[tab]();
}

async function refreshNotifBadge() {
  try {
    const { unread } = await api('/admin/notifications');
    const badge = $('notif-badge');
    if (badge) { badge.textContent = unread; badge.hidden = unread === 0; }
  } catch (_) { /* ignore */ }
}

function fcard(label, value, opts = {}) {
  const { tone = '', highlight = false, iconName = '' } = opts;
  return `
    <div class="admin-fcard ${highlight ? 'highlight' : ''} ${tone ? `admin-fcard--${tone}` : ''}">
      ${iconName ? `<span class="admin-fcard-icon">${icon(iconName)}</span>` : ''}
      <div class="admin-fcard-label">${label}</div>
      <div class="admin-fcard-value ${tone}">${value}</div>
    </div>`;
}

function statCard(label, value, tone = '') {
  return `
    <div class="admin-stat ${tone ? `admin-stat--${tone}` : ''}">
      <div class="admin-stat-label">${label}</div>
      <div class="admin-stat-value ${tone}">${value}</div>
    </div>`;
}

/* ---------------- Overview ---------------- */
async function loadOverview() {
  let o;
  try { o = await api('/admin/overview'); } catch { return; }

  const pill = document.getElementById('admin-users-pill');
  document.getElementById('admin-users-count').textContent = o.totalUsers.toLocaleString();
  pill.hidden = false;

  document.getElementById('admin-finance').innerHTML = [
    fcard('Net Sales', peso(o.netSales), { tone: 'green', iconName: 'sales' }),
    fcard('Est. Cost', peso(o.estCost), { tone: '', iconName: 'cost' }),
    fcard(`Refund Total (${o.refundCount})`, peso(o.refundTotal), { tone: 'red', iconName: 'refund' }),
    fcard('Net Profit', peso(o.netProfit), { highlight: true, iconName: 'profit' })
  ].join('');

  document.getElementById('admin-stats').innerHTML = [
    statCard('Paid Orders', o.totalOrders),
    statCard('Pending', o.pending, 'orange'),
    statCard('Rejected', o.rejected, 'red'),
    statCard('Total Reports', o.totalReports),
    statCard('Good / Fixed', o.resolvedReports, 'green')
  ].join('');

  renderChart(o.salesTrend);
  renderTopSellers(o.topSellers);

  if (typeof loadAdminModules === 'function') loadAdminModules();

  let platformStatsHtml = '';
  try {
    const p = await api('/admin/platform/stats');
    if (p) {
      platformStatsHtml = [
        statCard('Pending Shop', o.pending, 'orange'),
        statCard('New Web Inquiries', p.newWebsiteInquiries || 0, 'orange'),
        statCard('Pending Plug Orders', p.pendingPluggingOrders || 0, 'orange'),
        statCard('Visitors (7d)', p.visitorsWeek)
      ].join('');
      const webBadge = document.getElementById('website-badge');
      if (webBadge && p?.newWebsiteInquiries > 0) {
        webBadge.textContent = p.newWebsiteInquiries;
        webBadge.hidden = false;
      }
      const plugBadge = document.getElementById('plugging-badge');
      if (plugBadge) {
        const pendingPlug = Number(p.pendingPluggingOrders) || 0;
        if (pendingPlug > 0) {
          plugBadge.textContent = pendingPlug;
          plugBadge.hidden = false;
        } else {
          plugBadge.hidden = true;
        }
      }
    }
  } catch (_) { /* platform stats optional */ }

  if (platformStatsHtml) {
    document.getElementById('admin-stats').innerHTML += platformStatsHtml;
  }

  const badge = document.getElementById('orders-badge');
  if (badge) {
    if (o.pending > 0) {
      badge.textContent = o.pending;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
}

function renderChart(trend) {
  const wrap = document.getElementById('admin-chart');
  const max = Math.max(...trend.map((t) => t.amount), 1);
  const hasData = trend.some((t) => t.amount > 0);
  if (!hasData) {
    wrap.innerHTML = `<div class="admin-chart-empty">No paid orders yet — your sales trend will show here.</div>`;
    return;
  }

  const W = 640, H = 240, pad = { l: 8, r: 8, t: 12, b: 24 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const n = trend.length;
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;

  const chartColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#8d7b68';
  const chartMuted = getComputedStyle(document.documentElement).getPropertyValue('--muted-color').trim() || '#8a90a2';

  const linePts = trend.map((t, i) => `${x(i).toFixed(1)},${y(t.amount).toFixed(1)}`).join(' ');
  const areaPts = `${pad.l},${pad.t + ih} ${linePts} ${pad.l + iw},${pad.t + ih}`;
  const dots = trend.map((t, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(t.amount).toFixed(1)}" r="2.5" fill="${chartColor}"/>`).join('');

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = (pad.t + ih - f * ih).toFixed(1);
    return `<line x1="${pad.l}" y1="${gy}" x2="${pad.l + iw}" y2="${gy}" stroke="rgba(128,128,150,0.2)" stroke-width="1"/>`;
  }).join('');

  const labelIdx = [0, Math.floor(n / 2), n - 1];
  const labels = labelIdx.map((i) => {
    const d = new Date(trend[i].date);
    const txt = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    return `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="11" fill="${chartMuted}" text-anchor="${anchor}">${txt}</text>`;
  }).join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Sales trend">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${chartColor}" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="${chartColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <polygon points="${areaPts}" fill="url(#chartFill)"/>
      <polyline points="${linePts}" fill="none" stroke="${chartColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${labels}
    </svg>
  `;
}

function renderTopSellers(sellers) {
  const wrap = document.getElementById('admin-top-sellers');
  if (!sellers.length) {
    wrap.innerHTML = `<div class="admin-empty">No sales yet.</div>`;
    return;
  }
  const max = Math.max(...sellers.map((s) => s.revenue), 1);
  wrap.innerHTML = sellers.map((s, i) => `
    <div class="admin-seller">
      <span class="admin-seller-rank">${i + 1}</span>
      <div class="admin-seller-main">
        <div class="admin-seller-name">${esc(s.name)}</div>
        <div class="admin-seller-sold">${s.sold} sold</div>
        <div class="admin-seller-bar"><span style="width:${Math.max((s.revenue / max) * 100, 3)}%"></span></div>
      </div>
      <span class="admin-seller-rev">${peso(s.revenue)}</span>
    </div>
  `).join('');
}

/* ---------------- All Orders ---------------- */
const ORDER_STATUS_LABEL = { ...STATUS_LABEL, refunded: 'Refunded' };
const ordersTabCache = { pending: null, approved: null, rejected: null };
let ordersFetchGen = 0;
let ordersPrefetchTimer = null;
const ORDERS_TAB_STATUSES = {
  pending: new Set(['pending']),
  approved: new Set(['approved']),
  rejected: new Set(['rejected', 'refunded'])
};

function filterOrdersForTab(orders, tab) {
  const allowed = ORDERS_TAB_STATUSES[tab] || ORDERS_TAB_STATUSES.pending;
  let filtered = orders.filter((o) => allowed.has(o.status));
  if (tab === 'pending') filtered = filtered.filter((o) => o.receiptUrl);
  return filtered;
}

function invalidateOrdersCache() {
  ordersTabCache.pending = null;
  ordersTabCache.approved = null;
  ordersTabCache.rejected = null;
  delete loaded.overview;
}

function activeOrdersTab() {
  return document.querySelector('#orders-tabs .admin-subtab.active')?.dataset.otab || 'pending';
}

function ordersListParams(tab) {
  const params = new URLSearchParams({ tab });
  if ($('orders-search')?.value) params.set('search', $('orders-search').value.trim());
  if ($('orders-from')?.value) params.set('from', $('orders-from').value);
  if ($('orders-to')?.value) params.set('to', $('orders-to').value);
  return params;
}

function switchOrdersTab(tab) {
  document.querySelectorAll('#orders-tabs .admin-subtab').forEach((x) => {
    x.classList.toggle('active', x.dataset.otab === tab);
  });
  const cached = ordersTabCache[tab];
  if (cached) {
    renderOrdersList(cached, tab);
  } else {
    renderOrdersList([], tab);
    $('orders-list')?.classList.add('is-loading');
  }
  loadAllOrders({ preferCache: !!cached });
}

function adminProofBadge(hasProof) {
  if (hasProof) return '';
  return window.themeBadge
    ? themeBadge('no_proof', 'No proof', { size: 'lg' })
    : '<span class="admin-order-proof admin-order-proof--empty">No proof</span>';
}

function adminOrderStatusBadge(order) {
  if (!order || !window.themeBadge) return '';
  if (order.status === 'approved') return themeBadge('approved', 'Approved', { size: 'md' });
  if (order.status === 'pending') return themeBadge('pending', 'Pending approval', { size: 'md' });
  if (order.status === 'rejected') return themeBadge('cancelled', 'Rejected', { size: 'md' });
  if (order.status === 'refunded') return themeBadge('refunded', 'Refunded', { size: 'md' });
  return orderStatusBadge(order.status);
}

function orderProofCell(o) {
  if (!o.receiptUrl) return adminProofBadge(false);
  return `<a class="admin-order-proof admin-order-proof--link" href="${esc(o.receiptUrl)}" target="_blank" rel="noopener" title="View payment proof"><span>Proof</span></a>`;
}

function renderOrdersList(orders, tab) {
  const list = $('orders-list');
  if (!list) return;
  const filtered = filterOrdersForTab(orders, tab);
  $('orders-empty').hidden = filtered.length > 0;
  list.innerHTML = filtered.map((o) => `
    <div class="admin-order-card" data-status="${esc(o.status)}">
      <div class="admin-order-id">
        <small>Order</small>
        <strong>#${o.displayId || o.orderId || o.orderNumber}</strong>
      </div>
      <div class="admin-order-buyer">
        <small>Buyer</small>
        <strong>${esc(o.buyerName)}</strong>
      </div>
      <div class="admin-order-main">
        <div class="admin-order-name">${adminOrderStatusBadge(o)} ${esc(o.itemName)}${stockBadgeHtml(o.stockLabel, o.stockState)}${o.itemQty > 1 ? ` ×${o.itemQty}` : ''}${o.itemCount > 1 ? ` <span class="admin-pill">+${o.itemCount - 1} more</span>` : ''}</div>
        <div class="admin-order-sub">${esc(o.email)} • ${fmtDate(o.createdAt)}</div>
        ${o.rejectReason
          ? `<p class="admin-order-reject-note"><strong>Rejection note:</strong> ${esc(o.rejectReason)}</p>`
          : tab === 'rejected' ? `<p class="admin-order-reject-note admin-order-reject-note--empty">No rejection note recorded.</p>` : ''}
      </div>
      ${orderProofCell(o)}
      <div class="admin-order-amt"><strong>${peso(o.total)}</strong><small>${o.paymentMethod}</small></div>
      <div class="admin-order-actions">
        ${!o.receiptUrl ? `<button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-del-order="${esc(o.orderNumber)}">Remove</button>` : ''}
        <button class="admin-btn admin-btn-primary admin-btn-sm" data-order="${o.orderNumber}">View</button>
      </div>
    </div>
  `).join('');
  list.classList.remove('is-loading');
}

async function refreshOrdersTab(tab, gen, { background = false } = {}) {
  const list = $('orders-list');
  try {
    const orders = await api(`/admin/all-orders?${ordersListParams(tab)}`);
    if (gen !== ordersFetchGen) return;
    ordersTabCache[tab] = orders;
    if (activeOrdersTab() === tab) renderOrdersList(orders, tab);
    if (!background) scheduleOrdersPrefetch();
  } catch (err) {
    if (gen !== ordersFetchGen) return;
    if (!background && list) list.classList.remove('is-loading');
    if (!background) showToast(err.message, 'error');
  }
}

async function loadAllOrders(opts = {}) {
  const tab = activeOrdersTab();
  const list = $('orders-list');
  const gen = ++ordersFetchGen;
  const cached = ordersTabCache[tab];

  if (!opts.preferCache) {
    if (cached) renderOrdersList(cached, tab);
    else {
      renderOrdersList([], tab);
      list?.classList.add('is-loading');
    }
    await refreshOrdersTab(tab, gen);
    return;
  }

  if (cached) {
    refreshOrdersTab(tab, gen, { background: true });
    return;
  }

  renderOrdersList([], tab);
  list?.classList.add('is-loading');
  await refreshOrdersTab(tab, gen);
}

function scheduleOrdersPrefetch() {
  clearTimeout(ordersPrefetchTimer);
  ordersPrefetchTimer = setTimeout(async () => {
    const current = activeOrdersTab();
    for (const tab of ['pending', 'approved', 'rejected']) {
      if (tab === current || ordersTabCache[tab]) continue;
      try {
        ordersTabCache[tab] = await api(`/admin/all-orders?${ordersListParams(tab)}`);
      } catch (_) { /* ignore background prefetch */ }
    }
  }, 400);
}

function stockBadgeHtml(label, state) {
  if (!label) return '';
  return window.stockBadgeFromLabel ? stockBadgeFromLabel(label, state) : '';
}

async function openOrderModal(orderNumber) {
  const o = await api(`/admin/orders/${orderNumber}`);
  const itemsHtml = o.items.map((i) =>
    `<div class="admin-order-item">
      <span>${esc(i.name)} × ${i.quantity} ${stockBadgeHtml(i.stockLabel, i.stockState)}</span>
      <span>${peso(i.price * i.quantity)}</span>
    </div>`
  ).join('');
  const canApprove = o.status === 'pending' && o.receiptUrl;
  const canReject = o.status === 'pending' && o.receiptUrl;
  const receiptHtml = o.receiptUrl
    ? `
    <div class="admin-field">
      <label>Payment proof</label>
      <div class="admin-report-proof-gallery">
        <a class="admin-report-proof-thumb" href="${esc(o.receiptUrl)}" target="_blank" rel="noopener">
          <img src="${esc(o.receiptUrl)}" alt="Payment receipt">
        </a>
      </div>
      <a class="admin-card-meta admin-receipt-open" href="${esc(o.receiptUrl)}" target="_blank" rel="noopener">Open full image ↗</a>
    </div>`
    : `<div class="admin-field"><label>Payment proof</label><div class="admin-card-meta admin-receipt-missing">No proof on file.</div></div>`;
  openModal(`Order #${o.displayId || o.orderId || o.orderNumber}`, `
    <div class="admin-field"><label>Buyer name</label><div class="admin-card-meta">${o.buyerName || '—'}</div></div>
    <div class="admin-field"><label>Customer email</label><div class="admin-card-meta">${o.email}</div></div>
    <div class="admin-field"><label>Payment method</label><div class="admin-card-meta">${o.paymentMethod}</div></div>
    <div class="admin-field"><label>Status</label><div>${adminOrderStatusBadge(o) || (window.orderStatusBadge ? orderStatusBadge(o.status) : `<span class="admin-status ${o.status}">${ORDER_STATUS_LABEL[o.status] || o.status}</span>`)}</div></div>
    ${o.rejectReason ? `<div class="admin-field"><label>Rejection note</label><div class="admin-order-reject-box">${esc(o.rejectReason)}</div></div>` : ''}
    ${receiptHtml}
    <div class="admin-field"><label>Items</label><div class="admin-order-items">${itemsHtml}</div></div>
    <div class="admin-order-summary">
      <div><span>Subtotal</span><span>${peso(o.subtotal)}</span></div>
      ${o.discount ? `<div><span>Discount${o.redeemCode ? ' (' + o.redeemCode + ')' : ''}</span><span>-${peso(o.discount)}</span></div>` : ''}
      <div class="total"><span>Total</span><span>${peso(o.total)}</span></div>
    </div>
    <div class="admin-modal-actions">
      ${canReject ? `<button type="button" class="admin-btn admin-btn-danger admin-btn-icon" id="reject-order">${icon('x')} Reject</button>` : ''}
      ${canApprove ? `<button type="button" class="admin-btn admin-btn-success admin-btn-icon" id="approve-order">${icon('check')} Approve</button>` : ''}
      ${o.status === 'approved' ? `<button type="button" class="admin-btn admin-btn-ghost" disabled>Approved</button>` : ''}
    </div>
  `, false);

  on('approve-order', 'click', async () => {
    try {
      await api(`/admin/orders/${orderNumber}/approve`, { method: 'POST' });
      showToast(`Order #${o.displayId || o.orderId || orderNumber} approved`, 'approved');
      invalidateOrdersCache();
      closeModal(); switchOrdersTab('approved'); loadOverview();
    } catch (err) { showToast(err.message, 'error'); }
  });
  on('reject-order', 'click', async () => {
    const reason = prompt('Rejection reason (required):');
    if (!reason || !String(reason).trim()) {
      showToast('Rejection reason is required', 'error');
      return;
    }
    try {
      await api(`/admin/orders/${orderNumber}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: String(reason).trim() })
      });
      showToast(`Order #${o.displayId || o.orderId || orderNumber} rejected`, 'info');
      invalidateOrdersCache();
      closeModal(); switchOrdersTab('rejected'); loadOverview();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

/* ---------------- Catalog ---------------- */
let categoriesCache = [];
let catalogProductsCache = [];

function switchCatalogTab(tab) {
  $('catalog-products').hidden = tab !== 'products';
  $('catalog-categories').hidden = tab !== 'categories';
  if (tab === 'categories') loadCategories();
  else loadCatalog();
}

async function fetchCategories(force = false) {
  if (force || categoriesCache.length === 0) categoriesCache = await api('/admin/categories');
  return categoriesCache;
}

async function loadCatalog() {
  const params = new URLSearchParams();
  if ($('catalog-search')?.value) params.set('search', $('catalog-search').value.trim());
  if ($('catalog-category')?.value) params.set('category', $('catalog-category').value);
  const fetches = [api(`/admin/catalog?${params}`)];
  if (!categoriesCache.length) fetches.push(fetchCategories());
  const [products] = await Promise.all(fetches);
  catalogProductsCache = products;

  const catSel = $('catalog-category');
  if (catSel) {
    const current = catSel.value;
    catSel.innerHTML = '<option value="all">All Categories</option>' +
      categoriesCache.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
    catSel.value = current || 'all';
  }

  const planLabel = (p) => {
    const v = p.variants || [];
    if (!v.length) return '<span class="admin-card-meta">—</span>';
    const prices = v.map((x) => x.price);
    const range = Math.min(...prices) === Math.max(...prices)
      ? peso(prices[0]) : `${peso(Math.min(...prices))}–${peso(Math.max(...prices))}`;
    return `<span class="admin-plan-badge">${v.length} plan${v.length > 1 ? 's' : ''}</span><br><small class="admin-card-meta">${range}</small>`;
  };

  const tbody = document.querySelector('#catalog-table tbody');
  tbody.innerHTML = products.map((p) => `
    <tr>
      <td>${adminProdIconCell(p)}</td>
      <td><strong>${p.name}</strong><br><small class="admin-card-meta">${p.slug ? `<a href="/product/${p.slug}" target="_blank">/product/${p.slug}</a>` : ''}</small></td>
      <td>${p.category}</td>
      <td>${peso(p.price)}</td>
      <td>${planLabel(p)}</td>
      <td><span class="admin-stock ${p.stock > 0 ? 'in' : 'out'}">${p.stock}</span></td>
      <td>${p.sold_count ?? 0}</td>
      <td>
        <button class="admin-btn admin-btn-ghost admin-btn-sm" data-edit="${p.id}">Edit</button>
        <button class="admin-btn admin-btn-danger admin-btn-sm" data-del="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--a-muted);padding:2rem">No products yet.</td></tr>`;
}

function adminProdIconCell(p) {
  return invProductIconHtml(p.icon, p.name);
}

function invProductIconHtml(icon, name) {
  const iconId = icon || (window.guessIconFromName ? window.guessIconFromName(name) : '');
  if (iconId && window.renderProductIcon) {
    return `<span class="admin-prod-icon admin-prod-icon-img">${window.renderProductIcon(iconId, name, 'admin-prod-icon-img', 'white')}</span>`;
  }
  return `<span class="admin-prod-icon">${esc((name || '?')[0])}</span>`;
}

function iconPickerHTML(icon = '') {
  const presets = window.PRODUCT_ICON_PRESETS || [];
  const safe = (icon || '').replace(/"/g, '&quot;');
  return `
    <div class="admin-icon-picker">
      <label>Thumbnail / Icon</label>
      <div class="admin-icon-picker-row">
        <div class="admin-icon-preview" id="icon-preview">${window.renderProductIcon ? window.renderProductIcon(icon, '', 'admin-icon-preview-img', '') : '?'}</div>
        <div class="admin-icon-picker-controls">
          <input type="hidden" name="icon" id="product-icon" value="${safe}">
          <input type="text" class="admin-icon-id" id="product-icon-id" value="${safe}" placeholder="e.g. cbi:netflix-alt" autocomplete="off">
          <a class="admin-icon-browse" href="https://icon-sets.iconify.design/" target="_blank" rel="noopener noreferrer">Browse icons at iconify.design ↗</a>
          <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" id="icon-clear">Clear</button>
        </div>
      </div>
      <details class="admin-icon-presets">
        <summary>Preset icons (optional)</summary>
        <div class="admin-icon-grid" id="icon-grid">
          ${presets.map((p) => `
          <button type="button" class="admin-icon-choice ${icon === p.id ? 'active' : ''}" data-icon="${p.id}" title="${p.label}">
            <img src="https://api.iconify.design/${encodeURIComponent(p.id)}.svg" alt="${p.label}" loading="lazy">
          </button>`).join('')}
        </div>
      </details>
    </div>`;
}

function initIconPicker(initialIcon = '', productName = '') {
  const hidden = document.getElementById('product-icon');
  const idInput = document.getElementById('product-icon-id');
  const preview = document.getElementById('icon-preview');
  const nameInput = document.querySelector('#admin-modal-form [name="name"]');
  if (!hidden || !preview) return;

  const setIcon = (iconId, fromUser = true) => {
    hidden.value = iconId;
    if (idInput) idInput.value = iconId;
    preview.innerHTML = iconId
      ? window.renderProductIcon(iconId, productName, 'admin-icon-preview-img', '')
      : '<span class="admin-icon-preview-empty">?</span>';
    document.querySelectorAll('.admin-icon-choice').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.icon === iconId);
    });
    if (fromUser) hidden.dataset.userSet = iconId ? '1' : '';
  };

  document.getElementById('icon-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-icon-choice');
    if (!btn) return;
    setIcon(btn.dataset.icon);
  });

  idInput?.addEventListener('input', () => setIcon(idInput.value.trim()));
  document.getElementById('icon-clear')?.addEventListener('click', () => setIcon(''));

  nameInput?.addEventListener('input', () => {
    if (hidden.dataset.userSet === '1' || hidden.value) return;
    const guess = window.guessIconFromName?.(nameInput.value.trim());
    if (guess) setIcon(guess, false);
  });

  setIcon(initialIcon || hidden.value || '', !!initialIcon);
}

function normalizeBulkTiers(tiers) {
  if (!tiers) return [];
  if (typeof tiers === 'string') {
    try {
      const parsed = JSON.parse(tiers);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return Array.isArray(tiers) ? tiers : [];
}

function formatBulkTiersText(tiers = []) {
  const list = normalizeBulkTiers(tiers);
  if (!list.length) return '';
  return list.map((t) => {
    const max = t.maxQty == null ? '+' : t.maxQty;
    return `${t.minQty}-${max}:${t.price}`;
  }).join(', ');
}

function escTextarea(s) {
  return String(s || '').replace(/<\/textarea/gi, '&lt;/textarea');
}

function parseBulkTiersInput(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { /* fall through */ }
  }
  return raw.split(',').map((part) => {
    const [range, price] = part.split(':');
    if (!range || !price) return null;
    const [min, max] = range.trim().split('-');
    const maxQty = max?.includes('+') ? null : Number(max);
    return { minQty: Number(min), maxQty, price: Number(price.trim()) };
  }).filter((t) => t && t.price > 0);
}

function variantRowHTML(v = {}) {
  return `
    <div class="admin-variant-row">
      <div class="admin-variant-main">
        <input class="v-name admin-modal-input" placeholder="Plan name (e.g. 1 Month)" value="${(v.name || '').replace(/"/g, '&quot;')}">
        <input class="v-price admin-modal-input" type="number" min="0" placeholder="Price ₱" value="${v.price ?? ''}">
        <button type="button" class="admin-variant-del" title="Remove plan" aria-label="Remove plan">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <div class="admin-variant-desc-grid">
        <div class="admin-variant-field">
          <label class="admin-variant-label">Catalog description <small>(shown under plan name on product page)</small></label>
          <textarea class="v-desc admin-modal-input" rows="2" placeholder="e.g. Shared profile · PH only · 1 device">${v.description || v.duration || ''}</textarea>
        </div>
        <div class="admin-variant-field">
          <label class="admin-variant-label">Default rules &amp; regulations <small>(prefilled when adding stock)</small></label>
          <textarea class="v-rules admin-modal-input" rows="2" placeholder="Rules buyers should follow">${v.rules || ''}</textarea>
        </div>
      </div>
      <div class="admin-variant-bulk">
        <label class="admin-toggle admin-variant-bulk-toggle"><input type="checkbox" class="v-bulk-enabled" ${(v.bulkPricingEnabled || v.bulk_pricing_enabled) ? 'checked' : ''}> <span>Bulk pricing for this plan</span></label>
        <textarea class="v-bulk-tiers admin-modal-input" rows="2" placeholder="Tiers: 1-4:100, 5-9:90, 10+:80">${formatBulkTiersText(v.bulkTiers ?? v.bulk_tiers)}</textarea>
      </div>
    </div>`;
}

async function openProductModal(product = null) {
  const p = product || {};
  if (!categoriesCache.length) {
    await fetchCategories();
  } else {
    fetchCategories(true).catch(() => {});
  }

  // A product must be placed under a saved category — block if none exist yet
  if (!categoriesCache.length) {
    openModal('Add Product', `
      <p class="admin-card-meta" style="margin-bottom:1rem">You need to create a category first. Products are always placed under a saved category.</p>
      <div class="admin-modal-actions">
        <button type="button" class="admin-btn admin-btn-ghost" data-close>Cancel</button>
        <button type="button" class="admin-btn admin-btn-primary" id="go-categories">+ Create a Category</button>
      </div>
    `, false);
    document.getElementById('go-categories').addEventListener('click', () => {
      closeModal();
      const catTab = document.querySelector('#catalog-tabs [data-ctab="categories"]');
      if (catTab) catTab.click();
    });
    return;
  }

  const cats = categoriesCache.map((c) => c.name);
  const variants = p.variants && p.variants.length ? p.variants : [{}];
  openModal(product ? 'Edit Product' : 'Add Product', `
    <div class="admin-field"><label>Name</label><input name="name" value="${(p.name || '').replace(/"/g, '&quot;')}" required></div>
    ${iconPickerHTML(p.icon || '')}
    <div class="admin-field"><label>Category</label>
      <select name="category" required>
        ${product ? '' : '<option value="" disabled selected>-- Select category --</option>'}
        ${cats.map((c) => `<option value="${esc(c)}" ${p.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
    </div>
    <div class="admin-field"><label>Short description</label><input name="description" value="${(p.description || '').replace(/"/g, '&quot;')}"></div>
    <div class="admin-field"><label>Long description</label><textarea name="long_description">${escTextarea(p.long_description)}</textarea></div>
    <div class="admin-field"><label>Base price (₱)</label><input name="price" type="number" min="0" value="${p.price ?? ''}" required></div>
    <div class="admin-field"><label>Cost (₱) — for profit tracking</label><input name="cost" type="number" min="0" value="${p.cost ?? 0}"></div>
    <div class="admin-field"><label>Status</label>
      <select name="status">
        ${['AVAILABLE', 'SOLD OUT', 'COMING SOON'].map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="admin-field"><label>Warranty</label><input name="warranty" value="${(p.warranty || '30 days').replace(/"/g, '&quot;')}"></div>
    <div class="admin-field"><label>URL Slug</label><input name="slug" value="${(p.slug || '').replace(/"/g, '&quot;')}" placeholder="auto-generated from name"></div>
    <label class="admin-toggle" style="margin:.3rem 0"><input type="checkbox" name="is_featured" ${p.is_featured ? 'checked' : ''}> <span>Featured product</span></label>
    <label class="admin-toggle" style="margin:.3rem 0"><input type="checkbox" name="is_enabled" ${(product ? p.is_enabled !== 0 : true) ? 'checked' : ''}> <span>Enabled (visible in shop)</span></label>
    <div class="admin-field"><label>Meta title (SEO)</label><input name="meta_title" value="${(p.meta_title || '').replace(/"/g, '&quot;')}"></div>
    <div class="admin-field"><label>Meta description (SEO)</label><textarea name="meta_description" rows="2">${p.meta_description || ''}</textarea></div>
    <label class="admin-toggle" style="margin:.3rem 0"><input type="checkbox" name="allow_pre_order" ${(product ? p.allow_pre_order : 1) ? 'checked' : ''}> <span>Allow Pre-Order <small class="admin-card-meta">(buyers can order even when out of stock)</small></span></label>
    <label class="admin-toggle" style="margin:.3rem 0"><input type="checkbox" name="bulk_pricing_enabled" ${p.bulkPricingEnabled || p.bulk_pricing_enabled ? 'checked' : ''}> <span>Enable bulk pricing (base product)</span></label>
    <div class="admin-field"><label>Bulk tiers (base product)</label><textarea name="bulk_tiers" rows="2" placeholder="1-4:100, 5-9:90, 10+:80">${formatBulkTiersText(p.bulkTiers ?? p.bulk_tiers)}</textarea></div>
    <div class="admin-variants">
      <div class="admin-variants-head"><label>Plans / Variants</label><button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" id="variant-add">+ Add Plan</button></div>
      <p class="admin-variants-hint">Optional. Add subscription plans (e.g. 1 Month, 3 Months). Leave empty to use the base price only.</p>
      <div id="variant-rows">${variants.map(variantRowHTML).join('')}</div>
    </div>
    <div class="admin-modal-actions">
      <button type="button" class="admin-btn admin-btn-ghost" data-close>Cancel</button>
      <button type="submit" class="admin-btn admin-btn-primary">${product ? 'Save changes' : 'Create product'}</button>
    </div>
  `, true, async (form) => {
    const body = Object.fromEntries(new FormData(form));
    if (!body.category) throw new Error('Please select a category');
    body.allow_pre_order = form.querySelector('[name="allow_pre_order"]').checked;
    body.is_featured = form.querySelector('[name="is_featured"]')?.checked;
    body.is_enabled = form.querySelector('[name="is_enabled"]')?.checked;
    body.bulkPricingEnabled = form.querySelector('[name="bulk_pricing_enabled"]').checked;
    body.bulkTiers = parseBulkTiersInput(form.querySelector('[name="bulk_tiers"]').value);
    body.variants = [...form.querySelectorAll('#variant-rows .admin-variant-row')].map((r) => ({
      name: r.querySelector('.v-name').value.trim(),
      duration: r.querySelector('.v-desc').value.trim(),
      price: Number(r.querySelector('.v-price').value) || 0,
      description: r.querySelector('.v-desc').value.trim(),
      rules: r.querySelector('.v-rules').value.trim(),
      bulkPricingEnabled: r.querySelector('.v-bulk-enabled').checked,
      bulkTiers: parseBulkTiersInput(r.querySelector('.v-bulk-tiers').value)
    })).filter((v) => v.name);
    if (product) {
      await api(`/admin/products/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Product updated');
    } else {
      await api('/admin/products', { method: 'POST', body: JSON.stringify(body) });
      showToast('Product added');
    }
    closeModal();
    loadCatalog();
    loadOverview();
  });

  const rows = document.getElementById('variant-rows');
  initIconPicker(p.icon || '', p.name || '');
  document.getElementById('variant-add').addEventListener('click', () => {
    rows.insertAdjacentHTML('beforeend', variantRowHTML());
  });
  rows.addEventListener('click', (e) => {
    const del = e.target.closest('.admin-variant-del'); if (!del) return;
    del.closest('.admin-variant-row').remove();
  });
}

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try {
    await api(`/admin/products/${id}`, { method: 'DELETE' });
    showToast('Product deleted');
    loadCatalog();
    loadOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- Categories ---------------- */
async function loadCategories() {
  await fetchCategories(true);
  const tbody = document.querySelector('#categories-table tbody');
  tbody.innerHTML = categoriesCache.map((c) => `
    <tr>
      <td><strong>${c.name}</strong>${c.description ? `<br><small class="admin-card-meta">${c.description}</small>` : ''}</td>
      <td><code class="admin-card-meta">${c.slug}</code></td>
      <td><span class="admin-plan-badge">${c.product_count}</span></td>
      <td>
        <button class="admin-btn admin-btn-ghost admin-btn-sm" data-edit="${c.id}">Edit</button>
        <button class="admin-btn admin-btn-danger admin-btn-sm" data-del="${c.id}">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--a-muted);padding:2rem">No categories yet. Add one to start grouping products.</td></tr>`;
  tbody.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openCategoryModal(categoriesCache.find((c) => c.id == b.dataset.edit))));
  tbody.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => deleteCategory(b.dataset.del)));
}

function openCategoryModal(category = null) {
  const c = category || {};
  openModal(category ? 'Edit Category' : 'Add Category', `
    <div class="admin-field"><label>Name</label><input name="name" value="${(c.name || '').replace(/"/g, '&quot;')}" required></div>
    <div class="admin-field"><label>Description (optional)</label><textarea name="description">${c.description || ''}</textarea></div>
    <div class="admin-modal-actions">
      <button type="button" class="admin-btn admin-btn-ghost" data-close>Cancel</button>
      <button type="submit" class="admin-btn admin-btn-primary">${category ? 'Save changes' : 'Create category'}</button>
    </div>
  `, true, async (form) => {
    const body = Object.fromEntries(new FormData(form));
    if (category) {
      await api(`/admin/categories/${c.id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Category updated');
    } else {
      await api('/admin/categories', { method: 'POST', body: JSON.stringify(body) });
      showToast('Category added');
    }
    closeModal();
    await fetchCategories(true);
    loadCategories();
  });
}

async function deleteCategory(id) {
  if (!confirm('Delete this category?')) return;
  try {
    await api(`/admin/categories/${id}`, { method: 'DELETE' });
    showToast('Category deleted');
    await fetchCategories(true);
    loadCategories();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------- Transactions ---------------- */
async function loadTransactions() {
  const params = new URLSearchParams();
  if ($('tx-search')?.value) params.set('search', $('tx-search').value.trim());
  if ($('tx-status')?.value) params.set('status', $('tx-status').value);
  if ($('tx-from')?.value) params.set('from', $('tx-from').value);
  if ($('tx-to')?.value) params.set('to', $('tx-to').value);
  const { summary, ledger } = await api(`/admin/transactions?${params}`);

  $('tx-summary').innerHTML = `
    <div class="admin-fcard"><div class="admin-fcard-label">Net Revenue</div><div class="admin-fcard-value green">${peso(summary.netRevenue)}</div></div>
    <div class="admin-fcard"><div class="admin-fcard-label">Orders</div><div class="admin-fcard-value">${summary.orders}</div></div>
    <div class="admin-fcard"><div class="admin-fcard-label">Refund Total</div><div class="admin-fcard-value green">${peso(summary.refundTotal)}</div></div>
    <div class="admin-fcard"><div class="admin-fcard-label">Refund Count</div><div class="admin-fcard-value">${summary.refundCount}</div></div>
    <div class="admin-fcard"><div class="admin-fcard-label">Total Reports</div><div class="admin-fcard-value red">${summary.totalReports}</div></div>
    <div class="admin-fcard"><div class="admin-fcard-label">Good vs Fixed</div><div class="admin-fcard-value">${summary.goodReports} / <span style="color:var(--a-orange)">${summary.fixedReports}</span></div></div>
  `;

  const tbody = document.querySelector('#tx-table tbody');
  tbody.innerHTML = ledger.map((o) => `
    <tr>
      <td><strong>#${o.displayId || o.orderId || o.orderNumber}</strong><br><small class="admin-card-meta">${fmtDate(o.createdAt)}</small></td>
      <td>${o.buyerName}<br><small class="admin-card-meta">${o.email}</small></td>
      <td>${o.itemName}${o.itemQty > 1 ? ` ×${o.itemQty}` : ''}</td>
      <td><strong>${peso(o.total)}</strong><br><small class="admin-card-meta">${o.paymentMethod}</small></td>
      <td>${window.orderStatusBadge ? orderStatusBadge(o.status) : `<span class="admin-status ${o.status}">${esc(ORDER_STATUS_LABEL[o.status] || o.status)}</span>`}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--a-muted);padding:2rem">No transactions found.</td></tr>`;
}

/* ---------------- Inventory ---------------- */
let invLoadGen = 0;
let stockVariantsCache = null;
let stockVariantsCacheAt = 0;
const STOCK_VARIANTS_CACHE_MS = 60_000;

function invalidateStockVariantsCache() {
  stockVariantsCache = null;
  stockVariantsCacheAt = 0;
}

async function getStockVariants() {
  if (stockVariantsCache && Date.now() - stockVariantsCacheAt < STOCK_VARIANTS_CACHE_MS) {
    return stockVariantsCache;
  }
  stockVariantsCache = await api('/admin/variants');
  stockVariantsCacheAt = Date.now();
  return stockVariantsCache;
}

function activeInvTab() {
  return document.querySelector('#inv-tabs .admin-subtab.active')?.dataset.itab || 'stocks';
}

function invProductIconHtml(icon, name) {
  const iconId = icon || (window.guessIconFromName ? window.guessIconFromName(name) : '');
  if (iconId && window.renderProductIcon) {
    return `<span class="admin-prod-icon admin-prod-icon-img">${window.renderProductIcon(iconId, name, 'admin-prod-icon-img', 'white')}</span>`;
  }
  return `<span class="admin-prod-icon">${esc((name || '?')[0])}</span>`;
}

function invChevronSvg() {
  return `<svg class="admin-inv-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
}

function invPlanLabel(v) {
  const dur = v.duration ? ` (${v.duration})` : '';
  return `${v.name}${dur}`;
}

function buildInventoryTreeClient(categories, catalogProducts, stockItems, searchRaw) {
  const search = String(searchRaw || '').trim().toLowerCase();
  const stockByVariant = new Map();
  stockItems.forEach((row) => {
    const key = row.variant_id || `p${row.product_id}`;
    if (!stockByVariant.has(key)) stockByVariant.set(key, []);
    stockByVariant.get(key).push(row);
  });

  const categoryTree = new Map();
  const ensureCat = (name, id = null) => {
    const key = name || 'Uncategorized';
    if (!categoryTree.has(key)) {
      categoryTree.set(key, { id, name: key, products: [], totalCount: 0 });
    }
    return categoryTree.get(key);
  };

  categories.forEach((c) => ensureCat(c.name, c.id));
  ensureCat('Uncategorized');
  const productCatKeys = new Set(categories.map((c) => c.name.toLowerCase()));

  for (const p of catalogProducts) {
    const catName = p.category && productCatKeys.has(String(p.category).toLowerCase())
      ? p.category
      : (p.category || 'Uncategorized');
    const cat = ensureCat(catName);
    const productNode = {
      id: p.id,
      name: p.name,
      icon: p.icon || '',
      variants: [],
      totalCount: 0
    };
    const variantDefs = (p.variants && p.variants.length)
      ? p.variants
      : [{ id: null, name: 'Default', duration: '' }];
    for (const v of variantDefs) {
      const key = v.id || `p${p.id}`;
      let items = stockByVariant.get(key) || [];
      if (search) {
        items = items.filter((s) => {
          const profiles = Array.isArray(s.profiles) ? s.profiles.join(' ') : '';
          const hay = `${s.email} ${s.service_name} ${p.name} ${v.name} ${v.duration || ''} ${profiles}`.toLowerCase();
          return hay.includes(search);
        });
      }
      const nameHay = `${p.name} ${v.name} ${v.duration || ''}`.toLowerCase();
      if (search && items.length === 0 && !nameHay.includes(search)) continue;
      productNode.variants.push({
        id: v.id,
        name: v.name,
        duration: v.duration || '',
        description: v.description || v.duration || '',
        label: v.id
          ? `${p.name} – ${v.name}${v.duration ? ` (${v.duration})` : ''}`
          : p.name,
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
  for (const c of categories) {
    const node = categoryTree.get(c.name) || { id: c.id, name: c.name, products: [], totalCount: 0 };
    if (search && node.totalCount === 0 && node.products.length === 0 && !c.name.toLowerCase().includes(search)) continue;
    result.push(node);
  }
  const uncategorized = categoryTree.get('Uncategorized');
  if (uncategorized?.products.length > 0) result.push(uncategorized);
  return result;
}

async function fetchInventoryTree(sold, search) {
  const params = new URLSearchParams({ tab: sold ? 'sold' : 'stocks' });
  if (search) params.set('search', search);
  try {
    return await api(`/admin/inventory/tree?${params}`);
  } catch (_) {
    const [categories, catalog, items] = await Promise.all([
      api('/admin/categories'),
      api('/admin/catalog'),
      api(sold ? '/admin/inventory/sold' : '/admin/inventory')
    ]);
    return buildInventoryTreeClient(categories, catalog, items, search);
  }
}

function flattenInventoryItems(tree) {
  const items = [];
  tree.forEach((cat) => cat.products.forEach((p) => p.variants.forEach((v) => items.push(...v.items))));
  return items;
}

function renderInvStockRow(s, sold) {
  const profiles = (s.profiles && s.profiles.length)
    ? s.profiles.join(', ')
    : '<span class="admin-card-meta">whole account</span>';
  const soldMeta = sold
    ? `<td><small class="admin-card-meta">${esc(s.sold_to || 'sold')}</small><br><small>${fmtDate(s.sold_at)}</small></td>`
    : `<td class="admin-inv-actions">
        <button class="admin-btn admin-btn-ghost admin-btn-sm" data-edit="${s.id}">Edit</button>
        <button class="admin-btn admin-btn-danger admin-btn-sm" data-del="${s.id}">Delete</button>
      </td>`;
  return `
    <tr>
      <td>${esc(s.email || '—')}</td>
      <td>${profiles}</td>
      <td>${peso(s.price)}</td>
      <td>${s.valid_start || '—'} → ${s.valid_end || '—'}</td>
      ${soldMeta}
    </tr>`;
}

function renderInventoryVariant(product, v, sold) {
  const count = v.stockCount || 0;
  const stockClass = count > 0 ? 'in' : 'out';
  const planLabel = v.name || 'Default';
  const descText = String(v.description || v.duration || '').trim();
  return `
    <div class="admin-inv-variant">
      <button type="button" class="admin-inv-variant-head" data-inv-variant-toggle>
        <div class="admin-inv-variant-head-text">
          <span class="admin-inv-variant-plan">${esc(planLabel)}</span>
          ${descText ? `<span class="admin-inv-variant-desc">${esc(descText)}</span>` : ''}
        </div>
        <span class="admin-inv-stock-pill ${stockClass}">${count}</span>
        ${invChevronSvg()}
      </button>
      <div class="admin-inv-variant-body">
        ${!sold && v.id ? `<div class="admin-inv-variant-actions"><button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-add-variant="${v.id}">+ Add stock</button></div>` : ''}
        ${count > 0 ? `
          <table class="admin-inv-items-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Profile</th>
                <th>Price</th>
                <th>Validity</th>
                <th>${sold ? 'Sold' : ''}</th>
              </tr>
            </thead>
            <tbody>
              ${v.items.map((s) => renderInvStockRow(s, sold)).join('')}
            </tbody>
          </table>
        ` : `<p class="admin-inv-empty-variant">No stock available</p>`}
      </div>
    </div>`;
}

function renderInventoryProduct(product, sold) {
  const variants = product.variants || [];
  if (!variants.length) return '';
  return `
    <div class="admin-inv-product">
      <div class="admin-inv-product-head">
        ${invProductIconHtml(product.icon, product.name)}
        <div class="admin-inv-product-meta">
          <strong class="admin-inv-product-name">${esc(product.name)}</strong>
          <span class="admin-inv-count-pill">${product.totalCount || 0} item${product.totalCount === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="admin-inv-variant-list admin-inv-variant-list--nested">
        ${variants.map((v) => renderInventoryVariant(product, v, sold)).join('')}
      </div>
    </div>`;
}

function renderInventoryTree(tree, sold) {
  if (!tree.length) return '';

  return tree.map((cat) => {
    const products = cat.products || [];
    return `
    <section class="admin-inv-category is-open">
      <button type="button" class="admin-inv-cat-head" data-inv-cat-toggle>
        <span class="admin-inv-cat-icon">${icon('package')}</span>
        <strong class="admin-inv-cat-name">${esc(cat.name)}</strong>
        <span class="admin-inv-count-pill">${cat.totalCount} Item${cat.totalCount === 1 ? '' : 's'}</span>
        ${invChevronSvg()}
      </button>
      <div class="admin-inv-cat-body">
        ${products.length
          ? `<div class="admin-inv-logo-strip" aria-label="Apps in ${esc(cat.name)}">
              ${products.map((p) => `
                <div class="admin-inv-logo-chip" title="${esc(p.name)}">
                  ${invProductIconHtml(p.icon, p.name)}
                  <span>${esc(p.name)}</span>
                </div>`).join('')}
            </div>
            <div class="admin-inv-product-list">
              ${products.map((p) => renderInventoryProduct(p, sold)).join('')}
            </div>`
          : `<p class="admin-inv-empty-category">No products in this category yet.</p>`}
      </div>
    </section>`;
  }).join('');
}

function bindInventoryTree(root, tree, sold) {
  const items = flattenInventoryItems(tree);
  root.querySelectorAll('[data-inv-cat-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.admin-inv-category')?.classList.toggle('is-open');
    });
  });
  root.querySelectorAll('[data-inv-variant-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.admin-inv-variant')?.classList.toggle('is-open');
    });
  });
  root.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => runAsyncAction(
      () => openStockModal(items.find((s) => s.id == b.dataset.edit)),
      { errorMessage: 'Could not open stock editor' }
    )));
  root.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this stock item?')) return;
      await api(`/admin/inventory/${b.dataset.del}`, { method: 'DELETE' });
      showToast('Stock deleted'); loadInventory();
      if (!document.getElementById('tab-all-orders')?.hidden) loadAllOrders();
    }));
  root.querySelectorAll('[data-add-variant]').forEach((b) =>
    b.addEventListener('click', () => runAsyncAction(
      () => openStockModal(null, Number(b.dataset.addVariant)),
      { errorMessage: 'Could not open Add Stock' }
    )));
}

async function loadInventory() {
  const sold = activeInvTab() === 'sold';
  const search = $('inv-search')?.value?.trim() || '';
  const list = $('inv-list');
  const empty = $('inv-empty');
  const gen = ++invLoadGen;
  list?.classList.add('is-loading');
  try {
    const tree = await fetchInventoryTree(sold, search);
    if (gen !== invLoadGen) return;
    $('inv-add').style.display = sold ? 'none' : '';
    empty.hidden = tree.length > 0;
    empty.textContent = sold ? 'No sold stock yet.' : 'No catalog categories yet. Add categories and products in Catalog.';
    list.innerHTML = renderInventoryTree(tree, sold);
    bindInventoryTree(list, tree, sold);
  } catch (err) {
    if (gen !== invLoadGen) return;
    list.innerHTML = '';
    empty.hidden = false;
    empty.textContent = err.message || 'Could not load inventory.';
    showToast(err.message || 'Could not load inventory', 'error');
  } finally {
    if (gen === invLoadGen) list?.classList.remove('is-loading');
  }
}

function profileRowHTML(detail = '', idx = 0) {
  return `
    <div class="admin-profile-row">
      <span class="admin-profile-num">${idx + 1}</span>
      <input class="p-detail" placeholder="Profile Detail" value="${(detail || '').replace(/"/g, '&quot;')}">
      <button type="button" class="admin-profile-del" title="Remove profile">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>`;
}

function renumberProfiles() {
  document.querySelectorAll('#profile-rows .admin-profile-row .admin-profile-num')
    .forEach((el, i) => { el.textContent = i + 1; });
}

async function openStockModal(stock = null, prefillVariantId = null) {
  const s = stock || {};
  const variants = await getStockVariants();
  const initialProfiles = (s.profiles && s.profiles.length) ? s.profiles : (stock ? [''] : ['']);
  openModal(stock ? 'Edit Stock' : 'Add Stock', `
    <div class="admin-field"><label>Select Variant</label>
      <select name="variant_id" id="stock-variant" ${stock ? 'disabled' : ''}>
        <option value="">-- Choose Variant --</option>
        ${variants.map((v) => `<option value="${v.id}" data-service="${v.service_name.replace(/"/g, '&quot;')}" data-rules="${(v.rules || '').replace(/"/g, '&quot;')}" data-cost="${v.cost || 0}" data-price="${v.price || 0}" ${s.variant_id === v.id || prefillVariantId === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select>
    </div>
    <div class="admin-field"><label>Service Name</label><input name="service_name" id="stock-service" value="${(s.service_name || '').replace(/"/g, '&quot;')}" placeholder="Auto-filled from variant" readonly></div>
    <div class="admin-field"><label>Rules and Regulations</label><textarea name="rules" id="stock-rules" rows="3" placeholder="Optional — prefilled from plan default; edit here without changing the plan">${(s.rules || '').replace(/"/g, '&quot;')}</textarea></div>
    <div class="admin-pw-grid">
      <div class="admin-field"><label>Email</label><input name="email" value="${(s.email || '').replace(/"/g, '&quot;')}" placeholder="email@example.com"></div>
      <div class="admin-field"><label>Password</label><input name="password" value="${(s.password || '').replace(/"/g, '&quot;')}" placeholder="password123"></div>
    </div>
    <div class="admin-field"><label>Email Fetcher access code</label><input name="emailfetcher_access_code" value="${(s.emailfetcher_access_code || '').replace(/"/g, '&quot;')}" placeholder="Access code for emailfetcher.site"></div>
    <p class="admin-field-hint">Shown to buyers on Email Fetcher — they open <a href="https://emailfetcher.site" target="_blank" rel="noopener noreferrer">emailfetcher.site</a> and enter this code.</p>
    <div class="admin-profiles">
      <div class="admin-profiles-head">
        <label>Profiles${stock ? '' : ' — each becomes one sellable slot'}</label>
        <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" id="profile-add">+ Add Profile</button>
      </div>
      <div id="profile-rows">${initialProfiles.map((p, i) => profileRowHTML(p, i)).join('')}</div>
    </div>
    <div class="admin-pw-grid">
      <div class="admin-field"><label>Cost</label><input name="cost" type="number" min="0" value="${s.cost ?? 0}"></div>
      <div class="admin-field"><label>Price</label><input name="price" type="number" min="0" value="${s.price ?? 0}"></div>
    </div>
    <div class="admin-pw-grid">
      <div class="admin-field"><label>Valid start</label><input name="valid_start" type="date" value="${s.valid_start || ''}"></div>
      <div class="admin-field"><label>Valid end</label><input name="valid_end" type="date" value="${s.valid_end || ''}"></div>
    </div>
    <div class="admin-modal-actions">
      <button type="button" class="admin-btn admin-btn-ghost" data-close>Cancel</button>
      <button type="submit" class="admin-btn admin-btn-primary">${stock ? 'Save' : 'Add stock'}</button>
    </div>
  `, true, async (form) => {
    const fd = new FormData(form);
    const profiles = [...form.querySelectorAll('#profile-rows .p-detail')]
      .map((i) => i.value.trim()).filter(Boolean);
    const body = {
      variant_id: stock ? s.variant_id : Number(fd.get('variant_id')),
      service_name: fd.get('service_name'),
      rules: fd.get('rules') || '',
      email: fd.get('email'),
      password: fd.get('password'),
      emailfetcher_access_code: fd.get('emailfetcher_access_code') || '',
      profiles,
      cost: Number(fd.get('cost')) || 0,
      price: Number(fd.get('price')) || 0,
      valid_start: fd.get('valid_start') || null,
      valid_end: fd.get('valid_end') || null
    };
    if (!stock && !body.variant_id) throw new Error('Please select a variant');
    if (stock) {
      await api(`/admin/inventory/${s.id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Stock updated');
    } else {
      const r = await api('/admin/inventory', { method: 'POST', body: JSON.stringify(body) });
      showToast(`${r.created} stock slot${r.created > 1 ? 's' : ''} added`);
    }
    invalidateStockVariantsCache();
    closeModal(); loadInventory(); loadCatalog();
    if (!document.getElementById('tab-all-orders')?.hidden) loadAllOrders();
  });

  // Auto-fill service name + default rules + cost/price when a variant is chosen (new stock only)
  const sel = document.getElementById('stock-variant');
  const rulesEl = document.getElementById('stock-rules');
  const applyVariant = () => {
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    document.getElementById('stock-service').value = opt.dataset.service || '';
    if (!stock) rulesEl.value = opt.dataset.rules || '';
    else if (!rulesEl.value.trim()) rulesEl.value = opt.dataset.rules || '';
    const costEl = document.querySelector('#admin-modal-form [name="cost"]');
    const priceEl = document.querySelector('#admin-modal-form [name="price"]');
    if (costEl && !Number(costEl.value)) costEl.value = opt.dataset.cost || 0;
    if (priceEl && !Number(priceEl.value)) priceEl.value = opt.dataset.price || 0;
  };
  if (sel) {
    sel.addEventListener('change', applyVariant);
    applyVariant();
  }

  const rows = document.getElementById('profile-rows');
  document.getElementById('profile-add').addEventListener('click', () => {
    rows.insertAdjacentHTML('beforeend', profileRowHTML('', rows.children.length));
    renumberProfiles();
  });
  rows.addEventListener('click', (e) => {
    const del = e.target.closest('.admin-profile-del'); if (!del) return;
    del.closest('.admin-profile-row').remove();
    renumberProfiles();
  });
}

/* ---------------- Manage Users ---------------- */
async function loadUsers() {
  const params = new URLSearchParams();
  if ($('users-search')?.value) params.set('search', $('users-search').value.trim());
  const { total, users } = await api(`/admin/users?${params}`);
  $('users-total').textContent = `${total} total registered users`;
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = users.map((u) => `
    <tr>
      <td>
        <div class="admin-user-cell">
          <span class="admin-avatar">${(u.name || u.email || '?')[0].toUpperCase()}</span>
          <div><strong>${u.email}</strong><br><small class="admin-card-meta">${u.name || '—'} <span class="admin-handle">@${u.username || ''}</span></small></div>
        </div>
      </td>
      <td><span class="admin-role ${u.is_admin ? 'admin' : ''}">${u.is_admin ? 'ADMIN' : 'USER'}</span>${u.suspended ? ' <span class="admin-status cancelled">Suspended</span>' : ''}</td>
      <td>${u.orders}</td>
      <td>
        <div class="admin-user-spent-cell">
          <strong class="admin-user-spent-amount">${peso(u.spent || 0)}</strong>
          <small class="admin-card-meta">${u.name || '—'}</small>
          <small class="admin-card-meta">${u.email}</small>
        </div>
      </td>
      <td>
        <button class="admin-btn admin-btn-ghost admin-btn-sm" data-view-user="${u.id}">View</button>
        <button class="admin-btn admin-btn-ghost admin-btn-sm" data-user="${u.id}" data-sus="${u.suspended ? 1 : 0}">${u.suspended ? 'Unsuspend' : 'Suspend'}</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-user]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/admin/users/${b.dataset.user}`, { method: 'PUT', body: JSON.stringify({ suspended: b.dataset.sus === '1' ? 0 : 1 }) });
      showToast('User updated'); loadUsers();
    }));
  tbody.querySelectorAll('[data-view-user]').forEach((b) =>
    b.addEventListener('click', () => openUserDetail(Number(b.dataset.viewUser))));
}

async function openUserDetail(userId) {
  try {
    const u = await api(`/admin/users/${userId}`);
    const p = u.profile || {};
    const sec = u.security || {};
    const purchase = u.purchase || {};
    const social = u.social || {};

    const statusCls = u.suspended ? 'cancelled' : 'paid';
    const statusLabel = u.suspended ? 'SUSPENDED' : 'ACTIVE';
    const avatarLetter = (p.name || p.email || '?')[0].toUpperCase();
    const avatarHtml = p.avatarUrl
      ? `<img src="${esc(p.avatarUrl)}" alt="" class="admin-user-detail-avatar-img">`
      : `<span class="admin-avatar admin-user-detail-avatar">${avatarLetter}</span>`;

    const socialEntries = Object.entries(social).filter(([, v]) => String(v || '').trim());
    const socialHtml = socialEntries.length
      ? `<div class="admin-user-detail-section">
          <h4 class="admin-user-detail-section-title">Social links</h4>
          <dl class="admin-user-detail-grid">${socialEntries.map(([key, val]) =>
            `<div><dt>${esc(key)}</dt><dd>${esc(val)}</dd></div>`
          ).join('')}</dl>
        </div>`
      : '';

    openModal('Buyer Profile', `
      <div class="admin-user-detail">
        <div class="admin-user-detail-head">
          ${avatarHtml}
          <div class="admin-user-detail-head-text">
            <strong>${esc(p.name || '—')}</strong>
            ${p.username ? `<span class="admin-handle">@${esc(p.username)}</span>` : ''}
            <span class="admin-card-meta">${esc(p.email || '')}</span>
          </div>
        </div>
        <dl class="admin-user-detail-grid">
          <div><dt>User ID</dt><dd>${p.id}</dd></div>
          <div><dt>Full name</dt><dd>${esc(p.name || '—')}</dd></div>
          <div><dt>Username</dt><dd>${p.username ? `@${esc(p.username)}` : '—'}</dd></div>
          <div><dt>Email</dt><dd>${esc(p.email || '—')}</dd></div>
          <div><dt>Phone</dt><dd>${esc(p.phone || '—')}</dd></div>
          <div><dt>Role</dt><dd>${(u.role || 'buyer').toUpperCase()}</dd></div>
          <div><dt>Status</dt><dd><span class="admin-status ${statusCls}">${statusLabel}</span></dd></div>
          <div><dt>Country</dt><dd>${esc(p.country || '—')}</dd></div>
          <div><dt>Timezone</dt><dd>${esc(p.timezone || '—')}</dd></div>
          <div><dt>Member since</dt><dd>${fmtDate(p.createdAt || u.registrationDate)}</dd></div>
          <div><dt>Last login</dt><dd>${fmtDate(u.lastLogin || sec.lastLoginAt)}</dd></div>
          <div><dt>Last login IP</dt><dd>${esc(u.lastLoginIp || sec.lastLoginIp || '—')}</dd></div>
          <div><dt>Total orders</dt><dd>${purchase.totalOrders ?? u.totalPurchases ?? 0}</dd></div>
          <div><dt>Total spent</dt><dd>${peso(purchase.totalSpent || 0)}</dd></div>
          <div><dt>Membership</dt><dd>${esc(purchase.membershipLevel || 'member')}</dd></div>
        </dl>
        ${socialHtml}
        <p class="admin-user-detail-note">Password is never shown for security.</p>
        <div class="admin-modal-actions">
          <button type="button" class="admin-btn admin-btn-ghost" data-close>Close</button>
        </div>
      </div>
    `, false);
  } catch (err) {
    showToast(err.message || 'Could not load buyer profile', 'error');
  }
}

async function refreshTicketsBadge() {
  try {
    const { openCount } = await api('/admin/support-tickets?status=open');
    const badge = $('tickets-badge');
    if (badge) {
      badge.textContent = openCount;
      badge.hidden = !openCount;
    }
  } catch (_) { /* ignore */ }
}

function activeTicketsTab() {
  return document.querySelector('#tickets-tabs .admin-subtab.active')?.dataset.ttab || 'open';
}

function parseTicketIdFromNotif(body) {
  const match = String(body || '').match(/Ticket #(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function loadSupportTickets() {
  const status = activeTicketsTab();
  const params = new URLSearchParams({ status });
  const search = $('tickets-search')?.value?.trim();
  if (search) params.set('search', search);

  try {
    const { openCount, tickets } = await api(`/admin/support-tickets?${params}`);
    $('tickets-total').textContent = `${openCount} open ticket${openCount === 1 ? '' : 's'}`;
    refreshTicketsBadge();

    const list = $('tickets-list');
    const empty = $('tickets-empty');
    if (!tickets.length) {
      list.innerHTML = '';
      empty.hidden = false;
      empty.textContent = status === 'closed' ? 'No closed tickets.' : 'No open tickets.';
      return;
    }

    empty.hidden = true;
    list.innerHTML = tickets.map((t) => `
      <article class="admin-ticket-card ${t.status === 'open' ? 'is-open' : 'is-closed'}">
        <div class="admin-ticket-icon" aria-hidden="true">${icon('ticket')}</div>
        <div class="admin-ticket-main">
          <div class="admin-ticket-head">
            <strong>${esc(t.subject)}</strong>
            <span class="admin-status ${t.status === 'open' ? 'pending' : 'paid'}">${t.status === 'open' ? 'OPEN' : 'CLOSED'}</span>
          </div>
          <p class="admin-ticket-preview">${esc(t.body.length > 140 ? `${t.body.slice(0, 140)}…` : t.body)}</p>
          <div class="admin-ticket-meta">
            <span>${esc(t.buyerName)}</span>
            <span>${esc(t.buyerEmail)}</span>
            <span>${fmtDate(t.createdAt)}</span>
          </div>
        </div>
        <div class="admin-ticket-actions">
          <button type="button" class="admin-btn admin-btn-primary admin-btn-sm" data-view-ticket="${t.id}">View</button>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('[data-view-ticket]').forEach((btn) =>
      btn.addEventListener('click', () => openTicketDetail(Number(btn.dataset.viewTicket))));
  } catch (err) {
    showToast(err.message || 'Could not load tickets', 'error');
  }
}

async function openTicketDetail(ticketId) {
  try {
    const t = await api(`/admin/support-tickets/${ticketId}`);
    const isOpen = t.status === 'open';
    openModal(`Ticket #${t.id}`, `
      <div class="admin-ticket-detail">
        <div class="admin-ticket-detail-head">
          <div>
            <h3 class="admin-ticket-detail-subject">${esc(t.subject)}</h3>
            <span class="admin-status ${isOpen ? 'pending' : 'paid'}">${isOpen ? 'OPEN' : 'CLOSED'}</span>
          </div>
          <span class="admin-card-meta">${fmtDate(t.createdAt)}</span>
        </div>
        <dl class="admin-user-detail-grid">
          <div><dt>Buyer</dt><dd>${esc(t.buyerName)}</dd></div>
          <div><dt>Email</dt><dd>${esc(t.buyerEmail)}</dd></div>
          <div><dt>Username</dt><dd>${t.buyerUsername ? `@${esc(t.buyerUsername)}` : '—'}</dd></div>
          <div><dt>User ID</dt><dd>${t.userId}</dd></div>
        </dl>
        <div class="admin-ticket-message">
          <label class="admin-variant-label">Message</label>
          <div class="admin-ticket-message-body">${esc(t.body)}</div>
        </div>
        <div class="admin-modal-actions">
          <button type="button" class="admin-btn admin-btn-ghost" data-view-buyer="${t.userId}">View buyer</button>
          <button type="button" class="admin-btn admin-btn-ghost" data-message-buyer="${t.userId}">Direct message</button>
          <button type="button" class="admin-btn ${isOpen ? 'admin-btn-primary' : 'admin-btn-ghost'}" id="ticket-status-btn" data-ticket-id="${t.id}" data-ticket-status="${t.status}">
            ${isOpen ? 'Mark as closed' : 'Reopen ticket'}
          </button>
          <button type="button" class="admin-btn admin-btn-ghost" data-close>Close</button>
        </div>
      </div>
    `, false);

    document.getElementById('ticket-status-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('ticket-status-btn');
      const nextStatus = btn.dataset.ticketStatus === 'open' ? 'closed' : 'open';
      try {
        await api(`/admin/support-tickets/${btn.dataset.ticketId}`, {
          method: 'PUT',
          body: JSON.stringify({ status: nextStatus })
        });
        showToast(nextStatus === 'closed' ? 'Ticket closed' : 'Ticket reopened', 'approved');
        closeModal();
        loadSupportTickets();
        refreshTicketsBadge();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    modalForm.querySelector('[data-view-buyer]')?.addEventListener('click', () => {
      closeModal();
      openUserDetail(t.userId);
    });

    modalForm.querySelector('[data-message-buyer]')?.addEventListener('click', async () => {
      closeModal();
      await openDmForUser(t.userId, t.buyerName);
    });
  } catch (err) {
    showToast(err.message || 'Could not load ticket', 'error');
  }
}

async function openDmForUser(userId, buyerName) {
  switchTab('direct-message');
  const threads = await api('/admin/messages');
  const thread = threads.find((th) => Number(th.user_id) === Number(userId));
  if (thread) {
    openDM(thread.id);
    return;
  }
  showToast(`No chat thread yet for ${buyerName || 'this buyer'}. They can message you from their account.`, 'info');
}

/* ---------------- Store Updates ---------------- */
async function loadStoreUpdates() {
  const list = $('store-updates-list');
  const empty = $('store-updates-empty');
  if (!list) return;
  try {
    const { updates } = await api('/admin/store-updates');
    if (!updates?.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = updates.map((u) => `
      <article class="admin-store-update-card info-card ${u.isPublished ? '' : 'is-hidden'}">
        <header class="admin-store-update-head">
          <strong>${esc(u.title)}</strong>
          <span class="admin-store-update-meta">${fmtDate(u.createdAt)}${u.isPublished ? '' : ' · Hidden'}</span>
        </header>
        <p class="admin-store-update-body">${esc(u.body)}</p>
        <div class="admin-store-update-actions">
          <button type="button" class="admin-btn admin-btn-sm" data-edit-update="${u.id}">Edit</button>
          <button type="button" class="admin-btn admin-btn-sm admin-btn-danger" data-del-update="${u.id}">Delete</button>
        </div>
      </article>
    `).join('');
    list.querySelectorAll('[data-del-update]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this update?')) return;
        try {
          await api(`/admin/store-updates/${btn.dataset.delUpdate}`, { method: 'DELETE' });
          showToast('Update deleted');
          loadStoreUpdates();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
    list.querySelectorAll('[data-edit-update]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const u = updates.find((x) => x.id === Number(btn.dataset.editUpdate));
        if (u) openStoreUpdateEdit(u);
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function publishStoreUpdate() {
  const title = $('store-update-title')?.value.trim();
  const body = $('store-update-body')?.value.trim();
  const notifyBuyers = $('store-update-notify')?.checked ?? true;
  if (!title || !body) {
    showToast('Title and message are required', 'error');
    return;
  }
  const btn = $('store-update-publish');
  btn.disabled = true;
  try {
    await api('/admin/store-updates', {
      method: 'POST',
      body: JSON.stringify({ title, body, notifyBuyers })
    });
    $('store-update-title').value = '';
    $('store-update-body').value = '';
    showToast(notifyBuyers ? 'Update published — buyers notified' : 'Update published');
    loadStoreUpdates();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function openStoreUpdateEdit(u) {
  openModal('Edit update', `
    <div class="admin-field"><label>Title</label><input name="title" value="${esc(u.title).replace(/"/g, '&quot;')}" required maxlength="120"></div>
    <div class="admin-field"><label>Message</label><textarea name="body" rows="4" required maxlength="2000">${esc(u.body)}</textarea></div>
    <div class="admin-field"><label>Visibility</label>
      <select name="isPublished">
        <option value="1" ${u.isPublished ? 'selected' : ''}>Visible to buyers</option>
        <option value="0" ${!u.isPublished ? 'selected' : ''}>Hidden</option>
      </select>
    </div>
    <div class="admin-modal-actions">
      <button type="button" class="admin-btn" data-close>Cancel</button>
      <button type="submit" class="admin-btn admin-btn-primary">Save</button>
    </div>
  `, true, async (form) => {
    await api(`/admin/store-updates/${u.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: form.title.value.trim(),
        body: form.body.value.trim(),
        isPublished: form.isPublished.value === '1'
      })
    });
    showToast('Update saved');
    closeModal();
    loadStoreUpdates();
  });
}

/* ---------------- Direct Message ---------------- */
let activeDmId = null;
async function loadDM() {
  const threads = await api('/admin/messages');
  const wrap = $('dm-threads');
  wrap.innerHTML = threads.map((t) => `
    <button class="admin-chat-item ${t.id === activeDmId ? 'active' : ''}" data-dm="${t.id}">
      <span class="admin-avatar sm">${(t.customer_name || '?')[0].toUpperCase()}</span>
      <div><strong>${t.customer_name}</strong><small>${t.last_message || ''}</small></div>
    </button>
  `).join('') || `<div class="admin-empty">No conversations.</div>`;
  wrap.querySelectorAll('[data-dm]').forEach((b) => b.addEventListener('click', () => openDM(Number(b.dataset.dm))));
}
async function openDM(id) {
  activeDmId = id;
  document.querySelectorAll('#dm-threads .admin-chat-item').forEach((b) => b.classList.toggle('active', Number(b.dataset.dm) === id));
  const { thread, messages } = await api(`/admin/messages/${id}`);
  renderConversation($('dm-window'), thread.customer_name, messages, async (text) => {
    await api(`/admin/messages/${id}/reply`, { method: 'POST', body: JSON.stringify({ body: text }) });
    openDM(id);
  });
}

function renderConversation(wrap, title, messages, onSend) {
  wrap.innerHTML = `
    <div class="admin-conv-head">${title}</div>
    <div class="admin-conv-body">${messages.map((m) => `
      <div class="admin-bubble ${m.sender === 'admin' ? 'me' : 'them'}">${m.body}<small>${fmtDate(m.created_at)}</small></div>
    `).join('')}</div>
    <form class="admin-conv-input"><input class="admin-modal-input" placeholder="Type a reply..." required><button class="admin-btn admin-btn-primary admin-btn-sm">Send</button></form>
  `;
  const body = wrap.querySelector('.admin-conv-body');
  body.scrollTop = body.scrollHeight;
  wrap.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    try { await onSend(text); } catch (err) { showToast(err.message, 'error'); }
  });
}

/* ---------------- Notifications ---------------- */
const NOTIF_ICON = { chat: 'chat', order: 'receipt', message: 'updates', ticket: 'ticket', payout: 'dollar', report: 'flag', system: 'info', plugging: 'message', website: 'store' };
async function loadNotifications() {
  const { notifications } = await api('/admin/notifications');
  $('notif-list').innerHTML = notifications.map((n) => {
    const ticketId = n.type === 'ticket' ? parseTicketIdFromNotif(n.body) : null;
    const viewBtn = ticketId
      ? `<button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-notif-ticket="${ticketId}">View ticket</button>`
      : '';
    const iconName = NOTIF_ICON[n.type] || 'info';
    return `
    <div class="admin-notif ${n.is_read ? '' : 'unread'}">
      <span class="admin-notif-icon">${icon(iconName)}</span>
      <div class="admin-notif-body">
        <strong>${esc(n.title)}</strong>
        <p>${esc(n.body)}</p>
        <small>${fmtDate(n.created_at)}</small>
        ${viewBtn}
      </div>
    </div>`;
  }).join('') || `<div class="admin-empty">No notifications.</div>`;

  $('notif-list').querySelectorAll('[data-notif-ticket]').forEach((btn) =>
    btn.addEventListener('click', () => openTicketDetail(Number(btn.dataset.notifTicket))));
}

/* ---------------- Product Reports ---------------- */

let reportResolveContext = null;
let reportResolveAction = 'fix_active';

function activeReportsTab() {
  return document.querySelector('#reports-tabs .admin-subtab.active')?.dataset.rtab || 'active';
}

function closeReportResolveModal() {
  const modal = $('report-resolve-modal');
  if (modal) modal.hidden = true;
  reportResolveContext = null;
  reportResolveAction = 'fix_active';
}

function formatReportProofGallery(report) {
  let proof = null;
  try { proof = JSON.parse(report.proof_urls || ''); } catch (_) { proof = null; }
  if (!proof?.vouch && !proof?.photos?.length) {
    return report.proof_note
      ? `<p class="admin-card-meta" style="margin-top:.4rem">Note: ${esc(report.proof_note)}</p>`
      : '';
  }
  const items = [];
  if (proof.vouch) items.push({ label: 'Vouch', url: proof.vouch });
  (proof.photos || []).forEach((url, i) => items.push({ label: `Proof ${i + 1}`, url }));
  return `
    <div class="admin-report-proof-gallery">
      ${items.map((item) => `
        <a class="admin-report-proof-thumb" href="${esc(item.url)}" target="_blank" rel="noopener">
          <img src="${esc(item.url)}" alt="${esc(item.label)}">
          <span>${esc(item.label)}</span>
        </a>
      `).join('')}
    </div>`;
}

function renderAffectedReportCard(r) {
  const username = r.username ? `@${r.username}` : r.buyer_name || r.email;
  return `
    <div class="admin-report-affected-card">
      <div class="admin-report-affected-head">
        <strong>${esc(username)}</strong>
        <span class="admin-status pending_payment">Open</span>
      </div>
      <dl class="admin-report-affected-meta">
        <div><dt>Request Type: </dt><dd>${esc(r.report_type || 'report')}</dd></div>
        <div><dt>Issue: </dt><dd>${esc(r.detail?.split('\n')[0] || '—')}</dd></div>
        <div><dt>Name: </dt><dd>${esc(r.buyer_name || '—')}</dd></div>
        <div><dt>Remaining Days: </dt><dd>${esc(r.remaining_days || '—')}</dd></div>
        <div><dt>Subscription/Product: </dt><dd>${esc(r.service || '—')}</dd></div>
      </dl>
      ${formatReportProofGallery(r)}
    </div>
  `;
}

function renderCredentialGroupCard(group) {
  const statusCls = group.credentialStatus === 'reported' ? 'cancelled' : 'paid';
  const statusLabel = group.credentialStatus === 'reported' ? 'Reported' : 'OK';
  return `
    <div class="admin-report-credential-card">
      <div class="admin-report-credential-head">
        <div>
          <strong>${esc(group.productName || 'Account')}</strong>
          <small class="admin-card-meta">${esc(group.email || '—')}</small>
        </div>
        <span class="admin-status ${statusCls}">${statusLabel}</span>
      </div>
      <div class="admin-report-profile-list">
        ${(group.profiles || []).map((p) => `
          <div class="admin-report-profile-row ${p.reported ? 'is-reported' : ''}">
            <span>${esc(p.detail)}</span>
            <span class="admin-status ${p.reported ? 'cancelled' : 'paid'}">${p.reported ? 'Reported' : 'OK'}</span>
          </div>
        `).join('') || '<p class="admin-card-meta">No profiles on credential.</p>'}
      </div>
    </div>`;
}

function formatProfilesForInput(profiles) {
  return (profiles || [])
    .map((p) => (typeof p === 'string' ? p : (p?.detail || p?.name || '')))
    .filter(Boolean)
    .join(', ');
}

function renderReportResolveForm(data) {
  const { report, stockItem, emailAccess, credentialGroups } = data;
  const groups = credentialGroups?.length ? credentialGroups : [];
  const primaryGroup = groups[0] || null;
  const credSource = stockItem || primaryGroup || {};
  const profiles = formatProfilesForInput(stockItem?.profiles || primaryGroup?.profiles);
  const accessProfiles = formatProfilesForInput(emailAccess?.profileData || primaryGroup?.profiles);
  const hasStock = !!(stockItem || primaryGroup);

  $('report-resolve-subtitle').textContent = groups.length
    ? `${groups.length} credential(s) · Order #${report.order_number || '—'}`
    : stockItem
      ? `${stockItem.serviceName || 'Account'} · Order #${report.order_number || '—'}`
      : `Order #${report.order_number || '—'}`;

  $('report-resolve-body').innerHTML = `
    <div>
      <div class="admin-report-section-label">Report summary</div>
      <dl class="admin-report-summary-grid">
        <div><dt>Product(s)</dt><dd>${esc(report.productSummary || report.service || '—')}</dd></div>
        <div><dt>Quantity reported</dt><dd>${report.reportQuantity || 1}</dd></div>
        <div><dt>Buyer</dt><dd>${esc(report.buyerName || report.buyer_name || report.email || '—')}</dd></div>
        <div><dt>Issue</dt><dd>${esc(report.issueText || '—')}</dd></div>
        <div><dt>Remaining days</dt><dd>${esc(report.remainingDays || report.remaining_days || '—')}</dd></div>
        <div><dt>Selected item(s)</dt><dd>${esc(report.selectedItemsSummary || '—')}</dd></div>
        <div><dt>Admin note (buyer)</dt><dd>${esc(report.adminNote || report.admin_note || '—')}</dd></div>
      </dl>
      <span class="admin-status pending_payment">New Report</span>
    </div>

    <div>
      <div class="admin-report-section-label">Credentials &amp; profiles</div>
      <div class="admin-report-credential-groups">
        ${groups.length
          ? groups.map(renderCredentialGroupCard).join('')
          : '<p class="admin-card-meta">No credential details linked.</p>'}
      </div>
    </div>

    ${hasStock ? `
      <div>
        <div class="admin-report-section-label">Master credentials (primary)</div>
        <div class="admin-report-credentials">
          <div class="admin-field"><label>Email</label><input id="rr-email" type="text" value="${esc(credSource.email || '')}"></div>
          <div class="admin-field"><label>Password</label><input id="rr-password" type="text" value="${esc(credSource.password || '')}"></div>
          <div class="admin-field"><label>Profile data</label><input id="rr-profiles" type="text" value="${esc(profiles)}" placeholder="Profile 1, Profile 2"></div>
        </div>
      </div>
      <div>
        <div class="admin-report-section-label">Email access credentials</div>
        <div class="admin-report-credentials">
          <div class="admin-field"><label>Email</label><input id="rr-access-email" type="text" value="${esc(emailAccess?.email || credSource.email || '')}"></div>
          <div class="admin-field"><label>Password</label><input id="rr-access-password" type="text" value="${esc(emailAccess?.password || credSource.password || '')}"></div>
          <div class="admin-field"><label>Profile data</label><input id="rr-access-profiles" type="text" value="${esc(accessProfiles)}" placeholder="Profile 1"></div>
        </div>
      </div>
    ` : `<p class="admin-card-meta">No purchased account linked. Fix &amp; Active requires a linked stock item.</p>`}

    <div>
      <div class="admin-report-section-label">Buyer proof</div>
      ${formatReportProofGallery(report) || '<p class="admin-card-meta">No proof uploaded.</p>'}
    </div>

    <div class="admin-field">
      <label>Stock description</label>
      <textarea id="rr-stock-desc" rows="2" placeholder="Replacement stock notes…">${esc(report.stock_description || '')}</textarea>
    </div>
    <div class="admin-field">
      <label>Note to buyer</label>
      <textarea id="rr-admin-notes" rows="2" placeholder="Message shown in the buyer Reports panel…">${esc(report.admin_note || report.adminNote || report.admin_notes || '')}</textarea>
    </div>
    <div class="admin-field admin-report-reject-field" id="rr-reject-wrap" hidden>
      <label>Rejection reason</label>
      <textarea id="rr-reject-reason" rows="2" placeholder="Reason shown to buyer…"></textarea>
    </div>

    <div>
      <div class="admin-report-section-label">Action</div>
      <div class="admin-report-actions-grid" id="rr-action-grid">
        <button type="button" class="admin-report-action-btn ${reportResolveAction === 'fix_active' ? 'active' : ''}" data-action="fix_active">Fix &amp; Active</button>
        <button type="button" class="admin-report-action-btn ${reportResolveAction === 'refund' ? 'active' : ''}" data-action="refund">Refund</button>
        <button type="button" class="admin-report-action-btn ${reportResolveAction === 'void' ? 'active' : ''}" data-action="void">Void</button>
        <button type="button" class="admin-report-action-btn ${reportResolveAction === 'reject' ? 'active' : ''}" data-action="reject">Reject</button>
      </div>
    </div>
    <button type="button" class="admin-report-apply-btn" id="rr-apply-btn">Apply Action</button>
  `;

  $('report-resolve-body').querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportResolveAction = btn.dataset.action;
      $('report-resolve-body').querySelectorAll('[data-action]').forEach((b) => b.classList.toggle('active', b === btn));
      const rejectWrap = $('rr-reject-wrap');
      if (rejectWrap) rejectWrap.hidden = reportResolveAction !== 'reject';
    });
  });

  $('rr-apply-btn').addEventListener('click', submitReportAction);
}

async function openReportResolveModal(reportId) {
  const modal = $('report-resolve-modal');
  modal.hidden = false;
  reportResolveAction = 'fix_active';
  $('report-resolve-title').textContent = 'Resolve Issue';
  $('report-resolve-body').innerHTML = '<p class="dashboard-loading">Loading report…</p>';

  try {
    const data = await api(`/admin/reports/${reportId}/detail`);
    reportResolveContext = { reportId, data };
    renderReportResolveForm(data);
  } catch (err) {
    $('report-resolve-body').innerHTML = `<p class="admin-card-meta">${esc(err.message)}</p>`;
  }
}

async function submitReportAction() {
  if (!reportResolveContext) return;
  const { reportId, data } = reportResolveContext;
  const btn = $('rr-apply-btn');
  const body = {
    action: reportResolveAction,
    adminNotes: $('rr-admin-notes')?.value.trim() || '',
    stockDescription: $('rr-stock-desc')?.value.trim() || ''
  };

  if (reportResolveAction === 'fix_active') {
    body.email = $('rr-email')?.value.trim();
    body.password = $('rr-password')?.value.trim();
    body.profiles = $('rr-profiles')?.value.trim();
    body.emailAccessEmail = $('rr-access-email')?.value.trim();
    body.emailAccessPassword = $('rr-access-password')?.value.trim();
    body.emailAccessProfileData = $('rr-access-profiles')?.value.trim();
  }
  if (reportResolveAction === 'reject') {
    body.rejectReason = $('rr-reject-reason')?.value.trim();
    if (!body.rejectReason) {
      showToast('Rejection reason is required', 'error');
      return;
    }
  }

  btn.disabled = true;
  try {
    await api(`/admin/reports/${reportId}/action`, { method: 'POST', body: JSON.stringify(body) });
    const labels = { fix_active: 'Account replaced', refund: 'Refund processed', void: 'Report voided', reject: 'Report rejected' };
    showToast(labels[reportResolveAction] || 'Action applied', 'approved');
    closeReportResolveModal();
    loadReports();
    loadOverview();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
  }
}

async function saveReportAdminNote(reportId, btn) {
  const input = document.querySelector(`textarea[data-note-report="${reportId}"]`);
  const adminNote = input?.value.trim() || '';
  if (btn) btn.disabled = true;
  try {
    await api(`/admin/reports/${reportId}/note`, {
      method: 'PUT',
      body: JSON.stringify({ adminNote })
    });
    showToast('Admin note saved for buyer', 'approved');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadReports() {
  const tab = activeReportsTab();
  const params = new URLSearchParams({ tab });
  if ($('reports-search')?.value) params.set('search', $('reports-search').value.trim());
  const reports = await api(`/admin/reports?${params}`);
  $('reports-empty').hidden = reports.length > 0;
  const tbody = document.querySelector('#reports-table tbody');
  tbody.innerHTML = reports.map((r) => {
    const buyer = r.username ? `@${r.username}` : r.buyer_name || r.email;
    const typeLabel = r.report_type === 'refund' ? 'Refund' : 'Report';
    const statusCls = r.status === 'resolved' ? 'paid' : 'pending_payment';
    const actionLabel = r.resolution_action
      ? r.resolution_action.replace('_', ' ')
      : (r.resolution || '');
    return `
    <tr>
      <td>${r.order_number ? '#' + r.order_number : '—'}</td>
      <td>${esc(buyer)}</td>
      <td>${typeLabel}</td>
      <td>${esc(r.productSummary || r.service || '—')}</td>
      <td>${esc(r.issueText || (r.detail || '').split('\n')[0] || '—')}</td>
      <td>${esc(r.remainingDays || r.remaining_days || '—')}</td>
      <td>${esc(r.selectedItemsSummary || '—')}</td>
      <td class="admin-report-note-cell">
        <textarea class="admin-report-note-input" data-note-report="${r.id}" rows="2" placeholder="Note visible to buyer…">${esc(r.adminNote || '')}</textarea>
        <button type="button" class="admin-btn admin-btn-ghost admin-btn-sm" data-save-note="${r.id}">Save</button>
      </td>
      <td><span class="admin-status ${statusCls}">${r.status}</span></td>
      <td>${r.status === 'active'
        ? `<button class="admin-btn admin-btn-success admin-btn-sm" data-resolve="${r.id}">Resolve</button>`
        : `<small class="admin-card-meta">${esc(actionLabel)}</small>`}</td>
    </tr>
  `;
  }).join('');
  tbody.querySelectorAll('[data-resolve]').forEach((b) =>
    b.addEventListener('click', () => openReportResolveModal(Number(b.dataset.resolve))));
  tbody.querySelectorAll('[data-save-note]').forEach((b) =>
    b.addEventListener('click', () => saveReportAdminNote(Number(b.dataset.saveNote), b)));
}

/* ---------------- Account Settings ---------------- */
let accountLoaded = false;
function showAccountPane(pane) {
  ['security', 'payments', 'integrations', 'social', 'contact', 'tingi'].forEach((p) => {
    const el = $(`account-${p}`);
    if (!el) return;
    const show = p === pane;
    el.hidden = !show;
    if (show) el.style.removeProperty('display');
    else el.style.display = 'none';
  });
  if (pane === 'payments') loadPayments();
  if (pane === 'contact') loadContact();
  if (pane === 'integrations') loadIntegrations();
  if (pane === 'social') loadSocial();
  if (pane === 'tingi') loadTingiSettings();
}
function loadAccount() {
  if (!accountLoaded) { accountLoaded = true; }
  showAccountPane(document.querySelector('#account-tabs .admin-subtab.active')?.dataset.atab || 'security');
}
async function submitPassword(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (fd.get('newPassword') !== fd.get('confirm')) { showToast('Passwords do not match', 'error'); return; }
  try {
    await api('/admin/account/password', { method: 'POST', body: JSON.stringify({ oldPassword: fd.get('oldPassword'), newPassword: fd.get('newPassword') }) });
    showToast('Password updated', 'approved'); e.target.reset();
  } catch (err) { showToast(err.message, 'error'); }
}

async function resetWebsite() {
  const confirmVal = ($('reset-website-confirm')?.value || '').trim();
  if (confirmVal !== 'RESET') {
    showToast('Type RESET in the confirmation field', 'error');
    return;
  }
  const ok = window.confirm(
    'Reset the entire website to a fresh state?\n\n' +
    'This deletes all users (except admin), orders, reports, refunds, inventory stock, and chat history.'
  );
  if (!ok) return;
  const btn = $('reset-website-btn');
  if (btn) btn.disabled = true;
  try {
    await api('/admin/reset-website', { method: 'POST', body: JSON.stringify({ confirm: 'RESET' }) });
    showToast('Website reset — reloading…', 'approved');
    invalidateOrdersCache();
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) btn.disabled = false;
  }
}

/* ---------------- Integrations ---------------- */
let integrationsData = null;
const INTG_META = {
  gmail: { icon: 'gmail', title: 'Gmail OAuth', sub: 'Connect seller Gmail once. Buyers get Email Access in their dashboard after order approval — OTPs and login emails auto-fetch from this inbox.' },
  'buyer-emails': { icon: 'gmail', title: 'Buyer Emails', sub: 'Welcome, forgot password, order delivered, and password changed — sent via SMTP (recommended) or Gmail OAuth.' },
  smtp: { icon: 'gmail', title: 'SMTP', sub: 'Send buyer emails (welcome, forgot password, order delivered) through your SMTP provider. Gmail OAuth is still used only for OTP fetch.' },
  'chat-seller': { icon: 'headset', title: 'Chat Seller Auto Reply', sub: 'Welcome message and instant reply in buyer Chat Seller — active when enabled.' }
};
function fieldTextarea(label, name, value = '', rows = 3, placeholder = '') {
  const safe = String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<div class="admin-field"><label>${label}</label><textarea name="${name}" rows="${rows}" placeholder="${placeholder}">${safe}</textarea></div>`;
}
async function loadIntegrations() {
  integrationsData = await api('/admin/integrations');
  try {
    integrationsData['chat-seller'] = await api('/admin/chat-seller-bot');
  } catch {
    integrationsData['chat-seller'] = integrationsData['chat-seller'] || {};
  }
  renderIntegration(document.querySelector('#intg-list .admin-intg-item.active')?.dataset.intg || 'gmail');
}

function buildIntegrationPayload(form) {
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd);
  payload.enabled = form.querySelector('[name="enabled"]')?.checked ?? false;
  if (form.querySelector('[name="unreadOnly"]')) payload.unreadOnly = form.querySelector('[name="unreadOnly"]').checked;
  if (form.querySelector('[name="inboxOnly"]')) payload.inboxOnly = form.querySelector('[name="inboxOnly"]').checked;
  if (form.querySelector('[name="welcome"]')) payload.welcome = form.querySelector('[name="welcome"]').checked;
  if (form.querySelector('[name="passwordReset"]')) payload.passwordReset = form.querySelector('[name="passwordReset"]').checked;
  if (form.querySelector('[name="password"]')) payload.password = form.querySelector('[name="password"]').checked;
  if (form.querySelector('[name="orderDelivered"]')) payload.orderDelivered = form.querySelector('[name="orderDelivered"]').checked;
  if (form.querySelector('[name="secure"]')) payload.secure = form.querySelector('[name="secure"]').checked;
  delete payload.testEmail;
  return payload;
}

let integrationHandlersBound = false;
function bindIntegrationFormHandlers() {
  if (integrationHandlersBound) return;
  integrationHandlersBound = true;
  const wrap = $('intg-form');
  if (!wrap) return;

  wrap.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[id^="intg-"]');
    if (!form) return;
    e.preventDefault();
    const name = form.id.replace(/^intg-/, '').replace(/-form$/, '');
    const meta = INTG_META[name];
    const payload = buildIntegrationPayload(form);
    const saveUrl = name === 'chat-seller' ? '/admin/chat-seller-bot' : `/admin/integrations/${name}`;
    try {
      await api(saveUrl, { method: 'PUT', body: JSON.stringify(payload) });
      showToast(name === 'gmail' ? 'Gmail filters saved — remembered next time' : `${meta.title} saved`, 'approved');
      await loadIntegrations();
    } catch (err) { showToast(err.message, 'error'); }
  });

  wrap.addEventListener('click', async (e) => {
    const testSmtpBtn = e.target.closest('#intg-test-smtp');
    if (testSmtpBtn) {
      const form = testSmtpBtn.closest('form[id^="intg-"]');
      if (!form) return;
      testSmtpBtn.disabled = true;
      testSmtpBtn.textContent = 'Sending...';
      try {
        const payload = buildIntegrationPayload(form);
        payload.testEmail = new FormData(form).get('testEmail') || '';
        const r = await api('/admin/integrations/test-smtp', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showToast(r.message, r.ok ? 'approved' : 'error');
      } catch (err) { showToast(err.message, 'error'); }
      testSmtpBtn.disabled = false;
      testSmtpBtn.textContent = 'Send SMTP Test';
      return;
    }

    const testBuyerBtn = e.target.closest('#intg-test-buyer-email');
    if (testBuyerBtn) {
      const form = testBuyerBtn.closest('form[id^="intg-"]');
      if (!form) return;
      const fd = new FormData(form);
      testBuyerBtn.disabled = true;
      testBuyerBtn.textContent = 'Sending...';
      try {
        const r = await api('/admin/integrations/test-buyer-email', { method: 'POST', body: JSON.stringify({
          testEmail: fd.get('testEmail') || ''
        }) });
        showToast(r.message, r.ok ? 'approved' : 'error');
      } catch (err) { showToast(err.message, 'error'); }
      testBuyerBtn.disabled = false;
      testBuyerBtn.textContent = 'Send Test Email';
      return;
    }

    const testBtn = e.target.closest('#intg-test');
    if (testBtn) {
      const form = testBtn.closest('form[id^="intg-"]');
      if (!form) return;
      const fd = new FormData(form);
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      try {
        const r = await api('/admin/integrations/test-gmail', { method: 'POST', body: JSON.stringify({
          testEmail: fd.get('testEmail') || ''
        }) });
        showToast(r.message, r.ok ? 'approved' : 'error');
      } catch (err) { showToast(err.message, 'error'); }
      testBtn.disabled = false;
      testBtn.textContent = 'Test Fetcher';
      return;
    }
  });
}
function field(label, name, value = '', type = 'text', placeholder = '') {
  return `<div class="admin-field"><label>${label}</label><input name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}"></div>`;
}
function renderIntegration(name) {
  document.querySelectorAll('#intg-list .admin-intg-item').forEach((b) => b.classList.toggle('active', b.dataset.intg === name));
  const d = (integrationsData && integrationsData[name]) || {};
  const meta = INTG_META[name];
  let body = '';
  if (name === 'gmail') {
    const redirectUri = d.redirectUri || '';
    const domainOk = d.domainConnected !== false;
    const oauthReady = d.oauthConfigured && domainOk;
    const gmailConnected = !!d.gmailConnected;
    const domainNotice = domainOk
      ? ''
      : `<p class="admin-card-meta admin-gmail-domain-warn">${icon('warning', 'admin-ui-icon admin-ui-icon--warn')} Connect your <strong>custom domain</strong> first — set <code>PUBLIC_URL=https://loveriette.shop</code> in server <code>.env</code>, restart PM2, then connect Gmail OAuth.</p>`;
    body = `
      <div class="admin-gmail-shell">
      <section class="admin-gmail-section admin-gmail-oauth-guide">
      <h4 class="admin-gmail-section-title">${icon('info')} Gmail OAuth setup (step-by-step)</h4>
      <ol class="admin-oauth-steps">
        <li><strong>Custom domain ready</strong> — <code>PUBLIC_URL=https://loveriette.shop</code> in VPS <code>.env</code>, then <code>pm2 restart ecommerce</code>.</li>
        <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console → Credentials</a>. Create project if needed.</li>
        <li><strong>OAuth consent screen</strong> → External → add app name, support email, save.</li>
        <li><strong>Create OAuth client ID</strong> → Web application.</li>
        <li>Paste this <strong>Authorized redirect URI</strong>:<br><code class="admin-oauth-uri-inline">${esc(redirectUri || 'https://loveriette.shop/auth/google/callback')}</code></li>
        <li>Copy <strong>Client ID</strong> and <strong>Client Secret</strong> into VPS <code>.env</code>:<br><code>GOOGLE_CLIENT_ID=...</code><br><code>GOOGLE_CLIENT_SECRET=...</code></li>
        <li>Run <code>pm2 restart ecommerce</code> on VPS.</li>
        <li>Come back here → click <strong>Connect Gmail</strong> → sign in with your seller inbox.</li>
        <li>Save message filters below (Netflix OTP senders, etc.) → toggle integration ON.</li>
      </ol>
      </section>
      <section class="admin-gmail-section">
      <h4 class="admin-gmail-section-title">${icon('gmail')} Connect inbox</h4>
      ${domainNotice}
      <p class="admin-gmail-lead admin-card-meta">
        ${!d.oauthConfigured
          ? `${icon('warning', 'admin-ui-icon admin-ui-icon--warn')} Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to server <code>.env</code>, then restart PM2.`
          : domainOk
            ? 'Click <strong>Connect Gmail</strong> and sign in with the inbox that receives OTP / login emails for your products. After you approve shop orders, buyers can fetch emails from their dashboard → Email Access.'
            : 'Gmail OAuth stays disabled until <code>PUBLIC_URL</code> points to your live custom domain (HTTPS).'}
      </p>
      ${oauthReady ? `
        <div class="admin-field admin-gmail-field">
          <label>Google OAuth redirect URI (paste in Google Cloud Console)</label>
          <input type="text" readonly class="admin-gmail-uri" value="${esc(redirectUri)}" onclick="this.select()">
        </div>` : ''}
      <div class="admin-modal-actions admin-gmail-actions">
        <a href="/auth/google" class="admin-btn admin-btn-primary admin-btn-lg" ${oauthReady ? '' : 'aria-disabled="true" style="pointer-events:none;opacity:.5"'}>${icon('gmail')} Connect Gmail</a>
        <button type="button" class="admin-btn admin-btn-ghost admin-btn-lg" id="intg-test">Test Fetcher</button>
      </div>
      <p class="admin-card-meta">${gmailConnected
        ? 'Gmail is connected. Accounts auto-remove after 30 days — no inbox list stored in admin.'
        : 'No Gmail connected yet — connect above to enable buyer Email Access.'}</p>
      ${field('Test account email (optional)', 'testEmail', '', 'email', 'buyer-account@email.com')}
      </section>
      <section class="admin-gmail-section admin-gmail-section--filters">
      <h4 class="admin-gmail-section-title">${icon('filter')} Message filters</h4>
      <p class="admin-card-meta">Buyers only see <strong>1 latest matching email</strong> per fetch — not the whole inbox. Filters apply before delivery.</p>
      <label class="admin-toggle admin-gmail-toggle"><input type="checkbox" name="unreadOnly" ${d.unreadOnly !== false ? 'checked' : ''}> <span>Unread only (recommended)</span></label>
      <label class="admin-toggle admin-gmail-toggle"><input type="checkbox" name="inboxOnly" ${d.inboxOnly !== false ? 'checked' : ''}> <span>Inbox only (exclude spam/promotions)</span></label>
      ${fieldTextarea('Allowed senders / domains (one per line, optional)', 'allowedSenders', d.allowedSenders || '', 4, 'netflix.com\naccount.netflix.com\nnoreply@canva.com')}
      ${fieldTextarea('Blocked senders / domains (one per line, optional)', 'blockedSenders', d.blockedSenders || '', 3, 'newsletter@spam.com')}
      ${field('Subject must contain (comma-separated, optional)', 'subjectKeywords', d.subjectKeywords || '', 'text', 'code, OTP, verify, reset')}
      ${field('Extra Gmail search query (optional)', 'extraQuery', d.extraQuery || '', 'text', 'category:primary')}
      <p class="admin-card-meta">Saved filters apply automatically — you only set them once.</p>
      <div class="admin-modal-actions">
        <button type="submit" class="admin-btn admin-btn-primary admin-btn-lg">Save filters</button>
      </div>
      </section>
      </div>`;
  } else if (name === 'smtp') {
    const passHint = d.hasPassword ? 'Saved — leave blank to keep current password' : 'SMTP password or API key';
    body = `
      <section class="admin-gmail-section">
      <h4 class="admin-gmail-section-title">${icon('gmail')} SMTP server</h4>
      <p class="admin-card-meta">Recommended for welcome, forgot password, and order emails. Use your provider's SMTP host — e.g. Resend, Brevo, or Zoho. Verify your domain with the provider first.</p>
      ${field('SMTP host', 'host', d.host || '', 'text', 'smtp.resend.com')}
      ${field('Port', 'port', d.port || 465, 'number', '465')}
      <label class="admin-toggle admin-gmail-toggle"><input type="checkbox" name="secure" ${d.secure !== false ? 'checked' : ''}> <span>Use SSL/TLS (port 465 — turn off for port 587 STARTTLS)</span></label>
      ${field('Username', 'user', d.user || '', 'text', 'resend')}
      ${field('Password / API key', 'password', '', 'password', passHint)}
      ${field('From email', 'fromEmail', d.fromEmail || '', 'email', 'noreply@loveriette.shop')}
      ${field('From name', 'fromName', d.fromName || 'loveriette', 'text', 'loveriette')}
      ${field('Send test email to', 'testEmail', '', 'email', 'your@gmail.com')}
      <div class="admin-modal-actions admin-gmail-actions">
        <button type="button" class="admin-btn admin-btn-ghost admin-btn-lg" id="intg-test-smtp">Send SMTP Test</button>
        <button type="submit" class="admin-btn admin-btn-primary admin-btn-lg">Save SMTP</button>
      </div>
      </section>`;
  } else if (name === 'buyer-emails') {
    const connected = d.smtpEnabled && d.smtpConfigured
      ? `SMTP — ${esc(d.fromEmail || d.connectedEmail || 'configured')}`
      : d.gmailConnected
        ? esc(d.connectedEmail || 'Gmail connected')
        : 'Not configured — set up SMTP or Gmail OAuth first';
    body = `
      <section class="admin-gmail-section">
      <h4 class="admin-gmail-section-title">${icon('gmail')} Outbound buyer emails</h4>
      <p class="admin-card-meta">Uses <strong>SMTP first</strong> if enabled, otherwise connected Gmail. Turn the main switch ON, then choose which emails to send.</p>
      <p class="admin-card-meta">Sender status: <strong>${connected}</strong></p>
      ${!(d.smtpConfigured || d.gmailConnected) ? '<p class="admin-card-meta admin-gmail-domain-warn">Set up <strong>SMTP</strong> (recommended) or connect Gmail under Gmail OAuth.</p>' : ''}
      <label class="admin-toggle admin-gmail-toggle"><input type="checkbox" name="welcome" ${d.welcome !== false ? 'checked' : ''}> <span>Welcome email on sign up</span></label>
      <label class="admin-toggle admin-gmail-toggle"><input type="checkbox" name="passwordReset" ${d.passwordReset !== false ? 'checked' : ''}> <span>Forgot password reset link email</span></label>
      <label class="admin-toggle admin-gmail-toggle"><input type="checkbox" name="password" ${d.password !== false ? 'checked' : ''}> <span>Password changed email</span></label>
      <label class="admin-toggle admin-gmail-toggle"><input type="checkbox" name="orderDelivered" ${d.orderDelivered !== false ? 'checked' : ''}> <span>Order delivered email (approved + all accounts delivered)</span></label>
      <p class="admin-card-meta">Credentials in order emails show <strong>Check on website</strong> only — buyers open My Purchases on the site.</p>
      ${field('Send test email to', 'testEmail', '', 'email', 'your@gmail.com')}
      <div class="admin-modal-actions admin-gmail-actions">
        <button type="button" class="admin-btn admin-btn-ghost admin-btn-lg" id="intg-test-buyer-email">Send Test Email</button>
        <button type="submit" class="admin-btn admin-btn-primary admin-btn-lg">Save Buyer Emails</button>
      </div>
      </section>`;
  } else if (name === 'chat-seller') {
    body = `
      ${fieldTextarea('Welcome message (shown when chat is empty)', 'welcome', d.welcome || '', 3, 'Hi! Thanks for messaging…')}
      ${fieldTextarea('Auto reply (after buyer sends a message)', 'autoReply', d.autoReply || '', 2, 'Thanks for your message! We will reply shortly.')}
      <p class="admin-card-meta">Turn off the toggle to disable bot messages. Real admin replies in Direct Message still work.</p>
      <div class="admin-modal-actions"><button type="submit" class="admin-btn admin-btn-primary">Save Integrations</button></div>`;
  }

  $('intg-form').innerHTML = `
    <form id="intg-${name}-form" class="admin-intg-form-panel ${name === 'gmail' ? 'admin-intg-form-panel--gmail' : ''}">
      <div class="admin-intg-head">
        <div><h3>${icon(meta.icon, 'admin-ui-icon admin-ui-icon--lg')} ${meta.title}</h3><p class="admin-card-meta">${meta.sub}</p></div>
        <label class="admin-switch"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}><span></span></label>
      </div>
      ${body}
    </form>`;
}

/* ---------------- Social Links ---------------- */
async function loadSocial() {
  const links = await api('/admin/social');
  const wrap = $('social-rows');
  wrap.innerHTML = '';
  (links.length ? links : [{ key: '', label: '', url: '', enabled: true }]).forEach((l) => addSocialRow(l));
}
function addSocialRow(l = { key: '', label: '', url: '', enabled: true }) {
  const wrap = $('social-rows');
  const row = document.createElement('div');
  row.className = 'admin-social-row';
  const icon = (window.socialIcon ? window.socialIcon(l.key) : '');
  row.innerHTML = `
    <span class="admin-social-logo" title="auto logo">${icon}</span>
    <div class="admin-field"><label>Key</label><input class="s-key" value="${l.key || ''}" placeholder="telegram"></div>
    <div class="admin-field"><label>Label</label><input class="s-label" value="${l.label || ''}" placeholder="Vouches"></div>
    <div class="admin-field"><label>URL</label><input class="s-url" value="${l.url || ''}" placeholder="https://t.me/..."></div>
    <label class="admin-switch"><input type="checkbox" class="s-enabled" ${l.enabled ? 'checked' : ''}><span></span></label>
    <button type="button" class="admin-social-del" title="Remove">&times;</button>`;
  row.querySelector('.s-key').addEventListener('input', (e) => {
    if (window.socialIcon) row.querySelector('.admin-social-logo').innerHTML = window.socialIcon(e.target.value);
  });
  row.querySelector('.admin-social-del').addEventListener('click', () => row.remove());
  wrap.appendChild(row);
}
async function saveSocial() {
  const links = [...document.querySelectorAll('#social-rows .admin-social-row')].map((r) => ({
    key: r.querySelector('.s-key').value.trim().toLowerCase(),
    label: r.querySelector('.s-label').value.trim(),
    url: r.querySelector('.s-url').value.trim(),
    enabled: r.querySelector('.s-enabled').checked
  })).filter((l) => l.key || l.label || l.url);
  try {
    await api('/admin/social', { method: 'PUT', body: JSON.stringify({ links }) });
    showToast('Social links saved', 'approved');
  } catch (err) { showToast(err.message, 'error'); }
}

/* ---------------- Store Profile ---------------- */
function updateStorePhotoPreview(url) {
  const img = $('store-photo-preview');
  if (!img) return;
  const fallback = '/assets/store-logo.png';
  img.src = url || fallback;
  img.onerror = () => { img.src = fallback; };
}

async function uploadStoreProfilePhoto(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const { photoUrl } = await api('/admin/store-profile/photo', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    if ($('store-photo-url')) $('store-photo-url').value = photoUrl;
    updateStorePhotoPreview(photoUrl);
    showToast('Profile photo uploaded');
  } catch (err) {
    showToast(err.message, 'error');
  }
  e.target.value = '';
}

async function loadStoreProfile() {
  const p = await api('/admin/store-profile');
  $('store-name').value = p.displayName || '';
  $('store-bio').value = p.bio || '';
  $('store-location').value = p.location || '';
  if ($('store-vouch-telegram')) $('store-vouch-telegram').value = p.vouchSellerTelegram || '';
  if ($('store-photo-url')) $('store-photo-url').value = p.photoUrl || '';
  updateStorePhotoPreview(p.photoUrl || '');
}
async function saveStoreProfile() {
  await api('/admin/store-profile', {
    method: 'PUT',
    body: JSON.stringify({
      displayName: $('store-name').value,
      bio: $('store-bio').value,
      location: $('store-location').value,
      photoUrl: $('store-photo-url')?.value || '',
      vouchSellerTelegram: $('store-vouch-telegram')?.value || ''
    })
  });
  showToast('Store profile saved', 'approved');
}

/* ---------------- Loyalty ---------------- */
async function loadTingiSettings() {
  const s = await api('/admin/tingi-settings');
  if ($('tingi-checkout-enabled')) $('tingi-checkout-enabled').checked = !!s.checkoutEnabled;
  if ($('tingi-min-qty')) $('tingi-min-qty').value = s.minQty || 2;
  if ($('tingi-max-qty')) $('tingi-max-qty').value = s.maxQty || 50;
  if ($('tingi-hold-days')) $('tingi-hold-days').value = s.holdDays || 10;
  if ($('tingi-min-auto')) $('tingi-min-auto').value = s.minAutoDrop || 5;
}
async function saveTingiSettings() {
  const body = {
    checkoutEnabled: $('tingi-checkout-enabled')?.checked || false,
    minQty: Number($('tingi-min-qty')?.value) || 2,
    maxQty: Number($('tingi-max-qty')?.value) || 50,
    holdDays: Number($('tingi-hold-days')?.value) || 10,
    minAutoDrop: Number($('tingi-min-auto')?.value) || 5
  };
  await api('/admin/tingi-settings', { method: 'PUT', body: JSON.stringify(body) });
  showToast('Tingi Drop settings saved', 'approved');
}

/* ---------------- Site Theme ---------------- */
const THEME_COLOR_FIELDS = [
  { picker: 'theme-bg', hex: 'theme-bg-hex', key: 'background' },
  { picker: 'theme-font', hex: 'theme-font-hex', key: 'font' },
  { picker: 'theme-primary', hex: 'theme-primary-hex', key: 'primary' },
  { picker: 'theme-secondary', hex: 'theme-secondary-hex', key: 'secondary' }
];

function readThemeColorsFromForm() {
  return {
    background: $('theme-bg-hex')?.value,
    font: $('theme-font-hex')?.value,
    primary: $('theme-primary-hex')?.value,
    secondary: $('theme-secondary-hex')?.value
  };
}

function normalizeThemeHexInput(hex) {
  const h = String(hex || '').trim();
  const m = h.match(/^#?([a-fA-F0-9]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : null;
}

function setThemeColorFields(colors) {
  THEME_COLOR_FIELDS.forEach(({ picker, hex, key }) => {
    const value = normalizeThemeHexInput(colors[key]);
    if (!value) return;
    if ($(picker)) $(picker).value = value;
    if ($(hex)) $(hex).value = value;
  });
}

function updateThemeRowAccents(colors) {
  THEME_COLOR_FIELDS.forEach(({ picker, key }) => {
    const row = $(picker)?.closest('.admin-theme-row');
    const value = normalizeThemeHexInput(colors?.[key]) || readThemeColorsFromForm()[key];
    if (row && value) row.style.setProperty('--theme-row-accent', value);
  });
}

function bindThemeColorInputs() {
  THEME_COLOR_FIELDS.forEach(({ picker, hex }) => {
    on(picker, 'input', (e) => {
      if ($(hex)) $(hex).value = e.target.value;
      previewThemeColors();
    });
    on(hex, 'input', (e) => {
      const v = e.target.value.trim();
      if (/^#[a-fA-F0-9]{6}$/.test(v) && $(picker)) $(picker).value = v;
      previewThemeColors();
    });
  });
}

function previewThemeColors() {
  const colors = readThemeColorsFromForm();
  window.applyThemeColors?.(colors);
  updateThemeRowAccents(colors);
  updateThemeBrandPreview();
}

function updateThemeBrandPreview() {
  const name = $('theme-brand-name')?.value || 'loveriette';
  const font = $('theme-brand-font')?.value || 'Pinyon Script';
  const fontBold = $('theme-brand-font-bold')?.value || 'Syne';
  const logo = $('theme-logo-url')?.value || '/assets/store-logo.png';
  const logoAutoTheme = $('theme-logo-auto')?.checked ?? true;
  if ($('theme-preview-logo')) { $('theme-preview-logo').src = logo; $('theme-preview-logo').hidden = !logo; }
  if ($('theme-logo-preview')) { $('theme-logo-preview').src = logo; $('theme-logo-preview').hidden = !logo; }
  window.applyStoreBranding?.({ name, logoUrl: logo, nameFont: font, nameFontBold: fontBold, logoAutoTheme });
}

async function applyColorhuntPalette() {
  const url = $('theme-colorhunt-url')?.value?.trim();
  if (!url) {
    showToast('Paste a Colorhunt palette link first', 'error');
    return;
  }
  try {
    let colors;
    if (window.parseColorhuntUrl && window.mapPaletteToTheme) {
      const hexes = window.parseColorhuntUrl(url);
      if (!hexes) throw new Error('Invalid Colorhunt palette link');
      colors = window.mapPaletteToTheme(hexes);
    } else {
      const res = await api('/admin/theme/colorhunt', { method: 'POST', body: JSON.stringify({ url }) });
      colors = res.colors;
    }
    if (!colors) throw new Error('Could not read colors from that link');
    setThemeColorFields(colors);
    previewThemeColors();
    showToast('Palette applied — preview updated');
  } catch (err) {
    showToast(err.message || 'Invalid Colorhunt link', 'error');
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function uploadThemeLogo(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const { logoUrl } = await api('/admin/theme/logo', { method: 'POST', body: JSON.stringify({ dataUrl }) });
    $('theme-logo-url').value = logoUrl;
    updateThemeBrandPreview();
    showToast('Logo uploaded');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadTheme() {
  const t = await api('/admin/theme');
  const colors = {
    background: t.background || '#f1dec9',
    font: t.font || '#4a3c2e',
    primary: t.primary || t.lightPrimary || '#8d7b68',
    secondary: t.secondary || '#a4907c'
  };
  setThemeColorFields(colors);
  if ($('theme-colorhunt-url')) $('theme-colorhunt-url').value = t.colorhuntUrl || '';
  if ($('theme-brand-name')) $('theme-brand-name').value = t.brandName || 'loveriette';
  if ($('theme-brand-font')) $('theme-brand-font').value = t.nameFont || 'Pinyon Script';
  if ($('theme-brand-font-bold')) $('theme-brand-font-bold').value = t.nameFontBold || 'Syne';
  if ($('theme-logo-url')) $('theme-logo-url').value = t.logoUrl || '';
  if ($('theme-logo-auto')) $('theme-logo-auto').checked = t.logoAutoTheme !== false;
  window.saveThemeToStorage?.(colors);
  previewThemeColors();
}
async function saveTheme() {
  const colors = readThemeColorsFromForm();
  const res = await api('/admin/theme', {
    method: 'PUT',
    body: JSON.stringify({
      ...colors,
      colorhuntUrl: $('theme-colorhunt-url')?.value || '',
      forceMode: 'light',
      brandName: $('theme-brand-name').value,
      nameFont: $('theme-brand-font').value,
      nameFontBold: $('theme-brand-font-bold')?.value || 'Syne',
      logoUrl: $('theme-logo-url').value,
      logoAutoTheme: $('theme-logo-auto')?.checked ?? true
    })
  });
  const saved = res.colors || colors;
  window.applyThemeColors?.(saved);
  window.saveThemeToStorage?.(saved);
  window.applyStoreBranding?.({
    name: $('theme-brand-name').value,
    logoUrl: $('theme-logo-url').value,
    nameFont: $('theme-brand-font').value,
    nameFontBold: $('theme-brand-font-bold')?.value || 'Syne',
    logoAutoTheme: $('theme-logo-auto')?.checked ?? true
  });
  showToast('Theme saved', 'approved');
}

/* ---------------- Payments ---------------- */
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const PAYMENT_METHOD_LIMIT = 10;

function renderPaymentMethodCard(m) {
  const qrPreview = m.qr_image_url
    ? `<img class="admin-qr-preview" src="${escAttr(m.qr_image_url)}" alt="${escAttr(m.name)} QR">`
    : `<div class="admin-qr-empty">No QR uploaded</div>`;
  return `
    <div class="admin-field">
      <label>Payment method name</label>
      <input type="text" class="admin-payment-name" value="${escAttr(m.name)}" maxlength="48" placeholder="e.g. GCASH Wallet" data-method-id="${m.id}">
    </div>
    ${qrPreview}
    <div class="admin-field">
      <label>QR code image</label>
      <input type="file" class="admin-payment-qr-file" accept="image/jpeg,image/png,image/webp,image/gif" data-method-id="${m.id}">
      <p class="admin-card-meta">Upload a square QR image (JPG, PNG, WebP).</p>
    </div>
    <div class="admin-field">
      <label>Account number <span class="admin-field-optional">(optional)</span></label>
      <input type="text" class="admin-payment-account" value="${escAttr(m.account_number || '')}" placeholder="e.g. 09XX XXX XXXX" data-method-id="${m.id}">
    </div>
    <div class="admin-payment-method-actions">
      <button type="button" class="admin-btn admin-btn-primary admin-btn-sm admin-payment-save" data-method-id="${m.id}">Save method</button>
      <button type="button" class="admin-btn admin-btn-danger admin-btn-sm admin-payment-delete" data-method-id="${m.id}">Delete</button>
    </div>
  `;
}

async function loadPayments() {
  loaded.payments = true;
  const data = await api('/admin/payment-methods');
  const instructionsText = data.instructionsText || '';
  const methods = data.methods || data;
  const maxMethods = data.maxMethods || PAYMENT_METHOD_LIMIT;
  const methodCount = data.methodCount ?? methods.length;

  const instructionsEl = document.getElementById('payment-instructions-text');
  if (instructionsEl) instructionsEl.value = instructionsText;

  const saveInstructionsBtn = document.getElementById('payment-instructions-save');
  if (saveInstructionsBtn && !saveInstructionsBtn.dataset.bound) {
    saveInstructionsBtn.dataset.bound = '1';
    saveInstructionsBtn.addEventListener('click', savePaymentInstructions);
  }

  const addBtn = document.getElementById('payment-method-add');
  const countEl = document.getElementById('payment-method-count');
  if (countEl) countEl.textContent = `${methodCount} / ${maxMethods} methods`;
  if (addBtn) {
    addBtn.disabled = methodCount >= maxMethods;
    if (!addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', addPaymentMethod);
    }
  }

  const wrap = document.getElementById('payments-list');
  wrap.innerHTML = '';
  methods.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'admin-card admin-payment-method-card';
    card.dataset.methodId = m.id;
    card.innerHTML = renderPaymentMethodCard(m);
    wrap.appendChild(card);
  });

  wrap.querySelectorAll('.admin-payment-save').forEach((btn) => {
    btn.addEventListener('click', () => savePaymentMethod(Number(btn.dataset.methodId)));
  });
  wrap.querySelectorAll('.admin-payment-delete').forEach((btn) => {
    btn.addEventListener('click', () => deletePaymentMethod(Number(btn.dataset.methodId)));
  });
}

async function addPaymentMethod() {
  const addBtn = document.getElementById('payment-method-add');
  if (addBtn?.disabled) return;
  if (addBtn) addBtn.disabled = true;
  try {
    await api('/admin/payment-methods', {
      method: 'POST',
      body: JSON.stringify({ name: 'New payment method' })
    });
    showToast('Payment method added', 'approved');
    await loadPayments();
  } catch (err) {
    showToast(err.message, 'error');
    if (addBtn) addBtn.disabled = false;
  }
}

async function savePaymentInstructions() {
  const text = (document.getElementById('payment-instructions-text')?.value || '').trim();
  const btn = document.getElementById('payment-instructions-save');
  if (btn) btn.disabled = true;
  try {
    await api('/admin/payment-settings', { method: 'PUT', body: JSON.stringify({ instructionsText: text }) });
    showToast('Payment instructions saved', 'approved');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deletePaymentMethod(methodId) {
  const card = document.querySelector(`.admin-payment-method-card[data-method-id="${methodId}"]`);
  const name = card?.querySelector('.admin-payment-name')?.value?.trim() || 'this method';
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const btn = card?.querySelector('.admin-payment-delete');
  if (btn) btn.disabled = true;
  try {
    await api(`/admin/payment-methods/${methodId}`, { method: 'DELETE' });
    showToast('Payment method deleted', 'approved');
    await loadPayments();
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) btn.disabled = false;
  }
}

async function savePaymentMethod(methodId) {
  const card = document.querySelector(`.admin-payment-method-card[data-method-id="${methodId}"]`);
  if (!card) return;
  const btn = card.querySelector('.admin-payment-save');
  const fileInput = card.querySelector('.admin-payment-qr-file');
  const accountInput = card.querySelector('.admin-payment-account');
  const nameInput = card.querySelector('.admin-payment-name');
  const name = (nameInput?.value || '').trim();
  if (!name) {
    showToast('Payment method name is required', 'error');
    return;
  }
  if (btn) btn.disabled = true;
  try {
    if (fileInput?.files?.[0]) {
      const dataUrl = await readFileAsDataUrl(fileInput.files[0]);
      const { qrImageUrl } = await api(`/admin/payment-methods/${methodId}/qr`, {
        method: 'POST',
        body: JSON.stringify({ dataUrl })
      });
      const preview = card.querySelector('.admin-qr-preview');
      const empty = card.querySelector('.admin-qr-empty');
      if (preview) {
        preview.src = qrImageUrl;
        preview.alt = `${name} QR`;
      } else if (empty) {
        empty.outerHTML = `<img class="admin-qr-preview" src="${escAttr(qrImageUrl)}" alt="${escAttr(name)} QR">`;
      }
      fileInput.value = '';
    }
    await api(`/admin/payment-methods/${methodId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name,
        account_number: accountInput?.value?.trim() || ''
      })
    });
    showToast('Payment method saved', 'approved');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------------- Redeem ---------------- */
async function loadRedeem() {
  let codes = await api('/admin/redeem-codes');
  const search = ($('redeem-search')?.value || '').toUpperCase();
  if (search) codes = codes.filter((c) => c.code.toUpperCase().includes(search));
  const tbody = document.querySelector('#redeem-table tbody');
  tbody.innerHTML = codes.map((c) => {
    const val = c.discount_type === 'percent' ? `${c.discount_value}%` : peso(c.discount_value);
    const exhausted = c.max_uses != null && c.used_count >= c.max_uses;
    const status = !c.is_active ? 'Off' : exhausted ? 'Used up' : 'Active';
    return `
      <tr>
        <td><strong>${c.code}</strong></td>
        <td>${val}</td>
        <td>${c.used_count} / ${c.max_uses ?? '∞'}</td>
        <td><span class="admin-status ${status === 'Active' ? 'paid' : 'cancelled'}">${status}</span></td>
        <td>${c.max_uses ?? '∞'}</td>
        <td>
          <button class="admin-btn admin-btn-ghost admin-btn-sm" data-code="${c.id}">Edit</button>
          <button class="admin-btn admin-btn-danger admin-btn-sm" data-del="${c.id}">Delete</button>
        </td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-code]').forEach((b) =>
    b.addEventListener('click', () => openRedeemModal(codes.find((c) => c.id == b.dataset.code))));
  tbody.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this code?')) return;
      await api(`/admin/redeem-codes/${b.dataset.del}`, { method: 'DELETE' });
      showToast('Code deleted'); loadRedeem();
    }));
}

function openBulkModal() {
  openModal('Generate Bulk Codes', `
    <div class="admin-field"><label>How many codes</label><input name="count" type="number" min="1" max="100" value="10"></div>
    <div class="admin-field"><label>Discount type</label>
      <select name="discount_type"><option value="percent">Percent (%)</option><option value="fixed">Fixed (₱)</option></select>
    </div>
    <div class="admin-field"><label>Value</label><input name="discount_value" type="number" min="0" value="5"></div>
    <div class="admin-field"><label>Max uses each</label><input name="max_uses" type="number" min="1" value="1"></div>
    <div class="admin-modal-actions">
      <button type="button" class="admin-btn admin-btn-ghost" data-close>Cancel</button>
      <button type="submit" class="admin-btn admin-btn-primary">Generate</button>
    </div>
  `, true, async (form) => {
    const fd = new FormData(form);
    const created = await api('/admin/redeem-codes/bulk', { method: 'POST', body: JSON.stringify({
      count: Number(fd.get('count')), discount_type: fd.get('discount_type'),
      discount_value: Number(fd.get('discount_value')), max_uses: Number(fd.get('max_uses'))
    }) });
    showToast(`${created.length} codes generated`, 'approved');
    closeModal(); loadRedeem();
  });
}

function openRedeemModal(code = null) {
  const c = code || {};
  openModal(code ? `Edit ${c.code}` : 'Add Redeem Code', `
    <div class="admin-field"><label>Code</label><input name="code" value="${c.code || ''}" style="text-transform:uppercase" required></div>
    <div class="admin-field"><label>Discount type</label>
      <select name="discount_type">
        <option value="fixed" ${c.discount_type === 'fixed' ? 'selected' : ''}>Fixed (₱)</option>
        <option value="percent" ${c.discount_type === 'percent' ? 'selected' : ''}>Percent (%)</option>
      </select>
    </div>
    <div class="admin-field"><label>Value</label><input name="discount_value" type="number" min="0" value="${c.discount_value ?? ''}" required></div>
    <div class="admin-field"><label>Max uses (blank = unlimited)</label><input name="max_uses" type="number" min="0" value="${c.max_uses ?? ''}"></div>
    ${code ? `<div class="admin-field"><label>Active</label><select name="is_active"><option value="1" ${c.is_active ? 'selected' : ''}>Yes</option><option value="0" ${!c.is_active ? 'selected' : ''}>No</option></select></div>` : ''}
    <div class="admin-modal-actions">
      <button type="button" class="admin-btn admin-btn-ghost" data-close>Cancel</button>
      <button type="submit" class="admin-btn admin-btn-primary">${code ? 'Save' : 'Create code'}</button>
    </div>
  `, true, async (form) => {
    const fd = new FormData(form);
    const body = {
      code: fd.get('code'),
      discount_type: fd.get('discount_type'),
      discount_value: Number(fd.get('discount_value')),
      max_uses: fd.get('max_uses') === '' ? null : Number(fd.get('max_uses'))
    };
    if (code) {
      body.is_active = Number(fd.get('is_active'));
      await api(`/admin/redeem-codes/${c.id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Code updated');
    } else {
      await api('/admin/redeem-codes', { method: 'POST', body: JSON.stringify(body) });
      showToast('Code created');
    }
    closeModal();
    loadRedeem();
  });
}

/* ---------------- Contact ---------------- */
async function loadContact() {
  loaded.contact = true;
  const channels = await api('/admin/contact');
  const wrap = document.getElementById('contact-list');
  wrap.innerHTML = '';
  channels.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'admin-card';
    card.innerHTML = `
      <h3>${c.title}</h3>
      <div class="admin-card-meta">${c.description}</div>
      <div class="admin-card-meta"><strong>${c.link_text}</strong><br>${c.link_url}</div>
      <button class="admin-btn admin-btn-ghost admin-btn-sm" data-contact="${c.id}">Edit</button>
    `;
    wrap.appendChild(card);
    card.querySelector('[data-contact]').addEventListener('click', () => openContactModal(c));
  });
}

function openContactModal(c) {
  openModal(`Edit ${c.title}`, `
    <div class="admin-field"><label>Title</label><input name="title" value="${c.title || ''}"></div>
    <div class="admin-field"><label>Description</label><textarea name="description">${c.description || ''}</textarea></div>
    <div class="admin-field"><label>Link text</label><input name="link_text" value="${c.link_text || ''}"></div>
    <div class="admin-field"><label>Link URL</label><input name="link_url" value="${c.link_url || ''}"></div>
    <div class="admin-modal-actions">
      <button type="button" class="admin-btn admin-btn-ghost" data-close>Cancel</button>
      <button type="submit" class="admin-btn admin-btn-primary">Save</button>
    </div>
  `, true, async (form) => {
    const body = Object.fromEntries(new FormData(form));
    await api(`/admin/contact/${c.id}`, { method: 'PUT', body: JSON.stringify(body) });
    showToast('Contact updated');
    closeModal();
    loadContact();
  });
}

/* ---------------- Modal helper ---------------- */
const modal = document.getElementById('admin-modal');
const modalForm = document.getElementById('admin-modal-form');

function openModal(title, html, isForm, onSubmit) {
  ensureAdminModalsClosed();
  document.getElementById('admin-modal-title').textContent = title;
  modalForm.innerHTML = html;
  modalForm.onsubmit = null;

  if (isForm && onSubmit) {
    modalForm.onsubmit = async (e) => {
      e.preventDefault();
      const submitBtn = modalForm.querySelector('button[type="submit"]');
      if (submitBtn?.dataset?.busy === '1') return;
      if (submitBtn) submitBtn.disabled = true;
      try {
        await onSubmit(modalForm);
      } catch (err) {
        showToast(err.message, 'error');
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }

  modalForm.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.hidden = true;
  modalForm.innerHTML = '';
  modalForm.onsubmit = null;
  document.body.style.overflow = '';
}

checkAdmin();
