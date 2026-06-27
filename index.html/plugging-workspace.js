let workspace = null;
let selectedId = null;
let pendingOtpAccountId = null;

async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

async function tryLoadWorkspace() {
  try {
    workspace = await api('/api/plugging/workspace');
    showWorkspace();
    return true;
  } catch (_) {
    return false;
  }
}

function showWorkspace() {
  document.getElementById('gate-view').hidden = true;
  document.getElementById('workspace-view').hidden = false;
  document.getElementById('plan-info').textContent =
    `${workspace.planName} · up to ${workspace.maxSources} account(s)`;
  renderAccountList();
  if (selectedId) renderAccountDetail(selectedId);
}

function accountDotClass(a) {
  if (a.runnerStatus === 'running') return 'running';
  if (a.authStatus === 'authenticated') return 'authenticated';
  if (a.authStatus === 'code_sent') return 'pending';
  return '';
}

function renderAccountList() {
  const list = document.getElementById('account-list');
  if (!workspace.accounts?.length) {
    list.innerHTML = '<li style="padding:0.5rem;font-size:0.8rem;color:var(--plug-muted)">No accounts yet</li>';
    return;
  }
  list.innerHTML = workspace.accounts.map((a) => `
    <li class="plug-account-item ${a.id === selectedId ? 'active' : ''}" data-id="${a.id}">
      <span class="plug-account-dot ${accountDotClass(a)}"></span>
      <div>
        <strong>${esc(a.label || a.phone || 'Account')}</strong>
        <small>+${esc(a.phone)} · ${a.targetCount} target${a.targetCount !== 1 ? 's' : ''}</small>
      </div>
    </li>`).join('');
  list.querySelectorAll('.plug-account-item').forEach((el) => {
    el.addEventListener('click', () => {
      selectedId = Number(el.dataset.id);
      renderAccountList();
      renderAccountDetail(selectedId);
    });
  });
}

function renderAccountDetail(id) {
  const a = workspace.accounts.find((x) => x.id === id);
  const el = document.getElementById('account-detail');
  if (!a) {
    el.innerHTML = '<p style="color:#9aa0a6">Account not found.</p>';
    return;
  }

  const needsOtp = a.authStatus === 'code_sent' || pendingOtpAccountId === a.id;
  const authed = a.authStatus === 'authenticated';

  el.innerHTML = `
    <div class="plug-detail-header">
      <div>
        <h1>${esc(a.label || a.phone)}</h1>
        <span class="plug-status-badge ${a.runnerStatus === 'running' ? 'running' : ''}">${esc(a.runnerStatus)}</span>
      </div>
      <div class="plug-actions">
        ${authed ? `<button type="button" class="plug-btn plug-btn-primary" data-action="start">▶ Start Forwarder</button>
        <button type="button" class="plug-btn plug-btn-ghost" data-action="stop">Stop</button>
        <button type="button" class="plug-btn plug-btn-ghost" data-action="save">Save Config</button>` : ''}
        <button type="button" class="plug-btn plug-btn-danger" data-action="delete">Delete</button>
      </div>
    </div>

    ${needsOtp && !authed ? `
    <div class="plug-panel">
      <h3>Telegram Verification</h3>
      <p style="font-size:0.85rem;color:var(--plug-muted);margin:0 0 1rem">We sent a login code to your Telegram app. Enter it below to connect your account.</p>
      <div class="plug-otp-row">
        <div>
          <label>Code from Telegram</label>
          <input id="otp-code" placeholder="12345" inputmode="numeric">
        </div>
        <button type="button" class="plug-btn plug-btn-primary" id="verify-otp">Verify</button>
      </div>
      <p id="otp-msg" hidden style="font-size:0.85rem;margin:0.5rem 0 0"></p>
    </div>` : ''}

    ${authed ? `
    <div class="plug-stats">
      <div class="plug-stat"><strong>${a.successCount}</strong><span>Success</span></div>
      <div class="plug-stat"><strong>${a.failedCount}</strong><span>Failed</span></div>
      <div class="plug-stat"><strong>${a.cyclesCount}</strong><span>Cycles</span></div>
    </div>
    <div class="plug-panel">
      <h3>Forwarding Setup</h3>
      <p style="font-size:0.82rem;color:var(--plug-muted);margin:-0.5rem 0 1rem">Configure source, targets, and delay — then hit Start. The forwarder runs on your Telegram account automatically.</p>
      <label>Source chat / channel link</label>
      <input id="cfg-source" value="${esc(a.sourceLink)}" placeholder="https://t.me/sourcechannel">
      <label>Display name (optional prefix)</label>
      <input id="cfg-display" value="${esc(a.displayName)}" placeholder="Reseller Name">
      <label>Delay (minutes between forwards)</label>
      <input id="cfg-delay" type="number" min="0" value="${a.delayMinutes}">
      <label>Target groups — one link per line</label>
      <textarea id="cfg-targets" placeholder="https://t.me/yourgroup1\nhttps://t.me/yourgroup2">${esc(a.targetsText)}</textarea>
      ${a.lastError ? `<p style="color:var(--plug-danger);font-size:0.8rem">Last error: ${esc(a.lastError)}</p>` : ''}
    </div>` : (!needsOtp ? `
    <div class="plug-panel"><p style="margin:0;color:var(--plug-muted)">Waiting for Telegram verification…</p></div>` : '')}
  `;

  el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm('Delete this account?')) return;
    await api(`/api/plugging/workspace/accounts/${id}`, { method: 'DELETE' });
    selectedId = null;
    await refreshWorkspace();
  });

  el.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
    await api(`/api/plugging/workspace/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        sourceLink: document.getElementById('cfg-source').value,
        displayName: document.getElementById('cfg-display').value,
        delayMinutes: Number(document.getElementById('cfg-delay').value) || 0,
        targetsText: document.getElementById('cfg-targets').value
      })
    });
    await refreshWorkspace();
  });

  el.querySelector('[data-action="start"]')?.addEventListener('click', async () => {
    try {
      await api(`/api/plugging/workspace/accounts/${id}/start`, { method: 'POST' });
      await refreshWorkspace();
    } catch (e) { alert(e.message); }
  });

  el.querySelector('[data-action="stop"]')?.addEventListener('click', async () => {
    await api(`/api/plugging/workspace/accounts/${id}/stop`, { method: 'POST' });
    await refreshWorkspace();
  });

  document.getElementById('verify-otp')?.addEventListener('click', async () => {
    const msg = document.getElementById('otp-msg');
    msg.hidden = true;
    try {
      await api(`/api/plugging/workspace/accounts/${id}/verify-code`, {
        method: 'POST',
        body: JSON.stringify({ code: document.getElementById('otp-code').value })
      });
      pendingOtpAccountId = null;
      await refreshWorkspace();
    } catch (e) {
      msg.hidden = false;
      msg.style.color = '#e57373';
      msg.textContent = e.message;
    }
  });
}

async function refreshWorkspace() {
  workspace = await api('/api/plugging/workspace');
  renderAccountList();
  if (selectedId) {
    renderAccountDetail(selectedId);
  } else {
    document.getElementById('account-detail').innerHTML = `
      <div class="plug-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
        <p>Select an account or add your Telegram number to get started.</p>
      </div>`;
  }
}

document.getElementById('unlock-btn').addEventListener('click', async () => {
  const err = document.getElementById('gate-error');
  err.hidden = true;
  try {
    await api('/api/plugging/workspace/unlock', {
      method: 'POST',
      body: JSON.stringify({ accessKey: document.getElementById('access-key-input').value.trim() })
    });
    await tryLoadWorkspace();
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
  }
});

document.getElementById('add-account-btn').addEventListener('click', async () => {
  const msg = document.getElementById('add-account-msg');
  msg.hidden = true;
  try {
    const json = await api('/api/plugging/workspace/accounts', {
      method: 'POST',
      body: JSON.stringify({
        phone: document.getElementById('new-phone').value,
        label: document.getElementById('new-label').value
      })
    });
    pendingOtpAccountId = json.accountId;
    selectedId = json.accountId;
    document.getElementById('new-phone').value = '';
    msg.hidden = false;
    msg.style.color = '#81c995';
    msg.textContent = json.message || 'Code sent';
    await refreshWorkspace();
    renderAccountDetail(selectedId);
  } catch (e) {
    msg.hidden = false;
    msg.style.color = '#e57373';
    msg.textContent = e.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/plugging/workspace/logout', { method: 'POST' });
  location.reload();
});

tryLoadWorkspace();
