import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const folders = [
  { label: 'Unified inbox', icon: '▤' },
  { label: 'Sent', icon: '↗' },
  { label: 'Drafts', icon: '▱' },
  { label: 'Archive', icon: '▣' },
  { label: 'Settings', icon: '⚙' },
];

async function apiRequest(path, options = {}) {
  const { headers, ...requestOptions } = options;
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...requestOptions,
    headers: { Accept: 'application/json', ...headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function Login({ onLogin, busy, error }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    const ok = await onLogin(email, password);
    if (ok) setPassword('');
  };

  return (
    <div className="auth-layout">
      <section className="auth-card" aria-label="Administrator sign in">
        <div className="identity auth-brand">
          <div className="brand-icon">✉</div>
          <div><div className="brand-name">Cross Domain</div><div className="brand-subtitle">Email client</div></div>
        </div>
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1>Administrator sign in</h1>
        <p className="auth-hint">Enter the credentials created on the application server. Public registration is disabled.</p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="login-email">Email address</label>
          <input id="login-email" type="email" value={email} maxLength={320} autoComplete="username" required onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" value={password} autoComplete="current-password" required onChange={(event) => setPassword(event.target.value)} />
          {error && <div role="alert" className="auth-error">{error}</div>}
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="auth-footer">Available only through your private SSH tunnel during setup.</p>
      </section>
    </div>
  );
}

function Workspace({ user, onLogout, signingOut }) {
  const [activeFolder, setActiveFolder] = useState('Unified inbox');
  const [api, setApi] = useState({ status: 'checking', database: 'checking' });
  const [mailboxes, setMailboxes] = useState([]);
  const [mailboxError, setMailboxError] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest('/status').then((data) => { if (active) setApi(data); })
      .catch(() => { if (active) setApi({ status: 'unavailable', database: 'unavailable' }); });
    apiRequest('/mailboxes').then((data) => { if (active) setMailboxes(data.mailboxes || []); })
      .catch((error) => { if (active) setMailboxError(error.status === 401 ? 'Session expired. Refresh to sign in again.' : 'Unable to load mailboxes.'); });
    return () => { active = false; };
  }, []);

  const isReady = api.status === 'ready';
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="identity"><div className="brand-icon">✉</div><div><div className="brand-name">Cross Domain</div><div className="brand-subtitle">Email client</div></div></div>
        <div className="section-label">WORKSPACE</div>
        <nav aria-label="Mail folders">
          {folders.map((folder) => (
            <button key={folder.label} type="button" className={`nav-link ${activeFolder === folder.label ? 'selected' : ''}`} onClick={() => setActiveFolder(folder.label)}>
              <span aria-hidden="true">{folder.icon}</span><span>{folder.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom"><div className="server-dot" /><span>Signed in as {user.name}</span></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">Email <span>/</span> {activeFolder}</div>
          <div className="topbar-actions">
            <div className={`api-pill ${isReady ? 'ready' : ''}`} role="status"><span className="server-dot" />{isReady ? 'API connected' : api.status === 'checking' ? 'Checking API' : 'API unavailable'}</div>
            <button className="signout-button" type="button" onClick={onLogout} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
          </div>
        </header>
        <main className="content">
          <p className="eyebrow">SECURE WORKSPACE</p>
          <h1>{activeFolder}</h1>
          <p className="intro">Administrator authentication is enabled. Mailbox schema is ready; receiving and sending integrations are not connected yet.</p>
          <section className="panel" aria-label="Workspace status">
            <div className="panel-top"><div><h2>{mailboxes.length ? `${mailboxes.length} configured mailbox${mailboxes.length === 1 ? '' : 'es'}` : 'No messages yet'}</h2><p>{mailboxError || 'Connect a domain and mailbox in a future setup step to begin receiving mail.'}</p></div><span className="label">Setup in progress</span></div>
            <div className="empty"><div className="empty-icon">✉</div><h3>Mailboxes are secured</h3><p>Messages will appear here after Cloudflare R2 ingestion and mailbox APIs are implemented.</p></div>
          </section>
          <div className="status-grid">
            <div className="status-card"><div>Laravel API</div><strong>{api.status}</strong><span>Backend service health</span></div>
            <div className="status-card"><div>PostgreSQL</div><strong>{api.database}</strong><span>Private persistent database</span></div>
            <div className="status-card"><div>Administrator access</div><strong>Secured</strong><span>Database session and CSRF protection</span></div>
          </div>
          <p className="notice">This is an authenticated setup preview. No domain MX records, incoming email, or sending providers have been activated.</p>
        </main>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(undefined);
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const renewCsrf = async () => {
    const data = await apiRequest('/auth/csrf');
    setCsrf(data.csrf_token);
    return data.csrf_token;
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await apiRequest('/auth/csrf');
        if (!active) return;
        setCsrf(token.csrf_token);
        const current = await apiRequest('/auth/me');
        if (active) setUser(current.user);
      } catch (e) {
        if (active) {
          setUser(null);
          if (e.status && e.status !== 401) setError(e.message);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  const login = async (email, password) => {
    setError('');
    setBusy(true);
    try {
      const token = csrf || await renewCsrf();
      const data = await apiRequest('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': token }, body: JSON.stringify({ email, password }) });
      await renewCsrf();
      setUser(data.user);
      return true;
    } catch (e) {
      setError(e.status === 419 ? 'Your session expired. Refresh the page and try again.' : e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setError('');
    setBusy(true);
    try {
      await apiRequest('/auth/logout', { method: 'POST', headers: { 'Accept': 'application/json', 'X-CSRF-TOKEN': csrf || await renewCsrf() } });
      setUser(null);
      await renewCsrf();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (user === undefined) return <div className="auth-layout"><div className="auth-card"><p role="status">Checking administrator session…</p></div></div>;
  if (!user) return <Login onLogin={login} busy={busy} error={error} />;
  return <><Workspace user={user} onLogout={logout} signingOut={busy} />{error && <div className="floating-error" role="alert">{error}</div>}</>;
}

createRoot(document.getElementById('root')).render(<App />);
