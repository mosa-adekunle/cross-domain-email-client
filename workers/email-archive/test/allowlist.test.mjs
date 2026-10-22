import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('only explicitly approved recipients plus the existing pilot can be archived', () => {
  const worker = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const recipients = worker.vars.ALLOWED_RECIPIENTS.split(',');
  const expected = [
    'inbox-test@receiptboss.ca',
    'sales@receiptboss.ca', 'legal@receiptboss.ca',
    'privacy@receiptboss.ca', 'hello@receiptboss.ca',
    'sales@santasbag.ca', 'legal@santasbag.ca',
    'privacy@santasbag.ca', 'hello@santasbag.ca',
    'mosa@madenorth.dev', 'hello@madenorth.dev', 'sales@madenorth.dev',
  ];
  assert.deepEqual(recipients, expected);
  assert.equal(new Set(recipients).size, 12);
  assert.ok(recipients.every((address) => !address.includes('*') && address === address.toLowerCase()));
  assert.equal(worker.r2_buckets[0].bucket_name, 'cdec-inbound-mail');
  assert.equal(worker.r2_buckets[0].binding, 'MAIL_ARCHIVE');
  assert.equal(worker.vars.LEGACY_FORWARD_RECIPIENTS, 'legal@receiptboss.ca,privacy@receiptboss.ca');
  assert.ok(!Object.hasOwn(worker.vars, 'LEGACY_FORWARD_DESTINATION'), 'Gmail destination must never be committed');
});
