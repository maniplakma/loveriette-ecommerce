function getLogoLetter(name) {
  const lower = name.toLowerCase();
  if (lower.includes('netflix')) return 'N';
  if (lower.includes('spotify')) return 'S';
  if (lower.includes('capcut')) return 'C';
  return name.charAt(0).toUpperCase();
}

function formatMoney(amount) {
  return `₱${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

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

function updateNavCount(count) {
  document.querySelectorAll('.cart-count').forEach((el) => {
    el.textContent = count;
  });
  document.getElementById('cart-title-count').textContent = count;
}

function checkoutHref(item) {
  const plan = item.variantId ? `&plan=${item.variantId}` : '';
  return `checkout.html?product=${item.productId}${plan}`;
}

function renderCart(cart) {
  const list = document.getElementById('cart-list');
  const emptyEl = document.getElementById('cart-empty');
  const summaryEl = document.getElementById('cart-summary');

  updateNavCount(cart.count);
  list.innerHTML = '';

  if (cart.items.length === 0) {
    emptyEl.hidden = false;
    summaryEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  summaryEl.hidden = false;
  document.getElementById('cart-total').textContent = formatMoney(cart.total);

  cart.items.forEach((item) => {
    const lineTotal = item.lineTotal ?? item.price * item.quantity;
    const unitLabel = item.quantity > 1
      ? `${formatMoney(item.price)} × ${item.quantity}`
      : formatMoney(item.price);

    const row = document.createElement('article');
    row.className = 'cart-row';
    row.dataset.id = item.productId;
    row.innerHTML = `
      <div class="cart-row-logo">${getLogoLetter(item.name)}</div>
      <div class="cart-row-info">
        <strong>${item.name}</strong>
        <span class="cart-row-price">${unitLabel}</span>
      </div>
      <div class="qty-control">
        <button type="button" class="qty-btn qty-minus" data-id="${item.productId}" aria-label="Decrease quantity">−</button>
        <span class="qty-value">${item.quantity}</span>
        <button type="button" class="qty-btn qty-plus" data-id="${item.productId}" aria-label="Increase quantity">+</button>
      </div>
      <button type="button" class="cart-remove" data-id="${item.productId}" aria-label="Remove item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
      <span class="cart-row-total">${formatMoney(lineTotal)}</span>
      <a href="${checkoutHref(item)}" class="cart-buy-btn">Buy →</a>
    `;
    list.appendChild(row);
  });
}

async function loadCart() {
  const cart = await api('/cart');
  renderCart(cart);
}

document.getElementById('cart-list').addEventListener('click', async (e) => {
  const productId = Number(e.target.closest('[data-id]')?.dataset.id);
  if (!productId) return;

  const row = e.target.closest('.cart-row');
  const qtyEl = row?.querySelector('.qty-value');
  let quantity = Number(qtyEl?.textContent) || 1;

  if (e.target.closest('.qty-minus')) {
    if (quantity <= 1) {
      const cart = await api(`/cart/${productId}`, { method: 'DELETE' });
      renderCart(cart);
      return;
    }
    quantity -= 1;
  } else if (e.target.closest('.qty-plus')) {
    quantity += 1;
  } else if (e.target.closest('.cart-remove')) {
    const cart = await api(`/cart/${productId}`, { method: 'DELETE' });
    renderCart(cart);
    return;
  } else {
    return;
  }

  const cart = await api(`/cart/${productId}`, {
    method: 'PUT',
    body: JSON.stringify({ quantity })
  });
  renderCart(cart);
});

loadCart();
