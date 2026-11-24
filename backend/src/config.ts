const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  instanceId: env.INSTANCE_ID ?? `local-${process.pid}`,
  databaseUrl: env.DATABASE_URL ?? 'postgres://labpulse:labpulse@localhost:5432/labpulse',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me',
  ingestApiKey: env.INGEST_API_KEY ?? 'dev-ingest-key',
  devAuth: (env.DEV_AUTH ?? 'true') === 'true',
  pgPoolMax: Number(env.PG_POOL_MAX ?? 20),
  pgQueryTimeoutMs: Number(env.PG_QUERY_TIMEOUT_MS ?? 5000),
  alertThreshold: Number(env.ALERT_THRESHOLD ?? 3),
  alertWindowMs: Number(env.ALERT_WINDOW_MS ?? 120_000),
  replayBatch: Number(env.REPLAY_BATCH ?? 500),
  hubSweepMs: Number(env.HUB_SWEEP_MS ?? 10_000),
  llm: {
    provider: (env.LLM_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : 'mock')) as 'openai' | 'mock',
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    chatModel: env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
    embeddingModel: env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    // text-embedding-3-* can return shorter vectors; must equal the vector(1536) column (EMBEDDING_DIMS)
    embeddingDimensions: env.OPENAI_EMBEDDING_DIMENSIONS ? Number(env.OPENAI_EMBEDDING_DIMENSIONS) : undefined,
    timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 20_000),
    // cosine similarity of the best chunk below which we refuse to answer
    minConfidence: env.RETRIEVAL_MIN_CONFIDENCE ? Number(env.RETRIEVAL_MIN_CONFIDENCE) : undefined,
  },
  guidePath: env.GUIDE_PATH ?? '../data/lab-guide.md',
};

export const EMBEDDING_DIMS = 1536;
