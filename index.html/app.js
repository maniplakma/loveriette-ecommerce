let activeCategory = 'All';

const productsEl = document.querySelector('.products');
const emptyStateEl = document.querySelector('.empty-state');
const searchInput = document.querySelector('#search-input');
const filterBtns = document.querySelectorAll('.filter-btn');
const authGuestEls = document.querySelectorAll('.auth-guest');
const authUserEls = document.querySelectorAll('.auth-user');

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    credentials: 'include'
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function updateAuthUI(user) {
  authGuestEls.forEach((el) => { el.hidden = !!user; });
  authUserEls.forEach((el) => { el.hidden = !user; });
  if (typeof setNewBuyer === 'function') setNewBuyer(!user);
  if (typeof ensureAdminLink === 'function') ensureAdminLink(!!user?.isAdmin);
  if (typeof cleanupDashboardNavLeft === 'function') cleanupDashboardNavLeft();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStartingPrice(price) {
  const n = Number(price);
  if (!n) return null;
  const major = Math.floor(n);
  const minor = String(Math.round((n - major) * 100)).padStart(2, '0');
  return { major, minor };
}

function catalogStockBadge(product) {
  const state = product.listingStockState || ((product.stock ?? 0) > 0 ? 'available' : 'preorder');
  let label = product.listingStockLabel || (state === 'available' ? 'Available' : 'Preorder');
  if (state === 'available' && Number(product.stock) > 0) {
    label = `${product.stock} left`;
  }
  if (window.themeBadge) {
    return themeBadge(state === 'available' ? 'available' : 'preorder', label, { size: 'sm' });
  }
  return `<span class="catalog-stock-badge catalog-stock-badge--${state}">${escapeHtml(label)}</span>`;
}

function renderProducts(products) {
  productsEl.innerHTML = '';

  if (products.length === 0) {
    emptyStateEl.hidden = false;
    return;
  }

  emptyStateEl.hidden = true;

  products.forEach((product) => {
    const priceParts = product.startingPrice ? formatStartingPrice(product.startingPrice) : null;
    const priceHtml = priceParts
      ? `<span class="catalog-price-currency">₱</span><span class="catalog-price-major">${priceParts.major}</span><span class="catalog-price-minor">${priceParts.minor}</span>`
      : '<span class="catalog-price-empty">No price yet</span>';

    const card = document.createElement('article');
    card.className = 'product-card catalog-card';
    card.innerHTML = `
      <a href="${product.shareUrl || (product.slug ? `/product/${product.slug}` : `product.html?id=${product.id}`)}" class="catalog-card-link">
        <div class="catalog-card-head">
          <div class="catalog-card-icon">
            <div class="logo${product.icon ? ' has-icon' : ''}">${window.renderProductIcon ? window.renderProductIcon(product.icon, product.name, 'logo-img') : ''}</div>
          </div>
          <div class="catalog-card-badge">${catalogStockBadge(product)}</div>
        </div>
        <div class="catalog-card-body">
          <h2 class="catalog-card-name">${escapeHtml(product.name)}</h2>
          <p class="catalog-card-category">${escapeHtml(product.category || '')}</p>
        </div>
        <div class="catalog-card-foot">
          <div class="catalog-card-price-block">
            <span class="catalog-price-label">STARTING AT</span>
            <span class="catalog-price-value">${priceHtml}</span>
          </div>
          <span class="catalog-card-arrow" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
        </div>
      </a>
    `;
    productsEl.appendChild(card);
  });
}

async function loadProducts() {
  const params = new URLSearchParams();
  if (activeCategory !== 'All') params.set('category', activeCategory);
  if (searchInput.value.trim()) params.set('search', searchInput.value.trim());

  const query = params.toString();
  const url = query ? `/products?${query}` : '/products';
  const products = await fetch(url, { credentials: 'include' }).then((r) => r.json());
  renderProducts(products);
}

let searchDebounce = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadProducts, 300);
});

filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeCategory = btn.dataset.category;
    loadProducts();
  });
});

document.querySelector('a[href="#products"]')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelector('#products')?.scrollIntoView({ behavior: 'smooth' });
});

loadProducts();

if (window.location.hash === '#products') {
  setTimeout(() => {
    document.querySelector('#products')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}
