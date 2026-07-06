const params = new URLSearchParams(window.location.search);
const pathSlug = window.location.pathname.match(/\/product\/([^/]+)/)?.[1];
const productId = Number(params.get('id'));

const heroEl = document.getElementById('product-hero');
const aboutEl = document.getElementById('product-about');
const plansSection = document.getElementById('plans-section');
const plansGrid = document.getElementById('plans-grid');
const errorEl = document.getElementById('product-error');

function productHref(p) {
  return p.shareUrl || (p.slug ? `/product/${p.slug}` : `product.html?id=${p.id}`);
}

const LOGO_LETTERS = {
  netflix: 'N',
  spotify: 'S',
  capcut: 'C',
  canva: 'C',
  coursera: 'C',
  grammarly: 'G'
};

function getLogoLetter(name) {
  const lower = name.toLowerCase();
  for (const [key, letter] of Object.entries(LOGO_LETTERS)) {
    if (lower.includes(key)) return letter;
  }
  return name.charAt(0).toUpperCase();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(price) {
  return `₱${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function api(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (method === 'GET' && window.ApiCache) {
    return ApiCache.fetchJson(url, options, 45000);
  }
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function getPlans(product) {
  if (product.variants && product.variants.length) return product.variants;
  return [{
    id: null,
    name: product.name,
    duration: '',
    price: product.price,
    description: product.description || '',
    availability: product.availability,
    availability_state: product.availability_state
  }];
}

function renderExploreServices(products, currentId) {
  const grid = document.getElementById('explore-services-grid');
  const others = products.filter((p) => p.id !== currentId).slice(0, 3);

  const tiles = others.map((p) => `
    <a href="${productHref(p)}" class="explore-tile" title="${escapeHtml(p.name)}">
      <div class="explore-tile-icon logo${p.icon ? ' has-icon' : ''}">
        ${window.renderProductIcon ? window.renderProductIcon(p.icon, p.name, 'logo-img') : getLogoLetter(p.name)}
      </div>
    </a>
  `).join('');

  grid.innerHTML = `${tiles}
    <a href="/shop" class="explore-tile explore-tile-all" title="All products">
      <span>ALL</span>
    </a>`;
}

function planDurationText(plan) {
  return String(plan.duration || '').trim();
}

function planDescriptionText(plan) {
  return String(plan.description || '').trim();
}

function renderPlanCard(product, plan) {
  const rawState = plan.availability_state || product.availability_state || 'available';
  const state = rawState === 'coming_soon' || rawState === 'sold_out'
    ? rawState
    : (rawState === 'available' ? 'available' : 'preorder');
  const label = state === 'available'
    ? 'Available'
    : state === 'preorder'
      ? 'Preorder'
      : (plan.availability || product.availability || 'Available');
  const disabled = state === 'sold_out' || state === 'coming_soon';
  const planParam = plan.id ? `&plan=${plan.id}` : '';
  const purchaseLabel = state === 'preorder' ? 'Pre-order →' : state === 'sold_out' ? 'Sold Out' : 'Purchase →';
  const duration = planDurationText(plan);
  const description = planDescriptionText(plan);

  return `
    <article class="plan-purchase-card${disabled ? ' is-disabled' : ''}">
      ${window.themeBadge && state !== 'sold_out' && state !== 'coming_soon'
        ? themeBadge(state === 'available' ? 'available' : 'preorder', label)
        : `<span class="plan-badge status-${state}">${escapeHtml(label)}</span>`}
      <div class="plan-purchase-top">
        <div class="plan-purchase-icon logo${product.icon ? ' has-icon' : ''}">
          ${window.renderProductIcon ? window.renderProductIcon(product.icon, product.name, 'logo-img') : getLogoLetter(product.name)}
        </div>
        <div class="plan-purchase-info">
          <h3>${escapeHtml(plan.name)}</h3>
          ${duration && !description ? `<p class="plan-tag"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${escapeHtml(duration)}</p>` : ''}
        </div>
      </div>
      ${description
    ? `<div class="plan-desc-box">
          <p class="plan-desc-box-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Plan details
          </p>
          <p class="plan-desc-box-text">${escapeHtml(description)}</p>
        </div>`
    : ''}
      <p class="plan-purchase-price">${formatMoney(plan.displayPrice ?? plan.price)}</p>
      <div class="plan-purchase-actions">
        ${disabled
    ? `<button type="button" class="btn-purchase" disabled>${purchaseLabel}</button>
           <button type="button" class="btn-cart-icon" disabled aria-label="Add to cart">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
           </button>`
    : `<a href="checkout.html?product=${product.id}${planParam}" class="btn-purchase">${purchaseLabel}</a>
           <button type="button" class="btn-cart-icon add-to-cart" data-id="${product.id}"${plan.id ? ` data-variant="${plan.id}"` : ''} aria-label="Add to cart">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
           </button>`}
      </div>
    </article>
  `;
}

function renderReviews(reviews) {
  const section = document.getElementById('product-reviews-section');
  const list = document.getElementById('product-reviews-list');
  if (!section || !list) return;
  if (!reviews?.length) { section.hidden = true; return; }
  section.hidden = false;
  list.innerHTML = reviews.map((r) => `
    <div class="review-card">
      <div class="review-header">
        <strong>${escapeHtml(r.authorName || r.author_name)}</strong>
        <span class="review-rating">${'★'.repeat(r.rating || 5)}</span>
      </div>
      <p>${escapeHtml(r.body)}</p>
    </div>`).join('');
}

function renderRelated(related) {
  const section = document.getElementById('related-products-section');
  const grid = document.getElementById('related-products-grid');
  if (!section || !grid || !related?.length) return;
  section.hidden = false;
  grid.innerHTML = related.map((p) => `
    <a href="${productHref(p)}" class="related-product-card">
      <div class="related-product-icon logo${p.icon ? ' has-icon' : ''}">
        ${window.renderProductIcon ? window.renderProductIcon(p.icon, p.name, 'logo-img') : getLogoLetter(p.name)}
      </div>
      <strong>${escapeHtml(p.name)}</strong>
      <div class="related-product-price">From ${formatMoney(p.startingPrice || p.price || p.displayPrice)}</div>
    </a>`).join('');
}

function renderProduct(product) {
  const sharePath = product.shareUrl || (product.slug ? `/product/${product.slug}` : `/product.html?id=${product.id}`);
  if (window.applySeoMeta) {
    applySeoMeta({
      title: `${product.metaTitle || product.meta_title || product.name} — loveriette`,
      description: product.metaDescription || product.meta_description || product.description,
      image: product.ogImage || product.og_image,
      url: sharePath
    });
  } else {
    document.title = `${product.name} — loveriette`;
  }

  if (window.renderShareButtons) {
    renderShareButtons(document.getElementById('product-share'), sharePath, product.name);
  }

  const logoEl = document.getElementById('product-logo');
  logoEl.innerHTML = window.renderProductIcon
    ? window.renderProductIcon(product.icon, product.name, 'product-logo-img')
    : getLogoLetter(product.name);
  logoEl.classList.toggle('has-icon', !!product.icon);

  document.getElementById('about-name').textContent = product.name;
  document.getElementById('product-description').textContent =
    product.long_description || product.description;

  const plans = getPlans(product);
  plansGrid.innerHTML = plans.map((plan) => renderPlanCard(product, plan)).join('');

  renderReviews(product.reviews);
  renderRelated(product.relatedProducts);

  heroEl.hidden = false;
  aboutEl.hidden = false;
  plansSection.hidden = false;
}

async function loadExploreProducts(product) {
  let list = product.relatedProducts;
  if (!list?.length) {
    try {
      const cat = encodeURIComponent(product.category || '');
      list = await api(`/products?category=${cat}&limit=8`);
    } catch {
      list = [];
    }
  }
  renderExploreServices(list, product.id);
  if (!product.relatedProducts?.length) {
    const related = list.filter((p) => p.id !== product.id).slice(0, 4);
    if (related.length) renderRelated(related);
  }
}

async function addToCart(productId, variantId) {
  const body = { productId };
  if (variantId) body.variantId = variantId;
  const cart = await api('/cart', { method: 'POST', body: JSON.stringify(body) });
  document.querySelectorAll('.cart-count').forEach((el) => { el.textContent = cart.count; });
  showToast('Added to cart');
}

async function loadProduct() {
  try {
    if (!pathSlug && !productId) {
      location.replace('/shop');
      return;
    }
    let product;
    if (pathSlug) {
      product = await api(`/api/products/slug/${encodeURIComponent(pathSlug)}`);
    } else if (productId) {
      product = await api(`/products/${productId}`);
    } else {
      errorEl.hidden = false;
      return;
    }

    renderProduct(product);
    loadExploreProducts(product).catch(() => {});

    api(`/products/${product.id}/view`, { method: 'POST' }).catch(() => {});
  } catch {
    errorEl.hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof initPlatformNav === 'function') initPlatformNav('shop');
});

plansGrid.addEventListener('click', async (e) => {
  const btn = e.target.closest('.add-to-cart');
  if (!btn || btn.disabled) return;
  const id = Number(btn.dataset.id);
  const variantId = btn.dataset.variant ? Number(btn.dataset.variant) : null;
  if (id) await addToCart(id, variantId);
});

loadProduct();
