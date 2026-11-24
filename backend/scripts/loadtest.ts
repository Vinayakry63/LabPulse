/**
 * Load test for the ingest -> persist -> Redis -> WebSocket path.
 *   npm run loadtest -- --url http://localhost:8080 --events 1000 --seconds 30 --tenants 3 --learners 30
 *   npm run loadtest -- --burst --events 5000 --concurrency 200      (as fast as possible)
 * End-to-end latency = (instructor socket receives event) - (moment the POST was sent).
 */
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const URL_ = arg('url', 'http://localhost:8080');
const EVENTS = Number(arg('events', '1000'));
const SECONDS = Number(arg('seconds', '30'));
const TENANTS = Number(arg('tenants', '3'));
const LEARNERS = Number(arg('learners', '30'));
const CONCURRENCY = Number(arg('concurrency', '200'));
const API_KEY = arg('api-key', process.env.INGEST_API_KEY ?? 'dev-ingest-key');
const BURST = flag('burst');
const RUN = randomUUID().slice(0, 6);

const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : NaN);
const f = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '-');

async function main() {
  const tenants = Array.from({ length: TENANTS }, (_, i) => `load-${RUN}-t${i}`);
  const sentAt = new Map<string, number>();
  const e2e: number[] = [];
  const received = new Map<string, number>(tenants.map((t) => [t, 0]));
  const types = ['lab.started', 'step.completed', 'step.completed', 'step.completed', 'lab.completed'];

  const sockets = await Promise.all(tenants.map(async (t) => {
    const r = await fetch(`${URL_}/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: t, tenantName: t, role: 'instructor', userId: 'load-inst' }) });
    const { token } = (await r.json()) as { token: string };
    const s = connect(URL_, { transports: ['websocket'], auth: { token }, forceNew: true });
    s.on('events', (batch: { idempotencyKey: string; tenantId: string; type: string }[]) => {
      const now = Date.now();
      for (const ev of batch) {
        received.set(t, (received.get(t) ?? 0) + 1);
        const t0 = sentAt.get(ev.idempotencyKey);
        if (t0 !== undefined) e2e.push(now - t0);
      }
    });
    await new Promise<void>((res, rej) => { s.once('caught_up', () => res()); s.once('connect_error', rej); });
    return s;
  }));

  const ack: number[] = [];
  const status = new Map<string, number>();
  const instances = new Map<string, number>();
  const perSecond = new Map<number, number[]>();
  const t0 = Date.now();
  let inflight = 0, maxInflight = 0;

  const send = async (i: number) => {
    const tenantId = tenants[i % TENANTS];
    const key = `${RUN}-${i}-${randomUUID()}`;
    const body = {
      type: types[i % types.length], tenantId, labId: `lab-${i % 3}`, learnerId: `learner-${i % LEARNERS}`,
      step: `step-${(i % 5) + 1}`, message: `load event ${i}`, occurredAt: new Date().toISOString(), idempotencyKey: key,
    };
    sentAt.set(key, Date.now());
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    const s0 = performance.now();
    try {
      const res = await fetch(`${URL_}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': API_KEY }, body: JSON.stringify(body) });
      const j = (await res.json()) as { instance?: string };
      const ms = performance.now() - s0;
      ack.push(ms);
      const sec = Math.floor((Date.now() - t0) / 1000);
      (perSecond.get(sec) ?? perSecond.set(sec, []).get(sec)!).push(ms);
      status.set(String(res.status), (status.get(String(res.status)) ?? 0) + 1);
      if (j.instance) instances.set(j.instance, (instances.get(j.instance) ?? 0) + 1);
    } catch {
      status.set('network_error', (status.get('network_error') ?? 0) + 1);
    } finally { inflight--; }
  };

  console.log(`target=${URL_} mode=${BURST ? `burst(concurrency=${CONCURRENCY})` : `paced(${EVENTS} events / ${SECONDS}s)`} tenants=${TENANTS} learners=${LEARNERS}`);
  const pending: Promise<void>[] = [];
  if (BURST) {
    let next = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (next < EVENTS) await send(next++); }));
  } else {
    const gap = (SECONDS * 1000) / EVENTS;
    for (let i = 0; i < EVENTS; i++) {
      const due = t0 + i * gap;
      const wait = due - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      pending.push(send(i)); // open loop: do not wait for the response before sending the next
    }
    await Promise.all(pending);
  }
  const sendWindow = (Date.now() - t0) / 1000;

  // wait for the sockets to drain
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && e2e.length < EVENTS) await new Promise((r) => setTimeout(r, 100));
  const total = [...received.values()].reduce((a, b) => a + b, 0);
  const okCount = (status.get('201') ?? 0) + (status.get('200') ?? 0);

  console.log('\n=== RESULTS ===');
  console.log(`accepted:            ${okCount}/${EVENTS}   statuses: ${JSON.stringify(Object.fromEntries(status))}`);
  console.log(`delivered to sockets:${total}/${okCount}  (lost: ${okCount - total}, duplicates would show as > accepted)`);
  console.log(`send window:         ${sendWindow.toFixed(1)}s   throughput: ${(okCount / sendWindow).toFixed(0)} events/s accepted`);
  console.log(`POST ack latency ms: p50=${f(pct(ack, 50))} p95=${f(pct(ack, 95))} p99=${f(pct(ack, 99))} max=${f(Math.max(...ack))}`);
  console.log(`end-to-end ms:       p50=${f(pct(e2e, 50))} p95=${f(pct(e2e, 95))} p99=${f(pct(e2e, 99))} max=${f(Math.max(...e2e))}   (n=${e2e.length})`);
  console.log(`max in-flight POSTs: ${maxInflight}    per-instance: ${JSON.stringify(Object.fromEntries(instances))}`);
  console.log('ack p95 by second:  ', [...perSecond.entries()].sort((a, b) => a[0] - b[0]).map(([s, xs]) => `${s}s:${f(pct(xs, 95))}`).join('  '));
  sockets.forEach((s) => s.close());
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
