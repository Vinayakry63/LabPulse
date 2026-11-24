import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const API = 'http://localhost:8080';
const DIR = new URL('..', import.meta.url).pathname;
const T = `fault-pg-${randomUUID().slice(0, 6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sh = (c) => execSync(c, { cwd: DIR, stdio: 'pipe' }).toString();

async function post(key, learnerId = 'a') {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'dev-ingest-key' },
      body: JSON.stringify({ type: 'step.completed', tenantId: T, labId: 'lab-x', learnerId, step: 's', message: 'm', occurredAt: '2026-11-22T10:00:00Z', idempotencyKey: key }),
      signal: AbortSignal.timeout(25000),
    });
    return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json(), ms: Date.now() - t0 };
  } catch (e) {
    return { status: 'client-timeout/error', err: e.message, ms: Date.now() - t0 };
  }
}

try {
  const key = `pg-key-${randomUUID()}`;
  const ok = await post('warmup-' + randomUUID());
  check('baseline POST works', ok.status === 201, `${ok.ms}ms`);

  sh('docker compose pause postgres');
  console.log('--- postgres paused (frozen, accepts nothing)');
  const slow = await post(key);
  console.log('    result while paused:', JSON.stringify(slow));
  check('POST fails FAST with a clean 503 (not a hang)', slow.status === 503 && slow.ms < 10000, `status=${slow.status} after ${slow.ms}ms`);
  check('503 carries Retry-After', !!slow.retryAfter, `retry-after=${slow.retryAfter}`);
  const h = await fetch(`${API}/health`, { signal: AbortSignal.timeout(15000) }).then((r) => r.status).catch((e) => e.message);
  console.log('    /health while paused:', h);

  sh('docker compose unpause postgres');
  console.log('--- postgres unpaused');
  await sleep(1500);
  const retry = await post(key);
  check('retry with the SAME idempotency key succeeds after recovery', retry.status === 201 || retry.status === 200, `status=${retry.status} ${retry.ms}ms`);
  const again = await post(key);
  check('and is not duplicated', again.status === 200 && again.body.status === 'duplicate', JSON.stringify(again.body));
  const others = await Promise.all(Array.from({ length: 10 }, (_, i) => post(`after-${i}-${randomUUID()}`, `l${i}`)));
  check('service fully healthy again (10 concurrent POSTs)', others.every((r) => r.status === 201), others.map((r) => r.status).join(','));
} finally {
  try { sh('docker compose unpause postgres'); } catch {}
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
