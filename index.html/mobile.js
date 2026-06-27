/**
 * Mobile UX: sidebar backdrops, sticky titles, viewport helpers.
 */
(function () {
  const PANEL_TITLES = {
    dashboard: 'Dashboard',
    'active-purchases': 'My Purchases',
    plugging: 'Plugging',
    loan: 'Loan',
    webtech: 'Webtech',
    wallet: 'Wallet Activity',
    'email-access': 'Email Access',
    reports: 'Reports & Refunds',
    settings: 'Settings',
    notifications: 'Notifications',
    updates: 'Updates',
    'chat-seller': 'Chat Seller',
    'vouch-seller': 'Vouch Seller'
  };

  function closeBuyerSidebar() {
    document.querySelector('.buyer-dash-layout')?.classList.remove('sidebar-open');
  }

  function closeAdminMenu() {
    document.getElementById('admin-shell')?.classList.remove('menu-open');
  }

  function bindBuyerMobile() {
    document.addEventListener('click', (e) => {
      const layout = document.querySelector('.buyer-dash-layout');
      if (!layout?.classList.contains('sidebar-open')) return;
      if (e.target.closest('.buyer-dash-sidebar') || e.target.closest('#buyer-dash-menu-toggle')) return;
      closeBuyerSidebar();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 860) closeBuyerSidebar();
    });
  }

  function bindStorefrontNav() {
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        document.querySelectorAll('.nav-inner.nav-open').forEach((inner) => {
          inner.classList.remove('nav-open');
          const toggle = inner.querySelector('.nav-toggle');
          if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Open menu');
          }
        });
      }
    });
  }

  function bindAdminMobile() {
    document.addEventListener('click', (e) => {
      const shell = document.getElementById('admin-shell');
      if (!shell?.classList.contains('menu-open')) return;
      if (e.target.closest('.admin-sidebar') || e.target.closest('#admin-menu-toggle')) return;
      closeAdminMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 860) closeAdminMenu();
    });
  }

  function patchBuyerSwitchPanel() {
    if (typeof window.switchPanel !== 'function') return;
    const original = window.switchPanel;
    window.switchPanel = function (panelId) {
      original(panelId);
      const stickyTitle = document.getElementById('buyer-dash-sticky-title');
      if (stickyTitle) {
        stickyTitle.textContent = PANEL_TITLES[panelId] || 'Account';
      }
      closeBuyerSidebar();
    };
  }

  function init() {
    bindBuyerMobile();
    bindStorefrontNav();
    bindAdminMobile();
    patchBuyerSwitchPanel();
    const activePanel = document.querySelector('.buyer-dash-nav-btn.active');
    const stickyTitle = document.getElementById('buyer-dash-sticky-title');
    if (activePanel && stickyTitle) {
      stickyTitle.textContent = PANEL_TITLES[activePanel.dataset.panel] || 'Dashboard';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
