const params = new URLSearchParams(window.location.search);

const productId = params.get('product') ? Number(params.get('product')) : null;

const variantId = params.get('plan') ? Number(params.get('plan')) : null;



let items = [];

let subtotal = 0;

let discount = 0;

let appliedCode = '';

let selectedPaymentId = null;

let checkoutProduct = null;

let selectedVariantId = variantId || null;

let checkoutQuantity = 1;

let tingiConfig = { checkoutEnabled: true, minQty: 2, maxQty: 50, holdDays: 10 };



function getCheckoutQtyMax() {
  return Math.max(1, Number(tingiConfig.maxQty) || 50);
}

function syncCheckoutQtyUI() {
  const display = document.getElementById('checkout-qty-display');
  const hidden = document.getElementById('checkout-quantity');
  const minus = document.getElementById('checkout-qty-minus');
  const plus = document.getElementById('checkout-qty-plus');
  const max = getCheckoutQtyMax();
  if (display) display.textContent = checkoutQuantity;
  if (hidden) hidden.value = checkoutQuantity;
  if (minus) minus.disabled = checkoutQuantity <= 1;
  if (plus) plus.disabled = checkoutQuantity >= max;
}

function setCheckoutQuantity(next) {
  const max = getCheckoutQtyMax();
  checkoutQuantity = Math.min(max, Math.max(1, Number(next) || 1));
  syncCheckoutQtyUI();
  rebuildDirectCheckoutItem();
}

function updateTingiVisibility() {
  const wrap = document.getElementById('checkout-tingi-wrap');

  const checkbox = document.getElementById('checkout-tingi-drop');

  const title = document.getElementById('checkout-tingi-title');

  const hint = document.getElementById('checkout-tingi-hint');

  const shell = wrap?.querySelector('.tingi-drop-shell');

  if (!wrap) return;

  const qty = productId ? checkoutQuantity : items.reduce((s, i) => s + i.quantity, 0);

  const eligible = tingiConfig.checkoutEnabled && qty >= tingiConfig.minQty && qty <= tingiConfig.maxQty;

  wrap.hidden = !productId || !tingiConfig.checkoutEnabled;

  if (checkbox) {

    checkbox.disabled = !eligible;

    if (!eligible) checkbox.checked = false;

  }

  if (shell) shell.classList.toggle('is-disabled', !eligible);

  if (title) {

    title.textContent = eligible

      ? `Tingi Drop — Claim units in batches within ${tingiConfig.holdDays} days`

      : 'Tingi Drop';

  }

  if (hint) {

    hint.textContent = eligible

      ? `Reserve all ${qty} units now. After payment, claim accounts one-by-one from My Account — perfect for resellers. Any remaining units auto-deliver after ${tingiConfig.holdDays} days. Same total price.`

      : `Available for ${tingiConfig.minQty}–${tingiConfig.maxQty} units per order.`;

  }

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



function unitPriceFromTiers(quantity, basePrice, enabled, tiers) {

  const qty = Math.max(1, Number(quantity) || 1);

  if (!enabled || !tiers?.length) return basePrice;

  for (const tier of tiers) {

    const max = tier.maxQty == null ? Infinity : tier.maxQty;

    if (qty >= tier.minQty && qty <= max) return tier.price;

  }

  return basePrice;

}



function currentUnitPrice() {

  if (!checkoutProduct) return items[0]?.price || 0;



  const vid = selectedVariantId || null;

  let base = checkoutProduct.price;

  let enabled = false;

  let tiers = [];



  if (vid && checkoutProduct.variants?.length) {

    const variant = checkoutProduct.variants.find((v) => v.id === vid);

    if (variant) {

      base = variant.price;

      if (variant.bulkPricingEnabled) {

        enabled = true;

        tiers = variant.bulkTiers || [];

      } else {

        return unitPriceFromTiers(checkoutQuantity, base, false, []);

      }

    }

  }



  if (!enabled && !vid) {

    if (checkoutProduct.bulkPricingEnabled) {

      enabled = true;

      tiers = checkoutProduct.bulkTiers || [];

    }

  }



  return unitPriceFromTiers(checkoutQuantity, base, enabled, tiers);

}



function updateSummary() {

  const total = subtotal - discount;

  document.getElementById('summary-subtotal').textContent = `₱${subtotal}`;

  const qty = items.reduce((s, i) => s + i.quantity, 0);

  const unit = items[0]?.price || 0;

  document.getElementById('summary-subtotal-label').textContent =

    items.length === 1

      ? `Subtotal (${qty}x ₱${unit})`

      : `Subtotal (${qty} items)`;



  const discountRow = document.getElementById('discount-row');

  if (discount > 0) {

    discountRow.hidden = false;

    document.getElementById('summary-discount').textContent = `-₱${discount}`;

  } else {

    discountRow.hidden = true;

  }



  document.getElementById('summary-total').textContent = `₱${total}`;

  document.getElementById('pay-btn').textContent = `Continue — ₱${total}`;

}



function renderItems() {

  const list = document.getElementById('summary-items');

  list.innerHTML = '';



  items.forEach((item) => {

    const li = document.createElement('li');

    li.innerHTML = `

      <div class="summary-product">

        <div class="summary-logo">${item.name.charAt(0)}</div>

        <div>

          <strong>${item.name}</strong>

          <span>${item.quantity}x @ ₱${item.price}</span>

        </div>

      </div>

      <span>₱${item.price * item.quantity}</span>

    `;

    list.appendChild(li);

  });



  subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  updateSummary();

  updateTingiVisibility();

}



function rebuildDirectCheckoutItem() {

  if (!checkoutProduct) return;

  let name = checkoutProduct.name;

  if (selectedVariantId && checkoutProduct.variants?.length) {

    const variant = checkoutProduct.variants.find((v) => v.id === selectedVariantId);

    if (variant) name = `${checkoutProduct.name} — ${variant.name}`;

  }

  const price = currentUnitPrice();

  items = [{

    productId: checkoutProduct.id,

    variantId: selectedVariantId,

    name,

    price,

    quantity: checkoutQuantity

  }];

  renderItems();

}



async function loadCheckoutItems() {

  const qtyWrap = document.getElementById('checkout-quantity-wrap');



  if (productId) {

    checkoutProduct = await api(`/products/${productId}`);

    if (variantId && checkoutProduct.variants?.length) {

      selectedVariantId = checkoutProduct.variants.find((v) => v.id === variantId)?.id || null;

    }

    try {
      const cart = await api('/cart');
      const vid = selectedVariantId || (variantId ? Number(variantId) : null);
      const cartItem = (cart.items || []).find((i) =>
        i.productId === Number(productId) && (i.variantId || null) === (vid || null)
      );
      if (cartItem?.quantity) setCheckoutQuantity(cartItem.quantity);
    } catch { /* ignore */ }

    if (qtyWrap) qtyWrap.hidden = false;

    syncCheckoutQtyUI();

    rebuildDirectCheckoutItem();

  } else {

    if (qtyWrap) qtyWrap.hidden = true;

    const cart = await api('/cart');

    if (cart.items.length === 0) {

      window.location.href = 'index.html';

      return;

    }

    items = cart.items;

    renderItems();

  }

}



async function loadDefaultPaymentMethod() {
  try {
    const data = await api('/payment-methods');
    const methods = data.methods || (Array.isArray(data) ? data : []);
    if (methods.length) {
      selectedPaymentId = methods[0].id;
      return true;
    }
    selectedPaymentId = null;
    return false;
  } catch {
    selectedPaymentId = null;
    return false;
  }
}

function showCheckoutPaymentWarning() {
  const errorEl = document.getElementById('checkout-error');
  const payBtn = document.getElementById('pay-btn');
  if (selectedPaymentId) {
    if (payBtn) payBtn.disabled = false;
    return;
  }
  if (!errorEl) return;
  errorEl.textContent = 'Payment is not configured yet. Please contact support before placing an order.';
  errorEl.hidden = false;
  if (payBtn) payBtn.disabled = true;
}



async function prefillEmail() {

  try {

    const { user } = await api('/auth/me');

    if (user?.email) document.getElementById('checkout-email').value = user.email;

  } catch { /* guest checkout */ }

}



document.getElementById('apply-code').addEventListener('click', async () => {

  const code = document.getElementById('redeem-code').value.trim();

  const msgEl = document.getElementById('redeem-msg');

  msgEl.hidden = true;



  if (!code) return;



  try {

    const result = await api('/redeem/validate', {

      method: 'POST',

      body: JSON.stringify({ code, subtotal })

    });

    discount = result.discount;

    appliedCode = code;

    msgEl.textContent = `Code applied! You save ₱${discount}`;

    msgEl.className = 'redeem-msg success';

    msgEl.hidden = false;

    updateSummary();

  } catch (err) {

    discount = 0;

    appliedCode = '';

    msgEl.textContent = err.message;

    msgEl.className = 'redeem-msg error';

    msgEl.hidden = false;

    updateSummary();

  }

});



document.getElementById('checkout-qty-minus')?.addEventListener('click', () => {
  setCheckoutQuantity(checkoutQuantity - 1);
});

document.getElementById('checkout-qty-plus')?.addEventListener('click', () => {
  setCheckoutQuantity(checkoutQuantity + 1);
});

async function loadTingiConfig() {

  try {

    tingiConfig = await api('/tingi-drop');

  } catch {

    tingiConfig = { checkoutEnabled: true, minQty: 2, maxQty: 50, holdDays: 10 };

  }

  if (checkoutQuantity > getCheckoutQtyMax()) {
    setCheckoutQuantity(getCheckoutQtyMax());
  } else {
    syncCheckoutQtyUI();
  }

  updateTingiVisibility();

}



document.getElementById('pay-btn').addEventListener('click', async () => {

  const email = document.getElementById('checkout-email').value.trim();

  const errorEl = document.getElementById('checkout-error');

  errorEl.hidden = true;



  if (!email) {

    errorEl.textContent = 'Please enter your email address';

    errorEl.hidden = false;

    return;

  }



  if (!selectedPaymentId) {

    await loadDefaultPaymentMethod();

  }



  if (!selectedPaymentId) {

    errorEl.textContent = 'Payment is not configured yet. Please contact support.';

    errorEl.hidden = false;

    return;

  }



  try {

    const tingiDrop = document.getElementById('checkout-tingi-drop')?.checked || false;

    const order = await api('/orders', {

      method: 'POST',

      body: JSON.stringify({

        email,

        paymentMethodId: selectedPaymentId,

        redeemCode: appliedCode || undefined,

        productId: productId || undefined,

        variantId: selectedVariantId || variantId || undefined,

        quantity: productId ? checkoutQuantity : undefined,

        tingiDrop

      })

    });

    sessionStorage.setItem(`toast-shown-${order.orderNumber}-pending_payment`, '1');

    window.location.href = `payment.html?order=${order.orderNumber}`;

  } catch (err) {

    errorEl.textContent = err.message;

    errorEl.hidden = false;

  }

});



loadTingiConfig();

loadCheckoutItems();

loadDefaultPaymentMethod().then(showCheckoutPaymentWarning);

prefillEmail();

