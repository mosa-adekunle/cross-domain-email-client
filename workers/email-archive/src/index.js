// Archive the original RFC 5322 MIME stream in private R2 before returning.
// No HTTP handler is exported. Email Routing rules are configured separately.
const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

function normalizeAddress(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export default {
  async email(message, env) {
    const recipient = normalizeAddress(message.to);
    const allowed = new Set((env.ALLOWED_RECIPIENTS || '').split(',').map(normalizeAddress).filter(Boolean));

    // Fail closed: an unconfigured Worker must never archive arbitrary mail.
    if (!recipient || !allowed.has(recipient)) {
      message.setReject('Mailbox is not configured for delivery');
      return;
    }

    if (!Number.isSafeInteger(message.rawSize) || message.rawSize < 1 || message.rawSize > MAX_EMAIL_BYTES) {
      message.setReject('Message exceeds the configured size limit');
      return;
    }

    if (!env.MAIL_ARCHIVE || typeof env.MAIL_ARCHIVE.put !== 'function') {
      // Do not accept delivery when durable storage is unavailable.
      throw new Error('R2 archive binding is unavailable');
    }

    const receivedAt = new Date().toISOString();
    const yyyy = receivedAt.slice(0, 4);
    const mm = receivedAt.slice(5, 7);
    const dd = receivedAt.slice(8, 10);
    // Timestamp-ordered V2 keys enable durable StartAfter checkpoints.
    // The legacy UUID layout remains readable by daily reconciliation.
    const timestamp = receivedAt.replace(/[-:.TZ]/g, '');
    const objectKey = `incoming/v2/${yyyy}/${mm}/${dd}/${timestamp}-${crypto.randomUUID()}.eml`;

    // The raw stream must not be decoded into UTF-8 text: email can include
    // binary MIME parts and non-UTF8 encodings.
    const options = {
      httpMetadata: { contentType: 'message/rfc822' },
      customMetadata: {
        recipient,
        envelope_from: normalizeAddress(message.from).slice(0, 320),
        received_at: receivedAt,
      },
    };

    // R2 requires a stream with a known byte length. EmailMessage.raw is an
    // arbitrary ReadableStream, but rawSize provides its exact length.
    // Feed the fixed-length stream and R2 concurrently to avoid deadlocking
    // on backpressure. The bytes are unchanged, including binary MIME parts.
    let stored;
    try {
      if (typeof FixedLengthStream !== 'undefined') {
        const { readable, writable } = new FixedLengthStream(message.rawSize);
        const upload = env.MAIL_ARCHIVE.put(objectKey, readable, options);
        const pipe = message.raw.pipeTo(writable);
        [stored] = await Promise.all([upload, pipe]);
      } else {
        // Bounded fallback for local test runtimes without FixedLengthStream.
        const bytes = await new Response(message.raw).arrayBuffer();
        if (bytes.byteLength !== message.rawSize) throw new Error('Raw MIME byte count mismatch');
        stored = await env.MAIL_ARCHIVE.put(objectKey, bytes, options);
      }
    } catch (error) {
      // Error detail stays in private Worker logs; never log email contents.
      console.error('R2 email archival failed', error);
      throw error;
    }

    if (!stored) throw new Error('R2 archive failed to confirm the write');
    // Success means only that R2 accepted the original MIME object.
    // Laravel imports it asynchronously over R2's S3 API.
  },
};
