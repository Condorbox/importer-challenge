import { and, eq, sql, type SQL } from "drizzle-orm";
import { records, type ImportColumn } from "@shared/db/schema";
import type {
  ParsedFilter,
  ParsedQuery,
  ParsedSort,
} from "../types/query.types";

/**
 * Translates an already-validated ParsedQuery (query.parser.ts +
 * column.validator.ts) into safe, parameterised SQL fragments against the
 * `records` table's JSONB `data` column.
 *
 * Every cell value in `records.data` is stored as a raw sanitized *string*
 * (see shared/src/db/schema.ts) — there's no native numeric/date type in
 * JSONB storage here, by design (a new CSV never needs a migration). That
 * means a numeric/date comparison has to CAST the extracted JSONB value
 * before comparing, or `co2_emissions[gte]=100` would silently become a
 * lexicographic string comparison ("9" > "100"). `castedField()` is the
 * one place that cast happens, driven by the column's `detectedType` from
 * import_columns — never by anything in the request itself.
 *
 * Callers MUST run `validateFilters()` first. This module trusts that:
 *   - every `filter.field` / `sort.field` names a real column on this
 *     import (every `columnsByName.get(...)` below is expected to hit)
 *   - every operator is compatible with its column's detected type
 *     (e.g. no gte/lte against a text column)
 * A `columnsByName` miss here is therefore treated as a programming error
 * (validation was skipped upstream), not a 4xx-worthy user input error.
 */

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

/** `records.data ->> 'field'` — the raw text value, uncast. */
function jsonField(field: string): SQL {
  return sql`${records.data} ->> ${field}`;
}

/**
 * The field's JSONB value, cast to its column's detected type. Falls
 * through to the raw text extraction for `text` columns, which need no
 * cast to compare correctly.
 */
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

/**
 * Escapes LIKE/ILIKE metacharacters (`%`, `_`, `\`) in a user-supplied
 * value so a `contains` filter matches it literally rather than as a
 * wildcard pattern, then wraps it for a substring search.
 */
function toContainsPattern(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

function buildFilterCondition(filter: ParsedFilter, column: ImportColumn): SQL {
  if (filter.operator === "contains") {
    // Substring match always runs against the raw text extraction,
    // regardless of the column's detected type — casting to numeric or
    // timestamptz first would make ILIKE meaningless, and (unlike
    // gte/lte) the validator doesn't restrict `contains` to text columns.
    return sql`${jsonField(filter.field)} ILIKE ${toContainsPattern(filter.value)} ESCAPE '\\'`;
  }

  const field = castedField(filter.field, column.detectedType);

  // `filter.value` is bound as a plain string parameter. Postgres resolves
  // its type from the other side of the comparison — the explicit cast on
  // `field` for numeric/date, or no cast at all for text — the same
  // "unknown"-type resolution any parameterised `x::numeric = $1` query
  // relies on, so no manual coercion of `value` is needed here.
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

/**
 * @param importId      - Scopes every query to a single import. ANDed in
 *                        first, unconditionally — this is the second layer
 *                        of isolation beyond the per-import column
 *                        allow-list already enforced by validateFilters(),
 *                        and it's non-negotiable: every query this builds
 *                        touches `records` directly, which has no other
 *                        tenant boundary.
 * @param parsed        - Output of parseQueryParams(), already validated
 *                        via validateFilters().
 * @param columnsByName - Column name -> ImportColumn for this import, as
 *                        returned by validateFilters().
 */
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

  // `conditions` always has at least the importId scope, so `and(...)` is
  // guaranteed to return a SQL, never undefined — the `!` reflects that
  // guarantee rather than an unchecked assumption.
  const whereSql = and(...conditions)!;

  const orderBySql = parsed.sort
    ? buildOrderBy(parsed.sort, columnsByName)
    : undefined;

  return { whereSql, orderBySql };
}
