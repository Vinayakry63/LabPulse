import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { config } from '../config';
import { chunkMarkdown } from './chunker';
import type { LLMProvider } from './llm';

export const toSql = (v: number[]) => `[${v.join(',')}]`;

export interface Retrieved {
  id: number;
  section: string;
  content: string;
  score: number;
}

/** Idempotent: (re)embeds only when the chunk set was built by a different provider. */
export async function ingestGuide(pool: Pool, provider: LLMProvider, path = config.guidePath, force = false) {
  const markdown = readFileSync(resolve(process.cwd(), path), 'utf8');
  const chunks = chunkMarkdown('build-first-bicep-file', markdown);
  const { rows } = await pool.query<{ provider: string; n: string }>(
    'SELECT provider, count(*) n FROM guide_chunks GROUP BY provider',
  );
  if (!force && rows.length === 1 && rows[0].provider === provider.embeddingId && Number(rows[0].n) === chunks.length) {
    return { chunks: chunks.length, skipped: true };
  }
  const embeddings = await provider.embed(chunks.map((c) => `${c.section}\n${c.content}`));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM guide_chunks');
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      await client.query(
        'INSERT INTO guide_chunks (doc, section, ord, content, provider, embedding) VALUES ($1,$2,$3,$4,$5,$6::vector)',
        [c.doc, c.section, c.ord, c.content, provider.embeddingId, toSql(embeddings[i])],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { chunks: chunks.length, skipped: false };
}

export async function retrieve(pool: Pool, provider: LLMProvider, question: string, k = 4): Promise<Retrieved[]> {
  const [vec] = await provider.embed([question]);
  const { rows } = await pool.query(
    `SELECT id, section, content, 1 - (embedding <=> $1::vector) AS score
       FROM guide_chunks WHERE provider = $2
      ORDER BY embedding <=> $1::vector LIMIT $3`,
    [toSql(vec), provider.embeddingId, k],
  );
  return rows.map((r) => ({ id: r.id, section: r.section, content: r.content, score: Number(r.score) }));
}
