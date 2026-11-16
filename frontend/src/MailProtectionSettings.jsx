import React, { useCallback, useEffect, useState } from 'react';

// Receiving aliases and sender rules are managed only by authenticated admins.
export default function MailProtectionSettings({ mailboxes, csrf, onExpired }) {
  const [aliases, setAliases] = useState([]);
  const [rules, setRules] = useState([]);
  const [address, setAddress] = useState('');
  const [mailboxId, setMailboxId] = useState('');
  const [type, setType] = useState('address');
  const [value, setValue] = useState('');
  const [action, setAction] = useState('block');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const request = useCallback(async (suffix = '', method = 'GET', payload) => {
    const res = await fetch('/api/mail-protection' + suffix, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(method !== 'GET' ? {'X-CSRF-TOKEN': csrf} : {}),
        ...(payload ? {'Content-Type': 'application/json'} : {}) },
      ...(payload ? {body: JSON.stringify(payload)} : {}),
    });
    if (res.status === 401) onExpired?.();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(Object.values(data.errors || {}).flat()[0] || data.message || 'Unable to save settings.');
    }
    return data;
  }, [csrf, onExpired]);

  const refresh = useCallback(async () => {
    const data = await request();
    setAliases(data.aliases || []);
    setRules(data.sender_rules || []);
  }, [request]);

  useEffect(() => {
    let mounted = true;
    request().then(data => {
      if (mounted) { setAliases(data.aliases || []); setRules(data.sender_rules || []); }
    }).catch(() => { if (mounted) setError('Unable to load protection settings.'); });
    return () => { mounted = false; };
  }, [request]);

  const run = async (task) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await task();
      setNotice(data.message || 'Settings saved.');
      await refresh();
    } catch (err) { setError(err.message || 'Unable to save.'); }
    finally { setBusy(false); }
  };

  return <section className="settings-card">
    <div className="settings-heading"><h2>Spam protection and aliases</h2></div>
    <p>Suspected spam is quarantined, not deleted. Original messages remain in private R2. Use Mark spam / Not spam on a message to improve future scoring.</p>
    <h3>Receiving aliases</h3>
    <p>An alias routes mail into an existing mailbox; it does not enable Cloudflare routing or authorize outgoing mail from that alias.</p>
    <form className="setup-form" onSubmit={event => {
      event.preventDefault(); run(async () => {
        const result = await request('/aliases', 'POST', {address, mailbox_id: Number(mailboxId)});
        setAddress(''); return result;
      });
    }}>
      <label htmlFor="mail-alias-address">Alias address</label>
      <input id="mail-alias-address" type="email" maxLength={320} required disabled={busy}
        placeholder="contact@madenorth.dev" value={address} onChange={e => setAddress(e.target.value)}/>
      <label htmlFor="mail-alias-target">Deliver into mailbox</label>
      <select id="mail-alias-target" value={mailboxId} required disabled={busy}
        onChange={e => setMailboxId(e.target.value)}>
        <option value="">Select an existing mailbox</option>
        {mailboxes.filter(m => m.is_active).map(m => <option key={m.id} value={m.id}>{m.address}</option>)}
      </select>
      <button className="primary-button" type="submit" disabled={busy || !mailboxId}>Add receiving alias</button>
    </form>
    <ul className="configuration-list">{aliases.map(a => <li key={a.id}>
      <div><strong>{a.address}</strong><small>Delivers to {a.destination}</small></div>
      <button className="compose-secondary" type="button" disabled={busy}
        onClick={() => run(() => request('/aliases/' + a.id, 'DELETE'))}>Remove</button>
    </li>)}</ul>
    <h3>Trusted and blocked senders</h3>
    <p>Address-specific rules override domain rules. Trusted senders bypass scoring; blocked senders go directly to Spam.</p>
    <form className="setup-form" onSubmit={event => {
      event.preventDefault(); run(async () => {
        const result = await request('/rules', 'POST', {type, value, action});
        setValue(''); return result;
      });
    }}>
      <label htmlFor="sender-rule-type">Match sender</label>
      <select id="sender-rule-type" value={type} onChange={e => setType(e.target.value)} disabled={busy}>
        <option value="address">Exact address</option><option value="domain">Entire domain</option>
      </select>
      <label htmlFor="sender-rule-value">Address or domain</label>
      <input id="sender-rule-value" maxLength={320} required disabled={busy}
        placeholder={type === 'address' ? 'sender@example.com' : 'example.com'}
        value={value} onChange={e => setValue(e.target.value)}/>
      <label htmlFor="sender-rule-action">Action</label>
      <select id="sender-rule-action" value={action} onChange={e => setAction(e.target.value)} disabled={busy}>
        <option value="block">Block to Spam</option><option value="allow">Trust sender</option>
      </select>
      <button className="primary-button" type="submit" disabled={busy}>Save sender rule</button>
    </form>
    <ul className="configuration-list">{rules.map(rule => <li key={rule.id}>
      <div><strong>{rule.value}</strong><small>{rule.action === 'allow' ? 'Trusted' : 'Blocked'} · {rule.type}</small></div>
      <button className="compose-secondary" type="button" disabled={busy}
        onClick={() => run(() => request('/rules/' + rule.id, 'DELETE'))}>Remove</button>
    </li>)}</ul>
    {error && <div className="form-alert error" role="alert">{error}</div>}
    {notice && <div className="form-alert success" role="status">{notice}</div>}
  </section>;
}
