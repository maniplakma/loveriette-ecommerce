const orderRef = new URLSearchParams(location.search).get('order');

const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

let selectedPm = null;
let selectedReceiptFile = null;
let paymentCatalog = { instructionsText: '', methods: [] };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setPayError(message) {
  const el = document.getElementById('pay-error');
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function validateReceiptFile(file) {
  if (!file) return 'Upload your receipt first — proof of payment is required.';
  if (!RECEIPT_TYPES.has(file.type)) return 'Use JPG, PNG, WebP, or GIF only';
  if (file.size > RECEIPT_MAX_BYTES) return 'Keep your receipt under 4MB, love';
  return null;
}

function updateSubmitButton() {
  const btn = document.getElementById('submit-payment');
  const hint = document.getElementById('submit-hint');
  if (!btn) return;

  const canSubmit = selectedPm && selectedReceiptFile;
  btn.disabled = !canSubmit;

  if (hint) {
    if (canSubmit) {
      hint.textContent = 'Receipt attached — tap submit when you\'re ready ';
      hint.classList.add('upload-confirm-hint--ready');
    } else if (!selectedPm) {
      hint.textContent = 'Pick a payment method first, gorgeous';
      hint.classList.remove('upload-confirm-hint--ready');
    } else {
      hint.textContent = 'Select your receipt image — then we\'ll confirm payment';
      hint.classList.remove('upload-confirm-hint--ready');
    }
  }
}

function renderInstructions() {
  const box = document.getElementById('payment-instructions');
  if (!box) return;
  const text = paymentCatalog.instructionsText || '';
  const lines = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = lines.map((line) => `<p>${esc(line)}</p>`).join('');
}

function renderQrAndAccount(method) {
  const qrImg = document.getElementById('qr-image');
  const qrPlaceholder = document.getElementById('qr-placeholder');
  const accountWrap = document.getElementById('payment-account-number');
  const accountVal = document.getElementById('payment-account-number-value');

  if (method?.qrImageUrl && qrImg) {
    qrImg.src = method.qrImageUrl;
    qrImg.hidden = false;
    if (qrPlaceholder) qrPlaceholder.hidden = true;
  } else if (qrImg) {
    qrImg.hidden = true;
    qrImg.removeAttribute('src');
    if (qrPlaceholder) qrPlaceholder.hidden = false;
  }

  const account = String(method?.accountNumber || '').trim();
  if (account && accountWrap && accountVal) {
    accountVal.textContent = account;
    accountWrap.hidden = false;
  } else if (accountWrap) {
    accountWrap.hidden = true;
    if (accountVal) accountVal.textContent = '';
  }
}

function selectPaymentMethod(methodId) {
  selectedPm = methodId;
  document.querySelectorAll('.plug-pay-method').forEach((btn) => {
    btn.classList.toggle('selected', Number(btn.dataset.id) === methodId);
  });
  const method = paymentCatalog.methods.find((m) => m.id === methodId);
  const nameEl = document.getElementById('payment-method-name');
  if (nameEl) nameEl.textContent = method?.name || '';
  renderQrAndAccount(method);
  updateSubmitButton();
}

function renderPaymentMethods() {
  const wrap = document.getElementById('payment-methods');
  if (!wrap) return;

  const methods = paymentCatalog.methods || [];
  if (!methods.length) {
    wrap.innerHTML = '<p class="plug-flow-error">Payment methods are not configured yet — contact support.</p>';
    return;
  }

  wrap.innerHTML = methods.map((m) => `
    <button type="button" class="plug-pay-method" data-id="${m.id}">${esc(m.name)}</button>
  `).join('');

  wrap.querySelectorAll('.plug-pay-method').forEach((btn) => {
    btn.addEventListener('click', () => selectPaymentMethod(Number(btn.dataset.id)));
  });

  selectPaymentMethod(methods[0].id);
}

async function loadPaymentCatalog() {
  try {
    const data = await fetch('/payment-methods').then((r) => r.json());
    paymentCatalog = {
      instructionsText: data.instructionsText || '',
      methods: data.methods || (Array.isArray(data) ? data : [])
    };
  } catch {
    paymentCatalog = { instructionsText: '', methods: [] };
  }
}

function clearReceiptSelection() {
  selectedReceiptFile = null;
  const input = document.getElementById('receipt-file');
  if (input) input.value = '';
  const fileName = document.getElementById('file-name');
  if (fileName) fileName.textContent = '';
  const preview = document.getElementById('receipt-preview');
  const previewImg = document.getElementById('receipt-preview-img');
  if (preview) preview.hidden = true;
  if (previewImg) previewImg.removeAttribute('src');
  setPayError('');
  updateSubmitButton();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read image file'));
    r.readAsDataURL(file);
  });
}

async function load() {
  const card = document.querySelector('.plug-flow-card');
  if (!orderRef) {
    if (card) card.innerHTML = '<p class="plug-flow-error">Missing order reference — check your link, love.</p>';
    return;
  }

  const statusLink = document.getElementById('status-link');
  if (statusLink) {
    statusLink.href = `/plugging/status?order=${encodeURIComponent(orderRef)}`;
    statusLink.hidden = false;
  }

  try {
    const [order] = await Promise.all([
      fetch(`/api/plugging/orders/${encodeURIComponent(orderRef)}`).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Order not found');
        return json;
      }),
      loadPaymentCatalog()
    ]);

    document.getElementById('order-line').textContent = `${order.planName} · ${order.orderRef}`;
    document.getElementById('payment-amount').textContent = `₱${Number(order.total).toLocaleString()}`;

    if (order.status !== 'pending_payment') {
      location.href = `/order-thanks.html?type=plugging&order=${encodeURIComponent(orderRef)}`;
      return;
    }

    renderInstructions();
    renderPaymentMethods();
  } catch (e) {
    if (card) {
      card.innerHTML = `<p class="plug-flow-error">${esc(e.message || 'Could not load payment page')}</p>`;
    }
  }
}

document.getElementById('select-receipt')?.addEventListener('click', () => {
  document.getElementById('receipt-file')?.click();
});

document.getElementById('receipt-file')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) {
    clearReceiptSelection();
    return;
  }
  const err = validateReceiptFile(file);
  if (err) {
    setPayError(err);
    clearReceiptSelection();
    if (window.showToast) showToast(err, 'error');
    return;
  }
  selectedReceiptFile = file;
  document.getElementById('file-name').textContent = file.name;
  setPayError('');
  const preview = document.getElementById('receipt-preview');
  const previewImg = document.getElementById('receipt-preview-img');
  if (preview && previewImg) {
    previewImg.src = URL.createObjectURL(file);
    preview.hidden = false;
  }
  updateSubmitButton();
});

document.getElementById('submit-payment')?.addEventListener('click', async () => {
  setPayError('');
  const fileErr = validateReceiptFile(selectedReceiptFile);
  if (!selectedPm) {
    setPayError('Select a payment method first.');
    return;
  }
  if (fileErr) {
    setPayError(fileErr);
    return;
  }

  const btn = document.getElementById('submit-payment');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const receiptImage = await fileToDataUrl(selectedReceiptFile);
    const res = await fetch(`/api/plugging/orders/${encodeURIComponent(orderRef)}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ paymentMethodId: selectedPm, receiptImage })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Payment failed');
    location.href = json.thanksUrl
      || `order-thanks.html?type=plugging&order=${encodeURIComponent(orderRef)}`;
  } catch (e) {
    setPayError(e.message);
    btn.disabled = false;
    btn.textContent = 'Submit Payment';
    updateSubmitButton();
  }
});

load();
