/**
 * Plugging verification solver tests (no Telegram network).
 */
const assert = require('assert');
const {
  solveVerificationText,
  extractButtonAnswer,
  isKnownVerificationButton,
  looksLikeVerificationMessage
} = require('./plugging-verify');

function testMathSolver() {
  assert.strictEqual(solveVerificationText('What is 1+1?'), '2');
  assert.strictEqual(solveVerificationText('1 + 1'), '2');
  assert.strictEqual(solveVerificationText('5 - 2'), '3');
  assert.strictEqual(solveVerificationText('3 x 4'), '12');
  assert.strictEqual(solveVerificationText('Are you a bot?'), 'No');
  assert.strictEqual(solveVerificationText('Are you human?'), 'Yes');
  assert.strictEqual(solveVerificationText('random text'), null);
}

function testButtonAnswerMatchesMath() {
  const markup = {
    rows: [
      { buttons: [{ text: '3' }, { text: '2' }, { text: '5' }] }
    ]
  };
  const answer = extractButtonAnswer(markup, 'What is 2+3?');
  assert.strictEqual(answer?.text, '5');
}

function testButtonAnswerHuman() {
  const markup = {
    rows: [
      { buttons: [{ text: 'I am human' }, { text: 'Bot' }] }
    ]
  };
  const answer = extractButtonAnswer(markup, 'Verify you are human');
  assert.strictEqual(answer?.text, 'I am human');
}

function testUnmuteButtons() {
  assert.strictEqual(isKnownVerificationButton('Unmute me'), true);
  assert.strictEqual(isKnownVerificationButton('Tap to unmute'), true);
  assert.strictEqual(isKnownVerificationButton('✅ Verify'), true);
  assert.strictEqual(isKnownVerificationButton('Hello everyone'), false);

  const unmute = extractButtonAnswer(
    { rows: [{ buttons: [{ text: 'Unmute me' }] }] },
    'Welcome! Tap the button below to unmute yourself.'
  );
  assert.strictEqual(unmute?.text, 'Unmute me');

  const tapUnmute = extractButtonAnswer(
    { rows: [{ buttons: [{ text: 'Tap to unmute' }] }] },
    ''
  );
  assert.strictEqual(tapUnmute?.text, 'Tap to unmute');

  const verify = extractButtonAnswer(
    { rows: [{ buttons: [{ text: '✅ Verify' }, { text: 'Cancel' }] }] },
    'Please verify to join'
  );
  assert.strictEqual(verify?.text, '✅ Verify');
}

function testVerificationContext() {
  assert.strictEqual(looksLikeVerificationMessage('Welcome! Unmute to speak'), true);
  assert.strictEqual(looksLikeVerificationMessage(''), true);
  assert.strictEqual(looksLikeVerificationMessage('Check out our sale today only'), false);

  const skip = extractButtonAnswer(
    { rows: [{ buttons: [{ text: 'Buy now' }] }] },
    'Check out our sale today only'
  );
  assert.strictEqual(skip, null);
}

function main() {
  testMathSolver();
  testButtonAnswerMatchesMath();
  testButtonAnswerHuman();
  testUnmuteButtons();
  testVerificationContext();
  console.log('plugging-verify tests: OK');
}

main();
