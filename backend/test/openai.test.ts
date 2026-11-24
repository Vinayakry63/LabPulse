import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../src/assistant/llm';

// A fake server that speaks the OpenAI wire protocol, so the real SDK + our adapter run end to end without a key.
interface Captured { url: string; body: any }
const captured: Captured[] = [];
let server: http.Server;
let provider: LLMProvider;

const sse = (res: http.ServerResponse, chunks: object[]) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};
const delta = (d: object) => ({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: d, finish_reason: null }] });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      captured.push({ url: req.url!, body });
      if (req.url!.endsWith('/embeddings')) {
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          object: 'list', model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 },
          data: inputs.map((_, i) => ({ object: 'embedding', index: i, embedding: Array.from({ length: 1536 }, (_, k) => (k === i % 1536 ? 1 : 0)) })),
        }));
      }
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          id: 'c', object: 'chat.completion', created: 0, model: 'm',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'What are the naming rules for a storage account name?' } }],
        }));
      }
      const hasToolResult = body.messages.some((m: any) => m.role === 'tool');
      if (body.tools && !hasToolResult && body.tool_choice === 'required') {
        // tool call streamed the way OpenAI does it: id+name first, arguments in fragments
        return sse(res, [
          delta({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'get_my_recent_errors', arguments: '' } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: '{"lim' } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: 'it": 3}' } }] }),
        ]);
      }
      return sse(res, [delta({ role: 'assistant', content: 'Hello ' }), delta({ content: 'from ' }), delta({ content: 'the model [1]' })]);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  process.env.OPENAI_EMBEDDING_DIMENSIONS = '1536';
  vi.resetModules();
  const { OpenAIProvider } = await import('../src/assistant/openai');
  provider = new OpenAIProvider();
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('OpenAI provider adapter (against a fake OpenAI-compatible server)', () => {
  it('embeds in batches of 64 and returns one vector per input, in order', async () => {
    captured.length = 0;
    const vecs = await provider.embed(Array.from({ length: 70 }, (_, i) => `text ${i}`));
    expect(vecs).toHaveLength(70);
    expect(vecs[0]).toHaveLength(1536);
    expect(captured.filter((c) => c.url.endsWith('/embeddings'))).toHaveLength(2);
    expect(captured[0].body.model).toBe('text-embedding-3-small');
    expect(captured[0].body.input).toHaveLength(64);
    expect(captured[0].body.dimensions).toBe(1536);
    expect(provider.embeddingId).toBe('openai:text-embedding-3-small:1536');
  });

  it('streams text deltas in order', async () => {
    captured.length = 0;
    let text = '';
    const chunks: string[] = [];
    for await (const c of provider.chat({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }] })) {
      if (c.type === 'text') { text += c.text; chunks.push(c.text); }
    }
    expect(chunks.length).toBe(3);
    expect(text).toBe('Hello from the model [1]');
    expect(captured[0].body.stream).toBe(true);
    expect(captured[0].body.tools).toBeUndefined();
  });

  it('reassembles a tool call that arrives in fragments, and forwards tool_choice=required', async () => {
    captured.length = 0;
    const tools = [{ name: 'get_my_recent_errors', description: 'd', parameters: { type: 'object', properties: {} } }];
    const out: any[] = [];
    for await (const c of provider.chat({ messages: [{ role: 'user', content: 'why did it fail?' }], tools, toolChoice: 'required' })) out.push(c);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('tool_calls');
    expect(out[0].calls).toEqual([{ id: 'call_abc', name: 'get_my_recent_errors', arguments: '{"limit": 3}' }]);
    expect(JSON.parse(out[0].calls[0].arguments)).toEqual({ limit: 3 });
    expect(captured[0].body.tool_choice).toBe('required');
    expect(captured[0].body.tools[0]).toMatchObject({ type: 'function', function: { name: 'get_my_recent_errors' } });
  });

  it('sends the assistant tool call and the tool result back in OpenAI message format', async () => {
    captured.length = 0;
    const msgs = [
      { role: 'system' as const, content: 'rules' },
      { role: 'user' as const, content: 'q' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_abc', name: 'get_my_recent_errors', arguments: '{}' }] },
      { role: 'tool' as const, toolCallId: 'call_abc', name: 'get_my_recent_errors', content: '<untrusted_lab_events>{}</untrusted_lab_events>' },
    ];
    let text = '';
    for await (const c of provider.chat({ messages: msgs })) if (c.type === 'text') text += c.text;
    expect(text).toContain('Hello');
    const sent = captured[0].body.messages;
    expect(sent[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'get_my_recent_errors', arguments: '{}' } }] });
    expect(sent[3]).toEqual({ role: 'tool', tool_call_id: 'call_abc', content: '<untrusted_lab_events>{}</untrusted_lab_events>' });
  });

  it('normalizes a misspelled question with a non-streaming, temperature-0 call that must not answer it', async () => {
    captured.length = 0;
    const fixed = await provider.normalizeQuestion!('whta are teh naimng ruels for storge acount nmae');
    expect(fixed).toBe('What are the naming rules for a storage account name?');
    expect(captured[0].body.stream).toBeUndefined();
    expect(captured[0].body.temperature).toBe(0);
    expect(captured[0].body.messages[0].content).toMatch(/Do NOT answer/);
    expect(captured[0].body.messages[1]).toEqual({ role: 'user', content: 'whta are teh naimng ruels for storge acount nmae' });
  });
});
