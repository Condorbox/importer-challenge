import { and, eq, sql, type SQL } from "drizzle-orm";
import { records, type ImportColumn } from "@shared/db/schema";
import type {
  ParsedFilter,
  ParsedQuery,
  ParsedSort,
} from "../types/query.types";

/**
 * Postgres evaluates `(data ->> 'field')::numeric` per scanned row before
 * applying the WHERE comparison, so a single non-numeric value ("" or "NA")
 * will raise `invalid input syntax for type numeric` and abort the query.
 *
 * So only cast when the extracted text matches the importer’s
 * detection pattern, otherwise we return SQL NULL. This prevents runtime
 * cast errors and makes non-conforming cells behave as absent values.
 *
 * TODO Maybe export numeric/date regexes  type-detection patterns from
 * services/importer/src/services/type_detector.service.ts
 * or share in a util file
 */
const NUMERIC_FORMAT = String.raw`^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$`;
const ISO_DATE_FORMAT = String.raw`^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$`;

/** `records.data ->> 'field'` - the raw text value, uncast. */
function jsonField(field: string): SQL {
  return sql`${records.data} ->> ${field}`;
}

function castedField(
  field: string,
  detectedType: ImportColumn["detectedType"],
): SQL {
  const raw = jsonField(field);

  switch (detectedType) {
    case "numeric":
      return sql`(CASE WHEN ${raw} ~ ${NUMERIC_FORMAT} THEN (${raw})::numeric ELSE NULL END)`;
    case "date":
      return sql`(CASE WHEN ${raw} ~ ${ISO_DATE_FORMAT} THEN (${raw})::timestamptz ELSE NULL END)`;
    case "text":
      return raw;
  }
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
