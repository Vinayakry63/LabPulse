import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const API = 'http://localhost:8080';
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? 'labpulse';
const CLONE = process.env.COMPOSE_DIR ?? new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const psql = (sql) => execSync(`docker compose -p ${PROJECT} exec -T postgres psql -U labpulse -d labpulse -c "${sql}"`, { cwd: CLONE, stdio: 'pipe' }).toString();

const body = (tenantId, learnerId, extra = {}) => ({
  type: 'step.completed', tenantId, labId: 'lab-x', learnerId, step: 's', message: 'm',
  occurredAt: new Date().toISOString(), idempotencyKey: randomUUID(), ...extra,
});
const post = async (b) => {
  const t0 = performance.now();
  try {
    const r = await fetch(`${API}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'dev-ingest-key' }, body: JSON.stringify(b), signal: AbortSignal.timeout(20000) });
    return { status: r.status, ms: performance.now() - t0, body: await r.json() };
  } catch { return { status: 'error', ms: performance.now() - t0 }; }
};
const token = async (tenantId, role = 'instructor', userId = 'i') =>
  (await (await fetch(`${API}/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, role, userId }) })).json()).token;

// ---------------- PROBE 1: noisy neighbour
console.log('--- PROBE 1: one hot tenant (200 concurrent POSTs) vs a quiet tenant doing 1 POST / 100 ms');
{
  const HOT = `hot-${randomUUID().slice(0, 6)}`, COLD = `cold-${randomUUID().slice(0, 6)}`;
  const base = [];
  for (let i = 0; i < 20; i++) { base.push((await post(body(COLD, 'q'))).ms); await sleep(50); }
  console.log(`    quiet tenant alone:        p50=${pct(base, 50).toFixed(0)}ms p95=${pct(base, 95).toFixed(0)}ms`);
  let stop = false, hotDone = 0, hotErr = 0;
  const hot = Array.from({ length: 200 }, async () => { while (!stop) { const r = await post(body(HOT, `h${hotDone % 50}`)); hotDone++; if (r.status !== 201) hotErr++; } });
  await sleep(500);
  const cold = [], coldStatus = {};
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) { const r = await post(body(COLD, 'q')); cold.push(r.ms); coldStatus[r.status] = (coldStatus[r.status] ?? 0) + 1; await sleep(100); }
  stop = true; await Promise.all(hot);
  console.log(`    quiet tenant UNDER the hot burst: n=${cold.length} p50=${pct(cold, 50).toFixed(0)}ms p95=${pct(cold, 95).toFixed(0)}ms max=${Math.max(...cold).toFixed(0)}ms statuses=${JSON.stringify(coldStatus)}  (hot tenant: ${hotDone} posts, ${hotErr} non-201)`);
  check('quiet tenant is not starved by a noisy one (all 201, p95 < 1000 ms)', Object.keys(coldStatus).every((s) => s === '201') && pct(cold, 95) < 1000, `p95=${pct(cold, 95).toFixed(0)}ms`);
}

// ---------------- PROBE 2: a committed event whose publish never happened
console.log('--- PROBE 2: event committed to Postgres but never published (crash / publish failure), then later events arrive');
{
  const T = `lostpub-${randomUUID().slice(0, 6)}`;
  const tok = await token(T);
  const seen = [];
  let cursor = 0;
  const connect = () => {
    const s = io(API, { transports: ['websocket'], auth: (cb) => cb({ token: tok, ...(cursor > 0 && { cursor }) }), forceNew: true, reconnection: false });
    s.on('events', (b) => { for (const e of b) { seen.push(e.seq); cursor = Math.max(cursor, e.seq); } });
    return s;
  };
  let s = connect();
  await new Promise((r) => s.once('caught_up', r));
  await post(body(T, 'a'));                              // seq 1, delivered normally
  await sleep(300);
  psql(`UPDATE tenant_seq SET last_seq = 2 WHERE tenant_id = '${T}'; INSERT INTO events (tenant_id, seq, type, lab_id, learner_id, step, message, occurred_at, idempotency_key, payload_hash) VALUES ('${T}', 2, 'lab.error', 'lab-x', 'a', 's', 'committed-but-never-published', now(), '${randomUUID()}', 'h');`);
  await post(body(T, 'a'));                              // seq 3, published normally
  await sleep(1500);
  console.log(`    live socket saw seqs: [${seen.join(',')}]  (DB has 1,2,3)`);
  check('connected client receives the unpublished event (seq 2) without reconnecting', seen.includes(2), `saw [${seen.join(',')}]`);
  s.close(); await sleep(200);
  s = connect();                                          // reconnects with cursor = max seen
  await new Promise((r) => s.once('caught_up', r));
  await sleep(500);
  check('after a reconnect the client has every event 1..3', [1, 2, 3].every((n) => seen.includes(n)), `saw [${[...new Set(seen)].join(',')}] cursor=${cursor}`);
  s.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
