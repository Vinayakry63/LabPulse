import { timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { signToken, verifyToken, type Claims } from '../auth';
import { runAssistant } from '../assistant/orchestrator';
import type { LLMProvider } from '../assistant/llm';
import { config } from '../config';
import { isTransientDbError } from '../db';
import { IdempotencyConflict, type IngestService } from '../events/ingest';
import { formatZodIssues, ingestSchema } from '../events/schema';
import { TenantBusy, type EventStore } from '../events/store';

export interface AppDeps {
  pool: Pool;
  redis: Redis;
  store: EventStore;
  ingest: IngestService;
  provider: LLMProvider;
  instanceId: string;
  connectionCount: () => number;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function authenticate(req: Request, res: Response): Claims | null {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    return verifyToken(token);
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'A valid Bearer token is required' });
    return null;
  }
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', async (_req, res) => {
    const [db, redis] = await Promise.all([
      deps.pool.query('SELECT 1').then(() => true, () => false),
      deps.redis.ping().then(() => true, () => false),
    ]);
    res.status(db ? 200 : 503).json({
      status: db && redis ? 'ok' : db ? 'degraded' : 'down',
      instance: deps.instanceId,
      db,
      redis,
      sockets: deps.connectionCount(),
    });
  });

  app.post('/events', async (req, res) => {
    const key = req.header('x-api-key') ?? '';
    if (!safeEqual(key, config.ingestApiKey)) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid x-api-key' });
    }
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation_error', details: formatZodIssues(parsed.error) });
    }
    try {
      const r = await deps.ingest.ingest(parsed.data);
      res.status(r.duplicate ? 200 : 201).json({
        status: r.duplicate ? 'duplicate' : 'accepted',
        seq: r.event.seq,
        delivered: r.published,
        alert: r.alert ? { seq: r.alert.seq } : undefined,
        instance: deps.instanceId,
      });
    } catch (err) {
      if (err instanceof IdempotencyConflict) {
        return res.status(409).json({ error: 'idempotency_conflict', message: err.message });
      }
      if (err instanceof TenantBusy) {
        res.setHeader('Retry-After', '1');
        return res.status(503).json({ error: 'tenant_busy', message: 'Too many concurrent writes for this tenant; retry with the same idempotencyKey' });
      }
      if (isTransientDbError(err)) {
        console.error('[events] backing store unavailable', (err as Error).message);
        res.setHeader('Retry-After', '2');
        return res.status(503).json({ error: 'unavailable', message: 'Temporarily unable to persist the event; retry with the same idempotencyKey' });
      }
      throw err;
    }
  });

  if (config.devAuth) {
    const devTokenSchema = z.object({
      tenantId: z.string().min(1),
      tenantName: z.string().min(1).optional(),
      role: z.enum(['instructor', 'learner']),
      userId: z.string().min(1),
    });
    app.post('/dev/token', (req, res) => {
      const p = devTokenSchema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'validation_error', details: formatZodIssues(p.error) });
      const { userId, ...rest } = p.data;
      res.json({ token: signToken({ sub: userId, ...rest }) });
    });
  }

  const chatSchema = z.object({ question: z.string().trim().min(1).max(1000) });
  app.post('/assistant/chat', async (req, res) => {
    const claims = authenticate(req, res);
    if (!claims) return;
    const body = chatSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'validation_error', details: formatZodIssues(body.error) });
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    for await (const ev of runAssistant(
      { pool: deps.pool, store: deps.store, provider: deps.provider },
      claims,
      body.data.question,
      ac.signal,
    )) {
      const { type, ...data } = ev;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    res.end();
  });

  app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large' });
    }
    console.error('[http] unhandled', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
