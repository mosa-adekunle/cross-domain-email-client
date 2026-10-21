import React, { useEffect, useState } from 'react';

async function call(path, csrf, options = {}) {
  const response = await fetch('/api' + path, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf } : {}), ...options.headers },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fieldError = Object.values(json.errors || {})[0];
    const error = new Error(Array.isArray(fieldError) ? fieldError[0] : json.message || 'Request failed.');
    error.status = response.status;
    error.delivery_status = json.delivery_status;
    throw error;
  }
  return json;
}

function addresses(raw) {
  return raw.split(/[,;\n]+/).map((address) => address.trim()).filter(Boolean);
}

export default function ComposeMail({ csrf, mailboxes, selectedMailbox, draftId, initial, onClose, onSent, onExpired }) {
  const [mailboxId, setMailboxId] = useState(() => initial?.mailbox_id ? String(initial.mailbox_id) : String(selectedMailbox || mailboxes[0]?.id || ''));
  const [to, setTo] = useState(initial?.to || '');
  const [cc, setCc] = useState(initial?.cc || '');
  const [bcc, setBcc] = useState(initial?.bcc || '');
  const [showCc, setShowCc] = useState(Boolean(initial?.cc));
  const [showBcc, setShowBcc] = useState(Boolean(initial?.bcc));
  const [subject, setSubject] = useState(initial?.subject || '');
  const [body, setBody] = useState(initial?.body_text || '');
  const [replyId, setReplyId] = useState(initial?.in_reply_to || '');
  const [savedDraftId, setSavedDraftId] = useState(draftId || null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(Boolean(draftId));
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let active = true;
    call('/outbound/status', csrf).then((data) => { if (active) setStatus(data); })
      .catch((err) => { if (err.status === 401) onExpired(); if (active) setStatus({ configured: false, senders: [] }); });
    if (draftId) {
      call('/messages/' + draftId, csrf).then((data) => {
        if (!active) return;
        const item = data.message;
        if (item.folder !== 'drafts' || item.direction !== 'draft') throw new Error('Draft not found.');
        setMailboxId(String(item.mailbox_id || ''));
        setTo((item.to_addresses || []).join(', '));
        setCc((item.cc_addresses || []).join(', '));
        setBcc((item.bcc_addresses || []).join(', '));
        setShowCc(Boolean(item.cc_addresses?.length));
        setShowBcc(Boolean(item.bcc_addresses?.length));
        setSubject(item.subject || '');
        setBody(item.body || '');
        setReplyId(item.in_reply_to || '');
        setLocked(item.delivery_status !== 'draft');
      }).catch((err) => {
        if (err.status === 401) onExpired();
        if (active) setError(err.message || 'Unable to open the saved draft.');
      }).finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [draftId, csrf, onExpired]);

  const senderOptions = status?.configured
    ? mailboxes.filter((box) => (status.senders || []).some((item) => item.id === box.id))
    : mailboxes;

  useEffect(() => {
    if (senderOptions.length && !senderOptions.some((sender) => String(sender.id) === String(mailboxId))) {
      setMailboxId(String(senderOptions[0].id));
    }
  }, [mailboxId, senderOptions.length]);

  const payload = () => ({
    mailbox_id: Number(mailboxId),
    to: addresses(to), cc: addresses(cc), bcc: addresses(bcc),
    subject, body_text: body, in_reply_to: replyId || null,
  });

  async function saveDraft() {
    const data = await call(savedDraftId ? '/drafts/' + savedDraftId : '/drafts', csrf, {
      method: savedDraftId ? 'PATCH' : 'POST',
      body: JSON.stringify(payload()),
    });
    setSavedDraftId(data.id);
    return data.id;
  }

  async function action(kind) {
    if (busy || loading || locked) return;
    setError('');
    setNote('');
    if (!mailboxId) { setError('Select a sending mailbox.'); return; }
    if (kind === 'send' && addresses(to).length === 0) { setError('Enter at least one recipient.'); return; }
    setBusy(kind);
    try {
      const id = await saveDraft();
      if (kind === 'save') {
        setNote('Draft saved. You can return to it in Drafts.');
        return;
      }
      // The server transitions this draft to "sending" atomically before
      // contacting SMTP, so repeated clicks cannot submit it twice.
      const sent = await call('/drafts/' + id + '/send', csrf, { method: 'POST', body: JSON.stringify({}) });
      setLocked(true);
      onSent(sent);
    } catch (err) {
      if (err.status === 401) onExpired();
      if (err.delivery_status === 'unknown') {
        setLocked(true);
        setError(err.message + ' Do not send another copy until you check the SMTP provider.');
      } else if (err.status === 419) {
        setError('Your session expired. Refresh the page before continuing.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="panel compose-panel" aria-label={draftId ? 'Edit draft' : 'Compose email'} role="dialog" aria-modal="false">
      <header className="compose-header">
        <h2>{draftId ? 'Edit draft' : 'New message'}</h2>
        <button type="button" className="compose-close" onClick={onClose} aria-label="Close compose window" title="Close compose window">×</button>
      </header>
      {loading ? <div className="empty">Loading draft…</div> : (
        <form className="compose-fields" onSubmit={(event) => { event.preventDefault(); action('send'); }}>
          {status && !status.configured && (
            <div className="compose-warning" role="status">Outgoing SMTP is not configured. Drafts can be saved, but sending is disabled until the server has working SMTP credentials.</div>
          )}
          <div className="compose-address-row">
            <label htmlFor="compose-from">From</label>
            <select id="compose-from" value={mailboxId} onChange={(event) => setMailboxId(event.target.value)} disabled={busy || locked} required>
              {!senderOptions.length && <option value="">No configured sender addresses</option>}
              {senderOptions.map((sender) => <option key={sender.id} value={sender.id}>{sender.display_name ? sender.display_name + ' <' + sender.address + '>' : sender.address}</option>)}
            </select>
          </div>
          <div className="compose-address-row compose-to-row">
            <label htmlFor="compose-to">To</label>
            <input id="compose-to" type="text" autoComplete="off" maxLength={7000} placeholder="Recipients" value={to} onChange={(event) => setTo(event.target.value)} disabled={busy || locked} />
            <div className="recipient-toggles">
              {!showCc && <button type="button" onClick={() => setShowCc(true)} disabled={busy || locked}>Cc</button>}
              {!showBcc && <button type="button" onClick={() => setShowBcc(true)} disabled={busy || locked}>Bcc</button>}
            </div>
          </div>
          {showCc && <div className="compose-address-row">
            <label htmlFor="compose-cc">Cc</label>
            <input id="compose-cc" value={cc} placeholder="Recipients" maxLength={7000} onChange={(event) => setCc(event.target.value)} disabled={busy || locked} />
            {!cc && <button type="button" className="recipient-hide" onClick={() => setShowCc(false)} aria-label="Hide Cc field">×</button>}
          </div>}
          {showBcc && <div className="compose-address-row">
            <label htmlFor="compose-bcc">Bcc</label>
            <input id="compose-bcc" value={bcc} placeholder="Hidden recipients" maxLength={7000} onChange={(event) => setBcc(event.target.value)} disabled={busy || locked} />
            {!bcc && <button type="button" className="recipient-hide" onClick={() => setShowBcc(false)} aria-label="Hide Bcc field">×</button>}
          </div>}
          <div className="compose-subject-line">
            <label htmlFor="compose-subject" className="visually-hidden">Subject</label>
            <input id="compose-subject" value={subject} maxLength={998} onChange={(event) => setSubject(event.target.value)} disabled={busy || locked} placeholder="Subject" />
          </div>
          <div className="compose-editor">
            <label htmlFor="compose-body" className="visually-hidden">Message</label>
            <textarea id="compose-body" maxLength={262144} value={body} onChange={(event) => setBody(event.target.value)} disabled={busy || locked} placeholder="Write your message…" />
          </div>
          {error && <div className="form-alert error" role="alert">{error}</div>}
          {note && <div className="form-alert success" role="status">{note}</div>}
          {locked && <div className="compose-warning">This draft was submitted or its delivery status is uncertain. It cannot be submitted again automatically.</div>}
          <div className="compose-footer">
            <div className="compose-actions">
              <button type="submit" className="primary-button" disabled={busy !== '' || locked || !mailboxId || !status?.configured}>{busy === 'send' ? 'Sending…' : 'Send'}</button>
              <button type="button" className="compose-secondary" onClick={() => action('save')} disabled={busy !== '' || locked || !mailboxId}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
            </div>
            <span className="compose-hint">Plain text only · Save drafts before closing</span>
          </div>
        </form>
      )}
    </section>
  );
}
