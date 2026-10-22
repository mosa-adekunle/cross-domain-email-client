import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const raw = 'From: sender@example.net\r\nTo: support@example.com\r\nSubject: Example\r\n\r\nHello\r\n';
const createMessage = (to = 'support@example.com') => ({
  from: 'sender@example.net',
  to,
  rawSize: new TextEncoder().encode(raw).length,
  raw: new Blob([raw]).stream(),
  rejected: null,
  setReject(reason) { this.rejected = reason; },
});

test('stores raw MIME bytes and envelope recipient before returning', async () => {
  let saved;
  const message = createMessage('SUPPORT@Example.com');
  await worker.email(message, {
    ALLOWED_RECIPIENTS: 'support@example.com',
    MAIL_ARCHIVE: {
      async put(key, stream, metadata) {
        saved = { key, data: await new Response(stream).text(), metadata };
        return { key };
      },
    },
  });
  assert.equal(saved.data, raw);
  assert.match(saved.key, /^incoming\/v2\/\d{4}\/\d{2}\/\d{2}\/\d{17}-[0-9a-f-]+\.eml$/);
  assert.equal(saved.metadata.customMetadata.recipient, 'support@example.com');
  assert.equal(saved.metadata.httpMetadata.contentType, 'message/rfc822');
  assert.equal(message.rejected, null);
});

test('fail-closed without an allowlist', async () => {
  const message = createMessage();
  await worker.email(message, { ALLOWED_RECIPIENTS: '', MAIL_ARCHIVE: { put() { throw Error('should not write'); } } });
  assert.match(message.rejected, /not configured/);
});

test('rejects unlisted recipients', async () => {
  const message = createMessage('other@example.com');
  await worker.email(message, { ALLOWED_RECIPIENTS: 'support@example.com', MAIL_ARCHIVE: { put() { throw Error('should not write'); } } });
  assert.ok(message.rejected);
});

test('storage errors propagate rather than being accepted', async () => {
  const message = createMessage();
  await assert.rejects(worker.email(message, {
    ALLOWED_RECIPIENTS: 'support@example.com',
    MAIL_ARCHIVE: { put: async () => { throw new Error('R2 unavailable'); } },
  }), /R2 unavailable/);
  assert.equal(message.rejected, null);
});

test('over-size mail is rejected before attempting R2 writes', async () => {
  const message = createMessage();
  message.rawSize = 25 * 1024 * 1024 + 1;
  await worker.email(message, {
    ALLOWED_RECIPIENTS: 'support@example.com',
    MAIL_ARCHIVE: { put: async () => { throw new Error('should not write'); } },
  });
  assert.match(message.rejected, /size/);
});

test('uses a fixed-length stream for R2 and preserves all MIME bytes', async () => {
  const previous = globalThis.FixedLengthStream;
  let chosenLength = null;
  let saved;
  globalThis.FixedLengthStream = class {
    constructor(length) {
      chosenLength = length;
      const stream = new TransformStream();
      this.readable = stream.readable;
      this.writable = stream.writable;
    }
  };
  try {
    const message = createMessage();
    await worker.email(message, {
      ALLOWED_RECIPIENTS: 'support@example.com',
      MAIL_ARCHIVE: {
        async put(key, bytes, options) {
          saved = { key, data: await new Response(bytes).text(), options };
          return { key };
        },
      },
    });
    assert.equal(chosenLength, message.rawSize);
    assert.equal(saved.data, raw);
    assert.equal(saved.options.customMetadata.recipient, 'support@example.com');
  } finally {
    if (previous === undefined) delete globalThis.FixedLengthStream;
    else globalThis.FixedLengthStream = previous;
  }
});

test('rejects an inconsistent byte count before writing to R2 in fallback mode', async () => {
  const message = createMessage();
  message.rawSize++;
  const oldLog = console.error;
  console.error = () => {};
  try {
    await assert.rejects(worker.email(message, {
      ALLOWED_RECIPIENTS: 'support@example.com',
      MAIL_ARCHIVE: { put() { throw Error('should not write'); } },
    }), /byte count mismatch/);
  } finally { console.error = oldLog; }
});


test('uses sortable timestamp keys for the checkpointed importer', async () => {
  const message = createMessage();
  let key;
  await worker.email(message, {
    ALLOWED_RECIPIENTS: 'support@example.com',
    MAIL_ARCHIVE: { async put(k) { key = k; return { key: k }; } },
  });
  assert.match(key, /^incoming\/v2\/\d{4}\/\d{2}\/\d{2}\/\d{17}-[0-9a-f-]+\.eml$/);
});

test('archives and then forwards legal mail to the verified legacy destination', async () => {
  const events = [];
  const message = createMessage('LEGAL@receiptboss.ca');
  message.forward = async (destination) => {
    events.push('forward:' + destination);
  };
  await worker.email(message, {
    ALLOWED_RECIPIENTS: 'legal@receiptboss.ca',
    LEGACY_FORWARD_RECIPIENTS: 'legal@receiptboss.ca,privacy@receiptboss.ca',
    LEGACY_FORWARD_DESTINATION: 'verified@example.net',
    MAIL_ARCHIVE: {
      async put() { events.push('archive'); return { key: 'archived' }; },
    },
  });
  assert.deepEqual(events, ['archive', 'forward:verified@example.net']);
});

test('does not forward new addresses or the existing test mailbox', async () => {
  for (const recipient of ['sales@receiptboss.ca', 'inbox-test@receiptboss.ca']) {
    const message = createMessage(recipient);
    let forwarded = false;
    message.forward = async () => { forwarded = true; };
    await worker.email(message, {
      ALLOWED_RECIPIENTS: recipient,
      LEGACY_FORWARD_RECIPIENTS: 'legal@receiptboss.ca,privacy@receiptboss.ca',
      MAIL_ARCHIVE: { async put() { return { key: 'archived' }; } },
    });
    assert.equal(forwarded, false);
  }
});

test('fails closed for legacy forwarding when destination is missing', async () => {
  const message = createMessage('privacy@receiptboss.ca');
  message.forward = async () => { throw Error('Should not forward'); };
  await assert.rejects(worker.email(message, {
    ALLOWED_RECIPIENTS: 'privacy@receiptboss.ca',
    LEGACY_FORWARD_RECIPIENTS: 'privacy@receiptboss.ca',
    MAIL_ARCHIVE: { async put() { throw Error('Should not archive'); } },
  }), /Verified legacy forwarding destination is not configured/);
});

test('propagates forwarding failures after archiving without reporting success', async () => {
  const message = createMessage('legal@receiptboss.ca');
  message.forward = async () => { throw new Error('Forward rejected by provider'); };
  let archived = false;
  await assert.rejects(worker.email(message, {
    ALLOWED_RECIPIENTS: 'legal@receiptboss.ca',
    LEGACY_FORWARD_RECIPIENTS: 'legal@receiptboss.ca',
    LEGACY_FORWARD_DESTINATION: 'verified@example.net',
    MAIL_ARCHIVE: { async put() { archived = true; return { key: 'archived' }; } },
  }), /Forward rejected by provider/);
  assert.equal(archived, true);
});

test('does not attempt forwarding when archiving fails', async () => {
  const message = createMessage('legal@receiptboss.ca');
  let attempted = false;
  message.forward = async () => { attempted = true; };
  const saved = console.error;
  console.error = () => {};
  try {
    await assert.rejects(worker.email(message, {
      ALLOWED_RECIPIENTS: 'legal@receiptboss.ca',
      LEGACY_FORWARD_RECIPIENTS: 'legal@receiptboss.ca',
      LEGACY_FORWARD_DESTINATION: 'verified@example.net',
      MAIL_ARCHIVE: { async put() { throw new Error('R2 unavailable'); } },
    }), /R2 unavailable/);
    assert.equal(attempted, false);
  } finally {
    console.error = saved;
  }
});

test('accepts new local parts at every approved domain and archives the true envelope recipient', async () => {
  const domains = ['receiptboss.ca', 'santasbag.ca', 'madenorth.dev', 'madekunle.com', 'delishearsentertainment.com'];
  for (const domain of domains) {
    const recipient = 'Unexpected+Alias@' + domain.toUpperCase();
    const message = createMessage(recipient);
    let metadata;
    await worker.email(message, {
      ALLOWED_DOMAINS: domains.join(','),
      MAIL_ARCHIVE: {
        async put(_key, _stream, options) {
          metadata = options.customMetadata;
          return { key: 'stored' };
        },
      },
    });
    assert.equal(message.rejected, null);
    assert.equal(metadata.recipient, 'unexpected+alias@' + domain);
  }
});

test('does not accept unknown recipients outside exact owned domain list', async () => {
  for (const recipient of [
    'info@unowned.example', 'mail@fake-receiptboss.ca',
    'mail@sub.madenorth.dev', 'mail@madenorth.dev.attacker.test',
    'missing-at', 'a@@receiptboss.ca', 'space address@receiptboss.ca',
  ]) {
    const message = createMessage(recipient);
    await worker.email(message, {
      ALLOWED_DOMAINS: 'receiptboss.ca,santasbag.ca,madenorth.dev,madekunle.com,delishearsentertainment.com',
      MAIL_ARCHIVE: { put() { throw new Error('Unauthorized recipient must not be stored'); } },
    });
    assert.match(message.rejected || '', /not configured/, recipient);
  }
});

test('catch-all messages do not accidentally inherit Gmail forwarding', async () => {
  const message = createMessage('other@receiptboss.ca');
  let forwarded = false;
  message.forward = async () => { forwarded = true; };
  await worker.email(message, {
    ALLOWED_DOMAINS: 'receiptboss.ca',
    LEGACY_FORWARD_RECIPIENTS: 'privacy@receiptboss.ca,legal@receiptboss.ca',
    LEGACY_FORWARD_DESTINATION: 'verified@example.net',
    MAIL_ARCHIVE: { async put() { return { key: 'stored' }; } },
  });
  assert.equal(forwarded, false);
});
