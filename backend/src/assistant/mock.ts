import { config } from '../config';
import type { ChatChunk, ChatMessage, LLMProvider, ToolCall, ToolSpec } from './llm';
import { FAILURE_INTENT, hashEmbed, tokens } from './text';

interface Excerpt { n: number; section: string; text: string }

function parseExcerpts(messages: ChatMessage[]): Excerpt[] {
  const out: Excerpt[] = [];
  for (const m of messages) {
    if (m.role !== 'system' && m.role !== 'user') continue;
    for (const x of m.content.matchAll(/<guide_excerpt n="(\d+)" section="([^"]*)">([\s\S]*?)<\/guide_excerpt>/g)) {
      out.push({ n: Number(x[1]), section: x[2], text: x[3].trim() });
    }
  }
  return out;
}

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/[#>*`|]/g, '').trim())
    .filter((s) => s.length > 25);
}

function bestSentences(q: string, ex: Excerpt, k: number): string[] {
  const qt = new Set(tokens(q));
  return sentences(ex.text)
    .map((s) => ({ s, score: tokens(s).filter((t) => qt.has(t)).length / Math.sqrt(tokens(s).length + 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.s);
}

/**
 * Offline stand-in for a real model: deterministic, extractive, tool-aware.
 * It exercises the exact same orchestration path (tool calls, citations, streaming) as OpenAI.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly embeddingId = 'mock';
  readonly minConfidence = config.llm.minConfidence ?? 0.18;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(hashEmbed);
  }

  async *chat(req: {
    messages: ChatMessage[];
    tools?: ToolSpec[];
    toolChoice?: 'auto' | 'required';
    signal?: AbortSignal;
  }): AsyncIterable<ChatChunk> {
    const question = [...req.messages].reverse().find((m) => m.role === 'user' && !m.content.includes('<guide_excerpt'))?.content
      ?? [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const q = question.split('Question:').pop()!.trim();
    const toolMsg = [...req.messages].reverse().find((m) => m.role === 'tool');
    const excerpts = parseExcerpts(req.messages);

    if (!toolMsg && req.tools?.some((t) => t.name === 'get_my_recent_errors') && FAILURE_INTENT.test(q)) {
      const call: ToolCall = { id: 'call_mock_1', name: 'get_my_recent_errors', arguments: JSON.stringify({ limit: 5 }) };
      yield { type: 'tool_calls', calls: [call] };
      return;
    }

    const parts: string[] = [];
    if (toolMsg && toolMsg.role === 'tool') {
      const m = toolMsg.content.match(/<untrusted_lab_events>([\s\S]*?)<\/untrusted_lab_events>/);
      let events: { step?: string; message?: string; occurredAt?: string }[] = [];
      try { events = JSON.parse(m?.[1] ?? '{}').events ?? []; } catch { /* ignore */ }
      if (events.length) {
        parts.push(
          `Your most recent lab errors were: ` +
            events.slice(0, 3).map((e) => `at step "${e.step}": ${e.message}`).join('; ') + '.',
        );
      } else {
        parts.push('I could not find any recent errors recorded for your lab session.');
      }
    }
    if (excerpts.length) {
      const top = excerpts[0];
      const picked = bestSentences(q, top, toolMsg ? 2 : 3);
      if (picked.length) parts.push(`${picked.join(' ')} [${top.n}]`);
    }
    if (!parts.length) parts.push('That is not covered in the lab guide.');

    const text = parts.join(' ');
    for (const w of text.match(/\S+\s*/g) ?? []) {
      if (req.signal?.aborted) return;
      yield { type: 'text', text: w };
    }
  }
}
