/**
 * Migration runner.
 *
 * Applies `supabase/migrations/*.sql` in filename order, each in its own
 * transaction, recording what ran in `public.schema_migrations`. Re-running is
 * a no-op.
 *
 * The Supabase CLI would normally own this, but this project's database is
 * provisioned through the Vercel Marketplace and the CLI would need a separate
 * Supabase login to reach it. A direct connection needs no extra credential,
 * and the `supabase/migrations` layout means adopting the CLI later is just a
 * `supabase link`.
 *
 *   npm run db:migrate          apply pending migrations
 *   npm run db:migrate -- --dry list pending without applying
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import pg from 'pg'
import { connectionString } from '../lib/db/index.ts'

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

type Applied = { name: string; checksum: string }

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16)
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry')
  // Migrations use the direct connection: DDL through a transaction pooler is
  // asking for trouble.
  const client = new pg.Client({ connectionString: connectionString('direct') })
  await client.connect()

  try {
    await client.query(`
      create table if not exists public.schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `)
    await client.query('alter table public.schema_migrations enable row level security')
    // This table is created here rather than by a migration, so it misses the
    // default-privileges change in 0001 and needs the same treatment: Supabase
    // grants anon and authenticated full DML on every new table in public.
    await client.query(
      'revoke all privileges on table public.schema_migrations from anon, authenticated',
    )

    const { rows: applied } = await client.query<Applied>(
      'select name, checksum from public.schema_migrations',
    )
    const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]))

    let pending = 0
    for (const name of migrationFiles()) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
      const sum = checksum(sql)
      const previous = appliedByName.get(name)

      if (previous !== undefined) {
        if (previous !== sum) {
          // An applied migration changing underneath us means the database and
          // the repo disagree. Refuse rather than guess.
          throw new Error(
            `${name} was already applied but its contents changed ` +
              `(${previous} -> ${sum}). Write a new migration instead of editing it.`,
          )
        }
        continue
      }

      pending += 1
      if (dryRun) {
        console.log(`pending  ${name}`)
        continue
      }

      process.stdout.write(`applying ${name} ... `)
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query(
          'insert into public.schema_migrations (name, checksum) values ($1, $2)',
          [name, sum],
        )
        await client.query('commit')
        console.log('ok')
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        console.log('failed')
        throw error
      }
    }

    console.log(
      pending === 0
        ? 'up to date'
        : dryRun
          ? `${String(pending)} pending`
          : `applied ${String(pending)}`,
    )
  } finally {
    await client.end()
  }
}

await main()
