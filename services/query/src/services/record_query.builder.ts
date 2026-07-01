import { and, eq, sql, type SQL } from "drizzle-orm";
import { records, type ImportColumn } from "@shared/db/schema";
import type {
  ParsedFilter,
  ParsedQuery,
  ParsedSort,
} from "../types/query.types";

/** Postgres cast suffix for a JSONB ->> text extraction, per detected type. */
function castSuffix(detectedType: ImportColumn["detectedType"]): SQL | null {
  switch (detectedType) {
    case "numeric":
      return sql.raw("::numeric");
    case "date":
      return sql.raw("::timestamptz");
    case "text":
      return null;
  }
}

/** `records.data ->> 'field'` - the raw text value, uncast. */
function jsonField(field: string): SQL {
  return sql`${records.data} ->> ${field}`;
}

function castedField(
  field: string,
  detectedType: ImportColumn["detectedType"],
): SQL {
  const suffix = castSuffix(detectedType);
  const raw = jsonField(field);
  return suffix ? sql`(${raw})${suffix}` : raw;
}

/** Maps a comparison operator to its raw SQL symbol. Never fed user input. */
function rawOp(operator: "eq" | "gte" | "lte"): SQL {
  switch (operator) {
    case "eq":
      return sql.raw("=");
    case "gte":
      return sql.raw(">=");
    case "lte":
      return sql.raw("<=");
  }
}

function toContainsPattern(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

function buildFilterCondition(filter: ParsedFilter, column: ImportColumn): SQL {
  if (filter.operator === "contains") {
    return sql`${jsonField(filter.field)} ILIKE ${toContainsPattern(filter.value)} ESCAPE '\\'`;
  }

  const field = castedField(filter.field, column.detectedType);
  return sql`${field} ${rawOp(filter.operator)} ${filter.value}`;
}

function buildOrderBy(
  sortSpec: ParsedSort,
  columnsByName: Map<string, ImportColumn>,
): SQL {
  const column = columnsByName.get(sortSpec.field);

  if (!column) {
    throw new Error(
      `buildRecordQuery: unknown sort field "${sortSpec.field}". ` +
        "Did you call validateFilters() before buildRecordQuery()?",
    );
  }

  const field = castedField(sortSpec.field, column.detectedType);
  return sortSpec.direction === "desc" ? sql`${field} DESC` : sql`${field} ASC`;
}

export interface RecordQuery {
  whereSql: SQL;
  orderBySql: SQL | undefined;
}

export function buildRecordQuery(
  importId: number,
  parsed: ParsedQuery,
  columnsByName: Map<string, ImportColumn>,
): RecordQuery {
  const conditions: SQL[] = [eq(records.importId, importId)];

  for (const filter of parsed.filters) {
    const column = columnsByName.get(filter.field);

    if (!column) {
      throw new Error(
        `buildRecordQuery: unknown filter field "${filter.field}". ` +
          "Did you call validateFilters() before buildRecordQuery()?",
      );
    }

    conditions.push(buildFilterCondition(filter, column));
  }

  const whereSql = and(...conditions)!;

  const orderBySql = parsed.sort
    ? buildOrderBy(parsed.sort, columnsByName)
    : undefined;

  return { whereSql, orderBySql };
}
