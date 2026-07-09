/** Persist plugging workspace access key on this device until explicit logout */
const PLUG_KEY_STORAGE = 'loveriette_plug_access_key';

function getStoredPlugKey() {
  try {
    return String(localStorage.getItem(PLUG_KEY_STORAGE) || '').trim();
  } catch (_) {
    return '';
  }
}

function setStoredPlugKey(key) {
  try {
    const trimmed = String(key || '').trim();
    if (trimmed) localStorage.setItem(PLUG_KEY_STORAGE, trimmed);
    else localStorage.removeItem(PLUG_KEY_STORAGE);
  } catch (_) { /* private browsing */ }
}

function clearStoredPlugKey() {
  setStoredPlugKey('');
}

window.getStoredPlugKey = getStoredPlugKey;
window.setStoredPlugKey = setStoredPlugKey;
window.clearStoredPlugKey = clearStoredPlugKey;
