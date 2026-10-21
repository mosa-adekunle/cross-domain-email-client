import React, { useCallback, useEffect, useState } from 'react';
import MessageReader from './MessageReader.jsx';
import ComposeMail from './ComposeMail.jsx';

const folders = [
  { label: 'Unified inbox', folder: 'inbox', icon: '▤' },
  { label: 'Sent', folder: 'sent', icon: '↗' },
  { label: 'Drafts', folder: 'drafts', icon: '▱' },
  { label: 'Archive', folder: 'archive', icon: '▣' },
  { label: 'Settings', folder: 'settings', icon: '⚙' },
];

async function api(path, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(`/api${path}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...rest,
    headers: { Accept: 'application/json', ...headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = Object.values(body.errors || {})[0];
    const error = new Error(Array.isArray(firstError) ? firstError[0] : body.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function SetupStatus({ children }) {
  return <span className="setup-status">{children}</span>;
}

function DomainSettings({ domains, mailboxes, refresh, csrf, onExpired }) {
  const [domain, setDomain] = useState('');
  const [localPart, setLocalPart] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [domainId, setDomainId] = useState('');
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (domains.length && !domains.some((item) => String(item.id) === domainId)) {
      setDomainId(String(domains[0].id));
    }
  }, [domains, domainId]);

  async function submit(event, kind) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSaving(kind);
    try {
      const payload = kind === 'domain'
        ? { domain_name: domain }
        : { mail_domain_id: Number(domainId), local_part: localPart, display_name: displayName || null };
      const result = await api(kind === 'domain' ? '/domains' : '/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        body: JSON.stringify(payload),
      });
      if (kind === 'domain') setDomain('');
      else { setLocalPart(''); setDisplayName(''); }
      setSuccess(result.message);
      await refresh();
    } catch (err) {
      if (err.status === 401) onExpired();
      setError(err.status === 419 ? 'Your session expired. Refresh the page and sign in again.' : err.message);
    } finally {
      setSaving('');
    }
  }

  return (
    <div className="settings-layout">
      <section className="settings-card">
        <div className="settings-heading"><h2>Add a domain</h2><SetupStatus>Pending verification</SetupStatus></div>
        <p>Save a domain you control. This does not modify DNS, enable receiving, or prove ownership.</p>
        <form className="setup-form" onSubmit={(event) => submit(event, 'domain')}>
          <label htmlFor="domain-name">Domain name</label>
          <div className="form-line">
            <input id="domain-name" name="domain_name" placeholder="example.com" autoComplete="off" required maxLength={253} value={domain} onChange={(event) => setDomain(event.target.value)} />
            <button type="submit" className="primary-button" disabled={saving !== ''}>{saving === 'domain' ? 'Saving…' : 'Add domain'}</button>
          </div>
        </form>
        <h3>Configured domains ({domains.length})</h3>
        {domains.length === 0 ? <p className="muted">No domains configured yet.</p> : (
          <ul className="configuration-list">
            {domains.map((item) => <li key={item.id}><div><strong>{item.domain_name}</strong><small>{item.mailbox_count} mailbox(es)</small></div><SetupStatus>{item.verification_status === 'verified' ? 'Verified' : 'Pending verification'}</SetupStatus></li>)}
          </ul>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-heading"><h2>Add a mailbox</h2><SetupStatus>Inactive until configured</SetupStatus></div>
        <p>Create an address for an added domain. New mailboxes remain inactive until routing is verified.</p>
        <form className="setup-form" onSubmit={(event) => submit(event, 'mailbox')}>
          <label htmlFor="mailbox-domain">Domain</label>
          <select id="mailbox-domain" required disabled={!domains.length || saving !== ''} value={domainId} onChange={(event) => setDomainId(event.target.value)}>
            {domains.length === 0 && <option value="">Add a domain first</option>}
            {domains.map((item) => <option key={item.id} value={item.id}>{item.domain_name}</option>)}
          </select>
          <label htmlFor="mailbox-name">Email name</label>
          <input id="mailbox-name" placeholder="support" autoComplete="off" required maxLength={64} disabled={!domains.length || saving !== ''} value={localPart} onChange={(event) => setLocalPart(event.target.value)} />
          <label htmlFor="mailbox-display">Display name (optional)</label>
          <input id="mailbox-display" placeholder="Customer Support" maxLength={150} disabled={!domains.length || saving !== ''} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <button type="submit" className="primary-button" disabled={!domains.length || saving !== ''}>{saving === 'mailbox' ? 'Saving…' : 'Add mailbox'}</button>
        </form>
        <h3>Configured mailboxes ({mailboxes.length})</h3>
        {mailboxes.length === 0 ? <p className="muted">No mailboxes configured yet.</p> : (
          <ul className="configuration-list">
            {mailboxes.map((item) => <li key={item.id}><div><strong>{item.address}</strong><small>{item.display_name || 'No display name'}</small></div><SetupStatus>{item.is_active && item.domain_active ? 'Active' : 'Inactive'}</SetupStatus></li>)}
          </ul>
        )}
      </section>
      {error && <div className="form-alert error" role="alert">{error}</div>}
      {success && <div className="form-alert success" role="status">{success}</div>}
      <p className="notice">Adding domains or mailboxes here does not change Cloudflare MX records, create R2 buckets, or send a message. Outbound sending is enabled separately by verified SMTP credentials on the server.</p>
    </div>
  );
}

function MessagesPanel({ folder, mailboxes, selectedMailbox, onExpired, onOpenMessage, onOpenDraft }) {
  const [messages, setMessages] = useState([]);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setPage(1); }, [folder, selectedMailbox]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ folder, page: String(page) });
    if (selectedMailbox) params.set('mailbox_id', String(selectedMailbox));
    api(`/messages?${params.toString()}`).then((data) => {
      if (!active) return;
      setMessages(data.messages || []);
      setPagination(data.pagination || { current_page: 1, last_page: 1, total: 0 });
      setLoading(false);
    }).catch((err) => {
      if (!active) return;
      if (err.status === 401) onExpired();
      setError('Unable to load messages. Please try again.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [folder, selectedMailbox, page, onExpired]);

  return (
    <section className="panel" aria-label="Messages">
      <div className="panel-top"><div><h2>{loading ? 'Loading messages…' : `${pagination.total} message${pagination.total === 1 ? '' : 's'}`}</h2><p>{selectedMailbox ? mailboxes.find((item) => String(item.id) === String(selectedMailbox))?.address : 'All configured mailboxes'} · {folder}</p></div><SetupStatus>Private inbox</SetupStatus></div>
      {error ? <div className="form-alert error" role="alert">{error}</div> : loading ? <div className="empty"><p>Loading your mailbox…</p></div> : messages.length === 0 ? (
        <div className="empty"><div className="empty-icon">✉</div><h3>No messages yet</h3><p>No imported messages in this folder yet.</p></div>
      ) : (
        <>
          <div className="message-list">
            {messages.map((message) => <button key={message.id} type="button" className={`message-row message-row-button ${message.is_read ? '' : 'unread'}`} onClick={() => folder === 'drafts' ? onOpenDraft(message.id) : onOpenMessage(message.id)} aria-label={`Read: ${message.subject || '(no subject)'}`}>
              <span className="message-sender">{folder === 'sent' || folder === 'drafts' ? (message.to_recipients ? 'To: ' + message.to_recipients : '(no recipients)') : (message.from_name || message.from_address || 'Unknown sender')}<small>{message.mailbox_address}</small></span>
              <span className="message-summary"><strong>{message.subject || '(no subject)'}</strong><small>{message.preview_text || (message.delivery_status === 'unknown' ? 'Delivery not confirmed — do not resend automatically' : 'No preview available')}</small></span>
              <time>{message.received_at || message.sent_at ? new Date(message.received_at || message.sent_at).toLocaleDateString() : ''}</time>
            </button>)}
          </div>
          {pagination.last_page > 1 && <div className="pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pagination.last_page}</span><button type="button" disabled={page >= pagination.last_page} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
        </>
      )}
    </section>
  );
}

export default function Workspace({ user, csrf, onLogout, signingOut, onExpired }) {
  const [activeFolder, setActiveFolder] = useState('Unified inbox');
  const [composer, setComposer] = useState(null);
  const [sendNotice, setSendNotice] = useState('');
  const [apiStatus, setApiStatus] = useState({ status: 'checking', database: 'checking' });
  const [domains, setDomains] = useState([]);
  const [mailboxes, setMailboxes] = useState([]);
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [setupError, setSetupError] = useState('');
  const [selectedMailbox, setSelectedMailbox] = useState('');
  const [openedMessageId, setOpenedMessageId] = useState(() => { const id = new URLSearchParams(window.location.search).get('message'); return id && /^[1-9][0-9]*$/.test(id) ? id : null; });

  const refresh = useCallback(async () => {
    try {
      const [domainResult, mailboxResult] = await Promise.all([api('/domains'), api('/mailboxes')]);
      setDomains(domainResult.domains || []);
      setMailboxes(mailboxResult.mailboxes || []);
      setSetupError('');
    } catch (err) {
      if (err.status === 401) onExpired();
      setSetupError('Unable to load configured domains and mailboxes.');
      throw err;
    } finally {
      setLoadingSetup(false);
    }
  }, [onExpired]);

  useEffect(() => {
    api('/status').then(setApiStatus).catch(() => setApiStatus({ status: 'unavailable', database: 'unavailable' }));
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const sync = () => { const id = new URLSearchParams(window.location.search).get('message'); setOpenedMessageId(id && /^[1-9][0-9]*$/.test(id) ? id : null); };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const openMessage = (id) => {
    const url = new URL(window.location.href);
    url.searchParams.set('message', String(id));
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    setOpenedMessageId(String(id));
  };
  const closeMessage = () => {
    if (!openedMessageId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('message');
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    setOpenedMessageId(null);
  };

  const folderInfo = folders.find((item) => item.label === activeFolder);
  const startCompose = (options = {}) => { closeMessage(); setSendNotice(''); setComposer(options); };
  const openReply = (message, forward = false) => {
    const fromMailbox = mailboxes.find((m) => String(m.address).toLowerCase() === String(message.mailbox_address).toLowerCase());
    startCompose({ initial: {
      mailbox_id: fromMailbox?.id || selectedMailbox || mailboxes[0]?.id,
      to: forward ? '' : message.from_address || '',
      subject: (forward ? 'Fwd: ' : 'Re: ') + String(message.subject || '(no subject)').replace(/^(?:Re:\s*|Fwd:\s*)+/i, ''),
      body_text: '\n\n---- Original message ----\nFrom: ' + (message.from || '') + '\nDate: ' + (message.received_at || message.sent_at || '') + '\nSubject: ' + (message.subject || '') + '\n\n' + (message.body || ''),
      in_reply_to: forward ? '' : message.internet_message_id || '',
    }});
  };
  const isSettings = activeFolder === 'Settings';
  const isReady = apiStatus.status === 'ready';
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="identity"><div className="brand-icon">✉</div><div><div className="brand-name">Cross Domain</div><div className="brand-subtitle">Email client</div></div></div>
        <div className="section-label">WORKSPACE</div>
        <nav aria-label="Mail folders">
          {folders.map((item) => <button key={item.label} type="button" className={`nav-link ${activeFolder === item.label ? 'selected' : ''}`} onClick={() => { setActiveFolder(item.label); setComposer(null); setSendNotice(''); closeMessage(); }}><span aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>)}
        </nav>
        <button type="button" className="sidebar-compose" onClick={() => startCompose()} disabled={!mailboxes.length}>＋ Compose</button>
        <div className="section-label mailbox-label">MAILBOXES</div>
        <nav aria-label="Mailboxes" className="mailbox-nav">
          <button type="button" className={`mailbox-link ${selectedMailbox === '' ? 'selected' : ''}`} onClick={() => { setSelectedMailbox(''); if (isSettings) setActiveFolder('Unified inbox'); closeMessage(); }}>All mailboxes</button>
          {mailboxes.map((mailbox) => <button key={mailbox.id} type="button" className={`mailbox-link ${String(selectedMailbox) === String(mailbox.id) ? 'selected' : ''}`} title={mailbox.address} onClick={() => { setSelectedMailbox(String(mailbox.id)); if (isSettings) setActiveFolder('Unified inbox'); closeMessage(); }}>{mailbox.address}</button>)}
          {!loadingSetup && !mailboxes.length && <span className="sidebar-hint">Add mailboxes in Settings</span>}
        </nav>
        <div className="sidebar-bottom"><div className="server-dot" /><span>Signed in as {user.name}</span></div>
      </aside>
      <div className="main">
        <header className="topbar"><div className="breadcrumb">Email <span>/</span> {activeFolder}{composer ? ' / Compose' : openedMessageId && !isSettings ? ' / Read message' : ''}</div><div className="topbar-actions"><div className={`api-pill ${isReady ? 'ready' : ''}`} role="status"><span className="server-dot" />{isReady ? 'API connected' : 'API unavailable'}</div><button className="signout-button" type="button" onClick={onLogout} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div></header>
        <main className="content">
          <p className="eyebrow">SECURE WORKSPACE</p>
          <h1>{composer ? 'Compose email' : openedMessageId && !isSettings ? 'Read message' : activeFolder}</h1>
          <p className="intro">{isSettings ? 'Manage your domains and mailboxes.' : composer ? 'Write, save, and send from a configured domain.' : openedMessageId ? 'Read your email securely.' : 'Read imported email from your configured mailboxes in one private workspace.'}</p>
          {setupError && <div className="form-alert error" role="alert">{setupError}</div>}
          {sendNotice && <div className="form-alert success" role="status">{sendNotice}</div>}
          {isSettings ? <DomainSettings domains={domains} mailboxes={mailboxes} refresh={refresh} csrf={csrf} onExpired={onExpired} /> : composer ? <ComposeMail key={composer.draftId || 'new'} csrf={csrf} mailboxes={mailboxes} selectedMailbox={selectedMailbox} draftId={composer.draftId || null} initial={composer.initial} onClose={() => setComposer(null)} onExpired={onExpired} onSent={(receipt) => { setComposer(null); setActiveFolder('Sent'); setSendNotice(receipt.message); }} /> : openedMessageId ? <MessageReader messageId={openedMessageId} csrf={csrf} onBack={closeMessage} onExpired={onExpired} onReply={openReply} /> : <MessagesPanel folder={folderInfo.folder} mailboxes={mailboxes} selectedMailbox={selectedMailbox} onExpired={onExpired} onOpenMessage={openMessage} onOpenDraft={(id) => startCompose({ draftId: id })} />}
          {!openedMessageId && !composer && <div className="status-grid">
            <div className="status-card"><div>Laravel API</div><strong>{apiStatus.status}</strong><span>Backend service health</span></div>
            <div className="status-card"><div>PostgreSQL</div><strong>{apiStatus.database}</strong><span>Private persistent database</span></div>
            <div className="status-card"><div>Configured mailboxes</div><strong>{mailboxes.length}</strong><span>Configured addresses</span></div>
          </div>}
          {!openedMessageId && !composer && <p className="notice">Receiving uses Cloudflare R2. Outbound sending uses explicitly configured SMTP credentials and verified sending domains.</p>}
        </main>
      </div>
    </div>
  );
}
