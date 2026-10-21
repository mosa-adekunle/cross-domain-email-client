import React, { useCallback, useEffect, useState } from 'react';
import MessageReader from './MessageReader.jsx';
import ComposeMail from './ComposeMail.jsx';

const folders = [
  { label: 'Unified inbox', title: 'Inbox', folder: 'inbox', icon: 'inbox' },
  { label: 'Sent', title: 'Sent', folder: 'sent', icon: 'sent' },
  { label: 'Drafts', title: 'Drafts', folder: 'drafts', icon: 'drafts' },
  { label: 'Archive', title: 'Archive', folder: 'archive', icon: 'archive' },
  { label: 'Settings', title: 'Settings', folder: 'settings', icon: 'settings' },
];

const iconPaths = {
  inbox: 'M4 4h16l2 11v5H2v-5L4 4Zm-2 11h6l2 3h4l2-3h6',
  sent: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  drafts: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-1-13h2l.6 2.2 1.8.8 2-.9 1.5 1.5-.9 2  .8 1.8 2.2.6v2l-2.2.6-.8 1.8.9 2-1.5 1.5-2-.9-1.8.8-.6 2.2h-2l-.6-2.2-1.8-.8-2 .9-1.5-1.5.9-2-.8-1.8-2.2-.6v-2l2.2-.6.8-1.8-.9-2L6.5 3.6l2 .9 1.8-.8L11 2.5',
  search: 'm21 21-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  refresh: 'M20 6v5h-5M4 18v-5h5M5.8 9A7 7 0 0 1 18 6l2 5M4 13l2 5a7 7 0 0 0 12-3',
  compose: 'M12 20H4V4h10M9 15l10-10 2 2-10 10-4 1 1-4Z',
  close: 'M18 6 6 18M6 6l12 12',
};
function MailIcon({ name, size = 20 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name]} /></svg>;
}
function formatMessageDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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

function MessagesPanel({ folder, mailboxes, selectedMailbox, query, onExpired, onOpenMessage, onOpenDraft }) {
  const [messages, setMessages] = useState([]);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selectedAddress = selectedMailbox ? mailboxes.find((item) => String(item.id) === String(selectedMailbox))?.address : null;
  const folderTitle = folders.find((item) => item.folder === folder)?.title || 'Messages';

  useEffect(() => { setPage(1); }, [folder, selectedMailbox, query]);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const params = new URLSearchParams({ folder, page: String(page) });
    if (selectedMailbox) params.set('mailbox_id', String(selectedMailbox));
    if (query.trim()) params.set('q', query.trim());

    const loadMessages = async (background = false) => {
      // One request at a time. Never poll a hidden tab; refresh immediately
      // when it becomes visible again.
      if (!active || inFlight || (background && document.visibilityState === 'hidden')) return;
      inFlight = true;
      if (!background) {
        setLoading(true);
        setError('');
      }
      try {
        const data = await api(`/messages?${params.toString()}`);
        if (!active) return;
        setMessages(data.messages || []);
        setPagination(data.pagination || { current_page: 1, last_page: 1, total: 0 });
        setError('');
      } catch (err) {
        if (!active) return;
        if (err.status === 401) onExpired();
        // Keep existing emails visible if a background request fails.
        if (!background) setError('Unable to load messages. Please try again.');
      } finally {
        inFlight = false;
        if (active && !background) setLoading(false);
      }
    };

    // Initial load and manual refresh use the regular loading state.
    loadMessages();

    // Only the Inbox polls; other folders still load on navigation and via
    // their manual Refresh button. Compose can remain open above the inbox.
    let timer;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadMessages(true);
    };
    if (folder === 'inbox') {
      timer = window.setInterval(() => loadMessages(true), 60_000);
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
      if (folder === 'inbox') document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [folder, selectedMailbox, query, page, refreshKey, onExpired]);

  return (
    <section className="panel mail-panel" aria-label={folderTitle + ' messages'}>
      <div className="mail-list-toolbar">
        <div className="mail-list-heading">
          <h2>{folderTitle}</h2>
          <p>{selectedAddress || 'All mailboxes'}{query ? ` · Searching for “${query}”` : ''}</p>
        </div>
        <div className="mail-list-tools">
          {folder === 'inbox' && <span className="mail-count" title="The inbox refreshes every 60 seconds while this tab is active">Auto-refresh · 60s</span>}
          <span className="mail-count" aria-live="polite">{loading ? 'Loading…' : `${pagination.total} message${pagination.total === 1 ? '' : 's'}`}</span>
          <button type="button" className="mail-icon-button" title="Refresh messages" aria-label="Refresh messages" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}><MailIcon name="refresh" size={19} /></button>
        </div>
      </div>
      {error ? <div className="mail-error"><div className="form-alert error" role="alert">{error}</div><button type="button" className="compose-secondary" onClick={() => setRefreshKey((value) => value + 1)}>Try again</button></div> : loading ? <div className="empty"><p>Loading messages…</p></div> : messages.length === 0 ? (
        <div className="empty"><div className="empty-icon"><MailIcon name="inbox" size={34} /></div><h3>{query ? 'No matching messages' : 'Your mailbox is clear'}</h3><p>{query ? 'Try a different search in this folder.' : 'Messages will appear here when they arrive.'}</p></div>
      ) : (
        <>
          <div className="message-list">
            {messages.map((message) => {
              const recipientRow = folder === 'sent' || folder === 'drafts';
              const sender = recipientRow ? (message.to_recipients ? 'To: ' + message.to_recipients : '(no recipients)') : (message.from_name || message.from_address || 'Unknown sender');
              const snippet = message.delivery_status === 'unknown' ? 'Delivery not confirmed — do not resend automatically' : message.preview_text || '';
              return (
                <button key={message.id} type="button" className={`message-row message-row-button ${message.is_read ? '' : 'unread'}`} onClick={() => folder === 'drafts' ? onOpenDraft(message.id) : onOpenMessage(message.id)} aria-label={`Open: ${message.subject || '(no subject)'}`}>
                  <span className={`mail-star ${message.is_starred ? 'is-starred' : ''}`} aria-hidden="true">{message.is_starred ? '★' : '☆'}</span>
                  <span className="message-sender" title={sender}>{sender}<small>{message.mailbox_address}</small></span>
                  <span className="message-summary"><strong>{message.subject || '(no subject)'}</strong><span className="message-preview">{snippet ? ' — ' + snippet : ''}</span></span>
                  <time>{formatMessageDate(message.received_at || message.sent_at || message.created_at)}</time>
                </button>
              );
            })}
          </div>
          {pagination.last_page > 1 && <div className="pagination"><span>{`Page ${page} of ${pagination.last_page}`}</span><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button type="button" disabled={page >= pagination.last_page} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
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
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
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
  const selectFolder = (label) => {
    setActiveFolder(label);
    setComposer(null);
    setSendNotice('');
    setSearchInput('');
    setSearchQuery('');
    closeMessage();
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="identity"><div className="brand-icon"><MailIcon name="inbox" size={25} /></div><div><div className="brand-name">Cross Domain</div><div className="brand-subtitle">Mail</div></div></div>
        <button type="button" className="sidebar-compose" onClick={() => startCompose()} disabled={!mailboxes.length}><MailIcon name="compose" size={21} /><span>Compose</span></button>
        <nav aria-label="Mail folders" className="folder-nav">
          {folders.map((item) => <button key={item.label} type="button" className={`nav-link ${activeFolder === item.label ? 'selected' : ''}`} aria-current={activeFolder === item.label ? 'page' : undefined} onClick={() => selectFolder(item.label)}><MailIcon name={item.icon} size={19}/><span>{item.title}</span></button>)}
        </nav>
        <div className="section-label mailbox-label">MAILBOXES</div>
        <nav aria-label="Mailboxes" className="mailbox-nav">
          <button type="button" className={`mailbox-link ${selectedMailbox === '' ? 'selected' : ''}`} onClick={() => { setSelectedMailbox(''); if (isSettings) setActiveFolder('Unified inbox'); closeMessage(); }}>All mailboxes</button>
          {mailboxes.map((mailbox) => <button key={mailbox.id} type="button" className={`mailbox-link ${String(selectedMailbox) === String(mailbox.id) ? 'selected' : ''}`} title={mailbox.address} onClick={() => { setSelectedMailbox(String(mailbox.id)); if (isSettings) setActiveFolder('Unified inbox'); closeMessage(); }}>{mailbox.address}</button>)}
          {!loadingSetup && !mailboxes.length && <span className="sidebar-hint">Add mailboxes in Settings</span>}
        </nav>
        <div className="sidebar-bottom"><span className="account-avatar">{(user.name || 'A').charAt(0).toUpperCase()}</span><span className="account-name" title={user.name}>Signed in as <strong>{user.name}</strong></span></div>
      </aside>
      <div className="main">
        <header className="topbar">
          {!isSettings ? (
            <form className="mail-search" role="search" onSubmit={(event) => { event.preventDefault(); setSearchQuery(searchInput.trim()); closeMessage(); }}>
              <MailIcon name="search" size={21} />
              <input aria-label="Search messages in the current folder" type="search" maxLength={120} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search mail in this folder" />
              {searchInput && <button type="button" className="mail-icon-button" title="Clear search" aria-label="Clear search" onClick={() => { setSearchInput(''); setSearchQuery(''); }}><MailIcon name="close" size={18}/></button>}
              <button type="submit" className="search-submit">Search</button>
            </form>
          ) : <span className="topbar-context">Mailbox settings</span>}
          <div className="topbar-actions"><div className={`api-pill ${isReady ? 'ready' : ''}`} role="status"><span className="server-dot" />{isReady ? 'Connected' : 'Unavailable'}</div><button className="signout-button" type="button" onClick={onLogout} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div>
        </header>
        <main className="content">
          <div className="workspace-heading"><div><h1>{folderInfo.title}</h1><p className="intro">{isSettings ? 'Manage the domains and addresses connected to your inbox.' : selectedMailbox ? `Viewing messages for ${mailboxes.find((item) => String(item.id) === String(selectedMailbox))?.address || 'selected mailbox'}` : 'Your mail, organized in one place.'}</p></div></div>
          {setupError && <div className="form-alert error" role="alert">{setupError}</div>}
          {sendNotice && <div className="form-alert success" role="status">{sendNotice}</div>}
          {isSettings ? <DomainSettings domains={domains} mailboxes={mailboxes} refresh={refresh} csrf={csrf} onExpired={onExpired} /> : openedMessageId ? <MessageReader messageId={openedMessageId} csrf={csrf} onBack={closeMessage} onExpired={onExpired} onReply={openReply} /> : <MessagesPanel folder={folderInfo.folder} mailboxes={mailboxes} selectedMailbox={selectedMailbox} query={searchQuery} onExpired={onExpired} onOpenMessage={openMessage} onOpenDraft={(id) => startCompose({ draftId: id })} />}
          {isSettings && <details className="workspace-system"><summary>System health</summary><div className="status-grid"><div className="status-card"><div>Laravel API</div><strong>{apiStatus.status}</strong><span>Backend service</span></div><div className="status-card"><div>PostgreSQL</div><strong>{apiStatus.database}</strong><span>Private database</span></div><div className="status-card"><div>Mailboxes</div><strong>{mailboxes.length}</strong><span>Configured addresses</span></div></div><p className="notice">Incoming mail uses Cloudflare R2. Outgoing mail uses your configured SMTP provider.</p></details>}
        </main>
      </div>
      {composer && <ComposeMail key={composer.draftId || 'new'} csrf={csrf} mailboxes={mailboxes} selectedMailbox={selectedMailbox} draftId={composer.draftId || null} initial={composer.initial} onClose={() => setComposer(null)} onExpired={onExpired} onSent={(receipt) => { setComposer(null); setActiveFolder('Sent'); setSendNotice(receipt.message); }} />}
    </div>
  );
}
