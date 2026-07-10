/** Per-game pretty URLs — /riette.wheel, /riette.scratch, etc. */
(function () {
  const GAME_TYPES = ['wheel', 'scratch', 'mystery', 'dice', 'pick', 'vault'];
  const PATHS = Object.fromEntries(GAME_TYPES.map((t) => [t, `/riette.${t}`]));

  function gamePagePath(type) {
    return PATHS[type] || `/riette.${type}`;
  }

  function gameTypeFromPagePath(pathname) {
    const path = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/';
    for (const [type, route] of Object.entries(PATHS)) {
      if (route === path) return type;
    }
    return null;
  }

  function gameTypeFromHash() {
    const hash = window.location.hash.replace('#', '');
    if (!hash.startsWith('game-')) return null;
    const type = hash.slice(5);
    return PATHS[type] ? type : null;
  }

  function resolveFocusedGameType() {
    return gameTypeFromPagePath(window.location.pathname) || gameTypeFromHash();
  }

  window.GAME_PAGE_PATHS = PATHS;
  window.gamePagePath = gamePagePath;
  window.gameTypeFromPagePath = gameTypeFromPagePath;
  window.resolveFocusedGameType = resolveFocusedGameType;
})();
