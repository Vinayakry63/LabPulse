import { Pool } from 'pg';
import { config, EMBEDDING_DIMS } from './config';

export function createPool(): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.pgPoolMax,
    connectionTimeoutMillis: 3000,
    statement_timeout: 8000,
    // client-side: a frozen/partitioned Postgres never answers, so the server-side timeout cannot fire
    query_timeout: config.pgQueryTimeoutMs,
  });
  pool.on('error', (err) => console.error('[pg] idle client error', err.message));
  return pool;
}

export function isTransientDbError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  return /timeout|terminated|ECONNREFUSED|ECONNRESET|too many clients|Connection|read ETIMEDOUT/i.test(msg);
}

const MIGRATION_LOCK = 724001;

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_seq (
        tenant_id TEXT PRIMARY KEY,
        last_seq  BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        tenant_id       TEXT        NOT NULL,
        seq             BIGINT      NOT NULL,
        type            TEXT        NOT NULL,
        lab_id          TEXT        NOT NULL,
        learner_id      TEXT,
        step            TEXT,
        message         TEXT,
        occurred_at     TIMESTAMPTZ NOT NULL,
        idempotency_key TEXT        NOT NULL,
        payload_hash    TEXT        NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, seq),
        UNIQUE (tenant_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS events_learner_idx ON events (tenant_id, learner_id, seq);
      CREATE TABLE IF NOT EXISTS guide_chunks (
        id         SERIAL PRIMARY KEY,
        doc        TEXT NOT NULL,
        section    TEXT NOT NULL,
        ord        INT  NOT NULL,
        content    TEXT NOT NULL,
        provider   TEXT NOT NULL,
        embedding  vector(${EMBEDDING_DIMS}) NOT NULL
      );
    `);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
