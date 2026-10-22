import test from 'node:test';
import assert from 'node:assert/strict';
import { messageNavigationHighlight } from '../src/messageHighlight.js';

const folders = [
  { folder: 'inbox', label: 'Unified inbox' },
  { folder: 'sent', label: 'Sent' },
  { folder: 'drafts', label: 'Drafts' },
  { folder: 'archive', label: 'Archive' },
  { folder: 'trash', label: 'Trash' },
];
const mailboxes = [
  { id: 1, address: 'inbox-test@receiptboss.ca' },
  { id: 2, address: 'sales@receiptboss.ca' },
  { id: 3, address: 'hello@receiptboss.ca' },
];

function context(overrides = {}) {
  return {
    openedMessageId: '19',
    messageContext: { id: 19, mailbox_id: 2, mailbox_address: 'sales@receiptboss.ca', folder: 'inbox' },
    activeFolder: 'Unified inbox',
    selectedMailbox: '',
    mailboxes,
    folders,
    ...overrides,
  };
}

test('opening a message from All mailboxes highlights the actual mailbox', () => {
  assert.deepEqual(messageNavigationHighlight(context()), {
    folderLabel: 'Unified inbox',
    mailboxId: '2',
  });
});

test('existing list filter stays selected when no email is open', () => {
  assert.deepEqual(messageNavigationHighlight(context({
    openedMessageId: null,
    selectedMailbox: '',
  })), { folderLabel: 'Unified inbox', mailboxId: '' });
  assert.deepEqual(messageNavigationHighlight(context({
    openedMessageId: null,
    selectedMailbox: '3',
  })), { folderLabel: 'Unified inbox', mailboxId: '3' });
});

test('opening an archived email highlights Archive, not the list’s previous folder', () => {
  assert.deepEqual(messageNavigationHighlight(context({
    messageContext: { id: 19, mailbox_id: 3, mailbox_address: 'hello@receiptboss.ca', folder: 'archive' },
  })), { folderLabel: 'Archive', mailboxId: '3' });
});

test('deep-linked email starts without misleading All mailboxes highlight before loading', () => {
  assert.deepEqual(messageNavigationHighlight(context({ messageContext: null })), {
    folderLabel: 'Unified inbox',
    mailboxId: null,
  });
});

test('stale result for a different message does not highlight the wrong mailbox', () => {
  assert.deepEqual(messageNavigationHighlight(context({
    openedMessageId: '20',
  })), { folderLabel: 'Unified inbox', mailboxId: null });
});

test('mailbox ID is authoritative; address matching handles legacy data safely', () => {
  assert.deepEqual(messageNavigationHighlight(context({
    messageContext: { id: 19, mailbox_id: null, mailbox_address: 'SALES@RECEIPTBOSS.CA', folder: 'inbox' },
  })), { folderLabel: 'Unified inbox', mailboxId: '2' });
});

test('an unrecognized mailbox does not incorrectly select All mailboxes', () => {
  assert.deepEqual(messageNavigationHighlight(context({
    messageContext: { id: 19, mailbox_id: 999, mailbox_address: 'unknown@example.com', folder: 'inbox' },
  })), { folderLabel: 'Unified inbox', mailboxId: null });
});
