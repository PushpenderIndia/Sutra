import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['**/src/**/*.ts', '**/packs/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        'packages/compliance/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
