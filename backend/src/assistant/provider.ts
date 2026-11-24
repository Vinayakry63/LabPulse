import { config } from '../config';
import type { LLMProvider } from './llm';
import { MockProvider } from './mock';
import { OpenAIProvider } from './openai';

export function createProvider(): LLMProvider {
  if (config.llm.provider === 'openai') {
    if (!config.llm.openaiApiKey) throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY');
    return new OpenAIProvider();
  }
  return new MockProvider();
}
