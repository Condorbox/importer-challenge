import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { relations } from "./relations";

/**
 * This is the ONLY place (besides schema.ts) that imports `pg` or a
 * driver-specific Drizzle entrypoint. Repositories import `db` from here
 * and never touch `pg` or `drizzle-orm/node-postgres` directly.
 *
 * Swapping databases later (e.g. to SQLite) means:
 *   1. Writing src/db/schema.sqlite.ts (sqlite-core column builders)
 *   2. Writing a new client here using drizzle-orm/better-sqlite3 (or similar)
 *   3. Repositories are unaffected, since they only depend on the `db`
 *      export's query-builder API, which Drizzle keeps consistent across
 *      dialects for the operations this app uses (select/insert/update,
 *      where, limit/offset, orderBy).
 *
 * The one dialect-specific exception is JSONB-path filtering (Postgres
 * `->>`/`@>` operators vs SQLite's `json_extract`), which is isolated to
 * filter-building in import.repository.ts and documented there.
 */


// const connectionString = process.env.DATABASE_URL;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Example: " +
      "postgres://user:password@localhost:5432/importer",
  );
}

const pool = new Pool({
  connectionString,
  // Keep the pool modest by default; a single-purpose import/query service
  // doesn't need a large pool, and an unbounded pool is a common source of
  // "works locally, falls over under load" surprises.
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
});

pool.on("error", (err) => {
  // Idle clients can emit background errors (e.g. connection dropped by the
  // server) outside of any query; without this handler those become
  // unhandled 'error' events and can crash the process.
  console.error("[db] Unexpected error on idle PG client", err);
});

export const db = drizzle({ client: pool, relations });

export type Database = typeof db;

/** Call during graceful shutdown (e.g. on SIGTERM) to close pool connections. */
export async function closeDb(): Promise<void> {
  await pool.end();
}