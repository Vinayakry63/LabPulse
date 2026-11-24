import { describe, expect, it } from 'vitest';
import { emptyState, mergeEvents, unreadCount, type LabEvent } from './store';

let n = 0;
const ev = (seq: number, type: string, learnerId = 'l1', extra: Partial<LabEvent> = {}): LabEvent => ({
  tenantId: 't', seq, type, labId: 'lab-a', learnerId, step: `step-${seq}`, message: null,
  occurredAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(), idempotencyKey: `k${n++}`, ...extra,
});

const log = [
  ev(1, 'lab.started'), ev(2, 'step.completed'), ev(3, 'lab.error'), ev(4, 'step.completed'),
  ev(5, 'lab.error', 'l2'), ev(6, 'instructor.alert', 'l2'), ev(7, 'lab.completed'),
];

const summarize = (s: ReturnType<typeof emptyState>) => ({
  learners: [...s.learners.values()].map((l) => [l.key, l.status, l.currentStep, l.stepsCompleted, l.errors, l.lastSeq]).sort(),
  alerts: s.alerts.map((a) => a.seq),
  seqs: s.events.map((e) => e.seq),
  maxSeq: s.maxSeq,
});

describe('render by sequence, not arrival order', () => {
  const inOrder = summarize(mergeEvents(emptyState(), log));

  it('in-order delivery builds the expected view', () => {
    expect(inOrder.learners).toContainEqual(['lab-a|l1', 'completed', 'step-7', 2, 1, 7]);
    expect(inOrder.learners).toContainEqual(['lab-a|l2', 'error', 'step-5', 0, 1, 5]);
    expect(inOrder.alerts).toEqual([6]);
  });

  it('fully reversed delivery converges to the identical view', () => {
    let s = emptyState();
    for (const e of [...log].reverse()) s = mergeEvents(s, [e]);
    expect(summarize(s)).toEqual(inOrder);
  });

  it('any random shuffle, split into random batches, with duplicates, converges', () => {
    for (let trial = 0; trial < 200; trial++) {
      const shuffled = [...log, ...log.slice(0, 3)].sort(() => Math.random() - 0.5);
      let s = emptyState();
      for (let i = 0; i < shuffled.length; ) {
        const size = 1 + Math.floor(Math.random() * 3);
        s = mergeEvents(s, shuffled.slice(i, i + size));
        i += size;
      }
      expect(summarize(s)).toEqual(inOrder);
    }
  });

  it('a late, older event does not overwrite a newer state', () => {
    let s = mergeEvents(emptyState(), [ev(10, 'lab.completed')]);
    s = mergeEvents(s, [ev(9, 'lab.error')]); // arrives late
    expect(s.learners.get('lab-a|l1')!.status).toBe('completed');
    expect(s.learners.get('lab-a|l1')!.errors).toBe(1);
  });

  it('is idempotent for duplicates and returns the same object when nothing changed', () => {
    const s = mergeEvents(emptyState(), log);
    expect(mergeEvents(s, log)).toBe(s);
  });

  it('tracks unread alerts by seq', () => {
    const s = mergeEvents(emptyState(), [ev(1, 'instructor.alert'), ev(2, 'instructor.alert'), ev(3, 'instructor.alert')]);
    expect(unreadCount(s.alerts, 0)).toBe(3);
    expect(unreadCount(s.alerts, 2)).toBe(1);
  });
});
