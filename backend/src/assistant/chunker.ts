export interface Chunk {
  doc: string;
  section: string;
  ord: number;
  content: string;
}

const MAX_CHARS = 1400;

function clean(line: string): string | null {
  if (/^:::/.test(line.trim())) return null; // Learn image/zone directives
  if (/^\s*\[!INCLUDE/.test(line)) return null;
  return line.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i, '').replace(/^>\s?/, '');
}

/** Heading-aware chunking: each chunk belongs to one "Unit › Subsection" and is <= ~1400 chars. */
export function chunkMarkdown(doc: string, markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let unit = '';
  let sub = '';
  let paras: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  let ord = 0;

  const section = () => [unit, sub].filter(Boolean).join(' › ') || doc;
  const flushPara = () => {
    const p = cur.join('\n').trim();
    if (p) paras.push(p);
    cur = [];
  };
  const flushChunks = () => {
    flushPara();
    let buf = '';
    const emit = () => {
      if (unit && buf.trim()) chunks.push({ doc, section: section(), ord: ord++, content: buf.trim() });
      buf = '';
    };
    for (const p of paras) {
      if (buf && buf.length + p.length > MAX_CHARS) emit();
      buf += (buf ? '\n\n' : '') + p;
    }
    emit();
    paras = [];
  };

  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) inFence = !inFence;
    if (!inFence) {
      const unitM = raw.match(/^##\s+Unit:\s*(.+)$/);
      const headM = raw.match(/^(#{3,6})\s+(.+)$/);
      if (unitM) { flushChunks(); unit = unitM[1].trim(); sub = ''; continue; }
      if (headM) { flushChunks(); sub = headM[2].trim(); continue; }
      if (/^#\s+/.test(raw) || /^#{2}\s+/.test(raw)) { flushChunks(); continue; }
    }
    const line = clean(raw);
    if (line === null) continue;
    if (!inFence && line.trim() === '') flushPara();
    else cur.push(line);
  }
  flushChunks();
  return chunks;
}
