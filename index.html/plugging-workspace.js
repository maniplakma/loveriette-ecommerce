let workspace = null;
let selectedId = null;
let pendingOtpAccountId = null;
let activityPollTimer = null;
let activityLastId = 0;

async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function formatActivityTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function activityKindLabel(kind) {
  const map = {
    success: 'Sent',
    complete: 'Complete',
    error: 'Error',
    cycle: 'Detected',
    started: 'Started',
    stopped: 'Stopped',
    info: 'Info'
  };
  return map[kind] || kind;
}

function stopActivityPoll() {
  if (activityPollTimer) {
    clearInterval(activityPollTimer);
    activityPollTimer = null;
  }
  activityLastId = 0;
}

function renderActivityItems(items, mode = 'append') {
  const feed = document.getElementById('plug-activity-feed');
  const empty = document.getElementById('plug-activity-empty');
  if (!feed) return;
  if (mode === 'replace') feed.innerHTML = '';
  items.forEach((item) => {
    if (feed.querySelector(`[data-activity-id="${item.id}"]`)) return;
    const row = document.createElement('div');
    row.className = `plug-activity-item plug-activity-${item.kind}`;
    row.dataset.activityId = item.id;
    row.innerHTML = `
      <span class="plug-activity-time">${esc(formatActivityTime(item.createdAt))}</span>
      <span class="plug-activity-badge">${esc(activityKindLabel(item.kind))}</span>
      <span class="plug-activity-msg">${esc(item.message)}</span>`;
    feed.appendChild(row);
  });
  if (empty) empty.hidden = feed.children.length > 0;
  feed.scrollTop = feed.scrollHeight;
}

async function loadActivity(accountId, reset = false) {
  if (!accountId) return;
  try {
    const since = reset ? 0 : activityLastId;
    const data = await api(`/api/plugging/workspace/accounts/${accountId}/activity?since=${since}&limit=80`);
    if (reset) {
      activityLastId = 0;
      renderActivityItems(data.items || [], 'replace');
    } else if (data.items?.length) {
      renderActivityItems(data.items, 'append');
    }
    if (data.items?.length) {
      activityLastId = Math.max(activityLastId, ...data.items.map((i) => i.id));
    }
  } catch (_) { /* ignore */ }
}

function startActivityPoll(accountId) {
  stopActivityPoll();
  loadActivity(accountId, true);
  activityPollTimer = setInterval(async () => {
    await loadActivity(accountId, false);
    await refreshWorkspaceStats(accountId);
  }, 4000);
}

function updateAccountStats(accountId) {
  const a = workspace?.accounts?.find((x) => x.id === accountId);
  if (!a) return;
  const stats = document.querySelectorAll('.plug-stat strong');
  if (stats.length >= 3) {
    stats[0].textContent = a.successCount;
    stats[1].textContent = a.failedCount;
    stats[2].textContent = a.cyclesCount;
  }
  const badge = document.querySelector('.plug-detail-header .plug-status-badge');
  if (badge) {
    badge.textContent = a.runnerStatus;
    badge.classList.toggle('running', a.runnerStatus === 'running');
  }
  const liveDot = document.getElementById('plug-activity-live');
  if (liveDot) liveDot.classList.toggle('active', a.runnerStatus === 'running');
}

async function refreshWorkspaceStats(accountId) {
  workspace = await api('/api/plugging/workspace');
  renderAccountList();
  updateAccountStats(accountId);
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
  const src = workspace.maxSourcesLabel || workspace.maxSources;
  const dst = workspace.maxDestinationsLabel || workspace.maxDestinations;
  const exp = workspace.expiresAt
    ? ` · expires ${new Date(workspace.expiresAt).toLocaleDateString()}`
    : (workspace.isMaster ? ' · no expiry' : '');
  const pri = workspace.priority ? ' · Priority' : '';
  document.getElementById('plan-info').textContent =
    `${workspace.planName} · ${src} account(s) · ${dst} groups each${pri}${exp}`;
  renderAccountList();
  if (selectedId) renderAccountDetail(selectedId);
  else renderEmptyDetail();
}

function readConfigForm() {
  return {
    sourceLink: document.getElementById('cfg-source')?.value?.trim() || '',
    displayName: document.getElementById('cfg-display')?.value?.trim() || '',
    delayMinutes: Number(document.getElementById('cfg-delay')?.value) || 0,
    targetsText: document.getElementById('cfg-targets')?.value || ''
  };
}

function setConfigSaveMessage(text, isError = false) {
  const msg = document.getElementById('cfg-save-msg');
  if (!msg) return;
  msg.hidden = !text;
  msg.textContent = text || '';
  msg.className = isError ? 'plug-form-msg plug-form-error' : 'plug-form-msg plug-form-success';
}

async function saveAccountConfig(id, { silent = false } = {}) {
  const config = readConfigForm();
  try {
    const data = await api(`/api/plugging/workspace/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(config)
    });
    workspace = await api('/api/plugging/workspace');
    renderAccountList();
    updateAccountStats(id);
    const saved = workspace.accounts?.find((x) => x.id === id);
    if (saved) {
      const source = document.getElementById('cfg-source');
      const display = document.getElementById('cfg-display');
      const delay = document.getElementById('cfg-delay');
      const targets = document.getElementById('cfg-targets');
      if (source) source.value = saved.sourceLink || '';
      if (display) display.value = saved.displayName || '';
      if (delay) delay.value = saved.delayMinutes ?? 70;
      if (targets) targets.value = saved.targetsText || '';
    }
    if (!silent) setConfigSaveMessage('Settings saved.');
    return data;
  } catch (e) {
    if (!silent) setConfigSaveMessage(e.message, true);
    throw e;
  }
}

function renderEmptyDetail() {
  stopActivityPoll();
  document.getElementById('account-detail').innerHTML = `
    <div class="plug-empty-detail">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
      <p>Select an account above to configure forwarding and view live activity.</p>
    </div>`;
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
    list.innerHTML = '<li class="plug-account-empty">No accounts yet — add one using the form above.</li>';
    return;
  }
  list.innerHTML = workspace.accounts.map((a) => `
    <li class="plug-account-item ${a.id === selectedId ? 'active' : ''}" data-id="${a.id}">
      <span class="plug-account-dot ${accountDotClass(a)}"></span>
      <div class="plug-account-item-body">
        <strong>${esc(a.label || a.phone || 'Account')}</strong>
        <small>+${esc(a.phone)} · ${a.targetCount} target${a.targetCount !== 1 ? 's' : ''}</small>
      </div>
      <span class="plug-account-status">${esc(a.runnerStatus)}</span>
    </li>`).join('');
  list.querySelectorAll('.plug-account-item').forEach((el) => {
    el.addEventListener('click', () => {
      selectedId = Number(el.dataset.id);
      renderAccountList();
      renderAccountDetail(selectedId);
    });
  });
}

async function submitAddAccount() {
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
    document.getElementById('new-label').value = '';
    msg.hidden = false;
    msg.className = 'plug-form-msg';
    msg.textContent = json.message || 'Code sent — check Telegram.';
    await refreshWorkspace();
  } catch (e) {
    msg.hidden = false;
    msg.className = 'plug-form-msg plug-form-error';
    msg.textContent = e.message;
  }
}

function renderAccountDetail(id) {
  stopActivityPoll();
  const a = workspace.accounts.find((x) => x.id === id);
  const el = document.getElementById('account-detail');
  if (!a) {
    renderEmptyDetail();
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
        ${authed ? `<button type="button" class="btn-primary-platform plug-btn-compact" data-action="start">▶ Start</button>
        <button type="button" class="btn-outline-platform plug-btn-compact" data-action="stop">Stop</button>
        <button type="button" class="btn-outline-platform plug-btn-compact" data-action="test-forward">Test Forward</button>` : ''}
        <button type="button" class="plug-btn plug-btn-danger plug-btn-compact" data-action="delete">Delete</button>
      </div>
    </div>

    ${needsOtp && !authed ? `
    <div class="plug-panel">
      <h3>Telegram Verification</h3>
      <p class="plug-panel-desc">We sent a login code to your Telegram app. Enter it below.</p>
      <div class="plug-otp-row">
        <div class="plug-form-field">
          <label for="otp-code">Code from Telegram</label>
          <input id="otp-code" class="plug-field-input plug-field-mono" placeholder="12345" inputmode="numeric">
        </div>
        <button type="button" class="btn-primary-platform plug-btn-compact" id="verify-otp">Verify</button>
      </div>
      <p id="otp-msg" class="plug-form-msg" hidden></p>
    </div>` : ''}

    ${authed ? `
    <div class="plug-stats">
      <div class="plug-stat"><strong>${a.successCount}</strong><span>Success</span></div>
      <div class="plug-stat"><strong>${a.failedCount}</strong><span>Failed</span></div>
      <div class="plug-stat"><strong>${a.cyclesCount}</strong><span>Cycles</span></div>
    </div>
    <div class="plug-panel">
      <h3>Forwarding Setup</h3>
      <p class="plug-panel-desc">Configure source, targets, and cycle delay — save first, then start.</p>
      <label>Source chat / channel link</label>
      <input id="cfg-source" class="plug-field-input" value="${esc(a.sourceLink)}" placeholder="https://t.me/sourcechannel">
      <label>Your shop / affiliate link</label>
      <input id="cfg-display" class="plug-field-input" value="${esc(a.displayName)}" placeholder="https://loveriette.shop/?ref=yourname">
      <small class="plug-panel-desc" style="display:block;margin-top:0.35rem">All links in forwarded posts are replaced with this URL. Required for your own reseller link.</small>
      <label>Delay between cycles (minutes)</label>
      <input id="cfg-delay" class="plug-field-input" type="number" min="0" value="${a.delayMinutes}" placeholder="3">
      <small class="plug-panel-desc" style="display:block;margin-top:0.35rem">Waits this long after a full cycle before the next post is forwarded. Groups send 3 seconds apart within each cycle.</small>
      <label>Target groups — one link per line</label>
      <textarea id="cfg-targets" class="plug-field-textarea" placeholder="https://t.me/yourgroup1\nhttps://t.me/yourgroup2">${esc(a.targetsText)}</textarea>
      <div class="plug-config-actions">
        <button type="button" class="btn-primary-platform plug-btn-compact" data-action="save-config">Save Settings</button>
      </div>
      <p id="cfg-save-msg" class="plug-form-msg" hidden></p>
      ${a.lastError ? `<p class="plug-last-error">Last error: ${esc(a.lastError)}</p>` : ''}
    </div>
    <div class="plug-panel plug-activity-panel">
      <div class="plug-activity-head">
        <div>
          <h3>Live Activity</h3>
          <p class="plug-panel-desc">Real-time log — complete forwards, errors, and status.</p>
        </div>
        <div class="plug-activity-head-actions">
          <span class="plug-activity-live ${a.runnerStatus === 'running' ? 'active' : ''}" id="plug-activity-live">
            <span class="plug-activity-live-dot"></span> Live
          </span>
          <button type="button" class="btn-outline-platform plug-btn-sm" data-action="clear-activity">Clear</button>
        </div>
      </div>
      <div class="plug-activity-wrap">
        <p id="plug-activity-empty" class="plug-activity-empty">No activity yet. Start the forwarder to see live logs.</p>
        <div id="plug-activity-feed" class="plug-activity-feed"></div>
      </div>
    </div>` : (!needsOtp ? `
    <div class="plug-panel"><p class="plug-panel-desc" style="margin:0">Waiting for Telegram verification…</p></div>` : '')}
  `;

  el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm('Delete this account?')) return;
    stopActivityPoll();
    await api(`/api/plugging/workspace/accounts/${id}`, { method: 'DELETE' });
    selectedId = null;
    await refreshWorkspace();
  });

  el.querySelector('[data-action="save-config"]')?.addEventListener('click', async () => {
    try {
      await saveAccountConfig(id);
    } catch (_) { /* message shown */ }
  });

  el.querySelector('[data-action="start"]')?.addEventListener('click', async () => {
    try {
      setConfigSaveMessage('');
      const config = readConfigForm();
      await api(`/api/plugging/workspace/accounts/${id}/start`, {
        method: 'POST',
        body: JSON.stringify(config)
      });
      await refreshWorkspace();
      startActivityPoll(id);
    } catch (e) {
      setConfigSaveMessage(e.message, true);
    }
  });

  el.querySelector('[data-action="stop"]')?.addEventListener('click', async () => {
    await api(`/api/plugging/workspace/accounts/${id}/stop`, { method: 'POST' });
    await refreshWorkspace();
    loadActivity(id, true);
  });

  el.querySelector('[data-action="test-forward"]')?.addEventListener('click', async () => {
    const btn = el.querySelector('[data-action="test-forward"]');
    try {
      setConfigSaveMessage('');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Testing…';
      }
      const config = readConfigForm();
      await api(`/api/plugging/workspace/accounts/${id}/test-forward`, {
        method: 'POST',
        body: JSON.stringify(config)
      });
      setConfigSaveMessage('Test forward sent — check Live Activity below.');
      await refreshWorkspace();
      startActivityPoll(id);
    } catch (e) {
      setConfigSaveMessage(e.message, true);
      loadActivity(id, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Test Forward';
      }
    }
  });

  el.querySelector('[data-action="clear-activity"]')?.addEventListener('click', async () => {
    await api(`/api/plugging/workspace/accounts/${id}/activity`, { method: 'DELETE' });
    activityLastId = 0;
    const feed = document.getElementById('plug-activity-feed');
    if (feed) feed.innerHTML = '';
    const empty = document.getElementById('plug-activity-empty');
    if (empty) empty.hidden = false;
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
      msg.className = 'plug-form-msg plug-form-error';
      msg.textContent = e.message;
    }
  });

  if (authed) startActivityPoll(id);
}

async function refreshWorkspace() {
  workspace = await api('/api/plugging/workspace');
  renderAccountList();
  if (selectedId) renderAccountDetail(selectedId);
  else renderEmptyDetail();
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

document.getElementById('add-account-btn').addEventListener('click', submitAddAccount);

document.getElementById('logout-btn').addEventListener('click', async () => {
  stopActivityPoll();
  await api('/api/plugging/workspace/logout', { method: 'POST' });
  location.reload();
});

tryLoadWorkspace();
