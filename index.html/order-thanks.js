const params = new URLSearchParams(window.location.search);

const orderNumber = params.get('order');
const serviceType = params.get('type') || 'shop';
const websitePackage = params.get('package');

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

function formatMoney(amount) {
  return `₱${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function orderLabel(order) {
  if (order.displayId) return String(order.displayId);
  if (order.orderId != null) return String(order.orderId);
  return order.orderNumber || order.orderRef || order.applicationId;
}

function statusCopy(type, status) {
  if (type === 'website') {
    const inquiryRef = params.get('ref');
    const chatHref = inquiryRef ? `/website-making/inquiry/${encodeURIComponent(inquiryRef)}` : 'dashboard.html';
    return {
      title: 'Inquiry received',
      desc: 'Your website inquiry is in our inbox. Open your chat thread to follow up anytime.',
      steps: [
        'We read your message and package request',
        'Reply in your inquiry chat if you have questions',
        'We\'ll update you as your project moves forward'
      ],
      primaryHref: chatHref,
      primaryText: inquiryRef ? 'Open Inquiry Chat' : 'Browse Packages',
      secondaryHref: '/website-making',
      secondaryText: inquiryRef ? 'Browse Packages' : 'My Account'
    };
  }

  if (type === 'plugging') {
    if (status === 'approved') {
      return {
        title: 'Order approved',
        desc: 'Your plugging order is active. Open the status page for your access key and workspace.',
        steps: [
          'Payment verified',
          'Access key available on the status page',
          'Open your workspace to get started'
        ],
        primaryHref: orderNumber ? `/plugging/status?order=${encodeURIComponent(orderNumber)}` : '/plugging',
        primaryText: 'View Access Key',
        secondaryHref: 'dashboard.html',
        secondaryText: 'My Account'
      };
    }
    if (status === 'pending_approval' || status === 'pending') {
      return {
        title: 'Receipt received',
        desc: 'We received your payment proof. After verification, your access key will appear on the status page.',
        steps: [
          'We verify your receipt',
          'Order approved — access key on status page',
          'Need help? Contact us anytime'
        ],
        primaryHref: orderNumber ? `/plugging/status?order=${encodeURIComponent(orderNumber)}` : '/plugging',
        primaryText: 'Check Order Status',
        secondaryHref: '/plugging',
        secondaryText: 'Back to Plugging'
      };
    }
    return {
      title: 'Order placed',
      desc: 'Complete payment if you haven\'t yet, then upload your receipt so we can activate your order.',
      steps: [
        'Send payment using your chosen method',
        'Upload a clear receipt screenshot',
        'We verify and send your access key'
      ],
      primaryHref: orderNumber ? `/plugging/payment?order=${encodeURIComponent(orderNumber)}` : '/plugging',
      primaryText: 'Complete Payment',
      secondaryHref: '/plugging',
      secondaryText: 'Back to Plugging'
    };
  }

  if (status === 'approved') {
    return {
      title: 'Order approved',
      desc: 'Your order is complete. Open My Account to view credentials and manage your purchase.',
      steps: [
        'Payment verified',
        'Credentials appear in My Account',
        'Need help? Contact us anytime'
      ],
      primaryHref: 'dashboard.html',
      primaryText: 'View My Account',
      secondaryHref: '/shop',
      secondaryText: 'Continue Shopping'
    };
  }
  if (status === 'pending') {
    return {
      title: 'Receipt received',
      desc: 'We\'re reviewing your payment. Credentials will appear in My Account once approved.',
      steps: [
        'We verify your payment receipt',
        'Order approved — credentials in My Account',
        'Need help? Contact us anytime'
      ],
      primaryHref: '/shop',
      primaryText: 'Continue Shopping',
      secondaryHref: 'dashboard.html',
      secondaryText: 'My Account'
    };
  }
  return {
    title: 'Thank you for your order',
    desc: 'Complete your payment if you haven\'t yet — then we\'ll verify and deliver your order.',
    steps: [
      'We verify your payment receipt',
      'Order approved — credentials in My Account',
      'Need help? Contact us anytime'
    ],
    primaryHref: '/shop',
    primaryText: 'Continue Shopping',
    secondaryHref: 'dashboard.html',
    secondaryText: 'My Account'
  };
}

function applyThanksContent({ title, lead, refLabel, refValue, total, status, steps, primaryHref, primaryText, secondaryHref, secondaryText, emailLine, isApproved }) {
  const heroTitle = document.querySelector('.thanks-hero h1');
  if (heroTitle && title) heroTitle.textContent = title;
  document.getElementById('thanks-trust-line').textContent = lead;
  document.getElementById('thanks-order-label').textContent = refLabel;
  document.getElementById('thanks-order-id').textContent = refValue;
  document.getElementById('thanks-order-total').textContent = total;
  document.getElementById('thanks-status-title').textContent = status.title;
  document.getElementById('thanks-status-desc').textContent = status.desc;

  const statusBox = document.getElementById('thanks-status-box');
  statusBox.classList.toggle('is-approved', !!isApproved);

  const stepsEl = document.querySelector('.thanks-steps');
  if (stepsEl && status.steps) {
    stepsEl.innerHTML = status.steps.map((text, i) => `
      <li><span class="thanks-step-num">${i + 1}</span><span>${text}</span></li>
    `).join('');
  }

  const primaryBtn = document.querySelector('.thanks-btn-primary');
  const secondaryBtn = document.getElementById('thanks-account-link');
  if (primaryBtn) {
    primaryBtn.href = primaryHref;
    primaryBtn.textContent = primaryText;
  }
  if (secondaryBtn) {
    secondaryBtn.href = secondaryHref;
    secondaryBtn.textContent = secondaryText;
  }

  const orderLink = document.getElementById('thanks-order-link');
  if (orderLink) orderLink.hidden = true;

  const emailEl = document.getElementById('thanks-email-line');
  if (emailEl) {
    emailEl.textContent = emailLine || '';
    emailEl.hidden = !emailLine;
  }
}

async function loadShopThanks() {
  const order = await api(`/orders/${encodeURIComponent(orderNumber)}`);
  const branding = await api('/branding').catch(() => ({ name: 'loveriette' }));
  const storeName = branding.name || 'loveriette';
  const status = statusCopy('shop', order.status);

  applyThanksContent({
    title: 'Thank you for your purchase!',
    lead: `Thank you for choosing ${storeName}. We'll notify you when your order is approved.`,
    refLabel: 'Order',
    refValue: `#${orderLabel(order)}`,
    total: formatMoney(order.total),
    status,
    primaryHref: order.status === 'approved' ? 'dashboard.html' : status.primaryHref,
    primaryText: order.status === 'approved' ? 'View My Account' : status.primaryText,
    secondaryHref: status.secondaryHref,
    secondaryText: status.secondaryText,
    emailLine: order.email ? `Delivery email: ${order.email}` : '',
    isApproved: order.status === 'approved'
  });

  const tingiWrap = document.getElementById('thanks-tingi-wrap');
  if (tingiWrap && order.tingiDropEnabled) {
    const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
    const holdDays = order.tingiHoldDays || 10;
    tingiWrap.hidden = false;
    document.getElementById('thanks-tingi-title').textContent = `Tingi Drop — ${holdDays}-day hold`;
    document.getElementById('thanks-tingi-hint').textContent =
      `You reserved ${totalQty} units. Claim accounts one-by-one from My Account. Unclaimed units auto-deliver after ${holdDays} days.`;
  }

  const orderLink = document.getElementById('thanks-order-link');
  if (orderLink) {
    orderLink.href = `dashboard.html?order=${encodeURIComponent(order.orderNumber)}#active-purchases`;
    orderLink.hidden = false;
  }
}

async function loadPluggingThanks() {
  const order = await api(`/api/plugging/orders/${encodeURIComponent(orderNumber)}`);
  const status = statusCopy('plugging', order.status);

  applyThanksContent({
    title: 'Thank you for your order',
    lead: 'Your plugging payment was submitted successfully.',
    refLabel: 'Order',
    refValue: order.orderRef,
    total: formatMoney(order.total),
    status,
    primaryHref: status.primaryHref,
    primaryText: status.primaryText,
    secondaryHref: status.secondaryHref,
    secondaryText: status.secondaryText,
    isApproved: order.status === 'approved'
  });
}

async function loadWebsiteThanks() {
  const status = statusCopy('website');

  applyThanksContent({
    title: 'Thank you for your inquiry',
    lead: 'Your inquiry was received. We\'ll respond as soon as possible.',
    refLabel: 'Package',
    refValue: websitePackage || 'Website inquiry',
    total: 'Inquiry received',
    status,
    primaryHref: status.primaryHref,
    primaryText: status.primaryText,
    secondaryHref: status.secondaryHref,
    secondaryText: status.secondaryText,
    isApproved: false
  });

  document.getElementById('thanks-order-dot').hidden = true;
}

async function loadThanks() {
  const loading = document.getElementById('thanks-loading');
  const errorEl = document.getElementById('thanks-error');
  const content = document.getElementById('thanks-content');

  const hasRef = orderNumber || serviceType === 'website';
  if (!hasRef) {
    loading.hidden = true;
    errorEl.hidden = false;
    return;
  }

  try {
    if (serviceType === 'plugging' && orderNumber) {
      await loadPluggingThanks();
    } else if (serviceType === 'website') {
      loadWebsiteThanks();
    } else if (orderNumber) {
      await loadShopThanks();
    } else {
      throw new Error('Missing reference');
    }

    loading.hidden = true;
    content.hidden = false;
  } catch {
    loading.hidden = true;
    errorEl.hidden = false;
  }
}

loadThanks();
