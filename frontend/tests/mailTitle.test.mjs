import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_BASE_TITLE, mailPageTitle, shouldPulseMailTitle } from '../src/mailTitle.js';

test('Unread mail appears before the brand title', () => {
  assert.equal(mailPageTitle(10), '🔴 (10 new) Mail - Made North Technologies');
  assert.equal(mailPageTitle(1), '🔴 (1 new) Mail - Made North Technologies');
});
test('Zero and invalid counts restore the normal title', () => {
  for (const value of [0, -1, undefined, NaN, 'invalid']) {
    assert.equal(mailPageTitle(value), MAIL_BASE_TITLE);
  }
});

test('The attention marker alternates red and green while keeping the unread count visible', () => {
  assert.equal(mailPageTitle(10, false), '🔴 (10 new) Mail - Made North Technologies');
  assert.equal(mailPageTitle(10, true), '🟢 (10 new) Mail - Made North Technologies');
  assert.equal(mailPageTitle(1, true), '🟢 (1 new) Mail - Made North Technologies');
  assert.equal(mailPageTitle(0, true), MAIL_BASE_TITLE);
});

test('Pulse requires unread mail and respects reduced-motion preferences', () => {
  assert.equal(shouldPulseMailTitle(1), true);
  assert.equal(shouldPulseMailTitle(10, false), true);
  assert.equal(shouldPulseMailTitle(10, true), false);
  assert.equal(shouldPulseMailTitle(0), false);
  assert.equal(shouldPulseMailTitle(-1), false);
  assert.equal(shouldPulseMailTitle(NaN), false);
});
