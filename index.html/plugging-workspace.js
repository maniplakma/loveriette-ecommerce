let workspace = null;
let selectedId = null;
let pendingOtpAccountId = null;
let activityPollTimer = null;
let joinGroupsPollTimer = null;
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
    cycle: 'Cycle',
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

async function unlockWithKey(key, { save = true } = {}) {
  const trimmed = String(key || '').trim();
  if (!trimmed) throw new Error('Enter your access key');
  await api('/api/plugging/workspace/unlock', {
    method: 'POST',
    body: JSON.stringify({ accessKey: trimmed })
  });
  if (save && window.setStoredPlugKey) setStoredPlugKey(trimmed);
  return tryLoadWorkspace();
}

async function initWorkspaceSession() {
  if (await tryLoadWorkspace()) return;

  const saved = window.getStoredPlugKey ? getStoredPlugKey() : '';
  if (saved) {
    const input = document.getElementById('access-key-input');
    if (input) input.value = saved;
    try {
      if (await unlockWithKey(saved, { save: true })) return;
    } catch (_) {
      /* saved key invalid or expired — keep prefilled for manual retry */
    }
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

  const loyaltyEl = document.getElementById('loyalty-info');
  if (loyaltyEl) {
    if (workspace.loyalty) {
      loyaltyEl.hidden = false;
      loyaltyEl.textContent = `Loyalty: ₱${Number(workspace.loyalty.balance || 0).toLocaleString()}`;
      loyaltyEl.title = workspace.loyalty.earnRateLabel || '₱1 loyalty credit per ₱200 spent';
    } else {
      loyaltyEl.hidden = true;
    }
  }

  renderAccountList();
  renderJoinGroupsPanel();
  renderAutoStartPanel();
  if (selectedId) renderAccountDetail(selectedId);
  else renderEmptyDetail();
  if (workspace.joinGroups?.running) startJoinGroupsPoll();
}

function readConfigForm() {
  return {
    sourceLink: normalizePostLinkClient(document.getElementById('cfg-source')?.value?.trim() || ''),
    delayMinutes: Number(document.getElementById('cfg-delay')?.value) || 0,
    targetsText: document.getElementById('cfg-targets')?.value || ''
  };
}

function normalizePostLinkClient(link) {
  const raw = String(link || '').trim();
  if (!raw) return '';
  const atSlash = raw.match(/^@([A-Za-z0-9_]+)\/(\d+)$/);
  if (atSlash) return `https://t.me/${atSlash[1]}/${atSlash[2]}`;
  const bareSlash = raw.match(/^([A-Za-z0-9_]+)\/(\d+)$/);
  if (bareSlash) return `https://t.me/${bareSlash[1]}/${bareSlash[2]}`;
  if (/^t\.me\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function stopJoinGroupsPoll() {
  if (joinGroupsPollTimer) {
    clearInterval(joinGroupsPollTimer);
    joinGroupsPollTimer = null;
  }
}

function startJoinGroupsPoll() {
  stopJoinGroupsPoll();
  joinGroupsPollTimer = setInterval(async () => {
    try {
      const data = await api('/api/plugging/workspace/join-groups/status');
      workspace.joinGroups = data;
      renderJoinGroupsPanel();
      if (!data.running) stopJoinGroupsPoll();
    } catch (_) { /* ignore */ }
  }, 4000);
}

function setJoinGroupsMessage(text, isError = false) {
  const msg = document.getElementById('join-groups-msg');
  if (!msg) return;
  msg.hidden = !text;
  msg.textContent = text || '';
  msg.className = isError ? 'plug-form-msg plug-form-error' : 'plug-form-msg plug-form-success';
}

function renderJoinGroupList(el, items, { emptyText, showErrors = false } = {}) {
  if (!el) return;
  if (!items?.length) {
    el.innerHTML = `<li class="plug-join-empty">${esc(emptyText || 'None yet')}</li>`;
    return;
  }
  if (showErrors) {
    el.innerHTML = items.map((item) => {
      if (typeof item === 'string') {
        return `<li>${esc(item)}</li>`;
      }
      const errLines = (item.accounts || [])
        .map((a) => `<li class="plug-join-error-detail">${esc(a.label || a.phone)}: ${esc(a.lastError || 'Failed')} (${a.attempts || 0}/3)</li>`)
        .join('');
      return `<li>${esc(item.groupRef)}</li>${errLines}`;
    }).join('');
    return;
  }
  el.innerHTML = items.map((item) => `<li>${esc(item)}</li>`).join('');
}

function renderJoinGroupsPanel() {
  const panel = document.getElementById('plug-join-groups-panel');
  if (!panel || !workspace) return;

  const authedCount = (workspace.accounts || []).filter((a) => a.authStatus === 'authenticated').length;
  panel.hidden = !(workspace.accounts || []).length;

  const input = document.getElementById('join-groups-input');
  const status = document.getElementById('plug-join-groups-status');
  const runBtn = document.getElementById('join-groups-run-btn');
  const saveBtn = document.getElementById('join-groups-save-btn');
  const jg = workspace.joinGroups || {};

  if (input && document.activeElement !== input) {
    input.value = jg.groupsText || '';
  }

  renderJoinGroupList(
    document.getElementById('join-groups-completed'),
    jg.completed || [],
    { emptyText: 'No completed joins yet' }
  );

  const pendingItems = [];
  for (const ref of jg.pending || []) {
    const err = (jg.errors || []).find((e) => e.groupRef === ref);
    pendingItems.push(err || ref);
  }
  renderJoinGroupList(
    document.getElementById('join-groups-pending'),
    pendingItems,
    { emptyText: 'All configured groups joined', showErrors: true }
  );

  if (status) {
    if (jg.running) {
      status.hidden = false;
      status.textContent = 'Join batch in progress…';
    } else if ((jg.configured || []).length && (jg.completed || []).length === (jg.configured || []).length && authedCount > 0) {
      status.hidden = false;
      status.textContent = 'All groups joined on all accounts';
    } else {
      status.hidden = true;
      status.textContent = '';
    }
  }

  const hasGroups = String(jg.groupsText || input?.value || '').trim().length > 0;
  if (runBtn) {
    runBtn.disabled = authedCount < 1 || !hasGroups || !!jg.running;
    runBtn.title = authedCount < 1
      ? 'Log in at least one Telegram account first'
      : (!hasGroups ? 'Add groups to join' : '');
  }
  if (saveBtn) saveBtn.disabled = !!jg.running;
}

async function saveJoinGroupsList() {
  const groupsText = document.getElementById('join-groups-input')?.value || '';
  const data = await api('/api/plugging/workspace/join-groups', {
    method: 'PUT',
    body: JSON.stringify({ groupsText })
  });
  workspace.joinGroups = data.joinGroups;
  renderJoinGroupsPanel();
  setJoinGroupsMessage('Group list saved.');
}

async function runJoinGroupsAll() {
  const data = await api('/api/plugging/workspace/join-groups/run', {
    method: 'POST',
    body: JSON.stringify({})
  });
  workspace.joinGroups = { ...workspace.joinGroups, ...data.joinGroups, running: true };
  renderJoinGroupsPanel();
  const count = data.queued || data.accountIds?.length || 0;
  setJoinGroupsMessage(`Joining ${data.groupCount || 0} group(s) on ${count} account(s).`);
  startJoinGroupsPoll();
}

function setAutoStartMessage(text, isError = false) {
  const msg = document.getElementById('autostart-msg');
  if (!msg) return;
  msg.hidden = !text;
  msg.textContent = text || '';
  msg.className = isError ? 'plug-form-msg plug-form-error' : 'plug-form-msg plug-form-success';
}

function renderAutoStartPanel() {
  const panel = document.getElementById('plug-autostart-panel');
  if (!panel || !workspace) return;

  const readyCount = (workspace.accounts || []).filter((a) =>
    a.authStatus === 'authenticated' && a.sourceLink && a.targetCount > 0
  ).length;

  panel.hidden = !(workspace.accounts || []).length;
  const enabled = document.getElementById('autostart-enabled');
  const stagger = document.getElementById('autostart-stagger');
  const daily = document.getElementById('autostart-daily');
  const status = document.getElementById('plug-autostart-status');
  const runBtn = document.getElementById('autostart-run-btn');

  if (enabled) enabled.checked = !!workspace.autoStart?.enabled;
  if (stagger) stagger.value = workspace.autoStart?.staggerMinutes ?? 10;
  if (daily) daily.value = workspace.autoStart?.dailyAt || '';

  if (status) {
    if (workspace.autoStartRunning) {
      status.hidden = false;
      status.textContent = 'Staggered start in progress…';
    } else if (workspace.autoStart?.enabled && workspace.autoStart?.dailyAt) {
      status.hidden = false;
      status.textContent = `Daily at ${workspace.autoStart.dailyAt}`;
    } else {
      status.hidden = true;
      status.textContent = '';
    }
  }

  if (runBtn) {
    runBtn.disabled = readyCount < 1 || !!workspace.autoStartRunning;
    runBtn.title = readyCount < 1
      ? 'Each account needs login, post link, and target groups'
      : '';
  }
}

async function saveAutoStartSettings() {
  const payload = {
    enabled: !!document.getElementById('autostart-enabled')?.checked,
    staggerMinutes: Number(document.getElementById('autostart-stagger')?.value) || 0,
    dailyAt: document.getElementById('autostart-daily')?.value || ''
  };
  const data = await api('/api/plugging/workspace/auto-start', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  workspace.autoStart = data.autoStart;
  workspace.autoStartRunning = data.autoStartRunning;
  renderAutoStartPanel();
  setAutoStartMessage('Auto-start settings saved.');
}

async function runAutoStartAll() {
  const staggerMinutes = Number(document.getElementById('autostart-stagger')?.value) || 0;
  const data = await api('/api/plugging/workspace/auto-start/run', {
    method: 'POST',
    body: JSON.stringify({ staggerMinutes })
  });
  workspace.autoStartRunning = true;
  renderAutoStartPanel();
  const count = data.queued || data.accountIds?.length || 0;
  const delay = data.staggerMinutes ?? staggerMinutes;
  setAutoStartMessage(`Starting ${count} account(s) — ${delay} min between each.`);
  if (selectedId) startActivityPoll(selectedId);
  setTimeout(() => refreshWorkspace({ soft: true }).then(renderAutoStartPanel), 4000);
}

function setConfigSaveMessage(text, isError = false) {
  const msg = document.getElementById('cfg-save-msg');
  const banner = document.getElementById('cfg-action-msg');
  if (msg) {
    msg.hidden = !text;
    msg.textContent = text || '';
    msg.className = isError ? 'plug-form-msg plug-form-error' : 'plug-form-msg plug-form-success';
  }
  if (banner) {
    banner.hidden = !text;
    banner.textContent = text || '';
    banner.className = isError ? 'plug-action-msg plug-form-error' : 'plug-action-msg plug-form-success';
  }
}

async function refreshWorkspace({ soft = false } = {}) {
  workspace = await api('/api/plugging/workspace');
  renderAccountList();
  renderJoinGroupsPanel();
  renderAutoStartPanel();
  if (!selectedId) {
    renderEmptyDetail();
    return;
  }
  if (soft) {
    updateAccountStats(selectedId);
    return;
  }
  renderAccountDetail(selectedId);
}

async function startForwarder(accountId) {
  const config = readConfigForm();
  setConfigSaveMessage('');
  await api(`/api/plugging/workspace/accounts/${accountId}`, {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  await api(`/api/plugging/workspace/accounts/${accountId}/start`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  workspace = await api('/api/plugging/workspace');
  renderAccountList();
  updateAccountStats(accountId);
  startActivityPoll(accountId);
  setConfigSaveMessage('Forwarder started.');
}

async function handleAccountDetailAction(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn || btn.disabled || !selectedId) return;

  const action = btn.dataset.action;
  const id = selectedId;

  if (action === 'delete') {
    if (!confirm('Delete this account?')) return;
    stopActivityPoll();
    await api(`/api/plugging/workspace/accounts/${id}`, { method: 'DELETE' });
    selectedId = null;
    await refreshWorkspace();
    return;
  }

  if (action === 'save-config') {
    try {
      await saveAccountConfig(id);
    } catch (_) { /* message shown */ }
    return;
  }

  if (action === 'start') {
    const label = btn.textContent;
    try {
      btn.disabled = true;
      btn.textContent = 'Starting…';
      await startForwarder(id);
    } catch (e) {
      setConfigSaveMessage(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
    return;
  }

  if (action === 'stop') {
    btn.disabled = true;
    try {
      await api(`/api/plugging/workspace/accounts/${id}/stop`, { method: 'POST' });
      workspace = await api('/api/plugging/workspace');
      renderAccountList();
      updateAccountStats(id);
      await loadActivity(id, true);
      setConfigSaveMessage('Forwarder stopped.');
    } catch (e) {
      setConfigSaveMessage(e.message, true);
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (action === 'clear-activity') {
    await api(`/api/plugging/workspace/accounts/${id}/activity`, { method: 'DELETE' });
    activityLastId = 0;
    const feed = document.getElementById('plug-activity-feed');
    if (feed) feed.innerHTML = '';
    const empty = document.getElementById('plug-activity-empty');
    if (empty) empty.hidden = false;
    return;
  }

  if (action === 'verify-otp') {
    const msg = document.getElementById('otp-msg');
    if (msg) msg.hidden = true;
    try {
      await api(`/api/plugging/workspace/accounts/${id}/verify-code`, {
        method: 'POST',
        body: JSON.stringify({ code: document.getElementById('otp-code')?.value || '' })
      });
      pendingOtpAccountId = null;
      await refreshWorkspace();
    } catch (e) {
      if (msg) {
        msg.hidden = false;
        msg.className = 'plug-form-msg plug-form-error';
        msg.textContent = e.message;
      }
    }
  }
}

function bindAccountDetailActions() {
  const root = document.getElementById('account-detail');
  if (!root || root.dataset.actionsBound === '1') return;
  root.dataset.actionsBound = '1';
  root.addEventListener('click', (event) => {
    handleAccountDetailAction(event).catch((err) => {
      setConfigSaveMessage(err.message || 'Action failed', true);
    });
  });
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
      const delay = document.getElementById('cfg-delay');
      const targets = document.getElementById('cfg-targets');
      if (source) source.value = saved.sourceLink || '';
      if (delay) delay.value = saved.delayMinutes ?? 40;
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
        <button type="button" class="plug-btn plug-btn-danger plug-btn-compact" data-action="delete">Delete</button>
      </div>
    </div>
    <p id="cfg-action-msg" class="plug-action-msg" hidden></p>

    ${needsOtp && !authed ? `
    <div class="plug-panel">
      <h3>Telegram Verification</h3>
      <p class="plug-panel-desc">We sent a login code to your Telegram app. Enter it below.</p>
      <div class="plug-otp-row">
        <div class="plug-form-field">
          <label for="otp-code">Code from Telegram</label>
          <input id="otp-code" class="plug-field-input plug-field-mono" placeholder="12345" inputmode="numeric">
        </div>
        <button type="button" class="btn-primary-platform plug-btn-compact" id="verify-otp" data-action="verify-otp">Verify</button>
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
      <label>Post link</label>
      <input id="cfg-source" class="plug-field-input" value="${esc(a.sourceLink)}" placeholder="https://t.me/channel/123">
      <label>Delay between cycles (minutes)</label>
      <input id="cfg-delay" class="plug-field-input" type="number" min="0" value="${a.delayMinutes}" placeholder="40">
      <p class="plug-field-hint">Wait this long after each cycle finishes before plugging again. Save settings, then Start.</p>
      <label>Target groups</label>
      <textarea id="cfg-targets" class="plug-field-textarea" placeholder="@group1&#10;@group2">${esc(a.targetsText)}</textarea>
      <div class="plug-config-actions">
        <button type="button" class="btn-primary-platform plug-btn-compact" data-action="start">Start</button>
        <button type="button" class="btn-outline-platform plug-btn-compact" data-action="stop">Stop</button>
        <button type="button" class="btn-outline-platform plug-btn-compact" data-action="save-config">Save Settings</button>
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

  if (authed) startActivityPoll(id);
}

document.getElementById('unlock-btn').addEventListener('click', async () => {
  const err = document.getElementById('gate-error');
  err.hidden = true;
  try {
    await unlockWithKey(document.getElementById('access-key-input').value, { save: true });
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
  }
});

document.getElementById('add-account-btn').addEventListener('click', submitAddAccount);

document.getElementById('logout-btn').addEventListener('click', async () => {
  stopActivityPoll();
  stopJoinGroupsPoll();
  if (window.clearStoredPlugKey) clearStoredPlugKey();
  await api('/api/plugging/workspace/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('join-groups-save-btn')?.addEventListener('click', async () => {
  setJoinGroupsMessage('');
  const btn = document.getElementById('join-groups-save-btn');
  try {
    if (btn) btn.disabled = true;
    await saveJoinGroupsList();
  } catch (e) {
    setJoinGroupsMessage(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
    renderJoinGroupsPanel();
  }
});

document.getElementById('join-groups-run-btn')?.addEventListener('click', async () => {
  setJoinGroupsMessage('');
  const btn = document.getElementById('join-groups-run-btn');
  try {
    if (btn) btn.disabled = true;
    await runJoinGroupsAll();
  } catch (e) {
    setJoinGroupsMessage(e.message, true);
    renderJoinGroupsPanel();
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('autostart-save-btn')?.addEventListener('click', async () => {
  setAutoStartMessage('');
  const btn = document.getElementById('autostart-save-btn');
  try {
    if (btn) btn.disabled = true;
    await saveAutoStartSettings();
  } catch (e) {
    setAutoStartMessage(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('autostart-run-btn')?.addEventListener('click', async () => {
  setAutoStartMessage('');
  const btn = document.getElementById('autostart-run-btn');
  try {
    if (btn) btn.disabled = true;
    await runAutoStartAll();
  } catch (e) {
    setAutoStartMessage(e.message, true);
    renderAutoStartPanel();
  } finally {
    if (btn) btn.disabled = false;
  }
});

bindAccountDetailActions();
initWorkspaceSession();
