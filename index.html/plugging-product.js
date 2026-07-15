const slug = window.location.pathname.match(/\/plugging\/plan\/([^/]+)/)?.[1];

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchPlugProduct(slug) {
  const url = `/api/plugging/products/${encodeURIComponent(slug)}`;
  if (window.ApiCache?.fetchJson) return ApiCache.fetchJson(url);
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Product not found');
  return data;
}

async function load() {
  if (!slug) {
    document.getElementById('plug-product-error').hidden = false;
    return;
  }
  try {
    const { product, related } = await fetchPlugProduct(slug);
    document.title = `${product.name} — Plugging — loveriette`;
    if (window.applySeoMeta) {
      applySeoMeta({ title: document.title, description: product.description, url: `/plugging/plan/${product.slug}` });
    }
    if (window.renderShareButtons) {
      renderShareButtons(document.getElementById('plug-product-share'), `/plugging/plan/${product.slug}`, product.name);
    }

    document.getElementById('plug-product-main').hidden = false;
    document.getElementById('plug-step-name').textContent = product.name;
    document.getElementById('plug-product-description').textContent = product.description || '';

    const variants = product.variants || [];
    document.getElementById('plug-plans-grid').innerHTML = variants.length
      ? variants.map((v, i) => renderNfVariantCard(product, v, i)).join('')
      : '<p class="empty-state">No variants available.</p>';

    if (related?.length) {
      document.getElementById('plug-related-section').hidden = false;
      document.getElementById('plug-related-grid').innerHTML = related
        .map((p, i) => renderNfRelatedCard(p, i)).join('');
    }
  } catch (_) {
    document.getElementById('plug-product-error').hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof initPlatformNav === 'function') initPlatformNav('plugging');
  load();
});
