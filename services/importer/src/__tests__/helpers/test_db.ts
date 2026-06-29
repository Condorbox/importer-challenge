import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { Database } from "../../db/client";
import { relations } from "../../db/relations";
import "dotenv/config";

export interface TestDb {
  db: Database;
  pool: Pool;
  teardown: () => Promise<void>;
  truncateAll: (tableNames: string[]) => Promise<void>;
}

export function isTestDbConfigured(): boolean {
  return Boolean(process.env.TEST_DATABASE_URL);
}

export async function setupTestDb(): Promise<TestDb> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "setupTestDb() called without TEST_DATABASE_URL set. " +
        "Guard the calling describe block with isTestDbConfigured().",
    );
  }

  const pool = new Pool({ connectionString });

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    await pool.end();
    throw new Error(
      "TEST_DATABASE_URL is set but Postgres is unreachable at that URL. " +
        "Start the test DB (e.g. `docker compose up -d`) and run migrations " +
        "(`npm run db:migrate`) against TEST_DATABASE_URL before running this suite.\n" +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  try {
    await pool.query("SELECT 1 FROM imports LIMIT 0");
  } catch (err) {
    await pool.end();
    throw new Error(
      "TEST_DATABASE_URL is reachable but missing expected tables. " +
        "Run `npm run db:migrate` against TEST_DATABASE_URL before running this suite.\n" +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  const db = drizzle({ client: pool, relations }) as Database;

  return {
    db,
    pool,
    teardown: () => pool.end(),
    truncateAll: async (tableNames: string[]) => {
      const tables = sql.join(
        tableNames.map((name) => sql.identifier(name)),
        sql.raw(", "),
      );
      await db.execute(sql`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
    },
  };
}
