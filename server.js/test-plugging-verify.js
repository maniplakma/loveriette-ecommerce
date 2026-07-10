/**
 * Plugging verification solver tests (no Telegram network).
 */
const assert = require('assert');
const { solveVerificationText, extractButtonAnswer } = require('./plugging-verify');

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

function main() {
  testMathSolver();
  testButtonAnswerMatchesMath();
  testButtonAnswerHuman();
  console.log('plugging-verify tests: OK');
}

main();
