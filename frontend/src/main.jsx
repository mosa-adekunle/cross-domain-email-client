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

function App() {
  const [activeFolder, setActiveFolder] = useState('Unified inbox');
  const [api, setApi] = useState({ status: 'checking', database: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/status', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('API is unavailable');
        setApi(await response.json());
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setApi({ status: 'unavailable', database: 'unavailable' });
      });
    return () => controller.abort();
  }, []);

  const isReady = api.status === 'ready';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="identity">
          <div className="brand-icon">✉</div>
          <div>
            <div className="brand-name">Cross Domain</div>
            <div className="brand-subtitle">Email client</div>
          </div>
        </div>

        <div className="section-label">WORKSPACE</div>
        <nav aria-label="Mail folders">
          {folders.map((folder) => (
            <button key={folder.label} type="button" className={`nav-link ${activeFolder === folder.label ? 'selected' : ''}`} onClick={() => setActiveFolder(folder.label)}>
              <span aria-hidden="true">{folder.icon}</span>
              <span>{folder.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="server-dot" />
          <span>Single-administrator workspace</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">Email <span>/</span> {activeFolder}</div>
          <div className={`api-pill ${isReady ? 'ready' : ''}`} role="status">
            <span className="server-dot" />
            {isReady ? 'API connected' : api.status === 'checking' ? 'Checking API' : 'API unavailable'}
          </div>
        </header>

        <main className="content">
          <p className="eyebrow">FOUNDATION PREVIEW</p>
          <h1>{activeFolder}</h1>
          <p className="intro">Your workspace shell is running. Mail accounts and message actions will be activated after authentication and Cloudflare integration are implemented.</p>

          <section className="panel" aria-label="Workspace status">
            <div className="panel-top">
              <div>
                <h2>No messages yet</h2>
                <p>Mailbox setup, secure login, and email receiving are not connected yet.</p>
              </div>
              <span className="label">Setup in progress</span>
            </div>
            <div className="empty">
              <div className="empty-icon">✉</div>
              <h3>Everything in one place, soon</h3>
              <p>You'll see email from every connected domain here once setup is complete.</p>
            </div>
          </section>

          <div className="status-grid">
            <div className="status-card"><div>Laravel API</div><strong>{api.status}</strong><span>Backend service health</span></div>
            <div className="status-card"><div>PostgreSQL</div><strong>{api.database}</strong><span>Private persistent database</span></div>
            <div className="status-card"><div>Email delivery</div><strong>Not connected</strong><span>Cloudflare and SMTP are next</span></div>
          </div>
          <p className="notice">This is a setup preview, not a functioning mailbox. No email traffic is being received, stored, or sent.</p>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
