/** Run fn when DOM is ready — defined first so sync body scripts can use it immediately. */
window.domReady = window.onPageReady = function domReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
};

/** Lightweight in-memory API cache with TTL */
const ApiCache = (() => {
  const store = new Map();
  const DEFAULT_TTL = 45000;

  function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) { store.delete(key); return null; }
    return entry.data;
  }

  function set(key, data, ttl = DEFAULT_TTL) {
    store.set(key, { data, expires: Date.now() + ttl });
  }

  async function fetchJson(url, options = {}, ttl = DEFAULT_TTL) {
    const cacheKey = `${options.method || 'GET'}:${url}`;
    if (!options.method || options.method === 'GET') {
      const cached = get(cacheKey);
      if (cached) return cached;
    }
    const res = await fetch(url, { credentials: 'include', ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    if (!options.method || options.method === 'GET') set(cacheKey, data, ttl);
    return data;
  }

  function invalidate(prefix) {
    for (const key of store.keys()) {
      if (key.includes(prefix)) store.delete(key);
    }
  }

  return { get, set, fetchJson, invalidate };
})();

window.ApiCache = ApiCache;
