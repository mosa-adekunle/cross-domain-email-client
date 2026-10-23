import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_BASE_TITLE, mailPageTitle } from '../src/mailTitle.js';

test('Unread mail appears before the brand title', () => {
  assert.equal(mailPageTitle(10), '(10 new) Mail - Made North Technologies');
  assert.equal(mailPageTitle(1), '(1 new) Mail - Made North Technologies');
});
test('Zero and invalid counts restore the normal title', () => {
  for (const value of [0, -1, undefined, NaN, 'invalid']) {
    assert.equal(mailPageTitle(value), MAIL_BASE_TITLE);
  }
});
