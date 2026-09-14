import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    // Database-backed tests live in *.db.test.ts and run under
    // vitest.db.config.mts. `npm test` stays hermetic: no network, no
    // database, no credentials.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/rules/**/*.ts'],
      exclude: ['lib/rules/**/*.test.ts', 'lib/rules/index.ts'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
})
