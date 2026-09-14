import { defineConfig } from 'vitest/config'

/**
 * Database-backed tests, kept out of `npm test` so the default suite stays
 * hermetic and fast. These hit the real Supabase database.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.db.test.ts'],
    setupFiles: ['./test/load-env.mts'],
    // One room at a time: these tests share a database.
    fileParallelism: false,
    testTimeout: 20_000,
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
})
