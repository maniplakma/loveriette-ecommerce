'use strict';

const GAME_TYPES = ['wheel', 'scratch', 'mystery', 'dice', 'pick', 'vault'];

const RIETTE_GAME_PATHS = Object.freeze(
  Object.fromEntries(GAME_TYPES.map((type) => [type, `/riette.${type}`]))
);

const RIETTE_GAME_ROUTES = Object.freeze(Object.values(RIETTE_GAME_PATHS));

function gameShortPath(type) {
  const key = String(type || '').trim();
  return RIETTE_GAME_PATHS[key] || `/riette.${key}`;
}

function gameTypeFromRiettePath(pathname) {
  const path = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/';
  for (const [type, route] of Object.entries(RIETTE_GAME_PATHS)) {
    if (route === path) return type;
  }
  return null;
}

module.exports = {
  GAME_TYPES,
  RIETTE_GAME_PATHS,
  RIETTE_GAME_ROUTES,
  gameShortPath,
  gameTypeFromRiettePath
};
