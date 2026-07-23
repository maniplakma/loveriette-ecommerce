/**
 * Plugging limits — expiry on first use.
 * Run: node server.js/test-plugging-limits.js
 */
const {
  isOrderExpired,
  isOrderAwaitingActivation,
  computeExpiresAtFromDuration
} = require('./plugging-limits');

let passed = 0;
let failed = 0;

function ok(label) {
  passed += 1;
  console.log(`  OK ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

function main() {
  const awaiting = { status: 'approved', expires_at: null, activated_at: null };
  if (!isOrderExpired(awaiting) && isOrderAwaitingActivation(awaiting)) ok('approved without activation is not expired');
  else fail('awaiting activation');

  const active = {
    status: 'approved',
    activated_at: new Date().toISOString(),
    expires_at: computeExpiresAtFromDuration('7 Days', new Date())
  };
  if (!isOrderExpired(active) && !isOrderAwaitingActivation(active)) ok('activated order with future expiry is valid');
  else fail('activated order');

  const expired = {
    status: 'approved',
    activated_at: '2020-01-01T00:00:00.000Z',
    expires_at: '2020-01-08T00:00:00.000Z'
  };
  if (isOrderExpired(expired)) ok('past expiry is expired');
  else fail('past expiry');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
