const params = new URLSearchParams(window.location.search);

const orderNumber = params.get('order');
const serviceType = params.get('type') || 'shop';
const lendingRef = params.get('ref');
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
  if (type === 'lending') {
    return {
      title: 'Application received, gorgeous',
      desc: 'We got your loan application — we\'ll review it and reach out soon. Save your reference number below.',
      steps: [
        'We review your application details',
        'You\'ll hear from us about approval or next steps',
        'Questions? Hit us up on the Contact page anytime'
      ],
      primaryHref: '/lending',
      primaryText: 'Browse Loan Plans',
      secondaryHref: lendingRef ? `/lending/application/${encodeURIComponent(lendingRef)}` : '/lending',
      secondaryText: 'View application status'
    };
  }

  if (type === 'website') {
    return {
      title: 'Inquiry sent — we\'re excited, babe',
      desc: 'Your website inquiry is in our inbox. We\'ll get back to you soon with next steps.',
      steps: [
        'We read your message and package request',
        'We\'ll contact you via email to discuss details',
        'Need something sooner? Visit Contact anytime'
      ],
      primaryHref: '/website-making',
      primaryText: 'Browse Packages',
      secondaryHref: 'dashboard.html',
      secondaryText: 'My Account'
    };
  }

  if (type === 'plugging') {
    if (status === 'approved') {
      return {
        title: 'Approved — you\'re in, babe ♡',
        desc: 'Your plugging order is live. Head to the status page for your access key and workspace.',
        steps: [
          'Payment verified — you\'re all set',
          'Grab your access key from the status page',
          'Open your workspace and start plugging'
        ],
        primaryHref: orderNumber ? `/plugging/status?order=${encodeURIComponent(orderNumber)}` : '/plugging',
        primaryText: 'View Access Key',
        secondaryHref: 'dashboard.html',
        secondaryText: 'My Account'
      };
    }
    if (status === 'pending_approval' || status === 'pending') {
      return {
        title: 'Receipt received — hang tight, love',
        desc: 'We got your payment proof. Once verified, your access key appears on the status page.',
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
      title: 'Order placed — almost there',
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

  // shop (default)
  if (status === 'approved') {
    return {
      title: 'Approved — enjoy your premium, babe ♡',
      desc: 'Your order is complete. Open My Account to view credentials and manage your purchase.',
      steps: [
        'Payment verified — you\'re all set',
        'Credentials appear in My Account',
        'Need help? Contact us anytime'
      ],
      primaryHref: 'dashboard.html',
      primaryText: 'View My Account',
      secondaryHref: 'index.html#products',
      secondaryText: 'Continue Shopping'
    };
  }
  if (status === 'pending') {
    return {
      title: 'Receipt received — we\'re on it, gorgeous',
      desc: 'We\'re reviewing your payment. Your credentials land in My Account once approved.',
      steps: [
        'We verify your payment receipt',
        'Order approved — credentials in My Account',
        'Need help? Contact us anytime'
      ],
      primaryHref: 'index.html#products',
      primaryText: 'Continue Shopping',
      secondaryHref: 'dashboard.html',
      secondaryText: 'My Account'
    };
  }
  return {
    title: 'Thank you for trusting us, babe',
    desc: 'Complete your payment if you haven\'t yet — then we\'ll verify and deliver your order.',
    steps: [
      'We verify your payment receipt',
      'Order approved — credentials in My Account',
      'Need help? Contact us anytime'
    ],
    primaryHref: 'index.html#products',
    primaryText: 'Continue Shopping',
    secondaryHref: 'dashboard.html',
    secondaryText: 'My Account'
  };
}

function applyThanksContent({ title, lead, refLabel, refValue, total, status, steps, primaryHref, primaryText, secondaryHref, secondaryText, emailLine, isApproved }) {
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
    lead: `Thank you for trusting ${storeName} — we're honored to have you, babe ♡`,
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
    lead: 'Your plugging payment is in — we\'re so glad you chose us, babe ♡',
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

  document.querySelector('.thanks-hero h1').textContent = 'Thank you, gorgeous!';
}

async function loadLendingThanks() {
  const app = lendingRef
    ? await api(`/api/lending/application/${encodeURIComponent(lendingRef)}`).catch(() => null)
    : null;
  const status = statusCopy('lending', app?.status);

  applyThanksContent({
    lead: 'We got your application — fingers crossed for you, babe ♡',
    refLabel: 'Reference',
    refValue: app?.applicationId || lendingRef || '—',
    total: app?.planName || 'Loan application',
    status,
    primaryHref: status.primaryHref,
    primaryText: status.primaryText,
    secondaryHref: status.secondaryHref,
    secondaryText: status.secondaryText,
    isApproved: app?.status === 'approved'
  });

  document.querySelector('.thanks-hero h1').textContent = 'Application sent!';
  document.getElementById('thanks-order-total').textContent = app?.planName ? app.planName : 'Pending review';
}

function loadWebsiteThanks() {
  const status = statusCopy('website');

  applyThanksContent({
    lead: 'Your inquiry just landed — we\'ll be in touch soon, love ♡',
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

  document.querySelector('.thanks-hero h1').textContent = 'Thank you, babe!';
  document.getElementById('thanks-order-dot').hidden = true;
}

async function loadThanks() {
  const loading = document.getElementById('thanks-loading');
  const errorEl = document.getElementById('thanks-error');
  const content = document.getElementById('thanks-content');

  const hasRef = orderNumber || lendingRef || serviceType === 'website';
  if (!hasRef) {
    loading.hidden = true;
    errorEl.hidden = false;
    return;
  }

  try {
    if (serviceType === 'plugging' && orderNumber) {
      await loadPluggingThanks();
    } else if (serviceType === 'lending') {
      await loadLendingThanks();
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
