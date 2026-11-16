import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('public Worker configuration does not publish the full mailbox roster', () => {
  const file = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const worker = JSON.parse(file);
  assert.equal(worker.vars.ALLOWED_RECIPIENTS, '', 'owned-domain routing already permits configured addresses');
  assert.ok(!file.includes('hello@madenorth.dev'));
  assert.ok(!file.includes('mosa@madenorth.dev'));
  assert.ok(!file.includes('sales@madenorth.dev'));
  assert.equal(worker.r2_buckets[0].bucket_name, 'cdec-inbound-mail');
  assert.equal(worker.r2_buckets[0].binding, 'MAIL_ARCHIVE');
  assert.deepEqual(worker.vars.ALLOWED_DOMAINS.split(','), [
    'receiptboss.ca', 'santasbag.ca', 'madenorth.dev',
    'madekunle.com', 'delishearsentertainment.com',
  ]);
  // Legacy forwards cannot be changed without verified Cloudflare destination settings.
  assert.equal(worker.vars.LEGACY_FORWARD_RECIPIENTS, 'legal@receiptboss.ca,privacy@receiptboss.ca');
  assert.ok(!Object.hasOwn(worker.vars, 'LEGACY_FORWARD_DESTINATION'), 'Never commit forwarding secrets');
});
