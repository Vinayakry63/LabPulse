import type { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { verifyToken, type Claims } from '../auth';
import { config } from '../config';
import { EVENTS_CHANNEL } from '../events/ingest';
import type { StoredEvent } from '../events/schema';
import { ALERT_TYPE, canSee, type EventStore } from '../events/store';

interface SocketState {
  claims: Claims;
  lastSent: number;
  replaying: boolean;
  buffer: StoredEvent[];
  /** a gap was detected while this socket was mid catch-up: read the DB once more after going live */
  resyncAfter: boolean;
}

const TAIL_ON_FIRST_CONNECT = 5000;
const MAX_BUFFER = 20_000;
const MAX_SOCKET_BACKLOG = 2000;

/**
 * `events` is the canonical, ordered stream. Alerts are additionally announced under their own
 * event name, `instructor.alert`, for consumers that only care about alerts. Only instructors
 * ever receive alert events (see canSee), so learners never get either form.
 */
function emitEvents(socket: Socket, batch: StoredEvent[]) {
  socket.emit('events', batch);
  for (const e of batch) if (e.type === ALERT_TYPE) socket.emit('instructor.alert', e);
}

/**
 * Fan-out + catch-up. Every backend instance subscribes to one Redis channel and
 * delivers to its *local* sockets, so a client gets events whichever instance holds
 * its connection. Per-socket `lastSent` makes delivery in-order and duplicate-free.
 */
export class RealtimeHub {
  private readonly byTenant = new Map<string, Set<Socket>>();
  private subscribedOnce = false;
  // Highest per-tenant seq announced over Redis to this instance. Seqs are gap-free per tenant,
  // so seeing N+2 right after N proves an event was committed but never announced to us.
  private readonly tenantSeen = new Map<string, number>();
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly io: Server,
    private readonly subscriber: Redis,
    private readonly store: EventStore,
    private readonly instanceId: string,
  ) {}

  async start() {
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string') throw new Error('missing token');
        const claims = verifyToken(token);
        socket.data = { claims, lastSent: 0, replaying: true, buffer: [], resyncAfter: false } satisfies SocketState;
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
    this.io.on('connection', (socket) => void this.onConnection(socket));

    this.subscriber.on('message', (channel, raw) => {
      if (channel !== EVENTS_CHANNEL) return;
      try {
        this.dispatch(JSON.parse(raw) as StoredEvent);
      } catch (err) {
        console.error('[hub] dropped malformed realtime message', (err as Error).message);
      }
    });
    this.subscriber.on('ready', () => {
      // a Redis outage may have swallowed publishes: repair every local socket from the DB
      if (this.subscribedOnce) void this.resyncAll();
    });
    await this.subscriber.subscribe(EVENTS_CHANNEL);
    this.subscribedOnce = true;
    this.sweepTimer = setInterval(() => void this.sweep(), config.hubSweepMs);
    this.sweepTimer.unref();
  }

  get connectionCount() {
    let n = 0;
    for (const s of this.byTenant.values()) n += s.size;
    return n;
  }

  private async onConnection(socket: Socket) {
    const st = socket.data as SocketState;
    const { claims } = st;
    // register BEFORE reading the DB so nothing published during catch-up is missed
    let set = this.byTenant.get(claims.tenantId);
    if (!set) this.byTenant.set(claims.tenantId, (set = new Set()));
    set.add(socket);
    // end the session when the JWT expires (a socket must not outlive its token)
    let expiryTimer: NodeJS.Timeout | undefined;
    if (claims.exp) {
      const ms = Math.min(Math.max(claims.exp * 1000 - Date.now(), 0), 2 ** 31 - 1);
      expiryTimer = setTimeout(() => socket.disconnect(true), ms);
    }
    socket.on('disconnect', () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      set!.delete(socket);
      if (set!.size === 0) this.byTenant.delete(claims.tenantId);
    });

    socket.emit('hello', {
      instance: this.instanceId,
      tenantId: claims.tenantId,
      tenantName: claims.tenantName ?? claims.tenantId,
      role: claims.role,
    });

    const rawCursor = socket.handshake.auth?.cursor;
    const cursor = Number.isFinite(Number(rawCursor)) && rawCursor !== null && rawCursor !== undefined
      ? Math.max(0, Math.floor(Number(rawCursor)))
      : null;
    try {
      // baseline for gap detection when this instance has not announced anything for the tenant yet
      if (!this.tenantSeen.has(claims.tenantId)) {
        const dbLast = await this.store.lastSeq(claims.tenantId);
        if (!this.tenantSeen.has(claims.tenantId)) this.tenantSeen.set(claims.tenantId, dbLast);
      }
      await this.catchUp(socket, cursor);
    } catch (err) {
      console.error('[hub] catch-up failed', (err as Error).message);
      socket.disconnect(true); // client reconnects and retries with its cursor
    }
  }

  private async catchUp(socket: Socket, cursor: number | null) {
    const st = socket.data as SocketState;
    st.replaying = true;
    st.buffer = [];

    if (cursor === null && st.lastSent === 0) {
      const tail = await this.store.fetchTail(st.claims, TAIL_ON_FIRST_CONNECT);
      if (tail.length) emitEvents(socket, tail);
      st.lastSent = tail.length ? tail[tail.length - 1].seq : 0;
    } else if (cursor !== null) {
      st.lastSent = Math.max(st.lastSent, cursor);
    }

    for (;;) {
      const rows = await this.store.fetchAfter(st.claims, st.lastSent, config.replayBatch);
      if (rows.length) {
        emitEvents(socket, rows);
        st.lastSent = rows[rows.length - 1].seq;
      }
      if (rows.length < config.replayBatch) break;
    }

    // Synchronous from here: drain what arrived live while we were reading, then go live.
    const live = st.buffer.filter((e) => e.seq > st.lastSent);
    if (live.length) {
      emitEvents(socket, live);
      st.lastSent = live[live.length - 1].seq;
    }
    st.buffer = [];
    st.replaying = false;
    socket.emit('caught_up', { cursor: st.lastSent });

    if (st.resyncAfter) {
      st.resyncAfter = false;
      await this.catchUp(socket, st.lastSent);
    }
  }

  private dispatch(e: StoredEvent) {
    const prev = this.tenantSeen.get(e.tenantId);
    if (prev === undefined || e.seq > prev) this.tenantSeen.set(e.tenantId, e.seq);
    const sockets = this.byTenant.get(e.tenantId);
    if (!sockets) return;

    if (prev !== undefined && e.seq > prev + 1) {
      // Events prev+1..seq-1 are in Postgres but were never announced to us (publish failed, process
      // died between COMMIT and PUBLISH, ...). Whether a given socket may see them depends on its role,
      // so repair every socket from the database instead of guessing. `e` itself is in the DB too.
      console.warn(`[hub] gap for tenant ${e.tenantId}: saw ${e.seq} after ${prev}; resyncing ${sockets.size} socket(s)`);
      for (const socket of sockets) this.resyncSocket(socket);
      return;
    }

    for (const socket of sockets) {
      const st = socket.data as SocketState;
      if (!canSee(st.claims, e)) continue;
      if (st.replaying) {
        if (st.buffer.length >= MAX_BUFFER) socket.disconnect(true);
        else st.buffer.push(e);
        continue;
      }
      if (e.seq <= st.lastSent) continue; // duplicate / already replayed
      const backlog = (socket.conn as unknown as { writeBuffer: unknown[] }).writeBuffer.length;
      if (backlog > MAX_SOCKET_BACKLOG) {
        socket.disconnect(true); // slow consumer: shed it, it will catch up from its cursor
        continue;
      }
      emitEvents(socket, [e]);
      st.lastSent = e.seq;
    }
  }

  private resyncSocket(socket: Socket) {
    const st = socket.data as SocketState;
    if (st.replaying) {
      st.resyncAfter = true; // finish the current catch-up, then read the DB again
      return;
    }
    this.catchUp(socket, st.lastSent).catch(() => void socket.disconnect(true));
  }

  /** Safety net: if the DB is ahead of what Redis announced to us, a publish was lost. Repair from the DB. */
  private async sweep() {
    const tenants = [...this.byTenant.keys()];
    if (!tenants.length) return;
    try {
      const dbLast = await this.store.lastSeqs(tenants);
      for (const [tenantId, last] of dbLast) {
        if (last > (this.tenantSeen.get(tenantId) ?? 0)) {
          this.tenantSeen.set(tenantId, last);
          for (const socket of this.byTenant.get(tenantId) ?? []) this.resyncSocket(socket);
        }
      }
    } catch (err) {
      console.error('[hub] sweep failed', (err as Error).message);
    }
  }

  private async resyncAll() {
    const jobs: Promise<void>[] = [];
    for (const sockets of this.byTenant.values()) {
      for (const socket of sockets) {
        const st = socket.data as SocketState;
        if (st.replaying) continue;
        jobs.push(this.catchUp(socket, st.lastSent).catch(() => void socket.disconnect(true)));
      }
    }
    await Promise.all(jobs);
  }

  async close() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.subscriber.unsubscribe(EVENTS_CHANNEL).catch(() => undefined);
  }
}
