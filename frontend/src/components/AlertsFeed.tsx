import type { LabEvent } from '../lib/store';
import { ago } from '../lib/time';

export function AlertsFeed({ alerts, readUpTo, onMarkRead, now }: { alerts: LabEvent[]; readUpTo: number; onMarkRead: () => void; now: number }) {
  const unread = alerts.filter((a) => a.seq > readUpTo).length;
  return (
    <div className="card alerts">
      <div className="card-head">
        <h2>Alerts {unread > 0 && <span className="badge" aria-label={`${unread} unread alerts`}>{unread}</span>}</h2>
        <button onClick={onMarkRead} disabled={unread === 0}>Mark all read</button>
      </div>
      {alerts.length === 0 && <p className="muted">No alerts. An alert fires when a learner raises 3 errors within 2 minutes.</p>}
      <ul>
        {[...alerts].reverse().map((a) => (
          <li key={a.seq} className={a.seq > readUpTo ? 'unread' : ''}>
            <strong>{a.learnerId}</strong> <span className="muted">in {a.labId}</span>
            <div>{a.message}</div>
            <small className="muted">step “{a.step}” · {ago(a.occurredAt, now)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
