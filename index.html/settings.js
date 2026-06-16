let settingsData = null;
let pendingAvatarDataUrl = null;
let removeAvatarFlag = false;

function applyDarkModePreference(_mode) {
  document.documentElement.classList.add('light-mode');
  if (document.body) document.body.classList.add('light-mode');
  try {
    localStorage.setItem('loveriette-theme', 'light');
  } catch (_) { /* ignore */ }
  if (typeof updateThemeMeta === 'function') updateThemeMeta();
}

function setAvatarPreview(url, name) {
  const el = document.getElementById('settings-avatar-preview');
  if (!el) return;
  if (url) {
    el.innerHTML = `<img src="${url}" alt="Avatar" loading="lazy" decoding="async">`;
  } else {
    el.textContent = (name || '?').charAt(0).toUpperCase();
  }
}

function populateSettingsForm(data) {
  settingsData = data;
  const p = data.profile;
  const s = data.security;
  const soc = data.social;
  const pref = data.preferences;
  const pur = data.purchase;

  setAvatarPreview(p.avatarUrl, p.name);
  document.getElementById('settings-name-input').value = p.name || '';
  document.getElementById('settings-username-input').value = p.username || '';
  document.getElementById('settings-email-input').value = p.email || '';
  document.getElementById('settings-phone-input').value = p.phone || '';
  document.getElementById('settings-country-input').value = p.country || '';
  document.getElementById('settings-timezone-input').value = p.timezone || '';
  document.getElementById('settings-created-input').value = formatDate(p.createdAt);

  const loginParts = [];
  if (s.lastLoginAt) loginParts.push(formatDate(s.lastLoginAt));
  if (s.lastLoginIp) loginParts.push(`IP: ${s.lastLoginIp}`);
  document.getElementById('settings-last-login').textContent = loginParts.length
    ? `Last login: ${loginParts.join(' · ')}`
    : 'Last login: —';

  document.getElementById('settings-social-facebook').value = soc.facebook || '';
  document.getElementById('settings-social-instagram').value = soc.instagram || '';
  document.getElementById('settings-social-tiktok').value = soc.tiktok || '';
  document.getElementById('settings-social-twitter').value = soc.twitter || '';
  document.getElementById('settings-social-youtube').value = soc.youtube || '';
  document.getElementById('settings-social-telegram').value = soc.telegram || '';
  document.getElementById('settings-social-discord').value = soc.discord || '';

  document.getElementById('settings-notify-email').checked = !!pref.notifyEmail;
  document.getElementById('settings-notify-orders').checked = !!pref.notifyOrders;
  document.getElementById('settings-notify-marketing').checked = !!pref.notifyMarketing;
  document.getElementById('settings-language').value = pref.language || 'en';

  document.getElementById('settings-total-orders').textContent = pur.totalOrders;
  document.getElementById('settings-completed-orders').textContent = pur.completedOrders;
  document.getElementById('settings-total-spent').textContent = formatMoney(pur.totalSpent);
  document.getElementById('settings-account-status').textContent = pur.accountStatus === 'active' ? 'Active' : 'Suspended';

  const welcome = document.getElementById('dash-welcome-name');
  if (welcome) welcome.textContent = p.name;
}

async function loadSettings() {
  const loading = document.getElementById('settings-loading');
  const content = document.getElementById('settings-content');
  const cached = window.dashboardPurchaseStats;
  if (cached) {
    document.getElementById('settings-total-orders').textContent = cached.totalOrders;
    document.getElementById('settings-completed-orders').textContent = cached.completedOrders;
    document.getElementById('settings-total-spent').textContent = formatMoney(cached.totalSpent);
  }
  try {
    const data = await api('/account/settings');
    populateSettingsForm(data);
    loading.hidden = true;
    content.hidden = false;
  } catch (err) {
    loading.textContent = err.message || 'Could not load settings';
  }
}

async function saveProfile(e) {
  e.preventDefault();
  const body = {
    name: document.getElementById('settings-name-input').value.trim(),
    username: document.getElementById('settings-username-input').value.trim(),
    email: document.getElementById('settings-email-input').value.trim(),
    phone: document.getElementById('settings-phone-input').value.trim(),
    country: document.getElementById('settings-country-input').value.trim(),
    timezone: document.getElementById('settings-timezone-input').value
  };
  if (pendingAvatarDataUrl) body.avatarDataUrl = pendingAvatarDataUrl;
  if (removeAvatarFlag) body.removeAvatar = true;

  try {
    const data = await api('/account/settings/profile', { method: 'PUT', body: JSON.stringify(body) });
    pendingAvatarDataUrl = null;
    removeAvatarFlag = false;
    populateSettingsForm(data);
    if (accountData.user) {
      accountData.user.name = data.profile.name;
      accountData.user.email = data.profile.email;
    }
    showToast('Profile saved');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function savePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('settings-current-password').value;
  const newPassword = document.getElementById('settings-new-password').value;
  const confirmPassword = document.getElementById('settings-confirm-password').value;
  if (!currentPassword || !newPassword || !confirmPassword) {
    showToast('Fill in all password fields', 'error');
    return;
  }
  try {
    const res = await api('/account/settings/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    document.getElementById('settings-current-password').value = '';
    document.getElementById('settings-new-password').value = '';
    document.getElementById('settings-confirm-password').value = '';
    showToast(res.message || 'Password updated');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveSocial(e) {
  e.preventDefault();
  try {
    const data = await api('/account/settings/social', {
      method: 'PUT',
      body: JSON.stringify({
        facebook: document.getElementById('settings-social-facebook').value,
        instagram: document.getElementById('settings-social-instagram').value,
        tiktok: document.getElementById('settings-social-tiktok').value,
        twitter: document.getElementById('settings-social-twitter').value,
        youtube: document.getElementById('settings-social-youtube').value,
        telegram: document.getElementById('settings-social-telegram').value,
        discord: document.getElementById('settings-social-discord').value
      })
    });
    populateSettingsForm(data);
    showToast('Social links saved');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function savePreferences(e) {
  e.preventDefault();
  try {
    const data = await api('/account/settings/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        notifyEmail: document.getElementById('settings-notify-email').checked,
        notifyOrders: document.getElementById('settings-notify-orders').checked,
        notifyMarketing: document.getElementById('settings-notify-marketing').checked,
        language: document.getElementById('settings-language').value,
        darkMode: 'light'
      })
    });
    populateSettingsForm(data);
    applyDarkModePreference('light');
    showToast('Preferences saved');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function logoutAllDevices() {
  if (!confirm('Log out from all other devices?')) return;
  try {
    const res = await api('/account/settings/logout-all', { method: 'POST' });
    showToast(res.message || 'Done');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function bindSettings() {
  document.getElementById('settings-profile-form')?.addEventListener('submit', saveProfile);
  document.getElementById('settings-password-form')?.addEventListener('submit', savePassword);
  document.getElementById('settings-social-form')?.addEventListener('submit', saveSocial);
  document.getElementById('settings-preferences-form')?.addEventListener('submit', savePreferences);
  document.getElementById('settings-logout-all')?.addEventListener('click', logoutAllDevices);

  document.getElementById('settings-avatar-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512000) {
      showToast('Image must be under 500 KB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingAvatarDataUrl = reader.result;
      removeAvatarFlag = false;
      setAvatarPreview(pendingAvatarDataUrl);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('settings-avatar-remove')?.addEventListener('click', () => {
    pendingAvatarDataUrl = null;
    removeAvatarFlag = true;
    setAvatarPreview('', document.getElementById('settings-name-input').value);
  });

  document.getElementById('settings-submit-ticket')?.addEventListener('click', () => {
    document.getElementById('ticket-modal').hidden = false;
  });
  document.getElementById('ticket-modal-close')?.addEventListener('click', () => {
    document.getElementById('ticket-modal').hidden = true;
  });
  document.getElementById('ticket-cancel')?.addEventListener('click', () => {
    document.getElementById('ticket-modal').hidden = true;
  });
  document.getElementById('ticket-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'ticket-modal') document.getElementById('ticket-modal').hidden = true;
  });
  document.getElementById('ticket-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/account/support/ticket', {
        method: 'POST',
        body: JSON.stringify({
          subject: document.getElementById('ticket-subject').value.trim(),
          body: document.getElementById('ticket-body').value.trim()
        })
      });
      document.getElementById('ticket-subject').value = '';
      document.getElementById('ticket-body').value = '';
      document.getElementById('ticket-modal').hidden = true;
      showToast('Ticket submitted');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('settings-report-issue')?.addEventListener('click', () => {
    if (typeof openReportModal === 'function') openReportModal({});
    else switchPanel('active-purchases');
  });
}

bindSettings();
