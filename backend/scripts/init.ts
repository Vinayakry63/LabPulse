import { createProvider } from '../src/assistant/provider';
import { ingestGuide } from '../src/assistant/guide';
import { createPool, migrate } from '../src/db';

async function main() {
  const pool = createPool();
  const provider = createProvider();
  await migrate(pool);
  console.log('[init] schema ready');
  const force = process.argv.includes('--force');
  const r = await ingestGuide(pool, provider, undefined, force);
  console.log(`[init] guide: ${r.chunks} chunks, embeddings=${provider.embeddingId}${r.skipped ? ' (already ingested)' : ' (ingested)'}`);
  await pool.end();
}
main().catch((e) => {
  console.error('[init] failed', e);
  process.exit(1);
});
