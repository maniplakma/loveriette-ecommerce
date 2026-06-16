/**

 * Shared theme badges with inline SVG icons.

 * Usage: themeBadge('approved', 'Approved') or themeBadge('available')

 */

(function () {

  const ICONS = {

    pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',

    approved: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',

    waiting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',

    cancelled: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',

    available: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',

    preorder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',

    no_proof: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',

    paid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',

    refunded: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',

    delivered: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',

    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'

  };



  const DEFAULT_LABELS = {

    pending: 'Pending approval',

    approved: 'Approved',

    waiting: 'Waiting for stock',

    cancelled: 'Rejected',

    available: 'Available',

    preorder: 'Preorder',

    no_proof: 'No proof',

    paid: 'Paid',

    refunded: 'Refunded',

    delivered: 'Delivered',

    receipt: 'Receipt uploaded'

  };



  const ALIASES = {

    pending_approval: 'pending',

    pending_payment: 'no_proof',

    receipt_uploaded: 'pending',

    waiting_for_stock: 'waiting',

    waiting_stock: 'waiting',

    stock_available: 'available',

    stock_preorder: 'preorder',

    dropped: null,

    paid: 'approved',

    approved: 'approved',

    rejected: 'cancelled',

    cancelled: 'cancelled',

    refunded: 'refunded',

    preparing: 'waiting'

  };



  function escapeBadgeText(str) {

    return String(str || '')

      .replace(/&/g, '&amp;')

      .replace(/</g, '&lt;')

      .replace(/>/g, '&gt;')

      .replace(/"/g, '&quot;');

  }



  function themeBadge(kind, label, opts = {}) {

    const resolved = ALIASES[kind] || kind;

    if (!resolved || !ICONS[resolved]) return '';

    const text = label || DEFAULT_LABELS[resolved] || kind;

    const size = opts.size === 'sm' ? ' theme-badge--sm'

      : opts.size === 'md' ? ' theme-badge--md'

      : opts.size === 'lg' ? ' theme-badge--lg'

      : opts.size === 'xl' ? ' theme-badge--xl' : ' theme-badge--md';

    const extra = opts.className ? ` ${opts.className}` : '';

    return `<span class="theme-badge theme-badge--${resolved}${size}${extra}" role="status"><span class="theme-badge-icon" aria-hidden="true">${ICONS[resolved]}</span><span class="theme-badge-text">${escapeBadgeText(text)}</span></span>`;

  }



  function stockBadgeFromLabel(label, state) {

    if (!label) return '';

    const s = String(state || '').toLowerCase();

    if (s === 'available' || String(label).toLowerCase() === 'available') {

      return themeBadge('available', label, { size: 'md' });

    }

    if (s === 'preorder' || String(label).toLowerCase() === 'preorder') {

      return themeBadge('preorder', label, { size: 'md' });

    }

    return themeBadge('preorder', label, { size: 'md' });

  }



  function orderStatusBadge(status) {

    const map = {

      approved: ['approved', 'Approved'],

      pending: ['pending', 'Pending approval'],

      pending_payment: ['no_proof', 'Pending payment'],

      rejected: ['cancelled', 'Rejected'],

      refunded: ['refunded', 'Refunded']

    };

    const entry = map[status] || ['pending', status];

    return themeBadge(entry[0], entry[1], { size: 'md' });

  }



  function buyerProofBadge(order) {

    if (!order) return '';

    if (order.status === 'approved') return themeBadge('approved', undefined, { size: 'md' });

    if (order.status === 'rejected') return themeBadge('cancelled', undefined, { size: 'md' });

    if (order.status === 'refunded') return themeBadge('refunded', undefined, { size: 'md' });

    if (order.status === 'pending_payment' && !order.receiptUrl) {

      return themeBadge('no_proof', undefined, { size: 'md' });

    }

    if (order.status === 'pending' || order.receiptUrl) {

      return themeBadge('pending', undefined, { size: 'md' });

    }

    return themeBadge('no_proof', undefined, { size: 'md' });

  }



  window.themeBadge = themeBadge;

  window.stockBadgeFromLabel = stockBadgeFromLabel;

  window.orderStatusBadge = orderStatusBadge;

  window.buyerProofBadge = buyerProofBadge;

})();


