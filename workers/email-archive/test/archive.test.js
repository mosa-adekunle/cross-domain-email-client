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
  assert.match(saved.key, /^incoming\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.eml$/);
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
