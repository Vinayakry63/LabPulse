export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON text
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ChatChunk = { type: 'text'; text: string } | { type: 'tool_calls'; calls: ToolCall[] };

/** The only seam between the app and any model vendor. */
export interface LLMProvider {
  readonly name: string;
  /** Identifies the exact embedding space. Stored with every chunk so a model change forces a re-embed. */
  readonly embeddingId: string;
  /** Best-chunk cosine similarity below which retrieval is considered "not covered". */
  readonly minConfidence: number;
  embed(texts: string[]): Promise<number[][]>;
  /** Optional: fix spelling/grammar so retrieval and intent detection survive typos. Never answers the question. */
  normalizeQuestion?(question: string, signal?: AbortSignal): Promise<string>;
  chat(req: {
    messages: ChatMessage[];
    tools?: ToolSpec[];
    toolChoice?: 'auto' | 'required';
    signal?: AbortSignal;
  }): AsyncIterable<ChatChunk>;
}
