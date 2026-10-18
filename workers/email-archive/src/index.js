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

    if (!Number.isFinite(message.rawSize) || message.rawSize > MAX_EMAIL_BYTES) {
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
    const objectKey = `incoming/${yyyy}/${mm}/${dd}/${crypto.randomUUID()}.eml`;

    // The raw stream must not be decoded into UTF-8 text: email can include
    // binary MIME parts and non-UTF8 encodings.
    const stored = await env.MAIL_ARCHIVE.put(objectKey, message.raw, {
      httpMetadata: { contentType: 'message/rfc822' },
      customMetadata: {
        recipient,
        envelope_from: normalizeAddress(message.from).slice(0, 320),
        received_at: receivedAt,
      },
    });

    if (!stored) throw new Error('R2 archive failed to confirm the write');
    // Success means only that R2 accepted the original MIME object.
    // Laravel imports it asynchronously over R2's S3 API.
  },
};
