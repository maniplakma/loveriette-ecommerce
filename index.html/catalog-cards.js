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
  if (!parts) return '<span class="catalog-price-empty">—</span>';
  return `<span class="catalog-showcase-price">₱${parts.major}<small>.${parts.minor}</small></span>`;
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
    <article class="catalog-showcase">
      <a href="${esc(href)}" class="catalog-showcase-link">
        <div class="catalog-showcase-top">
          <div class="catalog-showcase-icon">
            <div class="logo${icon ? ' has-icon' : ''}">${iconHtml}</div>
          </div>
          <div class="catalog-showcase-badge">${badgeHtml}</div>
        </div>
        <div class="catalog-showcase-body">
          <h2 class="catalog-showcase-name">${esc(name)}</h2>
          <p class="catalog-showcase-desc">${esc(description)}</p>
        </div>
        <footer class="catalog-showcase-foot">
          <div class="catalog-showcase-price-wrap">
            <span class="catalog-showcase-price-label">from</span>
            ${catalogPriceHtml(price)}
          </div>
          <span class="catalog-showcase-cta">Explore <span aria-hidden="true">→</span></span>
        </footer>
      </a>
    </article>`;
}

window.formatCatalogPrice = formatCatalogPrice;
window.catalogPriceHtml = catalogPriceHtml;
window.catalogStockBadge = catalogStockBadge;
window.renderCatalogProductCard = renderCatalogProductCard;
