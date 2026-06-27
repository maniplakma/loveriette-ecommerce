function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function loadLending() {
  const data = await ApiCache.fetchJson('/api/lending');
  if (!data.enabled) {
    document.body.innerHTML = '<main class="platform-section"><h2>Lending is currently unavailable.</h2><a href="/">← Home</a></main>';
    return;
  }

  document.getElementById('lending-hero-sub').textContent = data.heroSubtitle || 'flexible loans with trust and care — we\'ve got you';
  document.getElementById('lending-interest-note').textContent = data.interestNote || '';
  if (window.applySeoMeta) applySeoMeta({ title: 'Lending — loveriette', description: data.heroSubtitle, url: '/lending' });
  if (window.renderShareButtons) renderShareButtons(document.getElementById('lending-share'), '/lending', 'Lending Services');

  document.getElementById('loan-plans-grid').innerHTML = (data.plans||[]).map((p) => `
    <article class="package-card">
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.description)}</p>
      <div class="package-price">${p.interestRate}% / month</div>
      <ul class="package-features">
        <li>₱${Number(p.minAmount).toLocaleString()} – ₱${Number(p.maxAmount).toLocaleString()}</li>
        <li>Admin fee: ₱${Number(p.adminFee).toLocaleString()}</li>
        <li>Term: ${p.termMonths} month(s)</li>
        ${(p.features||[]).map((f) => `<li>${esc(f)}</li>`).join('')}
      </ul>
      <div class="package-actions">
        <a href="/lending/apply?plan=${esc(p.slug)}" class="btn-primary-platform">Apply</a>
        <a href="/lending/plan/${esc(p.slug)}" class="btn-outline-platform">Details</a>
      </div>
    </article>`).join('');

  document.getElementById('kyc-grid').innerHTML = (data.kyc||[]).map((k) =>
    `<div class="info-card"><h4>${esc(k.title)}${k.required ? ' *' : ''}</h4><p>${esc(k.description)}</p></div>`
  ).join('');

  document.getElementById('documents-grid').innerHTML = (data.documents||[]).map((d) =>
    `<div class="info-card"><h4>${esc(d.title)}</h4><p>${esc(d.description)}</p></div>`
  ).join('') || '<p>No documents listed.</p>';

  const resp = data.borrowerResponsibilities || [];
  document.getElementById('responsibilities-list').innerHTML = `<ul>${resp.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;

  document.getElementById('terms-list').innerHTML = (data.terms||[]).map((t) =>
    `<div class="info-card" style="margin-bottom:0.75rem"><h4>${esc(t.title)}</h4><p>${esc(t.body)}</p></div>`
  ).join('');

  document.getElementById('lending-faq').innerHTML = (data.faqs||[]).map((f, i) => `
    <div class="faq-item${i===0?' open':''}">
      <button type="button" class="faq-question">${esc(f.question)}</button>
      <div class="faq-answer"><p>${esc(f.answer)}</p></div>
    </div>`).join('');
  document.querySelectorAll('#lending-faq .faq-question').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open'));
  });

  const contact = [];
  if (data.contactEmail) contact.push(`Email: <a href="mailto:${esc(data.contactEmail)}">${esc(data.contactEmail)}</a>`);
  if (data.contactPhone) contact.push(`Phone: ${esc(data.contactPhone)}`);
  document.getElementById('lending-contact').innerHTML = contact.length ? contact.join('<br>') : 'Contact us via the Contact page.';
}

document.addEventListener('DOMContentLoaded', () => {
  initPlatformNav('lending');
  loadLending().catch(() => {});
});
