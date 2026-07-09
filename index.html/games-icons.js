/* Loveriette games — themed SVG icons */
(function () {
  const stroke = 'currentColor';
  const common = 'fill="none" stroke="' + stroke + '" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

  const ICONS = {
    wheel: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <circle cx="24" cy="24" r="18"/>
      <circle cx="24" cy="24" r="4" fill="currentColor" stroke="none"/>
      <path d="M24 6v6M24 36v6M6 24h6M36 24h6"/>
      <path d="M11 11l4.2 4.2M32.8 32.8l4.2 4.2M37 11l-4.2 4.2M14.2 32.8 10 37"/>
      <path d="M24 10l3 8-8 2 5 6-6-4-6 4 5-6-8-2z" fill="currentColor" stroke="none" opacity=".35"/>
    </svg>`,
    scratch: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <rect x="8" y="12" width="32" height="24" rx="4"/>
      <path d="M8 20h32"/>
      <path d="M16 28h16" stroke-dasharray="3 3"/>
      <circle cx="34" cy="16" r="3" fill="currentColor" stroke="none" opacity=".5"/>
      <path d="M14 16h8"/>
    </svg>`,
    mystery: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <rect x="10" y="20" width="28" height="18" rx="3"/>
      <path d="M10 26h28"/>
      <path d="M24 20V12"/>
      <path d="M18 12h12"/>
      <path d="M24 28v6"/>
      <circle cx="24" cy="31" r="2" fill="currentColor" stroke="none"/>
    </svg>`,
    dice: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <rect x="8" y="14" width="16" height="16" rx="3" transform="rotate(-12 16 22)"/>
      <rect x="24" y="18" width="16" height="16" rx="3" transform="rotate(12 32 26)"/>
      <circle cx="14" cy="20" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="20" cy="26" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="30" cy="24" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="36" cy="30" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="32" cy="34" r="1.5" fill="currentColor" stroke="none"/>
    </svg>`,
    pick: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <rect x="10" y="8" width="18" height="26" rx="3"/>
      <rect x="20" y="14" width="18" height="26" rx="3" opacity=".7"/>
      <path d="M19 18h6M19 24h8M19 30h5"/>
      <path d="M29 22h6M29 28h4"/>
      <path d="M16 8c0-2 2-4 6-4s6 2 6 4" opacity=".6"/>
    </svg>`,
    vault: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <rect x="10" y="18" width="28" height="22" rx="4"/>
      <circle cx="24" cy="29" r="6"/>
      <path d="M24 29v-4"/>
      <path d="M22 29h4"/>
      <path d="M14 18V14a10 10 0 0 1 20 0v4"/>
      <path d="M10 24h-2M40 24h-2"/>
    </svg>`,
    lock: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <rect x="12" y="22" width="24" height="18" rx="3"/>
      <path d="M16 22v-6a8 8 0 0 1 16 0v6"/>
      <circle cx="24" cy="31" r="2" fill="currentColor" stroke="none"/>
    </svg>`,
    cart: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <circle cx="18" cy="38" r="2"/>
      <circle cx="34" cy="38" r="2"/>
      <path d="M8 8h4l3 18h22l4-14H14"/>
    </svg>`,
    user: `<svg viewBox="0 0 48 48" ${common} aria-hidden="true">
      <circle cx="24" cy="16" r="7"/>
      <path d="M10 40c2-8 8-12 14-12s12 4 14 12"/>
    </svg>`
  };

  window.gamesIcon = function gamesIcon(name, className) {
    const svg = ICONS[name] || ICONS.wheel;
    return `<span class="games-icon ${className || ''}" aria-hidden="true">${svg}</span>`;
  };
})();
