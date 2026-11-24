import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlertDetector } from '../src/events/alerts';
import { config } from '../src/config';
import { client, eventBody, post, setupDb, sleep, startTwoInstances, token, uid } from './helpers';
import type { RunningServer } from '../src/createServer';

let a: RunningServer, b: RunningServer;
beforeAll(async () => {
  await setupDb();
  [a, b] = await startTwoInstances();
});
afterAll(async () => {
  await Promise.all([a.close(), b.close()]);
});

describe('alert rule (A5): 3 lab.error within 2 minutes', () => {
  it('fires exactly once per episode even when errors hit both instances concurrently', async () => {
    const t = uid('t');
    const inst = client(a, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    await inst.caughtUp;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        post(i % 2 ? a : b, eventBody({ tenantId: t, learnerId: 'dave', type: 'lab.error', message: `e${i}` })),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    await inst.until((e) => e.some((x) => x.type === 'instructor.alert'));
    await sleep(500);
    expect(inst.events.filter((e) => e.type === 'instructor.alert')).toHaveLength(1);
    expect(inst.events.filter((e) => e.type === 'lab.error')).toHaveLength(6);
    inst.close();
  });

  it('delivers the alert under the dedicated instructor.alert event to instructors only, exactly once', async () => {
    const t = uid('t');
    const inst = client(a, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    const other = client(b, token({ tenantId: t, role: 'instructor', sub: 'i2' }));
    const learner = client(b, token({ tenantId: t, role: 'learner', sub: 'kim' }));
    await Promise.all([inst.caughtUp, other.caughtUp, learner.caughtUp]);
    for (let n = 0; n < 4; n++) await post(n % 2 ? a : b, eventBody({ tenantId: t, learnerId: 'kim', type: 'lab.error', message: `e${n}` }));
    await inst.until(() => inst.alerts.length >= 1);
    await other.until(() => other.alerts.length >= 1);
    await sleep(500);
    expect(inst.alerts).toHaveLength(1);
    expect(other.alerts).toHaveLength(1);
    expect(inst.alerts[0]).toMatchObject({ type: 'instructor.alert', learnerId: 'kim', tenantId: t });
    expect(inst.alerts[0].seq).toBe(inst.events.find((e) => e.type === 'instructor.alert')!.seq);
    expect(learner.alerts).toHaveLength(0);
    expect(learner.events.some((e) => e.type === 'instructor.alert')).toBe(false);
    inst.close(); other.close(); learner.close();
  });

  it('does not fire for two errors, or for errors spread across different learners', async () => {
    const t = uid('t');
    const inst = client(a, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    await inst.caughtUp;
    await post(a, eventBody({ tenantId: t, learnerId: 'e1', type: 'lab.error' }));
    await post(b, eventBody({ tenantId: t, learnerId: 'e1', type: 'lab.error' }));
    await post(a, eventBody({ tenantId: t, learnerId: 'e2', type: 'lab.error' }));
    await inst.until((e) => e.length >= 3);
    await sleep(300);
    expect(inst.events.some((e) => e.type === 'instructor.alert')).toBe(false);
    inst.close();
  });

  it('a duplicate POST (same idempotencyKey) is not double counted', async () => {
    const t = uid('t');
    const inst = client(a, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    await inst.caughtUp;
    const dup = eventBody({ tenantId: t, learnerId: 'f', type: 'lab.error' });
    const first = await post(a, dup);
    const again = await post(b, dup);
    await post(a, eventBody({ tenantId: t, learnerId: 'f', type: 'lab.error' }));
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('duplicate');
    expect(again.body.seq).toBe(first.body.seq);
    await sleep(400);
    expect(inst.events.some((e) => e.type === 'instructor.alert')).toBe(false); // only 2 distinct errors
    inst.close();
  });

  describe('sliding window + episode re-arming (injected clock)', () => {
    const redis = new Redis(config.redisUrl);
    afterAll(() => void redis.disconnect());
    const d = new AlertDetector(redis, 3, 120_000);

    it('errors older than 2 minutes slide out of the window', async () => {
      const t = uid('t');
      const T = 1_700_000_000_000;
      expect(await d.recordError(t, 'l', 'a', T)).toBe(0);
      expect(await d.recordError(t, 'l', 'b', T + 60_000)).toBe(0);
      // third error arrives 130s after the first: window holds only b + c => no alert
      expect(await d.recordError(t, 'l', 'c', T + 130_000)).toBe(0);
      // fourth within 2 min of b and c => alert
      expect(await d.recordError(t, 'l', 'd', T + 140_000)).toBe(3);
    });

    it('fires once per episode, then re-arms after the learner recovers', async () => {
      const t = uid('t');
      const T = 1_700_000_000_000;
      const fired: number[] = [];
      const rec = async (offsetMs: number, id: string) => {
        if (await d.recordError(t, 'l', id, T + offsetMs)) fired.push(offsetMs);
      };
      await rec(0, '1'); await rec(10_000, '2'); await rec(20_000, '3'); // episode 1 opens
      await rec(30_000, '4'); await rec(40_000, '5');                    // same episode: silent
      expect(fired).toEqual([20_000]);
      await rec(400_000, '6');                                           // window cleared => episode over
      await rec(410_000, '7'); await rec(420_000, '8');                  // episode 2 opens
      expect(fired).toEqual([20_000, 420_000]);
    });

    it('is exactly-once under concurrent evaluation from many callers', async () => {
      const t = uid('t');
      const T = Date.now();
      const results = await Promise.all(Array.from({ length: 25 }, (_, i) => d.recordError(t, 'l', `m${i}`, T + i)));
      expect(results.filter((r) => r > 0)).toHaveLength(1);
    });
  });
});
