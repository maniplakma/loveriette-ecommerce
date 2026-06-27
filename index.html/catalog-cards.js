/** Shared shop-style catalog product cards */
function formatCatalogPrice(price) {
  const n = Number(price);
  if (!n) return null;
  return {
    major: Math.floor(n).toLocaleString(),
    minor: String(Math.round((n - Math.floor(n)) * 100)).padStart(2, '0')
  };
}

function catalogPriceHtml(price) {
  const parts = formatCatalogPrice(price);
  if (!parts) return '<span class="catalog-price-empty">No price yet</span>';
  return `<span class="catalog-price-currency">₱</span><span class="catalog-price-major">${parts.major}</span><span class="catalog-price-minor">${parts.minor}</span>`;
}

function catalogStockBadge(label, state = 'available') {
  if (window.themeBadge) {
    return themeBadge(state === 'preorder' ? 'preorder' : 'available', label, { size: 'sm' });
  }
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<span class="catalog-stock-badge catalog-stock-badge--${state}">${esc(label)}</span>`;
}

function renderCatalogProductCard({ href, name, description, icon, price, badgeHtml }) {
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const iconHtml = window.renderProductIcon
    ? window.renderProductIcon(icon, name, 'logo-img')
    : esc(name.charAt(0));
  return `
    <article class="product-card catalog-card">
      <a href="${esc(href)}" class="catalog-card-link">
        <div class="catalog-card-head">
          <div class="catalog-card-icon">
            <div class="logo${icon ? ' has-icon' : ''}">${iconHtml}</div>
          </div>
          <div class="catalog-card-badge">${badgeHtml}</div>
        </div>
        <div class="catalog-card-body">
          <h2 class="catalog-card-name">${esc(name)}</h2>
          <p class="catalog-desc">${esc(description)}</p>
        </div>
        <div class="catalog-card-foot">
          <div class="catalog-card-price-block">
            <span class="catalog-price-label">STARTING AT</span>
            <span class="catalog-price-value">${catalogPriceHtml(price)}</span>
          </div>
          <span class="catalog-card-arrow" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
        </div>
      </a>
    </article>`;
}

window.formatCatalogPrice = formatCatalogPrice;
window.catalogPriceHtml = catalogPriceHtml;
window.catalogStockBadge = catalogStockBadge;
window.renderCatalogProductCard = renderCatalogProductCard;
