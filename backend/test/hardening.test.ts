import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '../src/auth';
import { config } from '../src/config';
import type { RunningServer } from '../src/createServer';
import { AlertDetector } from '../src/events/alerts';
import { EVENTS_CHANNEL } from '../src/events/ingest';
import { client, eventBody, post, setupDb, sleep, startTwoInstances, token, uid } from './helpers';

let a: RunningServer, b: RunningServer;
beforeAll(async () => {
  await setupDb();
  [a, b] = await startTwoInstances();
});
afterAll(async () => {
  await Promise.all([a.close(), b.close()]);
});

/** Commit an event to Postgres WITHOUT announcing it: what a crash between COMMIT and PUBLISH leaves behind. */
function commitWithoutPublish(s: RunningServer, tenantId: string, learnerId: string, message: string) {
  return s.store.withTenantLock(tenantId, (c) =>
    s.store.append(c, {
      tenantId, type: 'lab.error', labId: 'lab-x', learnerId, step: 's', message,
      occurredAt: new Date().toISOString(), idempotencyKey: `unpublished-${randomUUID()}`, hash: 'h',
    }),
  );
}
const seqs = (c: { events: { seq: number }[] }) => c.events.map((e) => e.seq);

describe('a committed-but-never-announced event must not be skipped', () => {
  it('is delivered, in order, when the next event reveals the gap', async () => {
    const t = uid('t');
    const c = client(a, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    await c.caughtUp;
    await post(b, eventBody({ tenantId: t, learnerId: 'x' }));              // seq 1
    await c.until((e) => e.length === 1);
    await commitWithoutPublish(a, t, 'x', 'lost-publish');                    // seq 2, never announced
    await post(b, eventBody({ tenantId: t, learnerId: 'x' }));              // seq 3
    await c.until((e) => e.length === 3);
    await sleep(200);
    expect(seqs(c)).toEqual([1, 2, 3]);
    c.close();
  });

  it('a reconnect afterwards still has everything (the cursor never jumped over the hole)', async () => {
    const t = uid('t');
    const tok = token({ tenantId: t, role: 'instructor', sub: 'i' });
    const c1 = client(a, tok);
    await c1.caughtUp;
    await post(a, eventBody({ tenantId: t, learnerId: 'x' }));
    await commitWithoutPublish(b, t, 'x', 'lost');
    await post(a, eventBody({ tenantId: t, learnerId: 'x' }));
    await c1.until((e) => e.length === 3);
    const cursor = Math.max(...seqs(c1));
    c1.close();
    const c2 = client(b, tok, 0);
    await c2.caughtUp;
    expect(seqs(c2)).toEqual([1, 2, 3]);
    expect(cursor).toBe(3);
    c2.close();
  });

  it('the periodic sweep finds a lost LAST event even when nothing newer ever arrives', async () => {
    const t = uid('t');
    const c = client(a, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    await c.caughtUp;
    await post(a, eventBody({ tenantId: t, learnerId: 'x' }));
    await c.until((e) => e.length === 1);
    await commitWithoutPublish(b, t, 'x', 'last-and-lost');
    await c.until((e) => e.length === 2, 5000); // HUB_SWEEP_MS=300 in tests
    expect(seqs(c)).toEqual([1, 2]);
    c.close();
  });

  it('a learner socket stays correct: no one else\'s events, and its own lost event is recovered', async () => {
    const t = uid('t');
    const l = client(a, token({ tenantId: t, role: 'learner', sub: 'mine' }));
    await l.caughtUp;
    await post(b, eventBody({ tenantId: t, learnerId: 'mine', message: 'm1' }));      // seq 1 (mine)
    await commitWithoutPublish(b, t, 'someone-else', 'not-for-me');                   // seq 2 (other learner, lost)
    await commitWithoutPublish(b, t, 'mine', 'mine-but-lost');                        // seq 3 (mine, lost)
    await post(b, eventBody({ tenantId: t, learnerId: 'someone-else', message: 'x' })); // seq 4 (other, announced)
    await l.until((e) => e.some((x) => x.message === 'mine-but-lost'), 5000);
    await sleep(500);
    expect(l.events.map((e) => e.message)).toEqual(['m1', 'mine-but-lost']);
    l.close();
  });

  it('a malformed Redis message is ignored and does not crash the instance', async () => {
    const t = uid('t');
    const c = client(a, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    await c.caughtUp;
    const r = new Redis(config.redisUrl);
    await r.publish(EVENTS_CHANNEL, '{this is not json');
    await r.quit();
    await post(a, eventBody({ tenantId: t, learnerId: 'x' }));
    await c.until((e) => e.length === 1);
    c.close();
  });
});

describe('noisy neighbour isolation', () => {
  it('a quiet tenant keeps its latency while another tenant floods the same instance', async () => {
    const hot = uid('hot'), quiet = uid('quiet');
    let stop = false;
    // sustained flood: 150 concurrent writers for the same tenant, all through ONE instance
    const flood = Array.from({ length: 150 }, async () => {
      while (!stop) await post(a, eventBody({ tenantId: hot, learnerId: 'h' }));
    });
    await sleep(300); // let the flood saturate
    const lat: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t0 = Date.now();
      const r = await post(a, eventBody({ tenantId: quiet, learnerId: 'q' }));
      lat.push(Date.now() - t0);
      expect(r.status).toBe(201);
      await sleep(50);
    }
    stop = true;
    await Promise.all(flood);
    const worst = Math.max(...lat);
    const p50 = [...lat].sort((x, y) => x - y)[Math.floor(lat.length / 2)];
    console.log(`quiet tenant during flood: p50=${p50}ms max=${worst}ms`);
    expect(p50).toBeLessThan(250);
    expect(worst).toBeLessThan(1500);
  });
});

describe('alert claim and key hygiene', () => {
  const redis = new Redis(config.redisUrl);
  afterAll(() => void redis.disconnect());

  it('releasing a claimed episode lets the next error raise the alert again', async () => {
    const d = new AlertDetector(redis, 3, 120_000);
    const t = uid('t'), T = Date.now();
    await d.recordError(t, 'l', 'a', T); await d.recordError(t, 'l', 'b', T + 1);
    expect(await d.recordError(t, 'l', 'c', T + 2)).toBe(3);   // claimed
    expect(await d.recordError(t, 'l', 'd', T + 3)).toBe(0);   // silent: same episode
    await d.releaseEpisode(t, 'l');                            // the alert row could not be saved
    expect(await d.recordError(t, 'l', 'e', T + 4)).toBeGreaterThan(0);
  });

  it('rejects client idempotency keys in the reserved alert: namespace', async () => {
    const r = await post(a, eventBody({ tenantId: uid('t'), learnerId: 'x', idempotencyKey: 'alert:x:1234567' }));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.details)).toMatch(/reserved/);
  });
});

describe('session lifetime', () => {
  it('a socket is closed when its JWT expires', async () => {
    const t = uid('t');
    const short = signToken({ sub: 'i', tenantId: t, role: 'instructor' }, 2);
    const c = client(a, short);
    await c.caughtUp;
    expect(c.socket.connected).toBe(true);
    await sleep(3000);
    expect(c.socket.connected).toBe(false);
    c.close();
  });
});
