import React, { useCallback, useEffect, useState } from 'react';
import MessageReader from './MessageReader.jsx';
import ComposeMail from './ComposeMail.jsx';
import { readMailLocation, mailLocationUrl, mailPageUrl, messagePageRange } from './mailLocation.js';
import { messageNavigationHighlight } from './messageHighlight.js';
import { groupMailboxes } from './mailboxGroups.js';
import { mailboxBrand } from './mailboxBrands.js';
import { mailPageTitle, shouldPulseMailTitle } from './mailTitle.js';

const folders = [
  { label: 'Unified inbox', title: 'Inbox', folder: 'inbox', icon: 'inbox' },
  { label: 'Sent', title: 'Sent', folder: 'sent', icon: 'sent' },
  { label: 'Drafts', title: 'Drafts', folder: 'drafts', icon: 'drafts' },
  { label: 'Archive', title: 'Archive', folder: 'archive', icon: 'archive' },
  { label: 'Trash', title: 'Trash', folder: 'trash', icon: 'trash' },
  { label: 'Settings', title: 'Settings', folder: 'settings', icon: 'settings' },
];

const iconPaths = {
  inbox: 'M4 4h16l2 11v5H2v-5L4 4Zm-2 11h6l2 3h4l2-3h6',
  sent: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  drafts: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  trash: 'M3 6h18M8 6V4h8v2M5 6l1 15h12l1-15M10 10v7M14 10v7',
  restore: 'M3 12a9 9 0 1 0 3-7M3 3v6h6M12 7v5l4 3',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  mailopen: 'M3 10l9-7 9 7v10H3V10zm0 0 9 7 9-7',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-1-13h2l.6 2.2 1.8.8 2-.9 1.5 1.5-.9 2  .8 1.8 2.2.6v2l-2.2.6-.8 1.8.9 2-1.5 1.5-2-.9-1.8.8-.6 2.2h-2l-.6-2.2-1.8-.8-2 .9-1.5-1.5.9-2-.8-1.8-2.2-.6v-2l2.2-.6.8-1.8-.9-2L6.5 3.6l2 .9 1.8-.8L11 2.5',
  search: 'm21 21-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  refresh: 'M20 6v5h-5M4 18v-5h5M5.8 9A7 7 0 0 1 18 6l2 5M4 13l2 5a7 7 0 0 0 12-3',
  'chevron-left': 'm15 18-6-6 6-6',
  'chevron-right': 'm9 18 6-6-6-6',
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

function MailContact({ name, email, mailbox, otherRecipients = 0, messageId }) {
  const display = name || email || 'Unknown sender';
  const initial = display.slice(0, 1).toLocaleUpperCase();
  return (
    <span className="message-sender mail-contact">
      <span className="contact-display">{display}{otherRecipients > 0 ? `, +${otherRecipients}` : ''}</span>
      <small>{mailbox}</small>
      {email && <span className="contact-card" id={`mail-contact-${messageId}`} role="tooltip">
        <span className="contact-avatar">{initial}</span>
        <span className="contact-details">
          <strong>{display}</strong>
          <span className="contact-email">{email}</span>
          <span className="contact-hint">{name ? 'Display name provided in email' : 'No display name available'}</span>
          {otherRecipients > 0 && <span className="contact-hint">Plus {otherRecipients} additional recipient{otherRecipients === 1 ? '' : 's'}</span>}
        </span>
      </span>}
    </span>
  );
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

function MessagesPanel({ folder, mailboxes, selectedMailbox, query, page, onPageChange, csrf, onExpired, onOpenMessage, onOpenDraft, onMutation }) {
  const [messages, setMessages] = useState([]);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedAddress = selectedMailbox ? mailboxes.find((item) => String(item.id) === String(selectedMailbox))?.address : null;
  const folderTitle = folders.find((item) => item.folder === folder)?.title || 'Messages';
  const visibleIds = messages.map((m) => Number(m.id));
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const { start: rangeStart, end: rangeEnd, total: totalMessages } = messagePageRange(pagination, page);

  useEffect(() => { setSelectedIds([]); setNotice(''); }, [folder, selectedMailbox, query]);
  useEffect(() => { setSelectedIds([]); }, [page]);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const params = new URLSearchParams({ folder, page: String(page) });
    if (selectedMailbox) params.set('mailbox_id', String(selectedMailbox));
    if (query.trim()) params.set('q', query.trim());
    const loadMessages = async (background = false) => {
      if (!active || inFlight || (background && document.visibilityState === 'hidden')) return;
      inFlight = true;
      if (!background) { setLoading(true); setError(''); }
      try {
        const data = await api('/messages?' + params.toString());
        if (!active) return;
        const nextPagination = data.pagination || { current_page: 1, last_page: 1, total: 0, per_page: 50 };
        // A bulk delete/restore can make the current page disappear.
        // Return to the last available page rather than showing a blank list.
        if (page > Math.max(1, nextPagination.last_page || 1)) {
          onPageChange(Math.max(1, nextPagination.last_page || 1));
          return;
        }
        setMessages(data.messages || []);
        setPagination(nextPagination);
        const ids = new Set((data.messages || []).map((m) => Number(m.id)));
        setSelectedIds((previous) => previous.filter((id) => ids.has(id)));
        setError('');
      } catch (err) {
        if (!active) return;
        if (err.status === 401) onExpired();
        if (!background) setError('Unable to load messages. Please try again.');
      } finally {
        inFlight = false;
        if (active && !background) setLoading(false);
      }
    };
    loadMessages();
    let timer;
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') loadMessages(true); };
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

  const doAction = async (action, ids) => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/messages/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf },
        body: JSON.stringify({ action, ids }),
      });
      setSelectedIds([]);
      setNotice(result.message || 'Messages updated.');
      setRefreshKey((value) => value + 1);
      onMutation();
    } catch (err) {
      if (err.status === 401) onExpired();
      setError(err.message || 'The action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const toggleSelected = (id, checked) => {
    setSelectedIds((previous) => checked ? [...new Set([...previous, id])] : previous.filter((item) => item !== id));
  };

  return (
    <section className="panel mail-panel" aria-label={folderTitle + ' messages'}>
      <div className="mail-list-toolbar">
        <div className="mail-list-heading">
          <h2>{folderTitle}</h2>
          <p>{selectedAddress || 'All mailboxes'}{query ? ' · Results for “' + query + '”' : ''}</p>
        </div>
        <div className="mail-list-tools">
          <button type="button" className="mail-icon-button" title="Refresh messages" aria-label="Refresh messages" disabled={loading || busy} onClick={() => setRefreshKey((value) => value + 1)}><MailIcon name="refresh" size={18} /></button>
          <nav className="mail-pager" aria-label="Message pages">
            <span className="mail-pager-range" aria-live="polite">{loading ? 'Loading…' : `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${totalMessages.toLocaleString()}`}</span>
            <button type="button" className="mail-icon-button mail-pager-arrow" title="Newer messages" aria-label="Previous page of messages" disabled={loading || busy || page <= 1} onClick={() => onPageChange(page - 1)}><MailIcon name="chevron-left" size={19} /></button>
            <button type="button" className="mail-icon-button mail-pager-arrow" title="Older messages" aria-label="Next page of messages" disabled={loading || busy || page >= pagination.last_page || page >= 10000} onClick={() => onPageChange(page + 1)}><MailIcon name="chevron-right" size={19} /></button>
          </nav>
        </div>
      </div>
      <div className="mail-actionbar">
        <label className="mail-select-all" title="Select all messages on this page">
          <input type="checkbox" aria-label="Select all messages on this page" checked={allSelected} disabled={loading || busy || visibleIds.length === 0} onChange={(event) => setSelectedIds(event.target.checked ? visibleIds : [])} />
        </label>
        {selectedIds.length > 0 ? (
          <>
            <span className="mail-selection-count">{selectedIds.length} selected</span>
            {folder === 'inbox' && <button className="mail-toolbar-action" type="button" disabled={busy} onClick={() => doAction('archive', selectedIds)}><MailIcon name="archive" size={17} />Archive</button>}
            {folder === 'archive' && <button className="mail-toolbar-action" type="button" disabled={busy} onClick={() => doAction('unarchive', selectedIds)}><MailIcon name="inbox" size={17} />Move to Inbox</button>}
            {folder !== 'trash' && <button className="mail-toolbar-action" type="button" disabled={busy} onClick={() => doAction('trash', selectedIds)}><MailIcon name="trash" size={17} />Delete</button>}
            {folder === 'trash' && <button className="mail-toolbar-action" type="button" disabled={busy} onClick={() => doAction('restore', selectedIds)}><MailIcon name="restore" size={17} />Restore</button>}
            <button className="mail-toolbar-action" type="button" disabled={busy} onClick={() => doAction('read', selectedIds)}><MailIcon name="mailopen" size={17} />Mark read</button>
            <button className="mail-toolbar-action" type="button" disabled={busy} onClick={() => doAction('unread', selectedIds)}><MailIcon name="mail" size={17} />Mark unread</button>
            <button className="mail-toolbar-action clear-selection" type="button" disabled={busy} onClick={() => setSelectedIds([])}>Clear</button>
          </>
        ) : <span className="mail-action-hint">{folder === 'trash' ? 'Deleted messages can be restored' : folder === 'archive' ? 'Select messages to move back to Inbox' : 'Select messages for bulk actions'}</span>}
      </div>
      {notice && <div className="mail-inline-notice" role="status">{notice}</div>}
      {error && <div className="mail-error"><div className="form-alert error" role="alert">{error}</div><button type="button" className="compose-secondary" onClick={() => setRefreshKey((value) => value + 1)}>Try again</button></div>}
      {loading ? <div className="empty"><p>Loading messages…</p></div> : !error && messages.length === 0 ? (
        <div className="empty"><div className="empty-icon"><MailIcon name={folder === 'trash' ? 'trash' : 'inbox'} size={34} /></div><h3>{query ? 'No matching messages' : folder === 'trash' ? 'Trash is empty' : 'Your mailbox is clear'}</h3><p>{query ? 'Try a different search in this folder.' : folder === 'trash' ? 'Messages you delete will be moved here.' : 'Messages will appear here when they arrive.'}</p></div>
      ) : !error && (
        <>
          <div className="message-list">
            {messages.map((message) => {
              const id = Number(message.id);
              const recipientRow = folder === 'sent' || folder === 'drafts' || (folder === 'trash' && message.direction !== 'incoming');
              const contactEmail = recipientRow ? message.to_contact_email : message.from_address;
              const contactName = recipientRow ? message.to_contact_name : message.from_name;
              const otherRecipients = recipientRow ? Math.max(0, (message.to_recipient_count || 0) - 1) : 0;
              const snippet = message.delivery_status === 'unknown' ? 'Delivery not confirmed — do not resend automatically' : message.preview_text || '';
              return (
                <div key={message.id} className={'message-row mail-list-entry ' + (message.is_read ? 'read' : 'unread') + (selectedIds.includes(id) ? ' selected' : '')}>
                  <label className="mail-row-select" title="Select message"><input type="checkbox" checked={selectedIds.includes(id)} disabled={busy} onChange={(event) => toggleSelected(id, event.target.checked)} aria-label={'Select message: ' + (message.subject || '(no subject)')} /></label>
                  <button type="button" className={'mail-star-button ' + (message.is_starred ? 'is-starred' : '')} title={message.is_starred ? 'Remove star' : 'Star message'} aria-label={message.is_starred ? 'Remove star' : 'Star message'} disabled={busy} onClick={() => doAction(message.is_starred ? 'unstar' : 'star', [id])}>{message.is_starred ? '★' : '☆'}</button>
                  <button type="button" className="message-open" onClick={() => folder === 'drafts' ? onOpenDraft(message.id) : onOpenMessage(message.id)} title={message.subject || '(no subject)'}>
                    <MailContact name={contactName} email={contactEmail} mailbox={message.mailbox_address?.startsWith('catchall@') ? (message.to_recipients || message.mailbox_address) : message.mailbox_address} otherRecipients={otherRecipients} messageId={message.id} />
                    <span className="message-summary"><strong>{message.subject || '(no subject)'}</strong><span className="message-preview">{snippet ? ' — ' + snippet : ''}</span></span>
                    <time>{formatMessageDate(message.received_at || message.sent_at || message.created_at)}</time>
                  </button>
                  <div className="mail-row-actions">
                    <button type="button" title={folder === 'trash' ? 'Restore' : 'Move to Trash'} aria-label={folder === 'trash' ? 'Restore message' : 'Delete message'} disabled={busy} onClick={() => doAction(folder === 'trash' ? 'restore' : 'trash', [id])}><MailIcon name={folder === 'trash' ? 'restore' : 'trash'} size={17} /></button>
                  </div>
                </div>
              );
            })}
          </div>

        </>
      )}
    </section>
  );
}

export default function Workspace({ user, csrf, onLogout, signingOut, onExpired }) {
  const [activeFolder, setActiveFolder] = useState(() => {
    const { folder } = readMailLocation(window.location.search);
    return folders.find((item) => item.folder === folder)?.label || 'Unified inbox';
  });
  const [composer, setComposer] = useState(null);
  const [sendNotice, setSendNotice] = useState('');
  const [apiStatus, setApiStatus] = useState({ status: 'checking', database: 'checking' });
  const [domains, setDomains] = useState([]);
  const [mailboxes, setMailboxes] = useState([]);
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [setupError, setSetupError] = useState('');
  const [selectedMailbox, setSelectedMailbox] = useState(() => readMailLocation(window.location.search).mailboxId);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(() => readMailLocation(window.location.search).page);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [unreadRefreshKey, setUnreadRefreshKey] = useState(0);
  const onMessageRead = useCallback(() => setUnreadRefreshKey((value) => value + 1), []);
  const onMessageMutation = useCallback(() => setUnreadRefreshKey((value) => value + 1), []);
  const [openedMessageId, setOpenedMessageId] = useState(() => readMailLocation(window.location.search).messageId);
  // The opened message can belong to a different mailbox than the list filter.
  // Keep the selected list filter intact; this state is for visual context only.
  const [openedMessageContext, setOpenedMessageContext] = useState(null);
  const onMessageLoaded = useCallback((message) => {
    setOpenedMessageContext({
      id: message.id,
      mailbox_id: message.mailbox_id,
      mailbox_address: message.mailbox_address,
      folder: message.folder,
    });
  }, []);

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
    let active = true;
    let fetching = false;
    const params = new URLSearchParams();
    if (selectedMailbox) params.set('mailbox_id', String(selectedMailbox));
    const checkUnread = async () => {
      if (!active || fetching) return;
      fetching = true;
      try {
        const response = await api('/messages/unread-count' + (params.size ? '?' + params.toString() : ''));
        if (active) {
          setUnreadCount(Math.max(0, Number(response.unread_count) || 0));
          setTotalUnreadCount(Math.max(0, Number(response.total_unread_count ?? response.unread_count) || 0));
        }
      } catch (err) {
        if (active && err.status === 401) onExpired();
        // Keep the last known count when the network is temporarily down.
      } finally {
        fetching = false;
      }
    };
    checkUnread();
    const timer = window.setInterval(checkUnread, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') checkUnread(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedMailbox, unreadRefreshKey, onExpired]);

  useEffect(() => {
    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const normalTitle = mailPageTitle(totalUnreadCount);
    let interval = null;
    let pulse = false;

    // Browser tab titles cannot use CSS animation. Alternate the red
    // and green dots while keeping the unread count in both phases.
    // Background browsers may throttle the interval.
    const updateMotion = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
      pulse = false;
      document.title = normalTitle;
      if (!shouldPulseMailTitle(totalUnreadCount, motionPreference?.matches === true)) return;
      interval = window.setInterval(() => {
        pulse = !pulse;
        document.title = mailPageTitle(totalUnreadCount, pulse);
      }, 1500);
    };
    updateMotion();
    motionPreference?.addEventListener?.('change', updateMotion);
    return () => {
      if (interval !== null) window.clearInterval(interval);
      motionPreference?.removeEventListener?.('change', updateMotion);
      document.title = mailPageTitle(0);
    };
  }, [totalUnreadCount]);

  useEffect(() => {
    // Browser Back / Forward restores the whole mail view, not only a message.
    const sync = () => {
      const { folder, mailboxId, messageId, page: restoredPage } = readMailLocation(window.location.search);
      setActiveFolder(folders.find((item) => item.folder === folder)?.label || 'Unified inbox');
      setSelectedMailbox(mailboxId);
      setOpenedMessageId(messageId);
      setOpenedMessageContext(null);
      setPage(restoredPage);
      setSearchInput('');
      setSearchQuery('');
      setComposer(null);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const openMessage = (id) => {
    const url = new URL(window.location.href);
    url.searchParams.set('message', String(id));
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    setOpenedMessageId(String(id));
    setOpenedMessageContext(null);
  };
  const closeMessage = () => {
    if (!openedMessageId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('message');
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    setOpenedMessageId(null);
    setOpenedMessageContext(null);
  };

  const navigateToPage = (nextPage) => {
    const target = mailPageUrl(window.location.href, nextPage);
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (target !== current) window.history.pushState(null, '', target);
    setPage(nextPage);
  };

  const navigateToView = (label, mailboxId) => {
    const folder = folders.find((item) => item.label === label)?.folder || 'inbox';
    const target = mailLocationUrl(window.location.href, { folder, mailboxId });
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (target !== current) window.history.pushState(null, '', target);
    setActiveFolder(label);
    setSelectedMailbox(String(mailboxId || ''));
    setOpenedMessageId(null);
    setOpenedMessageContext(null);
    setPage(1);
  };

  const folderInfo = folders.find((item) => item.label === activeFolder);
  const messageHighlight = messageNavigationHighlight({
    openedMessageId,
    messageContext: openedMessageContext,
    activeFolder,
    selectedMailbox,
    mailboxes,
    folders,
  });
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
    navigateToView(label, selectedMailbox);
    setComposer(null);
    setSendNotice('');
    setSearchInput('');
    setSearchQuery('');
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="identity identity-with-logo"><img className="brand-logo" src="/made-north-technologies-logo.svg" alt="Made North Technologies" width="2048" height="682" /></div>
        <button type="button" className="sidebar-compose" onClick={() => startCompose()} disabled={!mailboxes.length}><MailIcon name="compose" size={21} /><span>Compose</span></button>
        <nav aria-label="Mail folders" className="folder-nav">
          {folders.map((item) => <button key={item.label} type="button" className={`nav-link ${messageHighlight.folderLabel === item.label ? 'selected' : ''}`} aria-current={messageHighlight.folderLabel === item.label ? 'page' : undefined} onClick={() => selectFolder(item.label)}><MailIcon name={item.icon} size={19}/><span>{item.title}</span>{item.folder === 'inbox' && unreadCount > 0 && <span className="nav-unread-count" aria-label={`${unreadCount} new messages`}>({unreadCount} new)</span>}</button>)}
        </nav>
        <div className="section-label mailbox-label">MAILBOXES</div>
        <nav aria-label="Mailboxes" className="mailbox-nav">
          <button type="button" className={`mailbox-link ${messageHighlight.mailboxId === '' ? 'selected' : ''}`} aria-current={messageHighlight.mailboxId === '' ? 'page' : undefined} onClick={() => navigateToView(isSettings ? 'Unified inbox' : activeFolder, '')}>All mailboxes</button>
          {groupMailboxes(mailboxes).map(({ domain, mailboxes: domainMailboxes }) => (
            <details className="mailbox-domain-group" style={mailboxBrand(domain).style} key={`${domain}:${messageHighlight.mailboxId}`} open={domainMailboxes.some((mailbox) => String(mailbox.id) === messageHighlight.mailboxId)}>
              <summary className="mailbox-domain-heading"><span className="mailbox-domain-title">{mailboxBrand(domain).logo ? <img className="mailbox-domain-logo" src={mailboxBrand(domain).logo} alt="" width="22" height="22" /> : <span className="mailbox-domain-initials" aria-hidden="true">{mailboxBrand(domain).initials}</span>}<span>{domain}</span></span></summary>
              <div className="mailbox-domain-items">
              {domainMailboxes.map((mailbox) => <button key={mailbox.id} type="button" className={`mailbox-link ${messageHighlight.mailboxId === String(mailbox.id) ? 'selected' : ''}`} aria-current={messageHighlight.mailboxId === String(mailbox.id) ? 'page' : undefined} title={mailbox.address} onClick={() => navigateToView(isSettings ? 'Unified inbox' : activeFolder, String(mailbox.id))}>{mailbox.address}</button>)}
              </div>
            </details>
          ))}
          {!loadingSetup && !mailboxes.length && <span className="sidebar-hint">Add mailboxes in Settings</span>}
        </nav>
        <div className="sidebar-bottom"><span className="account-avatar">{(user.name || 'A').charAt(0).toUpperCase()}</span><span className="account-name" title={user.name}>Signed in as <strong>{user.name}</strong></span></div>
      </aside>
      <div className="main">
        <header className="topbar">
          {!isSettings ? (
            <form className="mail-search" role="search" onSubmit={(event) => { event.preventDefault(); navigateToPage(1); setSearchQuery(searchInput.trim()); closeMessage(); }}>
              <MailIcon name="search" size={21} />
              <input aria-label="Search messages in the current folder" type="search" maxLength={120} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search mail in this folder" />
              {searchInput && <button type="button" className="mail-icon-button" title="Clear search" aria-label="Clear search" onClick={() => { navigateToPage(1); setSearchInput(''); setSearchQuery(''); }}><MailIcon name="close" size={18}/></button>}
              <button type="submit" className="search-submit">Search</button>
            </form>
          ) : <span className="topbar-context">Mailbox settings</span>}
          <div className="topbar-actions"><div className={`api-pill ${isReady ? 'ready' : ''}`} role="status"><span className="server-dot" />{isReady ? 'Connected' : 'Unavailable'}</div><button className="signout-button" type="button" onClick={onLogout} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div>
        </header>
        <main className="content">
          <div className="workspace-heading"><div><h1>{folderInfo.title}</h1><p className="intro">{isSettings ? 'Manage the domains and addresses connected to your inbox.' : selectedMailbox ? `Viewing messages for ${mailboxes.find((item) => String(item.id) === String(selectedMailbox))?.address || 'selected mailbox'}` : 'Your mail, organized in one place.'}</p></div></div>
          {setupError && <div className="form-alert error" role="alert">{setupError}</div>}
          {sendNotice && <div className="form-alert success" role="status">{sendNotice}</div>}
          {isSettings ? <DomainSettings domains={domains} mailboxes={mailboxes} refresh={refresh} csrf={csrf} onExpired={onExpired} /> : openedMessageId ? <MessageReader messageId={openedMessageId} csrf={csrf} onBack={closeMessage} onExpired={onExpired} onReply={openReply} onRead={onMessageRead} onLoaded={onMessageLoaded} onAction={async (action, id) => { const result = await api("/messages/actions", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": csrf }, body: JSON.stringify({ action, ids: [Number(id)] }) }); onMessageMutation(); closeMessage(); return result; }} /> : <MessagesPanel folder={folderInfo.folder} mailboxes={mailboxes} selectedMailbox={selectedMailbox} query={searchQuery} page={page} onPageChange={navigateToPage} csrf={csrf} onExpired={onExpired} onOpenMessage={openMessage} onOpenDraft={(id) => startCompose({ draftId: id })} onMutation={onMessageMutation} />}
          {isSettings && <details className="workspace-system"><summary>System health</summary><div className="status-grid"><div className="status-card"><div>Laravel API</div><strong>{apiStatus.status}</strong><span>Backend service</span></div><div className="status-card"><div>PostgreSQL</div><strong>{apiStatus.database}</strong><span>Private database</span></div><div className="status-card"><div>Mailboxes</div><strong>{mailboxes.length}</strong><span>Configured addresses</span></div></div><p className="notice">Incoming mail uses Cloudflare R2. Outgoing mail uses your configured SMTP provider.</p></details>}
        </main>
      </div>
      {composer && <ComposeMail key={composer.draftId || 'new'} csrf={csrf} mailboxes={mailboxes} selectedMailbox={selectedMailbox} draftId={composer.draftId || null} initial={composer.initial} onClose={() => setComposer(null)} onExpired={onExpired} onSent={(receipt) => { setComposer(null); navigateToView('Sent', selectedMailbox); setSendNotice(receipt.message); }} />}
    </div>
  );
}
