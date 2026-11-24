export interface Citation { n: number; section: string; score: number }
export type AssistantStreamEvent =
  | { type: 'meta'; confidence: number; citations: Citation[] }
  | { type: 'tool'; name: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; cited: number[]; toolsCalled: string[]; grounded: boolean }
  | { type: 'error'; code: string; message: string };

/** Minimal SSE-over-fetch reader (EventSource can't send an Authorization header). */
export async function* askAssistant(token: string, question: string, signal: AbortSignal): AsyncGenerator<AssistantStreamEvent> {
  const res = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Assistant request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const type = frame.match(/^event: (.+)$/m)?.[1];
      const data = frame.match(/^data: (.+)$/m)?.[1];
      if (type && data) yield { type, ...JSON.parse(data) } as AssistantStreamEvent;
    }
  }
}
