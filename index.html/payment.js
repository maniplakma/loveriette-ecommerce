const params = new URLSearchParams(window.location.search);
const orderNumber = params.get('order');

const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

let countdownTimer = null;
let currentOrder = null;
let selectedReceiptFile = null;
let paymentCatalog = { instructionsText: '', methods: [] };
let selectedPaymentId = null;

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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setReceiptError(message) {
  const el = document.getElementById('receipt-upload-error');
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function clearReceiptSelection() {
  selectedReceiptFile = null;
  const input = document.getElementById('receipt-file');
  if (input) input.value = '';
  document.getElementById('file-name').textContent = '';
  const preview = document.getElementById('receipt-preview');
  const previewImg = document.getElementById('receipt-preview-img');
  if (preview) preview.hidden = true;
  if (previewImg) previewImg.removeAttribute('src');
  setReceiptError('');
  updateConfirmButton();
}

function validateReceiptFile(file) {
  if (!file) return 'Please select a receipt image before confirming';
  if (!RECEIPT_TYPES.has(file.type)) {
    return 'Only JPG, PNG, WebP, or GIF images are allowed';
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return 'Receipt image must be 4MB or smaller';
  }
  return null;
}

function updateConfirmButton() {
  const btn = document.getElementById('confirm-order');
  const hint = document.getElementById('confirm-hint');
  if (!btn) return;

  const canSubmit = selectedReceiptFile
    && currentOrder
    && currentOrder.status === 'pending_payment';

  btn.disabled = !canSubmit;

  if (hint) {
    if (currentOrder?.status === 'pending') {
      hint.textContent = 'Receipt submitted — awaiting approval';
      hint.classList.remove('upload-confirm-hint--ready');
    } else if (currentOrder?.status === 'approved') {
      hint.textContent = 'This order is complete';
      hint.classList.remove('upload-confirm-hint--ready');
    } else if (canSubmit) {
      hint.textContent = 'Receipt attached — you can confirm your order';
      hint.classList.add('upload-confirm-hint--ready');
    } else {
      hint.textContent = 'Select a receipt image to enable Confirm Order';
      hint.classList.remove('upload-confirm-hint--ready');
    }
  }
}

function startCountdown(expiresAt) {
  const banner = document.getElementById('payment-timer');
  const countdownEl = document.getElementById('payment-countdown');
  if (!expiresAt) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;

  const tick = () => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      countdownEl.textContent = '00:00';
      clearInterval(countdownTimer);
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    countdownEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  tick();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(tick, 1000);
}

function renderPaymentInstructions(order) {
  const box = document.getElementById('payment-instructions-box');
  if (!box) return;

  const text = order.paymentInstructionsText
    || (order.paymentInstructions || []).join('\n');
  const lines = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  if (!lines.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  box.hidden = false;
  box.innerHTML = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

function renderQrAndAccount(source) {
  const qrImg = document.getElementById('qr-image');
  const qrPlaceholder = document.getElementById('qr-placeholder');
  if (source.qrImageUrl) {
    qrImg.src = source.qrImageUrl;
    qrImg.hidden = false;
    if (qrPlaceholder) qrPlaceholder.hidden = true;
  } else {
    qrImg.hidden = true;
    qrImg.removeAttribute('src');
    if (qrPlaceholder) qrPlaceholder.hidden = false;
  }

  const accountWrap = document.getElementById('payment-account-number');
  const accountVal = document.getElementById('payment-account-number-value');
  const account = String(source.accountNumber || '').trim();
  if (account && accountWrap && accountVal) {
    accountVal.textContent = account;
    accountWrap.hidden = false;
  } else if (accountWrap) {
    accountWrap.hidden = true;
    if (accountVal) accountVal.textContent = '';
  }
}

function applySelectedPaymentDisplay() {
  const method = paymentCatalog.methods.find((m) => m.id === selectedPaymentId);
  const nameEl = document.getElementById('payment-method-name');
  if (nameEl) nameEl.textContent = method?.name || currentOrder?.paymentMethod || '';

  renderPaymentInstructions({
    paymentInstructionsText: paymentCatalog.instructionsText || currentOrder?.paymentInstructionsText
  });

  renderQrAndAccount({
    qrImageUrl: method?.qrImageUrl || currentOrder?.qrImageUrl,
    accountNumber: method?.accountNumber || currentOrder?.accountNumber
  });
}

function renderPaymentMethodTabs(order) {
  const container = document.getElementById('payment-methods');
  const stepLabel = document.querySelector('.payment-panel .step-label');
  const viaLine = document.getElementById('payment-via-line');
  if (!container) return;

  const canChoose = order?.status === 'pending_payment' && paymentCatalog.methods.length > 0;
  if (stepLabel) stepLabel.hidden = !canChoose;
  container.hidden = !canChoose;
  if (viaLine) viaLine.hidden = !canChoose;

  if (!canChoose) {
    container.innerHTML = '';
    if (order) {
      document.getElementById('payment-method-name').textContent = order.paymentMethod || '';
      renderPaymentInstructions(order);
      renderQrAndAccount(order);
    }
    return;
  }

  selectedPaymentId = order.paymentMethodId || paymentCatalog.methods[0]?.id;
  container.innerHTML = '';

  paymentCatalog.methods.forEach((method) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `payment-btn${method.id === selectedPaymentId ? ' active' : ''}`;
    btn.textContent = method.name;
    btn.dataset.id = method.id;
    btn.addEventListener('click', () => selectPaymentMethod(method.id));
    container.appendChild(btn);
  });

  applySelectedPaymentDisplay();
}

async function selectPaymentMethod(methodId) {
  if (!methodId || selectedPaymentId === methodId) return;
  selectedPaymentId = methodId;

  document.querySelectorAll('#payment-methods .payment-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.id) === methodId);
  });

  applySelectedPaymentDisplay();

  if (currentOrder?.status !== 'pending_payment') return;

  try {
    const order = await api(`/orders/${orderNumber}/payment-method`, {
      method: 'PUT',
      body: JSON.stringify({ paymentMethodId: methodId })
    });
    currentOrder = order;
    document.getElementById('order-payment-method').textContent = order.paymentMethod;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadPaymentCatalog() {
  try {
    const data = await api('/payment-methods');
    paymentCatalog = {
      instructionsText: data.instructionsText || '',
      methods: data.methods || (Array.isArray(data) ? data : [])
    };
  } catch {
    paymentCatalog = { instructionsText: '', methods: [] };
  }
  if (!paymentCatalog.methods.length) {
    const err = document.getElementById('payment-config-error');
    if (err) {
      err.textContent = 'Payment methods are not configured yet. Please contact the store owner.';
      err.hidden = false;
    }
  }
}

function renderOrder(order) {
  currentOrder = order;

  document.getElementById('payment-amount').textContent = formatMoney(order.total);
  renderPaymentMethodTabs(order);

  const tbody = document.getElementById('order-items');
  tbody.innerHTML = '';
  order.items.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.name}<br><small>${formatMoney(item.price)} / item</small></td>
      <td>x${item.quantity}</td>
      <td class="price-cell">${formatMoney(item.price * item.quantity)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('delivery-email').textContent = order.email;
  document.getElementById('order-number').textContent = order.orderNumber;
  document.getElementById('order-payment-method').textContent = order.paymentMethod;
  document.getElementById('order-subtotal').textContent = formatMoney(order.subtotal);
  document.getElementById('order-total').textContent = formatMoney(order.total);

  const tingiWrap = document.getElementById('payment-tingi-wrap');
  if (tingiWrap) {
    const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
    const holdDays = order.tingiHoldDays || 10;
    tingiWrap.hidden = !order.tingiDropEnabled;
    if (order.tingiDropEnabled) {
      const titleEl = document.getElementById('payment-tingi-title');
      const hintEl = document.getElementById('payment-tingi-hint');
      if (titleEl) {
        titleEl.textContent = `Tingi Drop — Claim units in batches within ${holdDays} days`;
      }
      if (hintEl) {
        hintEl.textContent = `You reserved ${totalQty} units. After approval, claim accounts one-by-one from My Account. Any remaining units auto-deliver after ${holdDays} days. Same total price.`;
      }
    }
  }

  const statusEl = document.getElementById('order-status-text');
  if (window.themeBadge) {
    const kind = order.status === 'approved' ? 'approved'
      : order.status === 'pending_payment' ? 'no_proof'
      : order.status === 'pending' ? 'pending'
      : order.status;
    statusEl.innerHTML = themeBadge(kind);
    statusEl.className = 'order-status-badges';
  } else {
    const statusText = {
      pending_payment: 'Waiting for payment...',
      pending: 'Awaiting manual approval...',
      approved: 'Order approved'
    };
    statusEl.textContent = statusText[order.status] || order.status;
  }

  const timerVisible = order.status === 'pending_payment' || order.status === 'pending';
  if (timerVisible && order.paymentExpiresAt) {
    startCountdown(order.paymentExpiresAt);
  } else {
    document.getElementById('payment-timer').hidden = true;
    clearInterval(countdownTimer);
  }

  const confirmBtn = document.getElementById('confirm-order');
  const uploadSection = document.querySelector('.upload-section');

  if (order.status === 'pending') {
    confirmBtn.textContent = 'Receipt submitted';
    confirmBtn.disabled = true;
    if (uploadSection) uploadSection.classList.add('upload-section--locked');
    clearReceiptSelection();
  } else if (order.status === 'approved') {
    confirmBtn.textContent = 'Order complete';
    confirmBtn.disabled = true;
    if (uploadSection) uploadSection.classList.add('upload-section--locked');
    clearReceiptSelection();
  } else {
    confirmBtn.textContent = 'Confirm Order';
    if (uploadSection) uploadSection.classList.remove('upload-section--locked');
    updateConfirmButton();
  }

  document.getElementById('payment-content').hidden = false;
}

function showOrderStatusToast(order) {
  const key = `toast-shown-${order.orderNumber}-${order.status}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');

  if (order.status === 'approved') {
    showToast('Order approved!', 'approved');
  } else if (order.status === 'pending') {
    showToast('Receipt submitted — awaiting approval', 'info');
  } else if (order.status === 'pending_payment') {
    showToast('Order placed — complete your payment', 'info');
  }
}

async function loadOrder() {
  if (!orderNumber) {
    document.getElementById('payment-error').hidden = false;
    return;
  }

  try {
    await loadPaymentCatalog();
    const order = await api(`/orders/${orderNumber}`);
    renderOrder(order);
    showOrderStatusToast(order);
  } catch {
    document.getElementById('payment-error').hidden = false;
  }
}

document.getElementById('select-receipt').addEventListener('click', () => {
  if (currentOrder?.status !== 'pending_payment') return;
  document.getElementById('receipt-file').click();
});

document.getElementById('receipt-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) {
    clearReceiptSelection();
    return;
  }

  const validationError = validateReceiptFile(file);
  if (validationError) {
    setReceiptError(validationError);
    clearReceiptSelection();
    showToast(validationError, 'error');
    return;
  }

  selectedReceiptFile = file;
  document.getElementById('file-name').textContent = file.name;
  setReceiptError('');

  const preview = document.getElementById('receipt-preview');
  const previewImg = document.getElementById('receipt-preview-img');
  if (preview && previewImg) {
    previewImg.src = URL.createObjectURL(file);
    preview.hidden = false;
  }

  updateConfirmButton();
});

document.getElementById('copy-order').addEventListener('click', async () => {
  const text = document.getElementById('order-number').textContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Order number copied');
  } catch {
    showToast('Could not copy', 'error');
  }
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}

document.getElementById('confirm-order').addEventListener('click', async () => {
  const validationError = validateReceiptFile(selectedReceiptFile);
  if (validationError) {
    setReceiptError(validationError);
    showToast(validationError, 'error');
    updateConfirmButton();
    return;
  }

  if (currentOrder?.status !== 'pending_payment') {
    showToast('This order can no longer be confirmed', 'error');
    return;
  }

  const btn = document.getElementById('confirm-order');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const receiptImage = await readFileAsDataUrl(selectedReceiptFile);
    if (!String(receiptImage).startsWith('data:image/')) {
      throw new Error('Invalid receipt image. Please try another screenshot.');
    }

    const order = await api(`/orders/${orderNumber}/receipt`, {
      method: 'POST',
      body: JSON.stringify({ receiptImage })
    });

    if (!order.receiptUrl) {
      throw new Error('Receipt could not be saved. Please try again or use a smaller image.');
    }

    sessionStorage.removeItem(`toast-shown-${orderNumber}-pending_payment`);
    window.location.href = `order-thanks.html?order=${encodeURIComponent(order.orderNumber || orderNumber)}`;
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Confirm Order';
    updateConfirmButton();
  }
});

loadOrder();

setInterval(async () => {
  if (!orderNumber) return;
  try {
    const order = await api(`/orders/${orderNumber}`);
    const statusChanged = order.status !== currentOrder?.status;
    const contentChanged = order.paymentInstructionsText !== currentOrder?.paymentInstructionsText
      || order.qrImageUrl !== currentOrder?.qrImageUrl
      || order.accountNumber !== currentOrder?.accountNumber;

    if (statusChanged || contentChanged) {
      renderOrder(order);
      if (statusChanged) showOrderStatusToast(order);
    } else if (order.status === 'approved') {
      renderOrder(order);
    }
  } catch { /* ignore poll errors */ }
}, 15000);
