import { eq } from "drizzle-orm";
import type { Database } from "@shared/db/client";
import {
  imports,
  importColumns,
  records,
  type Import,
  type NewImport,
  type ImportColumn,
  type NewImportColumn,
  type NewRecord,
} from "@shared/db/schema";

/**
 * Accepted by every method below instead of the concrete `Database` type
 * exported from db/client.ts.
 *
 * `db` and `tx` are sibling types in Drizzle's relations-v2 hierarchy
 * (`NodePgDatabase` / `NodePgTransaction`, each extending its own
 * `PgAsync*` base) — neither is a strict superset of the other:
 *   - `tx` has extra methods `db` lacks (`rollback`, `nestedIndex`,
 *     `setTransaction`)
 *   - `db` has `$client` (the raw pg `Pool`), which `tx` lacks
 * Naming either type directly as `DbOrTx` therefore fails for the other
 * side. `Omit<Database, "$client">` removes the one property that's
 * actually exclusive to `db`, leaving exactly the query-builder surface
 * (select/insert/update/transaction) that both `db` and `tx` genuinely
 * share — which is also the only surface any method below actually uses;
 * none of them ever touch `this.db.$client`.
 */
type DbOrTx = Omit<Database, "$client">;

// Rows inserted per batch in insertRecords()
const RECORD_INSERT_BATCH_SIZE = 1000;

export class ImportRepository {
  constructor(private readonly db: DbOrTx) {}

  async createImport(filename: string): Promise<Import> {
    const [row] = await this.db
      .insert(imports)
      .values({ filename })
      .returning();
    return row;
  }

  async insertColumns(columns: NewImportColumn[]): Promise<ImportColumn[]> {
    if (columns.length === 0) return [];
    return this.db.insert(importColumns).values(columns).returning();
  }

  /**
   * Inserts data rows in fixed-size batches rather than one statement.
   *
   * Why batch at all: Postgres (via `pg`) caps bound parameters per query
   * at 65535. A single `records` row binds 3 parameters (importId,
   * rowNumber, data), so the cap alone wouldn't bite until ~20k rows in one
   * statement — but the README explicitly anticipates "a lot larger" files,
   * and a single multi-megabyte INSERT statement is also harder on the
   * connection's memory and on query-planning time than several smaller
   * ones. Batching at a fixed size keeps memory and statement size bounded
   * regardless of how large the CSV is, at the cost of N/batchSize round
   * trips instead of 1 — an acceptable trade given imports are
   * "write once" and allowed to take a few seconds (per the README).
   *
   * Returns only the inserted row count, not the rows themselves: the
   * caller already has the data it just inserted, so returning JSONB
   * blobs back out of the DB here would be pure waste.
   */
  async insertRecords(rows: NewRecord[]): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += RECORD_INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + RECORD_INSERT_BATCH_SIZE);
      const result = await this.db
        .insert(records)
        .values(batch)
        .returning({ id: records.id });
      inserted += result.length;
    }
    return inserted;
  }

  async updateImportStatus(
    importId: number,
    status: Import["status"],
    counts?: Pick<NewImport, "totalRows" | "validRows" | "skippedRows">,
  ): Promise<Import> {
    const [row] = await this.db
      .update(imports)
      .set({ status, ...counts })
      .where(eq(imports.id, importId))
      .returning();

    if (!row) {
      throw new Error(`Cannot update status: import ${importId} not found`);
    }
    return row;
  }

  async findImportById(importId: number): Promise<Import | undefined> {
    const [row] = await this.db
      .select()
      .from(imports)
      .where(eq(imports.id, importId));
    return row;
  }

  async findColumnsByImportId(importId: number): Promise<ImportColumn[]> {
    return this.db
      .select()
      .from(importColumns)
      .where(eq(importColumns.importId, importId));
  }
}

/**
 * Convenience wrapper: runs createImport + insertColumns + insertRecords
 * inside a single DB transaction, so a failure partway through (dropped
 * connection, OOM on a huge file, etc.) leaves no partial import behind —
 * either the whole batch lands, or none of it does. import.service.ts
 * (Phase 4) is expected to call this rather than the individual methods
 * directly for the main ingest path; the individual methods above remain
 * public for cases that don't need transactional grouping (e.g. status
 * updates after the fact, or read paths).
 */
export async function createImportWithData(
  db: DbOrTx,
  params: {
    filename: string;
    columns: Omit<NewImportColumn, "importId">[];
    rows: Omit<NewRecord, "importId">[];
    totalRows: number;
    validRows: number;
    skippedRows: number;
  },
): Promise<{
  importRow: Import;
  columns: ImportColumn[];
  recordCount: number;
}> {
  return db.transaction(async (tx: DbOrTx) => {
    const repo = new ImportRepository(tx);

    const importRow = await repo.createImport(params.filename);

    const columns = await repo.insertColumns(
      params.columns.map((c) => ({ ...c, importId: importRow.id })),
    );

    const recordCount = await repo.insertRecords(
      params.rows.map((r) => ({ ...r, importId: importRow.id })),
    );

    const finalImport = await repo.updateImportStatus(
      importRow.id,
      "completed",
      {
        totalRows: params.totalRows,
        validRows: params.validRows,
        skippedRows: params.skippedRows,
      },
    );

    return { importRow: finalImport, columns, recordCount };
  });
}
