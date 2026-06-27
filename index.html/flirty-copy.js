/**
 * Flirty buyer-facing copy — toasts, notifications, and UI hints.
 * Skipped on admin pages. Product names/descriptions are untouched.
 */
(function () {
  const TOAST_MAP = {
    'Order approved!': 'approved, babe — your order is ready ♡',
    'Receipt submitted — awaiting approval': 'got your receipt — we\'ll review it real soon',
    'Order placed — complete your payment': 'almost yours — complete payment when you\'re ready',
    'Added to cart': 'added to cart — good taste ♡',
    'Login successful': 'welcome back, gorgeous',
    'Account registered successfully': 'welcome to loveriette — so glad you\'re here ♡',
    'Order number copied': 'order number copied — paste away, babe',
    'Could not copy': 'couldn\'t copy that — try again, love',
    'Link copied!': 'link copied — share the love ♡',
    'Please select a receipt image before confirming': 'upload your receipt first, babe — we need proof',
    'Only JPG, PNG, WebP, or GIF images are allowed': 'that file won\'t work — use JPG, PNG, WebP, or GIF',
    'Receipt image must be 4MB or smaller': 'that image is too big — keep it under 4MB, love',
    'This order can no longer be confirmed': 'this order is already locked — check your dashboard',
    'Message sent': 'message sent — we\'ll get back to you soon ♡',
    'Profile saved': 'profile updated — looking good',
    'Preferences saved': 'preferences saved — all set, babe',
    'Ticket submitted': 'ticket sent — we\'ve got you',
    'Application submitted!': 'application sent — fingers crossed for you ♡',
    'Inquiry sent! We\'ll contact you soon.': 'inquiry sent — we\'ll reach out soon, babe',
    'Payment failed': 'payment didn\'t go through — try again, love',
    'Select a valid payment method': 'pick a payment method first, babe'
  };

  const NOTIF_STATUS = {
    approved: 'approved — enjoy your premium, babe ♡',
    pending: 'receipt received — hang tight while we review',
    pending_payment: 'waiting on your payment — almost yours',
    rejected: 'order declined — check your dashboard for details',
    refunded: 'refund processed — hope to see you again soon'
  };

  function isAdminContext() {
    return false;
  }

  function toast(message) {
    if (isAdminContext() || !message) return message;
    return TOAST_MAP[message] || message;
  }

  function orderStatus(status) {
    return NOTIF_STATUS[status] || status;
  }

  function orderNotifText(orderLabel, status) {
    const label = orderStatus(status);
    if (status === 'pending_payment') {
      return `complete payment for ${orderLabel} — we're waiting on you, babe`;
    }
    if (status === 'approved') {
      return `${orderLabel} is approved — check your purchases ♡`;
    }
    return `${orderLabel} — ${label}`;
  }

  window.flirtCopy = { toast, orderStatus, orderNotifText, isAdminContext };
})();
