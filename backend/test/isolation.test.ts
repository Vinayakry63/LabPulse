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

describe('tenant isolation (A3)', () => {
  it('never delivers another tenant\'s events, on either instance', async () => {
    const t1 = uid('t1'), t2 = uid('t2');
    const i1 = client(a, token({ tenantId: t1, role: 'instructor', sub: 'inst' }));
    const i2 = client(b, token({ tenantId: t2, role: 'instructor', sub: 'inst' }));
    await Promise.all([i1.caughtUp, i2.caughtUp]);

    // post through the *other* instance than the one holding the socket
    await post(b, eventBody({ tenantId: t1, learnerId: 'l1', message: 'for-t1' }));
    await post(a, eventBody({ tenantId: t2, learnerId: 'l1', message: 'for-t2' }));

    await i1.until((e) => e.length >= 1);
    await i2.until((e) => e.length >= 1);
    await sleep(300);
    expect(i1.events.map((e) => e.message)).toEqual(['for-t1']);
    expect(i2.events.map((e) => e.message)).toEqual(['for-t2']);
    expect(i1.events.every((e) => e.tenantId === t1)).toBe(true);
    i1.close(); i2.close();
  });

  it('learners only receive their own events (live and on replay)', async () => {
    const t = uid('t');
    await post(a, eventBody({ tenantId: t, learnerId: 'alice', message: 'old-alice' }));
    await post(a, eventBody({ tenantId: t, learnerId: 'bob', message: 'old-bob' }));

    const alice = client(b, token({ tenantId: t, role: 'learner', sub: 'alice' }), 0);
    await alice.caughtUp;
    await post(a, eventBody({ tenantId: t, learnerId: 'bob', message: 'live-bob' }));
    await post(a, eventBody({ tenantId: t, learnerId: 'alice', message: 'live-alice' }));
    await alice.until((e) => e.some((x) => x.message === 'live-alice'));
    await sleep(300);
    expect(alice.events.map((e) => e.message)).toEqual(['old-alice', 'live-alice']);
    alice.close();
  });

  it('learners never receive instructor alerts, instructors do', async () => {
    const t = uid('t');
    const inst = client(a, token({ tenantId: t, role: 'instructor', sub: 'i' }));
    const learner = client(b, token({ tenantId: t, role: 'learner', sub: 'carol' }));
    await Promise.all([inst.caughtUp, learner.caughtUp]);
    for (let n = 0; n < 3; n++) {
      await post(a, eventBody({ tenantId: t, learnerId: 'carol', type: 'lab.error', message: `boom ${n}` }));
    }
    await inst.until((e) => e.some((x) => x.type === 'instructor.alert'));
    await learner.until((e) => e.length >= 3);
    await sleep(300);
    expect(learner.events.map((e) => e.type)).toEqual(['lab.error', 'lab.error', 'lab.error']);
    inst.close(); learner.close();
  });

  it('rejects missing, forged and expired tokens', async () => {
    const t = uid('t');
    const bad = client(a, 'not-a-jwt');
    const err = await new Promise<Error>((r) => bad.socket.once('connect_error', r));
    expect(err.message).toBe('unauthorized');
    const forged = client(a, (await import('jsonwebtoken')).default.sign({ sub: 'x', tenantId: t, role: 'instructor' }, 'wrong-secret'));
    const err2 = await new Promise<Error>((r) => forged.socket.once('connect_error', r));
    expect(err2.message).toBe('unauthorized');
    bad.close(); forged.close();
  });

  it('a client cannot widen its scope by sending another tenant in the handshake', async () => {
    const mine = uid('mine'), theirs = uid('theirs');
    await post(a, eventBody({ tenantId: theirs, learnerId: 'x', message: 'secret' }));
    const c = client(a, token({ tenantId: mine, role: 'instructor', sub: 'i' }), 0);
    (c.socket.auth as any).tenantId = theirs;
    await c.caughtUp;
    await sleep(200);
    expect(c.events).toHaveLength(0);
    c.close();
  });
});
