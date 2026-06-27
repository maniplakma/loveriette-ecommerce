/**
 * Flirty UI copy site-wide — nav, labels, headings, buttons, placeholders.
 * Skips product names/descriptions and dynamic order data.
 */
(function () {
  const EXACT = {
    'Home': 'Home, love',
    'Products': 'Treats for you',
    'FAQs': 'Got questions, babe?',
    'Guide': 'How to spoil yourself',
    'About Me': 'About Me ♡',
    'About Us': 'About Me ♡',
    'Contact': 'Slide into our DMs',
    'Sign In': 'Come back, babe',
    'Sign Up': 'Join the party ♡',
    'My Account': 'My Account, gorgeous',
    'Logout': 'See you soon, babe',
    'Admin': 'Seller HQ',
    'Cart': 'Your cart, love',
    'Dashboard': 'Your corner, babe',
    'My Purchases': 'Your spoils ♡',
    'Plugging': 'Plugging',
    'Loan': 'Loan',
    'Webtech': 'Web magic',
    'Wallet Activity': 'Wallet vibes',
    'Email Access': 'Email access',
    'Reports & Refunds': 'Reports & refunds',
    'Settings': 'Your settings, babe',
    'Notifications': 'Your pings ♡',
    'Updates': 'What\'s new, love',
    'Chat Seller': 'Chat with us',
    'Vouch Seller': 'Vouch for us ♡',
    'Browse products': 'Browse treats',
    'View All': 'See everything',
    'Recent Activity': 'What you\'ve been up to',
    'No orders yet.': 'Nothing here yet — go spoil yourself ♡',
    'Loading your account…': 'Getting your space ready, babe…',
    'Loading…': 'Just a sec, gorgeous…',
    'Continue Shopping': 'Keep spoiling yourself',
    'Confirm Order': 'Confirm — it\'s yours ♡',
    'Select image...': 'Pick your receipt, babe…',
    'Select image…': 'Pick your receipt, babe…',
    'Submit Payment': 'Send it over, love ♡',
    'Submit Application': 'Send my application ♡',
    'Send Inquiry': 'Slide us a message',
    'Order Now': 'Order now, babe',
    'Add to Cart': 'Add to cart — good taste ♡',
    'Checkout': 'Almost yours ♡',
    'Proceed to Payment': 'Take me to payment',
    'Place Order': 'Make it mine ♡',
    'Back to store': '← Back to the shop, babe',
    'Privacy Policy': 'Privacy — we\'ve got you',
    'Terms of Service': 'Terms — read me, love',
    'Admin Login': 'Seller HQ — sign in, babe',
    'Sign in with your admin account.': 'Welcome back to seller HQ — we missed you.',
    'Login': 'Let me in ♡',
    'Email': 'Your email, gorgeous',
    'Password': 'Your secret',
    'Enter your password': 'Shhh… your password',
    'Admin Panel': 'Seller HQ',
    'Payment Methods': 'How they pay you, babe',
    'Save Instructions': 'Save instructions ♡',
    'Save method': 'Save method',
    'Order not found.': 'Order not found — double-check your link, love.',
    'Order Number': 'Order number',
    'Payment Method': 'How you paid',
    'Subtotal': 'Subtotal',
    'Total': 'Total, babe',
    'Delivery email': 'Sent to',
    'Step 1: pick how you\'ll spoil us': 'Step 1 — pick how you\'ll spoil us ♡',
    'Step 2: show us your receipt': 'Step 2 — show us your receipt, babe',
    'your order': 'your order, love',
    'Thank you for your purchase!': 'Thank you, gorgeous!',
    'Continue Shopping': 'Keep shopping, babe',
    'View My Account': 'Open my account ♡',
    'View order status': 'Check my order',
    'Complete Payment': 'Almost yours — complete payment',
    'Missing order reference.': 'Missing order link — check your URL, babe.',
    'Loan Application': 'Loan application, babe',
    'Fill in your details below. We\'ll review your application shortly.': 'Tell us about yourself, gorgeous — we\'ll review it real soon.',
    'Select a plan': 'Pick a plan, love',
    'All Packages': 'All packages',
    'Send Inquiry': 'Send us a flirty note ♡',
    'Subscribe': 'Subscribe, babe',
    'Check order status': 'Check my order status',
    'Payment tips': 'Payment tips for you, love',
    'Open menu': 'Open menu, babe',
    'Close menu': 'Close menu',
    'Overview': 'The big picture, babe',
    'All Orders': 'Every order, love',
    'Transactions': 'Money moves',
    'Catalog': 'Your catalog, gorgeous',
    'Inventory': 'Stock check',
    'Manage Users': 'Your people',
    'Redeem': 'Redeem codes',
    'Store Updates': 'Store news ♡',
    'Direct Message': 'DM your buyers',
    'Support Tickets': 'Help requests',
    'Product Reports': 'Product flags',
    'Account Settings': 'Account settings, babe',
    'Store Profile': 'Store profile ♡',
    'Site Theme': 'Site vibes',
    'Content (CMS)': 'Content hub',
    'Lending': 'Lending',
    'Website Making': 'Website magic',
    'Platform Analytics': 'The numbers, babe',
    'My Purchases': 'Your spoils ♡',
    'View credentials for your completed orders.': 'Your credentials live here, gorgeous — all yours to claim.',
    'Welcome back,': 'Welcome back,',
    'Transaction History': 'Your money trail',
    'Email Fetcher': 'Email fetcher, babe',
    'How to use Email Fetcher': 'How to use email fetcher',
    'Account Settings': 'Your settings, love',
    'Profile Information': 'About you, gorgeous',
    'Security Settings': 'Keep it safe, babe',
    'Social Links': 'Your socials ♡',
    'Account Preferences': 'Your preferences',
    'Purchase Settings': 'Purchase vibes',
    'Support': 'We\'ve got you',
    'Submit Support Ticket': 'Send us a note, babe',
    'Privacy Policy': 'Privacy — we\'ve got you',
    'Almost yours, babe': 'Almost yours, babe',
    'Complete Payment': 'Complete payment, love',
    'Send payment and show us your receipt — then we\'ll activate your plugging order.': 'Pay up and show us proof, gorgeous — then we activate your order ♡'
  };

  const PLACEHOLDER = {
    'admin@example.com': 'admin@loveriette.com',
    'Enter your password': 'Your secret password, babe',
    'Search…': 'Search for something yummy…',
    'Search...': 'Search for something yummy…'
  };

  const SKIP_SEL = [
    '[data-no-flirt]',
    '.product-logo',
    '.catalog-card-title',
    '.product-about-body',
    '.product-desc',
    '.product-name',
    '.admin-order-row',
    '.admin-seller-name',
    '.price-cell',
    '.order-table',
    '.hero-display',
    '.hero-display-shadow',
    '.hero-display-premiums',
    '.hero-display-script',
    '.brand-wordmark-wrap',
    '.brand-wordmark-front',
    '.brand-wordmark-back',
    '.store-brand-name',
    '.admin-brand-name',
    '.buyer-dash-brand-name',
    '.footer-copy',
    'script', 'style', 'svg', 'code', 'pre',
    'input', 'textarea', 'select', 'option'
  ].join(',');

  function shouldSkip(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.matches?.(SKIP_SEL)) return true;
    if (el.closest?.(SKIP_SEL)) return true;
    return false;
  }

  function flirtExact(text) {
    const trimmed = text.trim();
    if (EXACT[trimmed]) return text.replace(trimmed, EXACT[trimmed]);
    return null;
  }

  function flirtifyElement(el) {
    if (shouldSkip(el)) return;
    if (el.dataset.flirtDone) return;

    if (el.placeholder && PLACEHOLDER[el.placeholder]) {
      el.placeholder = PLACEHOLDER[el.placeholder];
    }

    const tag = el.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(tag)) return;

    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      const next = flirtExact(el.textContent);
      if (next) {
        el.textContent = next;
        el.dataset.flirtDone = '1';
      }
      return;
    }

    el.childNodes.forEach((node) => {
      if (node.nodeType !== 3) return;
      const raw = node.nodeValue;
      if (!raw.trim()) return;
      const next = flirtExact(raw);
      if (next) node.nodeValue = next;
    });

    if (tag === 'BUTTON' || tag === 'A' || tag === 'LABEL' || /^H[1-6]$/.test(tag) || tag === 'P' || tag === 'SPAN' || tag === 'DT' || tag === 'TH') {
      el.dataset.flirtDone = '1';
    }
  }

  function flirtifyTree(root) {
    if (!root || root.nodeType === 11) {
      root?.childNodes?.forEach?.((n) => flirtifyTree(n));
      return;
    }
    if (root.nodeType === 1) {
      if (!shouldSkip(root)) flirtifyElement(root);
      root.querySelectorAll?.(
        'nav a, nav button, .nav-link, .buyer-dash-nav-btn, .buyer-dash-foot-link, ' +
        '.admin-nav-btn, .admin-nav-group, .admin-subtab, ' +
        'button, .btn-primary, .btn-confirm, .btn-upload, .admin-btn, ' +
        'h1, h2, h3, h4, label, p.empty-state, p.dashboard-loading, .upload-section-hint, ' +
        '.upload-confirm-hint, .step-label, .payment-continue-note, .thanks-lead, ' +
        '.admin-login-sub, .admin-panel-card small, .buyer-dash-panel-head p, ' +
        '.platform-section-head p, .plug-flow-sub, .service-hero-flirt-sub, .admin-tab-sub'
      ).forEach(flirtifyElement);
    }
  }

  function init() {
    flirtifyTree(document.body);
    const obs = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 1) flirtifyTree(node);
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.flirtSiteText = { flirtExact, EXACT };
})();
