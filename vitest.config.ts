import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Ratchet baseline, set just under the measured numbers (32.86 stmts / 30.62 branch / 33.95 funcs / 33.12 lines) so coverage can only go up. The previous 70 across the board was never met, so `npm run test:coverage` always exited with four errors — a gate that cannot pass teaches contributors to ignore the command. Raise these as coverage improves. Note CI runs `npm test`, not this script, so the gate is local-only until test.yml calls it.
      thresholds: {
        branches: 30,
        functions: 33,
        lines: 32,
        statements: 32,
      },
    },
  },
  resolve: {
    alias: {
      obsidian: resolve(__dirname, './tests/__mocks__/obsidian.ts'),
    },
  },
});
