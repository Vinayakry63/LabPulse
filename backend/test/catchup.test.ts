import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const seqs = (c: { events: { seq: number }[] }) => c.events.map((e) => e.seq);
const strictlyIncreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

describe('cursor catch-up (A4)', () => {
  it('replays every missed event in order, with no duplicates, on a different instance', async () => {
    const t = uid('t');
    const tok = token({ tenantId: t, role: 'instructor', sub: 'inst' });

    const c1 = client(a, tok);
    await c1.caughtUp;
    for (let i = 0; i < 5; i++) await post(a, eventBody({ tenantId: t, learnerId: `l${i}` }));
    await c1.until((e) => e.length === 5);
    const cursor = c1.events[c1.events.length - 1].seq;
    c1.close(); // network drop

    // 7 events happen while the client is away (posted via both instances)
    for (let i = 0; i < 7; i++) await post(i % 2 ? a : b, eventBody({ tenantId: t, learnerId: `m${i}` }));

    const c2 = client(b, tok, cursor); // reconnects to the OTHER instance
    await c2.caughtUp;
    await c2.until((e) => e.length === 7);
    await sleep(200);
    expect(c2.events).toHaveLength(7);
    expect(strictlyIncreasing(seqs(c2))).toBe(true);
    expect(seqs(c2)[0]).toBe(cursor + 1);
    expect(new Set(seqs(c2)).size).toBe(7);
    c2.close();
  });

  it('is gap-free and duplicate-free when events keep arriving DURING the replay', async () => {
    const t = uid('t');
    const tok = token({ tenantId: t, role: 'instructor', sub: 'inst' });
    for (let i = 0; i < 40; i++) await post(a, eventBody({ tenantId: t, learnerId: `pre${i}` }));

    const c = client(b, tok, 0);
    // fire a concurrent burst through both instances while the socket is catching up
    const burst = Array.from({ length: 60 }, (_, i) => post(i % 2 ? a : b, eventBody({ tenantId: t, learnerId: `burst${i}` })));
    await Promise.all(burst);
    await c.until((e) => e.length === 100);
    await sleep(300);

    expect(c.events).toHaveLength(100);
    expect(strictlyIncreasing(seqs(c))).toBe(true);
    expect(seqs(c)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1)); // contiguous 1..100
    c.close();
  });

  it('a first-ever connection (no cursor) gets a snapshot then live events, no duplicates', async () => {
    const t = uid('t');
    for (let i = 0; i < 3; i++) await post(a, eventBody({ tenantId: t, learnerId: `x${i}` }));
    const c = client(b, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    await c.caughtUp;
    await post(a, eventBody({ tenantId: t, learnerId: 'live' }));
    await c.until((e) => e.length === 4);
    await sleep(200);
    expect(seqs(c)).toEqual([1, 2, 3, 4]);
    c.close();
  });

  it('resumes from the cursor even if the cursor is ahead of nothing (no events lost, none repeated)', async () => {
    const t = uid('t');
    const tok = token({ tenantId: t, role: 'instructor', sub: 'i' });
    const first = await post(a, eventBody({ tenantId: t, learnerId: 'l' }));
    const c = client(a, tok, first.body.seq);
    await c.caughtUp;
    await sleep(150);
    expect(c.events).toHaveLength(0); // already seen it: nothing replayed
    c.close();
  });
});
