import type { ConnState } from '../lib/useLabPulse';

const LABEL: Record<ConnState, string> = {
  connecting: 'Connecting…',
  catching_up: 'Catching up…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  unauthorized: 'Session expired',
};

export function ConnectionBadge({ conn, instance, reconnects }: { conn: ConnState; instance: string; reconnects: number }) {
  return (
    <span className={`conn ${conn}`} role="status" aria-live="polite" title={reconnects ? `${reconnects} reconnect(s) this session` : undefined}>
      <i className="dot" />
      {LABEL[conn]}
      {conn === 'live' && instance && <small> · {instance}</small>}
    </span>
  );
}
