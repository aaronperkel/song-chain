import pg from 'pg'

/**
 * Server-only Postgres access.
 *
 * The app talks to Postgres directly rather than through PostgREST. Direct SQL
 * gives real transactions -- a pick has to insert a chain entry and advance the
 * turn together or not at all -- and sidesteps the Data API exposure rules
 * entirely, since no table is ever reachable with a browser-visible key.
 */

/**
 * Supabase serves Postgres behind a certificate signed by a private CA, and
 * pg 8.16 treats `sslmode=require` as `verify-full`, which rejects it. The
 * libpq-compatible spelling keeps the connection encrypted while skipping
 * chain verification -- the standard posture for Supabase clients. Pinning
 * Supabase's CA certificate would be strictly better and is the upgrade path
 * if this ever carries anything more sensitive than a party game.
 */
function libpqCompatible(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('uselibpqcompat', 'true')
  parsed.searchParams.set('sslmode', 'require')
  return parsed.toString()
}

export function connectionString(kind: 'pooled' | 'direct' = 'pooled'): string {
  const raw =
    kind === 'direct'
      ? process.env.POSTGRES_URL_NON_POOLING
      : (process.env.POSTGRES_URL ?? process.env.POSTGRES_URL_NON_POOLING)

  if (raw === undefined || raw.length === 0) {
    throw new Error(
      kind === 'direct'
        ? 'POSTGRES_URL_NON_POOLING is not set'
        : 'POSTGRES_URL is not set (run `vercel env pull`)',
    )
  }
  return libpqCompatible(raw)
}

/**
 * Module-scope pool. Fluid Compute reuses instances across requests, so this
 * is a real pool rather than a per-request connection. It stays small: the
 * free tier has a modest connection budget and Supavisor multiplexes anyway.
 */
let pool: pg.Pool | null = null

export function db(): pg.Pool {
  if (pool === null) {
    pool = new pg.Pool({
      connectionString: connectionString('pooled'),
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    })
    // A pool-level error must not take the process down.
    pool.on('error', (error) => {
      console.error('[db] idle client error', error)
    })
  }
  return pool
}

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await db().query<Row>(text, values as unknown[])
  return result.rows
}

/** The single row a query is expected to return, or null. */
export async function queryOne<Row extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, values)
  return rows[0] ?? null
}

/**
 * Run `fn` inside a transaction on one checked-out connection.
 *
 * Supavisor's transaction pooling mode is safe here because the whole
 * transaction happens on a single client.
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** Test seam: drop the pool so a new connection string takes effect. */
export async function closePool(): Promise<void> {
  if (pool !== null) {
    const closing = pool
    pool = null
    await closing.end()
  }
}
