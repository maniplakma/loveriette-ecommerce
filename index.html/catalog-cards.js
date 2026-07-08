/** Shared shop-style catalog product cards */
function formatCatalogPrice(price) {
  const n = Number(price);
  if (!n) return null;
  return `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const priceText = formatCatalogPrice(price) || '—';
  return `
    <article class="catalog-tile">
      <a href="${esc(href)}" class="catalog-tile-link">
        <div class="catalog-tile-row">
          <div class="catalog-tile-icon logo${icon ? ' has-icon' : ''}">${iconHtml}</div>
          <div class="catalog-tile-main">
            <div class="catalog-tile-top">
              <h2 class="catalog-tile-name">${esc(name)}</h2>
              <span class="catalog-tile-badge">${badgeHtml}</span>
            </div>
            <p class="catalog-tile-desc">${esc(description)}</p>
          </div>
        </div>
        <div class="catalog-tile-foot">
          <span class="catalog-tile-price">${priceText}</span>
          <span class="catalog-tile-cta">View →</span>
        </div>
      </a>
    </article>`;
}

window.formatCatalogPrice = formatCatalogPrice;
window.catalogPriceHtml = formatCatalogPrice;
window.catalogStockBadge = catalogStockBadge;
window.renderCatalogProductCard = renderCatalogProductCard;
