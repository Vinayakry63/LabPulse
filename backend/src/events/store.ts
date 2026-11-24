import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { isTransientDbError } from '../db';
import type { Claims } from '../auth';
import type { IngestEvent, StoredEvent } from './schema';

export const ALERT_TYPE = 'instructor.alert';

interface Row {
  tenant_id: string;
  seq: string;
  type: string;
  lab_id: string;
  learner_id: string | null;
  step: string | null;
  message: string | null;
  occurred_at: Date;
  idempotency_key: string;
  payload_hash?: string;
}

const COLUMNS =
  'tenant_id, seq, type, lab_id, learner_id, step, message, occurred_at, idempotency_key';

function toEvent(r: Row): StoredEvent {
  return {
    tenantId: r.tenant_id,
    seq: Number(r.seq),
    type: r.type,
    labId: r.lab_id,
    learnerId: r.learner_id,
    step: r.step,
    message: r.message,
    occurredAt: r.occurred_at.toISOString(),
    idempotencyKey: r.idempotency_key,
  };
}

export function payloadHash(e: IngestEvent): string {
  const canonical = JSON.stringify([
    e.type, e.tenantId, e.labId, e.learnerId, e.step, e.message, new Date(e.occurredAt).toISOString(),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Which events a given principal may see. Single source of truth for isolation. */
export function canSee(claims: Pick<Claims, 'tenantId' | 'role' | 'sub'>, e: StoredEvent): boolean {
  if (e.tenantId !== claims.tenantId) return false;
  if (claims.role === 'instructor') return true;
  return e.type !== ALERT_TYPE && e.learnerId === claims.sub;
}

export class TenantBusy extends Error {}

const MAX_QUEUED_WRITERS_PER_TENANT = 1000;
// One writer is active; the next is allowed to fetch its connection and queue on the advisory lock so the
// hand-over costs nothing. More than that would only pin pooled connections while waiting.
const WRITER_PIPELINE_DEPTH = 2;

interface Gate { active: number; waiters: Array<() => void> }

export class EventStore {
  // Per-tenant FIFO of writers inside THIS process. Waiting here (in memory) instead of inside
  // pg_advisory_lock means a hot tenant can hold at most WRITER_PIPELINE_DEPTH pooled connections per
  // instance, so it can no longer starve every other tenant of connections.
  private readonly gates = new Map<string, Gate>();

  constructor(private readonly pool: Pool) {}

  private async enterLocalQueue(tenantId: string): Promise<() => void> {
    let gate = this.gates.get(tenantId);
    if (!gate) this.gates.set(tenantId, (gate = { active: 0, waiters: [] }));
    if (gate.active + gate.waiters.length >= MAX_QUEUED_WRITERS_PER_TENANT) {
      throw new TenantBusy(`write queue full for tenant ${tenantId}`);
    }
    if (gate.active < WRITER_PIPELINE_DEPTH) {
      gate.active++;
    } else {
      await new Promise<void>((resolve) => gate!.waiters.push(resolve)); // permit is handed over, not re-counted
    }
    const g = gate;
    return () => {
      const next = g.waiters.shift();
      if (next) next();
      else if (--g.active === 0 && this.gates.get(tenantId) === g) this.gates.delete(tenantId);
    };
  }

  /** Latest per-tenant sequence number (0 if the tenant has no events yet). */
  async lastSeq(tenantId: string): Promise<number> {
    const { rows } = await this.pool.query<{ last_seq: string }>('SELECT last_seq FROM tenant_seq WHERE tenant_id = $1', [tenantId]);
    return rows[0] ? Number(rows[0].last_seq) : 0;
  }

  async lastSeqs(tenantIds: string[]): Promise<Map<string, number>> {
    if (!tenantIds.length) return new Map();
    const { rows } = await this.pool.query<{ tenant_id: string; last_seq: string }>(
      'SELECT tenant_id, last_seq FROM tenant_seq WHERE tenant_id = ANY($1::text[])', [tenantIds]);
    return new Map(rows.map((r) => [r.tenant_id, Number(r.last_seq)]));
  }

  async findByKey(tenantId: string, key: string, db: Pick<Pool, 'query'> = this.pool) {
    const { rows } = await db.query<Row>(
      `SELECT ${COLUMNS}, payload_hash FROM events WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key],
    );
    return rows[0] ? { event: toEvent(rows[0]), hash: rows[0].payload_hash as string } : null;
  }

  /**
   * Serialises all writers of one tenant (across every backend instance) for the
   * duration of fn. Holding the lock through commit AND publish is what makes
   * "seq order == commit order == publish order" true per tenant.
   */
  async withTenantLock<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const leaveQueue = await this.enterLocalQueue(tenantId);
    let client: PoolClient | undefined;
    let destroy = false;
    try {
      client = await this.pool.connect();
      await client.query('SELECT pg_advisory_lock(7, hashtext($1))', [tenantId]);
      return await fn(client);
    } catch (err) {
      // A timed-out / broken connection cannot be asked to unlock; closing it makes Postgres drop the session lock.
      destroy = isTransientDbError(err);
      throw err;
    } finally {
      try {
        if (client) {
          if (destroy) {
            client.release(true);
          } else {
            try {
              await client.query('SELECT pg_advisory_unlock(7, hashtext($1))', [tenantId]);
              client.release();
            } catch {
              client.release(true);
            }
          }
        }
      } finally {
        leaveQueue();
      }
    }
  }

  /** Must run inside withTenantLock. Atomically assigns the next per-tenant seq and inserts. */
  async append(
    client: PoolClient,
    e: {
      tenantId: string; type: string; labId: string; learnerId: string | null; step: string | null;
      message: string | null; occurredAt: string; idempotencyKey: string; hash: string;
    },
  ): Promise<StoredEvent> {
    await client.query('BEGIN');
    try {
      const seqRes = await client.query<{ last_seq: string }>(
        `INSERT INTO tenant_seq (tenant_id, last_seq) VALUES ($1, 1)
         ON CONFLICT (tenant_id) DO UPDATE SET last_seq = tenant_seq.last_seq + 1
         RETURNING last_seq`,
        [e.tenantId],
      );
      const seq = Number(seqRes.rows[0].last_seq);
      const { rows } = await client.query<Row>(
        `INSERT INTO events (tenant_id, seq, type, lab_id, learner_id, step, message, occurred_at, idempotency_key, payload_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLUMNS}`,
        [e.tenantId, seq, e.type, e.labId, e.learnerId, e.step, e.message, e.occurredAt, e.idempotencyKey, e.hash],
      );
      await client.query('COMMIT');
      return toEvent(rows[0]);
    } catch (err) {
      if (!isTransientDbError(err)) await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  /** Events visible to `claims` with seq > afterSeq, oldest first. */
  async fetchAfter(claims: Pick<Claims, 'tenantId' | 'role' | 'sub'>, afterSeq: number, limit: number) {
    const { rows } =
      claims.role === 'instructor'
        ? await this.pool.query<Row>(
            `SELECT ${COLUMNS} FROM events WHERE tenant_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
            [claims.tenantId, afterSeq, limit],
          )
        : await this.pool.query<Row>(
            `SELECT ${COLUMNS} FROM events
              WHERE tenant_id = $1 AND learner_id = $2 AND type <> '${ALERT_TYPE}' AND seq > $3
              ORDER BY seq ASC LIMIT $4`,
            [claims.tenantId, claims.sub, afterSeq, limit],
          );
    return rows.map(toEvent);
  }

  /** Most recent `limit` visible events, oldest first (used for a first-ever connection). */
  async fetchTail(claims: Pick<Claims, 'tenantId' | 'role' | 'sub'>, limit: number) {
    const { rows } =
      claims.role === 'instructor'
        ? await this.pool.query<Row>(
            `SELECT ${COLUMNS} FROM events WHERE tenant_id = $1 ORDER BY seq DESC LIMIT $2`,
            [claims.tenantId, limit],
          )
        : await this.pool.query<Row>(
            `SELECT ${COLUMNS} FROM events
              WHERE tenant_id = $1 AND learner_id = $2 AND type <> '${ALERT_TYPE}'
              ORDER BY seq DESC LIMIT $3`,
            [claims.tenantId, claims.sub, limit],
          );
    return rows.map(toEvent).reverse();
  }

  /** Recent lab.error events for one learner in one tenant (assistant tool). */
  async recentErrors(tenantId: string, learnerId: string, limit: number) {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM events
        WHERE tenant_id = $1 AND learner_id = $2 AND type = 'lab.error'
        ORDER BY seq DESC LIMIT $3`,
      [tenantId, learnerId, limit],
    );
    return rows.map(toEvent);
  }
}
