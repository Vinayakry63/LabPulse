export interface LabEvent {
  tenantId: string;
  seq: number;
  type: string;
  labId: string;
  learnerId: string | null;
  step: string | null;
  message: string | null;
  occurredAt: string;
  idempotencyKey: string;
}

export type LearnerStatus = 'in_progress' | 'error' | 'timeout' | 'completed';

export interface LearnerRow {
  key: string;
  labId: string;
  learnerId: string;
  status: LearnerStatus;
  currentStep: string;
  stepsCompleted: number;
  errors: number;
  lastActivity: string;
  lastSeq: number;
}

export interface StoreState {
  /** every event we know, strictly ascending by seq, no duplicates */
  events: LabEvent[];
  learners: Map<string, LearnerRow>;
  alerts: LabEvent[];
  maxSeq: number;
}

export const emptyState = (): StoreState => ({ events: [], learners: new Map(), alerts: [], maxSeq: 0 });

function applyToLearners(learners: Map<string, LearnerRow>, e: LabEvent) {
  if (!e.learnerId || e.type === 'instructor.alert') return;
  const key = `${e.labId}|${e.learnerId}`;
  const prev = learners.get(key);
  const row: LearnerRow = prev ?? {
    key, labId: e.labId, learnerId: e.learnerId, status: 'in_progress', currentStep: '—',
    stepsCompleted: 0, errors: 0, lastActivity: e.occurredAt, lastSeq: 0,
  };
  const next = { ...row, lastSeq: e.seq, lastActivity: e.occurredAt, currentStep: e.step ?? row.currentStep };
  switch (e.type) {
    case 'lab.started': next.status = 'in_progress'; next.stepsCompleted = 0; next.errors = 0; break;
    case 'step.completed': next.status = 'in_progress'; next.stepsCompleted += 1; break;
    case 'lab.error': next.status = 'error'; next.errors += 1; break;
    case 'lab.timeout': next.status = 'timeout'; break;
    case 'lab.completed': next.status = 'completed'; break;
  }
  learners.set(key, next);
}

/** Derived view is a pure function of the seq-sorted log, so arrival order can never matter. */
function fold(events: LabEvent[]): Pick<StoreState, 'learners' | 'alerts'> {
  const learners = new Map<string, LearnerRow>();
  const alerts: LabEvent[] = [];
  for (const e of events) {
    if (e.type === 'instructor.alert') alerts.push(e);
    else applyToLearners(learners, e);
  }
  return { learners, alerts };
}

/**
 * Merge a batch of events (any order, may contain duplicates / already-seen events).
 * Fast path: strictly newer events fold incrementally. Out-of-order events are
 * inserted at their sorted position and the view is re-derived from the log.
 */
export function mergeEvents(state: StoreState, batch: LabEvent[]): StoreState {
  if (batch.length === 0) return state;
  const sortedBatch = [...batch].sort((a, b) => a.seq - b.seq);
  let events = state.events;
  let learners = state.learners;
  let alerts = state.alerts;
  let maxSeq = state.maxSeq;
  let copied = false;
  let outOfOrder = false;
  const known = new Set<number>();
  const lastKnown = (s: number) => {
    // duplicate check against the (sorted) log: binary search
    let lo = 0, hi = events.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].seq === s) return true;
      if (events[mid].seq < s) lo = mid + 1; else hi = mid - 1;
    }
    return false;
  };

  for (const e of sortedBatch) {
    if (known.has(e.seq) || lastKnown(e.seq)) continue; // duplicate: at-least-once => idempotent
    known.add(e.seq);
    if (!copied) { events = [...events]; learners = new Map(learners); alerts = [...alerts]; copied = true; }
    if (e.seq > maxSeq) {
      events.push(e);
      maxSeq = e.seq;
      if (e.type === 'instructor.alert') alerts.push(e);
      else applyToLearners(learners, e);
    } else {
      let lo = 0, hi = events.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].seq < e.seq) lo = mid + 1; else hi = mid; }
      events.splice(lo, 0, e);
      outOfOrder = true;
    }
  }
  if (!copied) return state;
  if (outOfOrder) ({ learners, alerts } = fold(events));
  return { events, learners, alerts, maxSeq };
}

export function unreadCount(alerts: LabEvent[], readUpTo: number) {
  return alerts.reduce((n, a) => (a.seq > readUpTo ? n + 1 : n), 0);
}
