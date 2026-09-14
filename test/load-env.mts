/**
 * Load .env.local for database-backed tests.
 *
 * Next loads .env.local itself, but vitest does not, and these tests talk to
 * the real Supabase database. Parsed here rather than adding a dependency for
 * one file.
 */
import { existsSync, readFileSync } from 'node:fs'

const file = '.env.local'
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] ??= value
  }
}
