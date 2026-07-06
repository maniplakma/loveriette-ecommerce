(function () {
  const ref = location.pathname.split('/').pop();
  const params = new URLSearchParams(location.search);
  const presetEmail = params.get('email') || '';

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso.replace(' ', 'T')).toLocaleString('en-PH', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
    } catch (_) {
      return iso;
    }
  }

  function renderMessages(messages) {
    const el = document.getElementById('inquiry-messages');
    if (!messages.length) {
      el.innerHTML = '<p class="inquiry-empty">No messages yet.</p>';
      return;
    }
    el.innerHTML = messages.map((m) => `
      <div class="inquiry-msg inquiry-msg--${m.senderType === 'admin' ? 'admin' : 'client'}">
        <div class="inquiry-msg-meta">${m.senderType === 'admin' ? 'Loveriette Team' : 'You'} · ${esc(formatTime(m.createdAt))}</div>
        <div class="inquiry-msg-body">${esc(m.body).replace(/\n/g, '<br>')}</div>
      </div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  async function loadInquiry(email) {
    const qs = email ? `?email=${encodeURIComponent(email)}` : '';
    const res = await fetch(`/api/website-making/inquiry/${encodeURIComponent(ref)}${qs}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Inquiry not found');

    const inq = data.inquiry;
    document.getElementById('inquiry-title').textContent = inq.packageName || 'Website Inquiry';
    document.getElementById('inquiry-meta').textContent =
      `${inq.inquiryRef} · ${inq.status.replace(/_/g, ' ')} · ${inq.name} (${inq.email})`;

    renderMessages(data.messages || []);

    const form = document.getElementById('inquiry-reply-form');
    const closed = document.getElementById('inquiry-closed-note');
    const emailInput = document.getElementById('inquiry-email');
    if (emailInput && (email || presetEmail)) emailInput.value = email || presetEmail;

    if (inq.status === 'closed') {
      form.hidden = true;
      closed.hidden = false;
    } else {
      form.hidden = false;
      closed.hidden = true;
    }
    return inq;
  }

  document.getElementById('inquiry-reply-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('inquiry-email').value.trim();
    const message = document.getElementById('inquiry-message').value.trim();
    if (!email || !message) return;
    try {
      const res = await fetch(`/api/website-making/inquiry/${encodeURIComponent(ref)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, message })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      document.getElementById('inquiry-message').value = '';
      renderMessages(data.messages || []);
      if (window.showToast) showToast('Message sent');
    } catch (err) {
      if (window.showToast) showToast(err.message || 'Failed to send');
    }
  });

  const domReady = window.domReady || window.onPageReady || function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

  domReady(() => {
    initPlatformNav('website');
    loadInquiry(presetEmail).catch(() => {
      document.getElementById('inquiry-messages').innerHTML =
        '<p class="inquiry-empty">Inquiry not found. Check your link or <a href="/website-making">browse packages</a>.</p>';
    });
  });
})();
