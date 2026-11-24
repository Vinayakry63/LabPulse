import { useEffect, useMemo, useState } from 'react';
import type { Session } from '../lib/auth';
import { unreadCount, type LearnerRow } from '../lib/store';
import { ago } from '../lib/time';
import { useLabPulse } from '../lib/useLabPulse';
import { AlertsFeed } from './AlertsFeed';
import { Assistant } from './Assistant';
import { ConnectionBadge } from './ConnectionBadge';

const STATUS_LABEL: Record<LearnerRow['status'], string> = {
  in_progress: 'In progress', error: 'Error', timeout: 'Timed out', completed: 'Completed',
};

export function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { state, conn, instance, reconnects, simulateDrop } = useLabPulse(session.token);
  const [lab, setLab] = useState('all');
  const [readUpTo, setReadUpTo] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const isInstructor = session.role === 'instructor';

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (conn === 'unauthorized') onLogout(); }, [conn, onLogout]);

  const unread = unreadCount(state.alerts, readUpTo);
  useEffect(() => { document.title = unread ? `(${unread}) LabPulse` : 'LabPulse'; }, [unread]);

  const labs = useMemo(() => [...new Set([...state.learners.values()].map((l) => l.labId))].sort(), [state.learners]);
  const byLab = useMemo(() => {
    const groups = new Map<string, LearnerRow[]>();
    for (const l of state.learners.values()) {
      if (lab !== 'all' && l.labId !== lab) continue;
      (groups.get(l.labId) ?? groups.set(l.labId, []).get(l.labId)!).push(l);
    }
    for (const rows of groups.values()) rows.sort((a, b) => b.lastSeq - a.lastSeq);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state.learners, lab]);

  const markRead = () => setReadUpTo(state.alerts.at(-1)?.seq ?? 0);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <strong>LabPulse</strong>
          <span className="tenant" title={`tenant id: ${session.tenantId}`}>{session.tenantName}</span>
          <span className="role">{session.role}</span>
        </div>
        <div className="head-right">
          <ConnectionBadge conn={conn} instance={instance} reconnects={reconnects} />
          <button onClick={simulateDrop} title="Drop the socket to demo reconnect + catch-up">Simulate drop</button>
          {isInstructor && (
            <button className="bell" onClick={markRead} aria-label={`Alerts, ${unread} unread`}>
              🔔{unread > 0 && <span className="badge">{unread}</span>}
            </button>
          )}
          <button onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <main>
        <section className="grid-col">
          <div className="toolbar">
            <label>Lab
              <select value={lab} onChange={(e) => setLab(e.target.value)}>
                <option value="all">All labs</option>
                {labs.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <span className="muted">{state.learners.size} learner session(s) · {state.events.length} events · cursor {state.maxSeq}</span>
          </div>

          {byLab.length === 0 && (
            <div className="card empty">
              {conn === 'live' ? 'Waiting for lab activity… run `npm run simulate` in backend/ to generate events.' : 'Connecting…'}
            </div>
          )}
          {byLab.map(([labId, rows]) => (
            <div className="card" key={labId}>
              <div className="card-head">
                <h2>{labId}</h2>
                <div className="summary">
                  {(['in_progress', 'error', 'timeout', 'completed'] as const).map((s) => {
                    const n = rows.filter((r) => r.status === s).length;
                    return n ? <span key={s} className={`pill ${s}`}>{n} {STATUS_LABEL[s].toLowerCase()}</span> : null;
                  })}
                </div>
              </div>
              <table>
                <thead><tr><th>Learner</th><th>Status</th><th>Current step</th><th>Steps done</th><th>Errors</th><th>Last activity</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.learnerId}</td>
                      <td><span className={`pill ${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                      <td>{r.currentStep}</td>
                      <td>{r.stepsCompleted}</td>
                      <td>{r.errors || '—'}</td>
                      <td title={r.lastActivity}>{ago(r.lastActivity, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <aside>
          {isInstructor && <AlertsFeed alerts={state.alerts} readUpTo={readUpTo} onMarkRead={markRead} now={now} />}
          <Assistant token={session.token} role={session.role} />
        </aside>
      </main>
    </div>
  );
}
