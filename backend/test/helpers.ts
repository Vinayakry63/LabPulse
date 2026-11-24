import { randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { signToken, type Claims } from '../src/auth';
import { config } from '../src/config';
import { createPool, migrate } from '../src/db';
import { startServer, type RunningServer } from '../src/createServer';
import type { StoredEvent } from '../src/events/schema';

export async function setupDb() {
  const pool = createPool();
  await migrate(pool);
  await pool.end();
}

export async function startTwoInstances(): Promise<[RunningServer, RunningServer]> {
  return Promise.all([
    startServer({ port: 0, instanceId: 'test-1' }),
    startServer({ port: 0, instanceId: 'test-2' }),
  ]);
}

export const uid = (p: string) => `${p}-${randomUUID().slice(0, 8)}`;

export function token(c: Partial<Claims> & Pick<Claims, 'tenantId' | 'role' | 'sub'>) {
  return signToken({ tenantName: `Name of ${c.tenantId}`, ...c });
}

export function eventBody(o: Partial<Record<string, unknown>> & { tenantId: string; learnerId: string }) {
  return {
    type: 'step.completed',
    labId: 'lab-bicep',
    step: 'step-1',
    message: 'ok',
    occurredAt: new Date().toISOString(),
    idempotencyKey: `k-${randomUUID()}`,
    ...o,
  };
}

export async function post(server: RunningServer, body: unknown, apiKey = config.ingestApiKey) {
  const res = await fetch(`http://127.0.0.1:${server.port}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

export interface TestClient {
  socket: Socket;
  events: StoredEvent[];
  /** events received under the dedicated `instructor.alert` socket event */
  alerts: StoredEvent[];
  hello: Promise<any>;
  caughtUp: Promise<any>;
  until(pred: (events: StoredEvent[]) => boolean, ms?: number): Promise<StoredEvent[]>;
  close(): void;
}

export function client(server: RunningServer, tok: string, cursor?: number): TestClient {
  const socket = connect(`http://127.0.0.1:${server.port}`, {
    transports: ['websocket'],
    auth: { token: tok, ...(cursor !== undefined && { cursor }) },
    reconnection: false,
    forceNew: true,
  });
  const events: StoredEvent[] = [];
  const alerts: StoredEvent[] = [];
  socket.on('events', (batch: StoredEvent[]) => events.push(...batch));
  socket.on('instructor.alert', (e: StoredEvent) => alerts.push(e));
  const hello = new Promise((r) => socket.once('hello', r));
  const caughtUp = new Promise((r) => socket.once('caught_up', r));
  return {
    socket,
    events,
    alerts,
    hello,
    caughtUp,
    until(pred, ms = 8000) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
          if (pred(events)) return resolve(events);
          if (Date.now() - t0 > ms) return reject(new Error(`timeout; got ${events.length} events: ${JSON.stringify(events.map((e) => e.seq))}`));
          setTimeout(tick, 25);
        };
        tick();
      });
    },
    close: () => socket.close(),
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
