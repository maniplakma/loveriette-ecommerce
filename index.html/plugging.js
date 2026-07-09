function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPluggingProducts(products) {
  const el = document.getElementById('plugging-products');
  const empty = document.getElementById('plugging-products-empty');
  const list = (products || []).filter((p) => p.slug !== 'starter');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  el.innerHTML = list.map((product, i) => renderNfProductCard(product, i)).join('');
}

function renderPluggingFaqs(faqs) {
  const el = document.getElementById('plugging-faq');
  if (!el) return;
  const list = Array.isArray(faqs) ? faqs : [];
  if (!list.length) {
    el.innerHTML = '<p class="empty-state">No FAQs available yet.</p>';
    return;
  }
  el.innerHTML = list.map((f, i) => `
    <div class="faq-item${i === 0 ? ' open' : ''}">
      <button type="button" class="faq-question">${esc(f.question)}</button>
      <div class="faq-answer"><p>${esc(f.answer)}</p></div>
    </div>`).join('');
  el.querySelectorAll('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.faq-item').classList.toggle('open'));
  });
}

async function fetchPluggingData() {
  if (window.ApiCache?.fetchJson) return ApiCache.fetchJson('/api/plugging');
  const res = await fetch('/api/plugging', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load plugging data');
  return res.json();
}

async function heroEnterWorkspace() {
  const err = document.getElementById('hero-ws-error');
  const key = document.getElementById('hero-access-key').value.trim();
  err.hidden = true;
  if (!key) {
    err.textContent = 'Enter your access key first';
    err.hidden = false;
    return;
  }
  try {
    const res = await fetch('/api/plugging/workspace/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accessKey: key })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Invalid access key');
    if (window.setStoredPlugKey) setStoredPlugKey(key);
    location.href = '/plugging/workspace';
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof initPlatformNav === 'function') initPlatformNav('plugging');

  document.getElementById('hero-enter-workspace')?.addEventListener('click', heroEnterWorkspace);
  document.getElementById('hero-access-key')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') heroEnterWorkspace();
  });

  try {
    const data = await fetchPluggingData();
    if (window.applySeoMeta) {
      applySeoMeta({ title: `${data.heroTitle || 'Plugging'} — loveriette`, description: data.heroSubtitle, url: '/plugging' });
    }
    if (window.renderShareButtons) {
      renderShareButtons(document.getElementById('plugging-share'), '/plugging', 'Plugging Service');
    }

    const subEl = document.getElementById('plugging-hero-sub');
    if (subEl) {
      subEl.textContent = data.heroSubtitle || 'Connect your Telegram, set your source and targets — the forwarder runs on your account, instantly. No admin setup needed.';
    }

    renderPluggingProducts(data.products || []);
    renderPluggingFaqs(data.faqs || []);
  } catch (e) {
    console.warn('Plugging load failed', e);
    const empty = document.getElementById('plugging-products-empty');
    if (empty) empty.hidden = false;
  }
});
