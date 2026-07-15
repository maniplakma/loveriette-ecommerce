let workspace = null;
let selectedId = null;
let pendingOtpAccountId = null;
let activityPollTimer = null;
let joinGroupsPollTimer = null;
let autoStartPollTimer = null;
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

let plugToastTimer = null;

function showPlugToast(message, kind = 'info') {
  const el = document.getElementById('plug-toast');
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
  el.className = `plug-toast plug-toast-${kind}`;
  if (plugToastTimer) clearTimeout(plugToastTimer);
  plugToastTimer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

function setStateBadge(el, { text, state }) {
  if (!el) return;
  el.textContent = text;
  el.className = `plug-state-badge plug-state-${state}`;
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
  renderBatchUpgradeNotice();
  renderJoinGroupsPanel();
  renderAutoStartPanel();
  if (selectedId) renderAccountDetail(selectedId);
  else renderEmptyDetail();
  if (workspace.joinGroups?.running) startJoinGroupsPoll();
  if (workspace.autoStartRunning) startAutoStartPoll();
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

function stopAutoStartPoll() {
  if (autoStartPollTimer) {
    clearInterval(autoStartPollTimer);
    autoStartPollTimer = null;
  }
}

function startAutoStartPoll() {
  stopAutoStartPoll();
  autoStartPollTimer = setInterval(async () => {
    try {
      workspace = await api('/api/plugging/workspace');
      renderAutoStartPanel();
      if (!workspace.autoStartRunning) stopAutoStartPoll();
    } catch (_) { /* ignore */ }
  }, 4000);
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

function renderBatchUpgradeNotice() {
  let el = document.getElementById('plug-batch-upgrade');
  if (!el) {
    el = document.createElement('p');
    el.id = 'plug-batch-upgrade';
    el.className = 'plug-field-hint';
    document.getElementById('plan-info')?.after(el);
  }
  if (!el) return;
  if (workspace?.hasBatchWorkspace) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = 'Auto join groups and Start all are included on VIP+ and Master workspace only.';
}

function renderJoinGroupsPanel() {
  const panel = document.getElementById('plug-join-groups-panel');
  if (!panel || !workspace) return;

  if (!workspace.hasBatchWorkspace) {
    panel.hidden = true;
    return;
  }

  const authedCount = (workspace.accounts || []).filter((a) => a.authStatus === 'authenticated').length;
  panel.hidden = !(workspace.accounts || []).length;

  const input = document.getElementById('join-groups-input');
  const enabledEl = document.getElementById('join-groups-enabled');
  const status = document.getElementById('plug-join-groups-status');
  const runBtn = document.getElementById('join-groups-run-btn');
  const stopBtn = document.getElementById('join-groups-stop-btn');
  const saveBtn = document.getElementById('join-groups-save-btn');
  const completedEl = document.getElementById('join-groups-completed');
  const copyBtn = document.getElementById('join-groups-copy-btn');
  const jg = workspace.joinGroups || {};
  const joinEnabled = jg.enabled !== false;

  if (enabledEl) enabledEl.checked = joinEnabled;
  if (input && document.activeElement !== input) {
    input.value = jg.groupsText || '';
  }

  const completedText = jg.completedText || (jg.completed || []).join('\n');
  if (completedEl && document.activeElement !== completedEl) {
    completedEl.value = completedText;
  }
  if (copyBtn) copyBtn.disabled = !completedText.trim();

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
      status.textContent = 'Join batch in progress — all accounts started';
    } else if ((jg.configured || []).length && (jg.completed || []).length === (jg.configured || []).length && authedCount > 0) {
      status.hidden = false;
      status.textContent = 'All groups joined on all accounts';
    } else {
      status.hidden = true;
      status.textContent = '';
    }
  }

  const joinBadge = document.getElementById('join-groups-state-badge');
  if (jg.running) {
    setStateBadge(joinBadge, { text: 'JOIN: RUNNING', state: 'running' });
  } else if (!joinEnabled) {
    setStateBadge(joinBadge, { text: 'JOIN: OFF', state: 'off' });
  } else {
    setStateBadge(joinBadge, { text: 'JOIN: ON', state: 'on' });
  }

  const hasGroups = String(jg.groupsText || input?.value || '').trim().length > 0;
  if (runBtn) {
    runBtn.disabled = !joinEnabled || authedCount < 1 || !hasGroups || !!jg.running;
    runBtn.title = !joinEnabled
      ? 'Turn on Enable join groups first'
      : (authedCount < 1
        ? 'Log in at least one Telegram account first'
        : (!hasGroups ? 'Add groups to join' : (jg.running ? 'Join batch is running' : '')));
  }
  if (stopBtn) {
    stopBtn.disabled = false;
    stopBtn.title = jg.running ? 'Stop join and turn JOIN off' : 'Turn JOIN off (nothing running)';
  }
  if (saveBtn) saveBtn.disabled = !!jg.running;
  if (input) input.disabled = !joinEnabled;

  const joinHint = document.getElementById('join-groups-run-hint');
  if (joinHint) {
    if (!joinEnabled) {
      joinHint.hidden = false;
      joinHint.textContent = 'Join groups is off — turn on Enable join groups to run again.';
    } else if (jg.running) {
      joinHint.hidden = false;
      joinHint.textContent = 'Join in progress — use Stop join to cancel.';
    } else if (authedCount < 1) {
      joinHint.hidden = false;
      joinHint.textContent = 'Log in at least one Telegram account first.';
    } else if (!hasGroups) {
      joinHint.hidden = false;
      joinHint.textContent = 'Add and save at least one group to join.';
    } else {
      joinHint.hidden = true;
      joinHint.textContent = '';
    }
  }
}

async function setJoinGroupsEnabled(enabled, { notify = true } = {}) {
  const data = await api('/api/plugging/workspace/join-groups', {
    method: 'PUT',
    body: JSON.stringify({ enabled })
  });
  workspace.joinGroups = data.joinGroups;
  renderJoinGroupsPanel();
  if (!enabled) stopJoinGroupsPoll();
  if (notify) {
    const msg = enabled ? 'Join groups is now ON' : 'Join groups is now OFF';
    setJoinGroupsMessage(msg);
    showPlugToast(msg, enabled ? 'on' : 'off');
  }
}

async function saveJoinGroupsList({ silent = false } = {}) {
  const groupsText = document.getElementById('join-groups-input')?.value || '';
  const enabled = !!document.getElementById('join-groups-enabled')?.checked;
  const data = await api('/api/plugging/workspace/join-groups', {
    method: 'PUT',
    body: JSON.stringify({ groupsText, enabled })
  });
  workspace.joinGroups = data.joinGroups;
  renderJoinGroupsPanel();
  if (!silent) {
    const msg = enabled ? 'Group list saved. Join groups is ON.' : 'Join groups is OFF.';
    setJoinGroupsMessage(msg);
    showPlugToast(msg, enabled ? 'on' : 'off');
  }
  if (!enabled || !data.joinGroups?.running) stopJoinGroupsPoll();
}

async function runJoinGroupsAll() {
  if (!document.getElementById('join-groups-enabled')?.checked) {
    throw new Error('Turn on Enable join groups first');
  }
  const data = await api('/api/plugging/workspace/join-groups/run', {
    method: 'POST',
    body: JSON.stringify({})
  });
  workspace.joinGroups = { ...workspace.joinGroups, ...data.joinGroups, running: true };
  renderJoinGroupsPanel();
  const count = data.queued || data.accountIds?.length || 0;
  setJoinGroupsMessage(`All ${count} account(s) started — joining ${data.groupCount || 0} group(s) in parallel.`);
  showPlugToast('Join groups: RUNNING', 'running');
  startJoinGroupsPoll();
}

async function stopJoinGroupsAll() {
  const data = await api('/api/plugging/workspace/join-groups/stop', { method: 'POST' });
  workspace.joinGroups = data.joinGroups;
  if (document.getElementById('join-groups-enabled')) {
    document.getElementById('join-groups-enabled').checked = false;
  }
  renderJoinGroupsPanel();
  const msg = data.wasRunning
    ? 'Join groups stopped and turned OFF.'
    : 'Join groups is now OFF.';
  setJoinGroupsMessage(msg);
  showPlugToast('Join groups: OFF', 'off');
  stopJoinGroupsPoll();
}

async function copyCompletedJoinGroups() {
  const text = document.getElementById('join-groups-completed')?.value?.trim() || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setJoinGroupsMessage('Copied completed groups — paste into Target groups.');
  } catch (_) {
    const el = document.getElementById('join-groups-completed');
    if (el) {
      el.focus();
      el.select();
      setJoinGroupsMessage('Select all and copy manually.');
    }
  }
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

  if (!workspace.hasBatchWorkspace) {
    panel.hidden = true;
    return;
  }

  const authedCount = (workspace.accounts || []).filter((a) => a.authStatus === 'authenticated').length;
  const readyCount = (workspace.accounts || []).filter((a) =>
    a.authStatus === 'authenticated' && a.sourceLink && a.targetCount > 0
  ).length;

  panel.hidden = !(workspace.accounts || []).length;
  const enabled = document.getElementById('autostart-enabled');
  const staggerEnabled = document.getElementById('autostart-stagger-enabled');
  const stagger = document.getElementById('autostart-stagger');
  const staggerField = stagger?.closest('.plug-form-field');
  const daily = document.getElementById('autostart-daily');
  const status = document.getElementById('plug-autostart-status');
  const runBtn = document.getElementById('autostart-run-btn');
  const stopBtn = document.getElementById('autostart-stop-btn');

  const staggerOn = workspace.autoStart?.staggerEnabled !== false;
  if (enabled) enabled.checked = !!workspace.autoStart?.enabled;
  if (staggerEnabled) staggerEnabled.checked = staggerOn;
  if (stagger) {
    stagger.value = workspace.autoStart?.staggerMinutes ?? 10;
    stagger.disabled = !staggerOn;
  }
  if (staggerField) staggerField.classList.toggle('is-disabled', !staggerOn);
  if (daily) daily.value = workspace.autoStart?.dailyAt || '';

  if (status) {
    if (workspace.autoStartRunning) {
      status.hidden = false;
      status.textContent = staggerOn
        ? 'Staggered start in progress…'
        : 'Starting all accounts (no delay)…';
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
    runBtn.title = workspace.autoStartRunning
      ? 'Start-all is already running'
      : (readyCount < 1
        ? 'Each account needs login, post link, and target groups saved'
        : '');
  }
  if (stopBtn) {
    stopBtn.disabled = false;
    stopBtn.title = workspace.autoStartRunning ? 'Stop staggered start-all batch' : 'Stop start-all batch if running';
  }

  const delayBadge = document.getElementById('autostart-delay-badge');
  if (workspace.autoStartRunning) {
    setStateBadge(delayBadge, { text: 'START ALL: RUNNING', state: 'running' });
  } else if (staggerOn) {
    setStateBadge(delayBadge, { text: `DELAY: ON (${workspace.autoStart?.staggerMinutes ?? 10}m)`, state: 'on' });
  } else {
    setStateBadge(delayBadge, { text: 'DELAY: OFF', state: 'off' });
  }

  const runHint = document.getElementById('autostart-run-hint');
  if (runHint) {
    if (workspace.autoStartRunning) {
      runHint.hidden = false;
      runHint.textContent = 'Start-all in progress — use Stop start all to cancel.';
    } else if (authedCount < 1) {
      runHint.hidden = false;
      runHint.textContent = 'Add and verify at least one Telegram account first.';
    } else if (readyCount < 1) {
      runHint.hidden = false;
      runHint.textContent = 'Each account needs a saved post link and at least one target group before Start all.';
    } else {
      runHint.hidden = true;
      runHint.textContent = '';
    }
  }
}

function readAutoStartForm() {
  const staggerEnabled = !!document.getElementById('autostart-stagger-enabled')?.checked;
  return {
    enabled: !!document.getElementById('autostart-enabled')?.checked,
    staggerEnabled,
    staggerMinutes: Number(document.getElementById('autostart-stagger')?.value) || 0,
    dailyAt: document.getElementById('autostart-daily')?.value || ''
  };
}

async function saveAutoStartSettings() {
  const payload = readAutoStartForm();
  const data = await api('/api/plugging/workspace/auto-start', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  workspace.autoStart = data.autoStart;
  workspace.autoStartRunning = data.autoStartRunning;
  renderAutoStartPanel();
  const staggerOn = !!payload.staggerEnabled;
  const msg = staggerOn
    ? `Delay between accounts is ON (${payload.staggerMinutes} min).`
    : 'Delay between accounts is OFF.';
  setAutoStartMessage('Auto-start settings saved. ' + msg);
  showPlugToast(staggerOn ? `DELAY: ON (${payload.staggerMinutes}m)` : 'DELAY: OFF', staggerOn ? 'on' : 'off');
}

async function runAutoStartAll() {
  await saveAutoStartSettings();
  const form = readAutoStartForm();
  const data = await api('/api/plugging/workspace/auto-start/run', {
    method: 'POST',
    body: JSON.stringify({
      staggerEnabled: form.staggerEnabled,
      staggerMinutes: form.staggerMinutes
    })
  });
  workspace.autoStartRunning = true;
  renderAutoStartPanel();
  const count = data.queued || data.accountIds?.length || 0;
  const delay = data.staggerEnabled === false ? 0 : (data.staggerMinutes ?? form.staggerMinutes);
  setAutoStartMessage(
    delay > 0
      ? `Started ${count} account(s) — rotation ${delay} min between each send (account 1 → 2 → … → 1).`
      : `Started ${count} account(s) — no delay between accounts.`
  );
  if (selectedId) startActivityPoll(selectedId);
  startAutoStartPoll();
}

async function stopAutoStartAll() {
  const data = await api('/api/plugging/workspace/auto-start/stop', { method: 'POST' });
  workspace.autoStartRunning = data.autoStartRunning;
  renderAutoStartPanel();
  const msg = data.wasRunning ? 'Start-all batch stopped.' : 'Start-all is not running.';
  setAutoStartMessage(msg);
  showPlugToast('START ALL: OFF', 'off');
  stopAutoStartPoll();
}

async function stopAllForwarding() {
  const data = await api('/api/plugging/workspace/forwarding/stop-all', { method: 'POST' });
  workspace = await api('/api/plugging/workspace');
  renderAccountList();
  renderAutoStartPanel();
  if (selectedId) {
    updateAccountStats(selectedId);
    await loadActivity(selectedId, true);
  }
  const msg = `Stopped forwarding on ${data.stopped || 0} account(s).`;
  setAutoStartMessage(msg);
  showPlugToast('FORWARDING: OFF', 'off');
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
  stopAutoStartPoll();
  if (window.clearStoredPlugKey) clearStoredPlugKey();
  await api('/api/plugging/workspace/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('join-groups-enabled')?.addEventListener('change', async (event) => {
  const enabled = !!event.target?.checked;
  setJoinGroupsMessage('');
  try {
    if (!enabled) {
      await stopJoinGroupsAll();
      return;
    }
    await setJoinGroupsEnabled(true);
  } catch (e) {
    if (event.target) event.target.checked = !enabled;
    setJoinGroupsMessage(e.message, true);
    showPlugToast(e.message, 'off');
    renderJoinGroupsPanel();
  }
});

document.getElementById('join-groups-stop-btn')?.addEventListener('click', async () => {
  setJoinGroupsMessage('');
  try {
    await stopJoinGroupsAll();
  } catch (e) {
    setJoinGroupsMessage(e.message, true);
    showPlugToast(e.message, 'off');
    renderJoinGroupsPanel();
  }
});

document.getElementById('join-groups-copy-btn')?.addEventListener('click', () => {
  copyCompletedJoinGroups().catch((e) => setJoinGroupsMessage(e.message, true));
});

document.getElementById('autostart-stagger-enabled')?.addEventListener('change', async (event) => {
  const staggerOn = !!event.target?.checked;
  renderAutoStartPanel();
  showPlugToast(staggerOn ? 'Account delay: ON (save to keep)' : 'Account delay: OFF (save to keep)', staggerOn ? 'on' : 'off');
});

document.getElementById('autostart-stop-btn')?.addEventListener('click', async () => {
  setAutoStartMessage('');
  try {
    await stopAutoStartAll();
  } catch (e) {
    setAutoStartMessage(e.message, true);
    showPlugToast(e.message, 'off');
    renderAutoStartPanel();
  }
});

document.getElementById('forwarding-stop-all-btn')?.addEventListener('click', async () => {
  setAutoStartMessage('');
  try {
    await stopAllForwarding();
  } catch (e) {
    setAutoStartMessage(e.message, true);
    showPlugToast(e.message, 'off');
  }
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
  } finally {
    renderJoinGroupsPanel();
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
    workspace.autoStartRunning = false;
    stopAutoStartPoll();
  } finally {
    renderAutoStartPanel();
  }
});

bindAccountDetailActions();
initWorkspaceSession();
