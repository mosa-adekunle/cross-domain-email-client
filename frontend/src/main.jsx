import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import Workspace from './Workspace.jsx';


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
        <p className="auth-footer">Sign in securely using the server HTTPS address.</p>
      </section>
    </div>
  );
}


function App() {
  const [user, setUser] = useState(undefined);
  const [csrf, setCsrf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const expireSession = useCallback(() => setUser(null), []);

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
  return <><Workspace user={user} csrf={csrf} onLogout={logout} signingOut={busy} onExpired={expireSession} />{error && <div className="floating-error" role="alert">{error}</div>}</>;
}

createRoot(document.getElementById('root')).render(<App />);
