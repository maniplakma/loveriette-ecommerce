function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function loadWebsiteMaking() {
  const data = await ApiCache.fetchJson('/api/website-making');
  if (window.applySeoMeta) applySeoMeta({ title: 'Website Making — loveriette', description: 'Professional websites for your business', url: '/website-making' });
  if (window.renderShareButtons) renderShareButtons(document.getElementById('web-share'), '/website-making', 'Website Making');

  document.getElementById('packages-grid').innerHTML = (data.packages||[]).map((p) => `
    <article class="package-card">
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.description)}</p>
      <div class="package-price">${esc(p.priceLabel || '₱' + Number(p.price).toLocaleString())}</div>
      <ul class="package-features">${(p.features||[]).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      <div class="package-actions">
        <a href="/website-making/${esc(p.slug)}" class="btn-primary-platform">view package ♡</a>
      </div>
    </article>`).join('');

  document.getElementById('portfolio-grid').innerHTML = (data.portfolio||[]).map((item) => `
    <div class="package-card">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.description)}</p>
      ${item.linkUrl ? `<a href="${esc(item.linkUrl)}" target="_blank" rel="noopener" class="btn-outline-platform">View Project</a>` : ''}
    </div>`).join('') || '<p>Portfolio coming soon.</p>';

  document.getElementById('web-faq').innerHTML = (data.faqs||[]).map((f, i) => `
    <div class="faq-item${i===0?' open':''}">
      <button type="button" class="faq-question">${esc(f.question)}</button>
      <div class="faq-answer"><p>${esc(f.answer)}</p></div>
    </div>`).join('');
  document.querySelectorAll('#web-faq .faq-question').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open'));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initPlatformNav('website');
  loadWebsiteMaking().catch(() => {});
});
