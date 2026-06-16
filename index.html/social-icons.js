/* Shared social/brand icons. Auto-maps an app name (key) to its logo.
   Used by the buyer Contact page/footer and the admin Social manager. */
(function (global) {
  const S = (paths, fill) =>
    `<svg viewBox="0 0 24 24" width="22" height="22" ${fill ? `fill="currentColor"` : `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`}>${paths}</svg>`;

  const ICONS = {
    telegram: S('<path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.47-2.27 2.19c-.25.25-.46.46-.94.46l.34-4.78 8.7-7.86c.38-.34-.08-.53-.59-.19L7.3 13.1l-4.63-1.45c-1-.32-1.02-1 .21-1.48l18.12-6.98c.84-.31 1.57.2 1.3 1.11z" />', true),
    channel: S('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    email: S('<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'),
    gmail: S('<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'),
    facebook: S('<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>', true),
    messenger: S('<path d="M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.4 5.5 3.7 7.2V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.5 0 10-4.1 10-9.2S17.5 2 12 2zm1 12.4-2.5-2.7-4.9 2.7 5.4-5.7 2.6 2.7 4.8-2.7z"/>', true),
    instagram: S('<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>'),
    twitter: S('<path d="M3 3l7.7 10.3L3.2 21h2.1l6.3-6.8L16.5 21H21l-8.1-10.9L20.4 3h-2.1l-5.9 6.3L7.9 3z"/>', true),
    x: S('<path d="M3 3l7.7 10.3L3.2 21h2.1l6.3-6.8L16.5 21H21l-8.1-10.9L20.4 3h-2.1l-5.9 6.3L7.9 3z"/>', true),
    discord: S('<path d="M19.5 5.3A16 16 0 0 0 15.5 4l-.3.5a12 12 0 0 1 3.4 1.7 11 11 0 0 0-9.3 0A12 12 0 0 1 12.8 4.5L12.5 4a16 16 0 0 0-4 1.3C3.5 10 3 14.6 3.2 19.1A16 16 0 0 0 8 21l1-1.6a9 9 0 0 1-1.7-.8l.4-.3a11 11 0 0 0 8.6 0l.4.3a9 9 0 0 1-1.7.8L16 21a16 16 0 0 0 4.8-1.9c.3-5.2-.6-9.7-1.3-13.8zM9.5 15.5c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7zm5 0c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7z"/>', true),
    whatsapp: S('<path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20zm4.4-5.6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.5 6.5 0 0 1-1.9-1.2 7.2 7.2 0 0 1-1.3-1.7c-.1-.2 0-.4.1-.5l.4-.4.2-.4v-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11 11 0 0 0 4.3 3.8c2 .8 2 .5 2.4.5a2.5 2.5 0 0 0 1.6-1.1 2 2 0 0 0 .1-1.1c0-.1-.2-.2-.4-.3z"/>', true),
    youtube: S('<path d="M22 7.5a3 3 0 0 0-2.1-2.1C18 5 12 5 12 5s-6 0-7.9.4A3 3 0 0 0 2 7.5 31 31 0 0 0 2 12a31 31 0 0 0 .1 4.5 3 3 0 0 0 2.1 2.1C6 19 12 19 12 19s6 0 7.9-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.1-4.5zM10 15V9l5 3z"/>', true),
    tiktok: S('<path d="M16 3c.3 2.2 1.6 3.9 3.8 4.2v2.8a6.8 6.8 0 0 1-3.8-1.2v5.7a5.6 5.6 0 1 1-5.6-5.6c.3 0 .6 0 .9.1v2.9a2.7 2.7 0 1 0 1.9 2.6V3z"/>', true),
    viber: S('<path d="M12 2C6.8 2 3 5.4 3 9.7c0 2.4 1.2 4.6 3.1 6v3.3l3-1.7c.6.1 1.2.2 1.9.2 5.2 0 9-3.4 9-7.7S17.2 2 12 2z"/>', true),
    github: S('<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.300-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.4 4.6-4.6 4.9.3.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/>', true),
    linkedin: S('<path d="M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM10 9h3.8v1.7h.1c.5-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6V21h-4v-5.3c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V21h-4z"/>', true),
    phone: S('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z"/>'),
    website: S('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>'),
    link: S('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>'),
    default: S('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>')
  };

  const ALIASES = {
    tg: 'telegram', mail: 'email', e_mail: 'email', fb: 'facebook',
    ig: 'instagram', insta: 'instagram', tweet: 'twitter', wa: 'whatsapp',
    yt: 'youtube', site: 'website', web: 'website', url: 'link'
  };

  function resolve(key) {
    const k = String(key || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (ICONS[k]) return ICONS[k];
    if (ALIASES[k] && ICONS[ALIASES[k]]) return ICONS[ALIASES[k]];
    for (const name in ICONS) {
      if (name !== 'default' && k.includes(name)) return ICONS[name];
    }
    return ICONS.default;
  }

  global.SOCIAL_ICONS = ICONS;
  global.socialIcon = resolve;
})(window);
