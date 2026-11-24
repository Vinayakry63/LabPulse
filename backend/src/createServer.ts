import http from 'node:http';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { createProvider } from './assistant/provider';
import type { LLMProvider } from './assistant/llm';
import { config } from './config';
import { createPool } from './db';
import { AlertDetector } from './events/alerts';
import { IngestService } from './events/ingest';
import { EventStore } from './events/store';
import { createApp } from './http/app';
import { RealtimeHub } from './realtime/hub';

export interface RunningServer {
  port: number;
  instanceId: string;
  hub: RealtimeHub;
  store: EventStore;
  close(): Promise<void>;
}

export async function startServer(opts: { port?: number; instanceId?: string; provider?: LLMProvider } = {}): Promise<RunningServer> {
  const instanceId = opts.instanceId ?? config.instanceId;
  const pool = createPool();

  // Writer connection fails fast: a hung publish must never hold a tenant lock.
  const redis = new Redis(config.redisUrl, { enableOfflineQueue: false, commandTimeout: 2000, maxRetriesPerRequest: 1 });
  const subscriber = new Redis(config.redisUrl);
  for (const [name, r] of [['pub', redis], ['sub', subscriber]] as const) {
    r.on('error', (e) => console.error(`[redis:${name}]`, e.message));
  }

  const store = new EventStore(pool);
  const ingest = new IngestService(store, redis, new AlertDetector(redis));
  const provider = opts.provider ?? createProvider();

  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    transports: ['websocket'], // no sticky sessions needed behind the load balancer
    cors: { origin: true },
    pingInterval: 10_000,
    pingTimeout: 10_000,
  });
  const hub = new RealtimeHub(io, subscriber, store, instanceId);
  await hub.start();

  const app = createApp({ pool, redis, store, ingest, provider, instanceId, connectionCount: () => hub.connectionCount });
  httpServer.on('request', app);
  await new Promise<void>((resolve) => httpServer.listen(opts.port ?? config.port, resolve));
  const port = (httpServer.address() as { port: number }).port;

  return {
    port,
    instanceId,
    hub,
    store,
    async close() {
      io.close();
      await hub.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
      redis.disconnect();
      subscriber.disconnect();
      await pool.end();
    },
  };
}
