/** Netflix-style plan cards for plugging catalog + variant picker */
(function () {
  const CHECK = '<svg class="nf-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  const TIERS = ['tier-1', 'tier-2', 'tier-3'];
  const POPULAR_SLUGS = new Set(['pro']);

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function peso(n) {
    return `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function planIconHtml(icon, name) {
    if (window.renderProductIcon && icon) {
      return window.renderProductIcon(icon, name, 'logo-img');
    }
    return esc((name || 'P').charAt(0).toUpperCase());
  }

  function featureList(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return '';
    return `<ul class="nf-plan-features">${list.map((f) => `<li>${CHECK}${esc(f)}</li>`).join('')}</ul>`;
  }

  function renderNfProductCard(product, index) {
    const tier = TIERS[index % TIERS.length];
    const popular = POPULAR_SLUGS.has(product.slug);
    const variants = product.variants?.length || 0;
    const meta = variants
      ? `${variants} duration option${variants !== 1 ? 's' : ''}`
      : 'Plugging plan';
    const features = product.features?.length
      ? product.features
      : ['Self-service workspace', 'Auto forward on your Telegram', 'Instant setup after payment'];

    return `
      <article class="nf-plan-card ${tier}${popular ? ' is-popular' : ''}">
        ${popular ? '<span class="nf-plan-ribbon">Most Popular</span>' : ''}
        <div class="nf-plan-header">
          <div class="nf-plan-icon"><div class="logo${product.icon ? ' has-icon' : ''}">${planIconHtml(product.icon, product.name)}</div></div>
          <h3>${esc(product.name)}</h3>
          <span class="nf-plan-meta">${esc(meta)}</span>
        </div>
        <div class="nf-plan-body">
          <p class="nf-plan-tagline">${esc(product.description || '')}</p>
          <div class="nf-plan-price-block">
            <span class="nf-plan-price">${esc(peso(product.startingPrice))}</span>
            <span class="nf-plan-period">starting price</span>
          </div>
          <hr class="nf-plan-divider">
          ${featureList(features)}
          <a href="/plugging/plan/${esc(product.slug)}" class="nf-plan-btn">Choose Plan</a>
        </div>
      </article>`;
  }

  function variantFeatures(product, variant) {
    if (variant.features?.length) return variant.features;
    const base = [
      `${variant.maxSources >= 999 ? 'Unlimited' : variant.maxSources} account(s) → ${variant.maxDestinations >= 999 ? 'Unlimited' : variant.maxDestinations} destination(s)`,
      variant.duration ? `${variant.duration} access` : null,
      'Self-service workspace'
    ].filter(Boolean);
    if (variant.priority) {
      base.push('Auto join groups', 'Start all (staggered)');
    } else {
      base.push('Manual start per account');
    }
    return base;
  }

  function renderNfVariantCard(product, variant, index) {
    const tier = TIERS[index % TIERS.length];
    const popular = index === 1 || String(variant.duration || '').includes('30');
    const price = variant.priceLabel || peso(variant.price);
    const features = variantFeatures(product, variant);

    return `
      <article class="nf-plan-card ${tier}${popular ? ' is-popular' : ''}">
        ${popular ? '<span class="nf-plan-ribbon">Best Value</span>' : ''}
        <div class="nf-plan-header">
          <div class="nf-plan-icon"><div class="logo${product.icon ? ' has-icon' : ''}">${planIconHtml(product.icon, product.name)}</div></div>
          <h3>${esc(variant.name || variant.duration)}</h3>
          <span class="nf-plan-meta">${esc(variant.duration || product.name)}</span>
        </div>
        <div class="nf-plan-body">
          <p class="nf-plan-tagline">${esc(variant.description || `${product.name} — ${variant.duration || variant.name}`)}</p>
          <div class="nf-plan-price-block">
            <span class="nf-plan-price">${esc(price)}</span>
            <span class="nf-plan-period">${esc(variant.duration ? `for ${variant.duration.toLowerCase()}` : 'one-time')}</span>
          </div>
          <hr class="nf-plan-divider">
          ${featureList(features)}
          <a href="/plugging/subscribe?plan=${encodeURIComponent(variant.id)}" class="nf-plan-btn">Subscribe</a>
        </div>
      </article>`;
  }

  function renderNfRelatedCard(product, index) {
    const tier = TIERS[index % TIERS.length];
    return `
      <article class="nf-plan-card is-compact ${tier}">
        <div class="nf-plan-header">
          <h3>${esc(product.name)}</h3>
          <span class="nf-plan-meta">From ${esc(peso(product.startingPrice))}</span>
        </div>
        <div class="nf-plan-body">
          <p class="nf-plan-tagline">${esc(product.description || '')}</p>
          <a href="/plugging/plan/${esc(product.slug)}" class="nf-plan-btn">View Plan</a>
        </div>
      </article>`;
  }

  window.renderNfProductCard = renderNfProductCard;
  window.renderNfVariantCard = renderNfVariantCard;
  window.renderNfRelatedCard = renderNfRelatedCard;
})();
