import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'apps/mobile/src/design/tests/**/*.test.ts',
      'apps/mobile/src/assistant/tests/**/*.test.ts'],
    environment: 'node',
  },
});
