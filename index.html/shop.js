/** Shop page — product catalog */
let activeCategory = 'All';
let searchTimer = null;

const productsEl = document.getElementById('products');
const emptyStateEl = document.querySelector('.empty-state');
const searchInput = document.getElementById('search-input');
const filterContainer = document.getElementById('category-filters');

async function api(url) {
  return ApiCache.fetchJson(url, {}, 30000);
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function productStockBadge(product) {
  const state = product.listingStockState || 'available';
  let label = product.listingStockLabel || (state === 'available' ? 'Available' : 'Preorder');
  if (state === 'available' && Number(product.stock) > 0) {
    label = `${product.stock} left`;
  }
  return catalogStockBadge(label, state === 'preorder' ? 'preorder' : 'available');
}

function productHref(p) {
  return p.shareUrl || (p.slug ? `/product/${p.slug}` : `product.html?id=${p.id}`);
}

function renderProducts(products) {
  productsEl.innerHTML = '';
  if (!products.length) { emptyStateEl.hidden = false; return; }
  emptyStateEl.hidden = true;

  productsEl.innerHTML = products.map((product) => renderCatalogProductCard({
    href: productHref(product),
    name: product.name,
    description: product.description,
    icon: product.icon,
    price: product.startingPrice,
    badgeHtml: productStockBadge(product)
  })).join('');
}

async function loadProducts() {
  const params = new URLSearchParams();
  if (activeCategory !== 'All') params.set('category', activeCategory);
  const q = searchInput?.value?.trim();
  if (q) params.set('search', q);
  try {
    const products = await api(`/products?${params}`);
    renderProducts(products);
  } catch { emptyStateEl.hidden = false; }
}

async function loadCategories() {
  try {
    const cats = await api('/categories');
    const btns = cats.map((c) =>
      `<button class="filter-btn" type="button" data-category="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`
    ).join('');
    filterContainer.innerHTML = `<button class="filter-btn active" type="button" data-category="All">All</button>${btns}`;
    filterContainer.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterContainer.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeCategory = btn.dataset.category;
        loadProducts();
      });
    });
  } catch (_) { /* ignore */ }
}

searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 300);
});

document.addEventListener('DOMContentLoaded', () => {
  initPlatformNav('shop');
  if (window.renderShareButtons) {
    renderShareButtons(document.getElementById('shop-share'), '/shop', 'Shop');
  }
  loadCategories();
  loadProducts();
});
