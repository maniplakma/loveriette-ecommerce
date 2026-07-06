async function api(url, options = {}) {

  const res = await fetch(url, {

    ...options,

    headers: {

      'Content-Type': 'application/json',

      ...options.headers

    },

    credentials: 'include'

  });



  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(data.error || 'Request failed');

  return data;

}



function updateAuthUI(user) {

  document.querySelectorAll('.auth-guest').forEach((el) => { el.hidden = !!user; });

  document.querySelectorAll('.auth-user').forEach((el) => { el.hidden = !user; });

  if (typeof setNewBuyer === 'function') setNewBuyer(!user);

  if (typeof ensureAdminLink === 'function') ensureAdminLink(!!user?.isAdmin);

  cleanupDashboardNavLeft();

}



function cleanupDashboardNavLeft() {

  document.querySelectorAll('.nav-left .nav-dashboard').forEach((el) => el.remove());

}

window.cleanupDashboardNavLeft = cleanupDashboardNavLeft;



async function initNav() {

  cleanupDashboardNavLeft();



  const authPromise = api('/auth/me')

    .then(({ user }) => updateAuthUI(user))

    .catch(() => updateAuthUI(null));



  const cartPromise = api('/cart')

    .then((cart) => {

      const cartCountEl = document.querySelector('.cart-count');

      if (cartCountEl) cartCountEl.textContent = cart.count;

    })

    .catch(() => { /* ignore */ });



  await authPromise;



  document.querySelector('.logout-btn')?.addEventListener('click', async () => {

    await api('/auth/logout', { method: 'POST' });

    updateAuthUI(null);

    const cartCountEl = document.querySelector('.cart-count');

    if (cartCountEl) cartCountEl.textContent = '0';

  }, { passive: true });



  document.querySelectorAll('.cart-btn').forEach((btn) => {

    btn.addEventListener('click', () => {

      window.location.href = 'cart.html';

    }, { passive: true });

  });



  if (typeof requestIdleCallback === 'function') {

    requestIdleCallback(() => { cartPromise.catch(() => {}); }, { timeout: 1500 });

  } else {

    cartPromise.catch(() => {});

  }

}



if (document.readyState === 'loading') {

  document.addEventListener('DOMContentLoaded', initNav, { once: true });

} else {

  initNav();

}

