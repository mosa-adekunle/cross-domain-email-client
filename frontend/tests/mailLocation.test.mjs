import test from 'node:test';
import assert from 'node:assert/strict';
import { readMailLocation, mailLocationUrl } from '../src/mailLocation.js';

test('defaults to Inbox when folder is missing or invalid', () => {
  assert.equal(readMailLocation('?utm_source=chatgpt.com').folder, 'inbox');
  assert.equal(readMailLocation('?folder=bad').folder, 'inbox');
  assert.equal(readMailLocation('?folder=__proto__').folder, 'inbox');
});

test('restores all mail folders after browser refresh', () => {
  for (const folder of ['inbox', 'sent', 'drafts', 'archive', 'trash', 'settings']) {
    const url = mailLocationUrl('https://mail.madenorth.dev/?utm_source=chatgpt.com', { folder, mailboxId: '' });
    const reloaded = new URL(url, 'https://mail.madenorth.dev');
    assert.equal(readMailLocation(reloaded.search).folder, folder);
    assert.equal(reloaded.searchParams.get('utm_source'), 'chatgpt.com');
  }
});

test('restores the selected mailbox and clears opened message on folder change', () => {
  const url = mailLocationUrl('https://mail.madenorth.dev/?message=17&utm_source=chatgpt.com', {
    folder: 'archive', mailboxId: '2',
  });
  assert.deepEqual(readMailLocation(new URL(url, 'https://mail.madenorth.dev').search), {
    folder: 'archive', mailboxId: '2', messageId: null,
  });
});

test('does not persist malformed mailbox IDs', () => {
  const url = mailLocationUrl('https://mail.madenorth.dev/?mailbox_id=44', {
    folder: 'trash', mailboxId: 'hello<script>',
  });
  assert.equal(new URL(url, 'https://mail.madenorth.dev').searchParams.has('mailbox_id'), false);
  assert.equal(readMailLocation('?mailbox_id=1x&message=abc').mailboxId, '');
});

test('preserves message deep links on initial load and does not lose fragments', () => {
  assert.equal(readMailLocation('?folder=sent&message=17').messageId, '17');
  const result = mailLocationUrl('https://mail.madenorth.dev/?message=17#mail', {
    folder: 'inbox', mailboxId: '',
  });
  assert.equal(result, '/#mail');
});
