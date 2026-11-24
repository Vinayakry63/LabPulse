import { useState } from 'react';
import { decodeToken, devLogin, saveToken, type Role, type Session } from '../lib/auth';

const PRESETS: { label: string; tenantId: string; tenantName: string; role: Role; userId: string }[] = [
  { label: 'Acme · Instructor', tenantId: 'acme', tenantName: 'Acme Corp', role: 'instructor', userId: 'inst-1' },
  { label: 'Acme · Learner 1', tenantId: 'acme', tenantName: 'Acme Corp', role: 'learner', userId: 'learner-1' },
  { label: 'Globex · Instructor', tenantId: 'globex', tenantName: 'Globex Inc', role: 'instructor', userId: 'inst-1' },
];

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [p, setP] = useState(PRESETS[0]);
  const [pasted, setPasted] = useState('');
  const [err, setErr] = useState('');

  const finish = (token: string) => {
    const s = decodeToken(token);
    if (!s) return setErr('That token is invalid or expired');
    saveToken(token);
    onLogin(s);
  };

  return (
    <div className="login">
      <h1>LabPulse</h1>
      <p className="muted">Real-time lab event hub. Sign in with a development token.</p>
      <div className="card">
        <div className="presets">
          {PRESETS.map((x) => (
            <button key={x.label} className={x.label === p.label ? 'chip active' : 'chip'} onClick={() => setP(x)}>{x.label}</button>
          ))}
        </div>
        <label>Tenant id<input value={p.tenantId} onChange={(e) => setP({ ...p, tenantId: e.target.value })} /></label>
        <label>Tenant name<input value={p.tenantName} onChange={(e) => setP({ ...p, tenantName: e.target.value })} /></label>
        <label>User id<input value={p.userId} onChange={(e) => setP({ ...p, userId: e.target.value })} /></label>
        <label>Role
          <select value={p.role} onChange={(e) => setP({ ...p, role: e.target.value as Role })}>
            <option value="instructor">instructor</option><option value="learner">learner</option>
          </select>
        </label>
        <button className="primary" onClick={() => devLogin(p).then(finish, (e) => setErr(String(e.message)))}>Sign in</button>
        <details>
          <summary>or paste a JWT</summary>
          <textarea rows={3} value={pasted} onChange={(e) => setPasted(e.target.value.trim())} placeholder="eyJhbGciOi..." />
          <button onClick={() => finish(pasted)}>Use token</button>
        </details>
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}
