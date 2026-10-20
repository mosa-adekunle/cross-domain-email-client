import React, { useEffect, useState } from 'react';

export default function MessageReader({ messageId, csrf, onBack, onExpired }) {
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setMessage(null);
    setError('');
    setLoading(true);
    async function load() {
      try {
        const response = await fetch('/api/messages/' + messageId, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          if (response.status === 401) onExpired();
          throw new Error(response.status === 404 ? 'Message not found.' : 'Unable to load this email.');
        }
        const payload = await response.json();
        if (!active) return;
        setMessage(payload.message);
        setLoading(false);
        if (!payload.message.is_read) {
          const update = await fetch('/api/messages/' + messageId + '/read', {
            method: 'PATCH',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrf },
          }).catch(() => null);
          if (active && update?.status === 401) onExpired();
        }
      } catch (err) {
        if (!active) return;
        setError(err.message || 'Unable to load this email.');
        setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [messageId, csrf, onExpired]);

  const timestamp = message && (message.received_at || message.sent_at || message.created_at);
  const date = timestamp && !Number.isNaN(Date.parse(timestamp))
    ? new Date(timestamp).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
    : '';

  return (
    <section className="panel message-detail" aria-label="Read email">
      <div className="message-toolbar">
        <button type="button" className="message-back" onClick={onBack}>← Back to messages</button>
        <span className="setup-status">Private email</span>
      </div>
      {loading ? <div className="empty"><p>Loading email…</p></div> : error ? (
        <div className="message-load-error"><div className="form-alert error" role="alert">{error}</div><button type="button" className="message-back" onClick={onBack}>Back to messages</button></div>
      ) : message ? (
        <article>
          <div className="message-detail-heading"><h2>{message.subject || '(no subject)'}</h2><span className="message-detail-date">{date}</span></div>
          <dl className="message-headers">
            <div><dt>From</dt><dd>{message.from || 'Unknown sender'}</dd></div>
            <div><dt>To</dt><dd>{message.to || message.mailbox_address}</dd></div>
            {message.cc && <div><dt>Cc</dt><dd>{message.cc}</dd></div>}
            <div><dt>Mailbox</dt><dd>{message.mailbox_address}</dd></div>
          </dl>
          <div className="message-body">
            <div className="message-body-heading">Message</div>
            <div className="message-text">{message.body || 'This email has no readable text body.'}</div>
            {message.body_truncated && <p className="message-truncated">Long message shortened for display; the original archived email is intact.</p>}
          </div>
          <div className="message-view-notice">HTML-only emails are displayed as text for security. Attachments remain preserved in private storage; attachment viewing is not available yet.</div>
        </article>
      ) : null}
    </section>
  );
}
