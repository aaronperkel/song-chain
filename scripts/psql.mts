/**
 * Run one SQL statement against the database, for inspection.
 *
 *   npm run db:psql -- "select code, status from rooms limit 5"
 */
import pg from 'pg'
import { connectionString } from '../lib/db/index.ts'

const sql = process.argv.slice(2).join(' ')
if (sql.trim().length === 0) {
  console.error('usage: npm run db:psql -- "<sql>"')
  process.exit(1)
}

const client = new pg.Client({ connectionString: connectionString('direct') })
await client.connect()
try {
  // A multi-statement query returns an array of results, one per statement.
  const result = await client.query(sql)
  const results = Array.isArray(result) ? result : [result]
  for (const one of results) {
    console.log(JSON.stringify(one.rows ?? [], null, 2))
  }
} finally {
  await client.end()
}
