import React, { useEffect, useRef, useState } from 'react';

// Load the PDF parser only when someone actually opens a PDF preview.
const PdfAttachmentPreview = React.lazy(() => import('./PdfAttachmentPreview.jsx'));

export default function MessageReader({ messageId, csrf, onBack, onExpired, onReply, onRead }) {
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [attachmentBusy, setAttachmentBusy] = useState(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [preview, setPreview] = useState(null);
  const previewUrl = useRef(null);
  const inFlight = useRef(null);

  const closePreview = () => {
    inFlight.current?.abort();
    inFlight.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
    setAttachmentBusy(null);
  };

  useEffect(() => {
    return () => {
      inFlight.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  useEffect(() => {
    closePreview();
    setAttachmentError('');
  }, [messageId]);

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  async function getAttachment(file, requestPreview) {
    setAttachmentError('');
    const busyKey = String(file.index) + (requestPreview ? ':preview' : ':download');
    setAttachmentBusy(busyKey);
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const url = '/api/messages/' + encodeURIComponent(messageId) + '/attachments/' + file.index +
        (requestPreview ? '?preview=1' : '');
      const response = await fetch(url, {
        credentials: 'same-origin', cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: requestPreview ? '*/*' : 'application/octet-stream' },
      });
      if (response.status === 401) {
        onExpired();
        throw new Error('Your session expired. Sign in again.');
      }
      if (!response.ok) {
        throw new Error(response.status === 415 ? 'This attachment cannot be previewed safely. Use Download instead.' :
          'Unable to retrieve the attachment. Please try again.');
      }
      const contentType = (response.headers.get('Content-Type') || '').split(';')[0].toLowerCase();
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (!requestPreview) {
        const temporaryUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = temporaryUrl;
        link.download = file.filename || 'attachment';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 30000);
        return;
      }
      const kind = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(contentType) ? 'image'
        : contentType === 'application/pdf' ? 'pdf' : contentType === 'text/plain' ? 'text' : null;
      if (!kind) {
        throw new Error('This attachment cannot be previewed safely. Use Download instead.');
      }
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
      if (kind === 'text') {
        setPreview({ filename: file.filename, kind, text: await blob.text() });
      } else if (kind === 'pdf') {
        // The old blob: iframe was blocked by the site's strict CSP and
        // browser PDF-plugin sandbox. Render bytes locally with PDF.js instead.
        const bytes = await blob.arrayBuffer();
        if (!controller.signal.aborted) {
          setPreview({ filename: file.filename, kind, bytes, file });
        }
      } else {
        const objectUrl = URL.createObjectURL(blob);
        previewUrl.current = objectUrl;
        setPreview({ filename: file.filename, kind, url: objectUrl });
      }
    } catch (err) {
      if (err.name !== 'AbortError') setAttachmentError(err.message || 'Unable to retrieve the attachment.');
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setAttachmentBusy(null);
      }
    }
  }


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
          if (active && update?.ok) onRead?.();
        }
      } catch (err) {
        if (!active) return;
        setError(err.message || 'Unable to load this email.');
        setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [messageId, csrf, onExpired, onRead]);

  const timestamp = message && (message.received_at || message.sent_at || message.created_at);
  const date = timestamp && !Number.isNaN(Date.parse(timestamp))
    ? new Date(timestamp).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
    : '';

  return (
    <section className="panel message-detail" aria-label="Read email">
      <div className="message-toolbar">
        <button type="button" className="message-back" onClick={onBack}>← Back to messages</button>
        <div className="message-toolbar-actions">
          {message && <button type="button" className="message-back" onClick={() => onReply(message)}>↩ Reply</button>}
          {message && <button type="button" className="message-back" onClick={() => onReply(message, true)}>↪ Forward text</button>}
          <span className="setup-status">Private email</span>
        </div>
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
            {message.bcc && message.direction !== 'incoming' && <div><dt>Bcc</dt><dd>{message.bcc}</dd></div>}
            {message.delivery_status && <div><dt>Delivery</dt><dd>{message.delivery_status === 'accepted' ? 'Accepted by outbound provider' : message.delivery_status}</dd></div>}
            <div><dt>Mailbox</dt><dd>{message.mailbox_address}</dd></div>
          </dl>
          <div className="message-body">
            <div className="message-body-heading">Message</div>
            <div className="message-text">{message.body || ((message.attachments || []).length ? 'This message has attachments but no readable text body.' : 'This email has no readable text body.')}</div>
            {message.body_truncated && <p className="message-truncated">Long message shortened for display; the original archived email is intact.</p>}
          </div>
          {(message.attachments || []).length > 0 && (
            <section className="message-attachments" aria-label="Email attachments">
              <h3>Attachments <span>({message.attachments.length})</span></h3>
              <div className="attachment-list">
                {message.attachments.map((file) => (
                  <div className="attachment-item" key={file.index}>
                    <span className="attachment-icon" aria-hidden="true">📎</span>
                    <div className="attachment-information">
                      <strong title={file.filename}>{file.filename}</strong>
                      <small>{file.content_type}{file.size_bytes != null ? ' · ' + (file.size_bytes < 1024 ? file.size_bytes + ' B' : (file.size_bytes / 1024 / 1024 >= 1 ? (file.size_bytes / 1024 / 1024).toFixed(1) + ' MB' : (file.size_bytes / 1024).toFixed(1) + ' KB')) : ''}</small>
                    </div>
                    <div className="attachment-actions">
                      {file.can_preview && <button type="button" onClick={() => getAttachment(file, true)} disabled={attachmentBusy !== null}>
                        {attachmentBusy === file.index + ':preview' ? 'Opening…' : 'Preview'}
                      </button>}
                      <button type="button" onClick={() => getAttachment(file, false)} disabled={attachmentBusy !== null}>
                        {attachmentBusy === file.index + ':download' ? 'Downloading…' : 'Download'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {attachmentError && <p className="attachment-error" role="alert">{attachmentError}</p>}
            </section>
          )}
          <div className="message-view-notice">Files are retrieved privately from the original archived message. Preview is restricted to validated images, PDFs and safe text; other file types are download-only. Only open files you trust.</div>
          {preview && (
            <div className="attachment-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePreview(); }}>
              <div className="attachment-modal" role="dialog" aria-modal="true" aria-label={'Preview ' + preview.filename}>
                <div className="attachment-modal-header">
                  <strong>{preview.filename}</strong>
                  <div className="attachment-modal-header-buttons">
                    {preview.kind === 'pdf' && <button type="button" onClick={() => getAttachment(preview.file, false)} disabled={attachmentBusy !== null}>Download PDF</button>}
                    <button type="button" onClick={closePreview} aria-label="Close attachment preview">Close ×</button>
                  </div>
                </div>
                {preview.kind === 'image' && <div className="attachment-image-wrap"><img src={preview.url} alt={preview.filename} /></div>}
                {preview.kind === 'pdf' && (
                  <React.Suspense fallback={<div className="attachment-pdf-status">Loading PDF viewer…</div>}>
                    <PdfAttachmentPreview bytes={preview.bytes} filename={preview.filename} />
                  </React.Suspense>
                )}
                {preview.kind === 'text' && <pre className="attachment-text-preview">{preview.text}</pre>}
              </div>
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}
