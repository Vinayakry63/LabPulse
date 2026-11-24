import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const API = 'http://localhost:8080';
const DIR = new URL('..', import.meta.url).pathname;
const T = `fault-redis-${randomUUID().slice(0, 6)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const sh = (c) => execSync(c, { cwd: DIR, stdio: 'pipe' }).toString();

async function post(type, learnerId, message) {
  const t0 = Date.now();
  const res = await fetch(`${API}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'dev-ingest-key' },
    body: JSON.stringify({ type, tenantId: T, labId: 'lab-x', learnerId, step: 's', message, occurredAt: new Date().toISOString(), idempotencyKey: randomUUID() }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, body: await res.json(), ms: Date.now() - t0 };
}

const tok = (await (await fetch(`${API}/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: T, role: 'instructor', userId: 'i' }) })).json()).token;
const seen = [];
const socket = io(API, { transports: ['websocket'], auth: (cb) => cb({ token: tok, ...(seen.length && { cursor: Math.max(...seen.map((e) => e.seq)) }) }), forceNew: true });
socket.on('events', (b) => seen.push(...b));
await new Promise((r) => socket.once('caught_up', r));

try {
  await post('lab.started', 'a', 'before outage');
  await sleep(300);
  check('baseline: live delivery works', seen.length === 1);

  sh('docker compose stop redis');
  console.log('--- redis stopped');
  await sleep(500);
  const r1 = await post('step.completed', 'a', 'during outage 1');
  check('POST still succeeds with Redis down (201)', r1.status === 201, `status=${r1.status} ms=${r1.ms}`);
  check('response says delivered:false (persisted, not announced)', r1.body.delivered === false, JSON.stringify(r1.body));
  check('POST does not hang (< 5 s)', r1.ms < 5000, `${r1.ms}ms`);
  const r2 = await post('lab.error', 'b', 'e1');
  const r3 = await post('lab.error', 'b', 'e2');
  const r4 = await post('lab.error', 'b', 'e3');
  check('3 more POSTs succeed (alert evaluation fails open)', [r2, r3, r4].every((r) => r.status === 201), [r2, r3, r4].map((r) => `${r.status}/${r.ms}ms`).join(' '));
  const h = await (await fetch(`${API}/health`)).json();
  check('/health reports degraded + redis:false', h.redis === false && h.status === 'degraded', JSON.stringify(h));
  const dup = await post('lab.started', 'dup', 'x');
  check('socket stayed connected during the outage', socket.connected);

  sh('docker compose start redis');
  console.log('--- redis started');
  const ok = await (async () => { for (let i = 0; i < 80; i++) { if (seen.length >= 6) return true; await sleep(250); } return false; })();
  const seqs = seen.map((e) => e.seq);
  check('after Redis returns, client receives the events it missed', ok, `got ${seen.length}/6 events: seqs=${seqs.join(',')}`);
  check('in order, no duplicates, no gaps', seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1) && new Set(seqs).size === seqs.length, seqs.join(','));

  const before = seen.length;
  await post('lab.completed', 'a', 'after recovery');
  await sleep(600);
  check('live delivery resumes after recovery', seen.length === before + 1);
  const h2 = await (await fetch(`${API}/health`)).json();
  check('/health back to ok', h2.status === 'ok', JSON.stringify(h2));
} finally {
  try { sh('docker compose start redis'); } catch {}
  socket.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
