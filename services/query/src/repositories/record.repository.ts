import { eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "@shared/db/client";
import {
  importColumns,
  records,
  type ImportColumn,
  type Record_ as RecordRow,
} from "@shared/db/schema";
import type { ParsedQuery } from "../types/query.types";
import { buildRecordQuery } from "../services/record_query.service";

type DbOrTx = Omit<Database, "$client">;

export interface FindRecordsResult {
  records: RecordRow[];
  total: number;
}

export class RecordRepository {
  constructor(private readonly db: DbOrTx) {}

  async findColumnsByImportId(importId: number): Promise<ImportColumn[]> {
    return this.db
      .select()
      .from(importColumns)
      .where(eq(importColumns.importId, importId));
  }

  async findRecords(
    importId: number,
    parsed: ParsedQuery,
    columnsByName: Map<string, ImportColumn>,
  ): Promise<FindRecordsResult> {
    const { whereSql, orderBySql } = buildRecordQuery(
      importId,
      parsed,
      columnsByName,
    );

    const [rows, countRows] = await Promise.all([
      this.selectPage(whereSql, orderBySql, parsed),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(records)
        .where(whereSql),
    ]);

    return { records: rows, total: countRows[0]?.count ?? 0 };
  }

  private selectPage(
    whereSql: SQL,
    orderBySql: SQL | undefined,
    parsed: ParsedQuery,
  ) {
    const base = this.db.select().from(records).where(whereSql);
    const ordered = orderBySql ? base.orderBy(orderBySql) : base;

    return ordered
      .limit(parsed.pagination.limit)
      .offset(parsed.pagination.offset);
  }
}
