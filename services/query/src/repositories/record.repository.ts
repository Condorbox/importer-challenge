import { eq } from "drizzle-orm";
import type { Database } from "@shared/db/client";
import { importColumns, type ImportColumn } from "@shared/db/schema";

type DbOrTx = Omit<Database, "$client">;

export class RecordRepository {
  constructor(private readonly db: DbOrTx) {}

  async findColumnsByImportId(importId: number): Promise<ImportColumn[]> {
    return this.db
      .select()
      .from(importColumns)
      .where(eq(importColumns.importId, importId));
  }
}