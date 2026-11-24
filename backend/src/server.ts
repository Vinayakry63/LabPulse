import { config } from './config';
import { startServer } from './createServer';

if (config.jwtSecret === 'dev-only-secret-change-me') console.warn('[security] JWT_SECRET is the built-in development default: anyone can forge tokens. Set JWT_SECRET.');
if (config.ingestApiKey === 'dev-ingest-key') console.warn('[security] INGEST_API_KEY is the built-in development default. Set INGEST_API_KEY.');
if (config.devAuth) console.warn('[security] DEV_AUTH=true: POST /dev/token mints tokens for any tenant. Set DEV_AUTH=false outside demos.');

startServer().then(
  (s) => {
    console.log(`[${s.instanceId}] listening on :${s.port} (llm=${config.llm.provider})`);
    const stop = () => void s.close().finally(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  },
  (err) => {
    console.error('fatal startup error', err);
    process.exit(1);
  },
);
