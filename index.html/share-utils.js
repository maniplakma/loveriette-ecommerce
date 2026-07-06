/** Share, copy link, and SEO meta helpers */
function getShareUrl(path) {
  const base = window.location.origin;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function copyToClipboard(text) {
  return navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

function renderShareButtons(container, url, title) {
  if (!container) return;
  container.classList.add('page-share-bar');
  const fullUrl = getShareUrl(url);
  container.innerHTML = `
    <div class="share-actions">
      <button type="button" class="btn-share btn-copy-link" data-url="${fullUrl}" title="Copy link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy link
      </button>
      <button type="button" class="btn-share btn-native-share" data-url="${fullUrl}" data-title="${title || ''}" title="Share">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        share the love 
      </button>
    </div>`;

  container.querySelector('.btn-copy-link')?.addEventListener('click', async (e) => {
    await copyToClipboard(e.currentTarget.dataset.url);
    if (window.showToast) showToast('Link copied!');
  });

  container.querySelector('.btn-native-share')?.addEventListener('click', async (e) => {
    const shareUrl = e.currentTarget.dataset.url;
    const shareTitle = e.currentTarget.dataset.title || document.title;
    if (navigator.share) {
      try { await navigator.share({ title: shareTitle, url: shareUrl }); } catch (_) { /* cancelled */ }
    } else {
      await copyToClipboard(shareUrl);
      if (window.showToast) showToast('Link copied!');
    }
  });
}

function applySeoMeta({ title, description, image, url }) {
  if (title) document.title = title;
  const setMeta = (name, content, prop) => {
    if (!content) return;
    const attr = prop ? 'property' : 'name';
    let el = document.querySelector(`meta[${attr}="${name}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.append(el); }
    el.content = content;
  };
  setMeta('description', description);
  setMeta('og:title', title, true);
  setMeta('og:description', description, true);
  setMeta('og:image', image, true);
  setMeta('og:url', url ? getShareUrl(url) : window.location.href, true);
}

window.getShareUrl = getShareUrl;
window.copyToClipboard = copyToClipboard;
window.renderShareButtons = renderShareButtons;
window.applySeoMeta = applySeoMeta;
