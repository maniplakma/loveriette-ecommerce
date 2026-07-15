/** Share, copy link, and SEO meta helpers */
function escAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function getShareUrl(path) {
  const base = window.location.origin;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function copyWithTextarea(text) {
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    ta.remove();
    if (ok) resolve();
    else reject(new Error('Copy failed'));
  });
}

async function copyToClipboard(text) {
  const value = String(text || '');
  if (!value) throw new Error('Nothing to copy');
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_) {
      /* fall through to textarea fallback */
    }
  }
  return copyWithTextarea(value);
}

function setCopyButtonFeedback(btn, state) {
  if (!btn) return;
  const defaultLabel = btn.dataset.defaultLabel || 'Copy link';
  if (state === 'copied') {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = defaultLabel; }, 2000);
    return;
  }
  if (state === 'error') {
    btn.textContent = 'Copy failed';
    setTimeout(() => { btn.textContent = defaultLabel; }, 2200);
  }
}

async function handleCopyLinkClick(btn, url) {
  try {
    await copyToClipboard(url);
    setCopyButtonFeedback(btn, 'copied');
    if (window.showToast) showToast('Link copied!');
  } catch (_) {
    setCopyButtonFeedback(btn, 'error');
    if (window.showToast) showToast('Copy failed — long-press the address bar to copy', 'error');
  }
}

function renderShareButtons(container, url, title) {
  if (!container) return;
  container.classList.add('page-share-bar');
  const fullUrl = getShareUrl(url);
  container.innerHTML = `
    <div class="share-actions">
      <button type="button" class="btn-share btn-copy-link" data-url="${escAttr(fullUrl)}" data-default-label="Copy link" title="Copy link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy link
      </button>
      <button type="button" class="btn-share btn-native-share" data-url="${escAttr(fullUrl)}" data-title="${escAttr(title || '')}" title="Share">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        share the love 
      </button>
    </div>`;

  const copyBtn = container.querySelector('.btn-copy-link');
  copyBtn?.addEventListener('click', (e) => {
    handleCopyLinkClick(e.currentTarget, e.currentTarget.dataset.url);
  });

  container.querySelector('.btn-native-share')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const shareUrl = btn.dataset.url;
    const shareTitle = btn.dataset.title || document.title;
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
      } catch (_) { /* cancelled */ }
      return;
    }
    await handleCopyLinkClick(btn, shareUrl);
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
