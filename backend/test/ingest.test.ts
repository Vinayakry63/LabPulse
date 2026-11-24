import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventBody, post, setupDb, startTwoInstances, uid } from './helpers';
import type { RunningServer } from '../src/createServer';

let a: RunningServer, b: RunningServer;
beforeAll(async () => {
  await setupDb();
  [a, b] = await startTwoInstances();
});
afterAll(async () => {
  await Promise.all([a.close(), b.close()]);
});

describe('POST /events validation and idempotency (A1)', () => {
  const t = uid('t');

  it('rejects a missing/invalid API key', async () => {
    expect((await post(a, eventBody({ tenantId: t, learnerId: 'l' }), 'nope')).status).toBe(401);
  });

  it('returns precise, field-level validation errors', async () => {
    const r = await post(a, { type: 'lab.exploded', tenantId: 'bad tenant!', labId: '', step: 1, occurredAt: 'yesterday', extra: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('validation_error');
    const paths = r.body.details.map((d: any) => d.path);
    for (const p of ['type', 'tenantId', 'labId', 'learnerId', 'step', 'message', 'occurredAt', 'idempotencyKey']) {
      expect(paths).toContain(p);
    }
    expect(r.body.details.find((d: any) => d.path === 'type').message).toMatch(/lab\.started/);
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    const res = await fetch(`http://127.0.0.1:${a.port}/events`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'dev-ingest-key' }, body: '{oops',
    });
    expect(res.status).toBe(400);
  });

  it('accepts all five event types', async () => {
    for (const type of ['lab.started', 'step.completed', 'lab.error', 'lab.timeout', 'lab.completed']) {
      expect((await post(a, eventBody({ tenantId: t, learnerId: 'all', type }))).status).toBe(201);
    }
  });

  it('duplicate POST returns the original seq and does not create a second row', async () => {
    const body = eventBody({ tenantId: t, learnerId: 'dup' });
    const first = await post(a, body);
    const second = await post(b, body);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body.seq).toBe(first.body.seq);
  });

  it('same key, different payload => 409', async () => {
    const body = eventBody({ tenantId: t, learnerId: 'conf' });
    await post(a, body);
    const r = await post(a, { ...body, message: 'tampered' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('idempotency_conflict');
  });

  it('concurrent identical POSTs create exactly one event', async () => {
    const body = eventBody({ tenantId: uid('t'), learnerId: 'race' });
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => post(i % 2 ? a : b, body)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(9);
    expect(new Set(rs.map((r) => r.body.seq)).size).toBe(1);
  });

  it('assigns a gap-free, strictly increasing per-tenant sequence under concurrency', async () => {
    const tt = uid('t');
    const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => post(i % 2 ? a : b, eventBody({ tenantId: tt, learnerId: `c${i}` }))));
    const seqs = rs.map((r) => r.body.seq as number).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});
