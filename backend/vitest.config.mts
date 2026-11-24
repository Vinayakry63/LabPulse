import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { LLM_PROVIDER: 'mock', DEV_AUTH: 'true', HUB_SWEEP_MS: '300' },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['test/**/*.test.ts'],
  },
});
