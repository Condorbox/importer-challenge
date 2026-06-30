import {
  ParsedQuery,
  ParsedFilter,
  PaginationConfig,
  FilterOperator,
  ParsedSort,
} from "../types/query.types";

const RESERVED_KEYS = new Set(["sort", "page", "limit"]);
const SUPPORTED_OPERATORS = new Set<FilterOperator>([
  "eq",
  "gte",
  "lte",
  "contains",
]);

/**
 * Mirrors the importer's `isSafeHeader` pattern (services/importer/src/utils/sanitize.ts).
 * Filter/sort `field` values from the query string are eventually used to
 * resolve a column in `import_columns` (and, downstream, a JSONB path like
 * `data->>'field'`). They must therefore pass the exact same "safe to use
 * as an identifier" check the importer applies when a column name is first
 * stored — letters, digits, spaces, hyphens, underscores only — so a
 * crafted query param can never smuggle something like `../etc`,
 * `col;DROP TABLE`, or `<script>` into a query built from this field name.
 */
const SAFE_FIELD_NAME = /^[\w\s-]{1,64}$/;

function isSafeFieldName(field: string): boolean {
  return SAFE_FIELD_NAME.test(field);
}

/**
 * Cap on filter values (mainly relevant to `contains`, which becomes an
 * ILIKE pattern downstream). Without a cap, a single query param could
 * carry an arbitrarily large string into a SQL pattern match — a cheap
 * DoS vector, same rationale as the importer's `maxCellLength` /
 * `normaliseCellLength` for CSV cells.
 */
const MAX_FILTER_VALUE_LENGTH = 500;

export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryValidationError";
  }
}

export function parseQueryParams(
  query: Record<string, unknown>,
  paginationConfig: PaginationConfig,
): ParsedQuery {
  const page = parsePage(query.page, paginationConfig.defaultPage);
  const limit = parseLimit(
    query.limit,
    paginationConfig.defaultLimit,
    paginationConfig.maxLimit,
  );

  return {
    filters: parseFilters(query),
    sort: parseSort(query.sort),
    pagination: {
      page,
      limit,
      offset: (page - 1) * limit,
    },
  };
}

function parseFilters(query: Record<string, unknown>): ParsedFilter[] {
  return Object.entries(query)
    .filter(([key]) => !RESERVED_KEYS.has(key))
    .map(([rawKey, rawValue]) => {
      const { field, operator } = parseFilterKey(rawKey);
      const value = normaliseFilterValue(parseSingleString(rawValue, rawKey));
      return { field, operator, value };
    });
}

function parseFilterKey(rawKey: string): {
  field: string;
  operator: FilterOperator;
} {
  if (rawKey.trim().length === 0) {
    throw new QueryValidationError("Filter field cannot be empty.");
  }

  if (!rawKey.includes("[") && !rawKey.includes("]")) {
    assertSafeFieldName(rawKey);
    return { field: rawKey, operator: "eq" };
  }

  const match = /^([^[\]]+)\[([^[\]]+)]$/.exec(rawKey);
  if (!match) {
    throw new QueryValidationError(`Malformed filter syntax: ${rawKey}`);
  }

  const [, field, rawOperator] = match;

  if (!isFilterOperator(rawOperator)) {
    throw new QueryValidationError(
      `Unsupported filter operator: ${rawOperator}`,
    );
  }

  assertSafeFieldName(field);

  return { field, operator: rawOperator };
}

function assertSafeFieldName(field: string): void {
  if (!isSafeFieldName(field)) {
    throw new QueryValidationError(
      `Unsafe field name: ${field}. Fields must contain only letters, ` +
        "digits, spaces, hyphens, and underscores.",
    );
  }
}

function normaliseFilterValue(value: string): string {
  return value.slice(0, MAX_FILTER_VALUE_LENGTH);
}

function parseSort(rawValue: unknown): ParsedSort | undefined {
  if (rawValue === undefined) return undefined;

  const value = parseSingleString(rawValue, "sort");
  if (value.length === 0 || value === "-") {
    throw new QueryValidationError("Sort field cannot be empty.");
  }

  const direction = value.startsWith("-") ? "desc" : "asc";
  const field = direction === "desc" ? value.slice(1) : value;

  assertSafeFieldName(field);

  return { field, direction };
}

function parsePage(rawValue: unknown, defaultPage: number): number {
  if (rawValue === undefined) return defaultPage;

  const page = parsePositiveInteger(rawValue, "page");

  // Design choice: page=0 / negative page is REJECTED, not clamped to 1.
  // Unlike `limit` (clamped to maxLimit, since "asking for too much" is a
  // harmless, common client mistake), an out-of-range page number is far
  // more likely to indicate a client-side bug (e.g. a 0-indexed page
  // counter that was never converted to 1-indexed) than legitimate intent.
  // Clamping it silently would hide that bug instead of surfacing it.
  if (page < 1) {
    throw new QueryValidationError("page must be greater than or equal to 1.");
  }

  return page;
}

function parseLimit(
  rawValue: unknown,
  defaultLimit: number,
  maxLimit: number,
): number {
  if (rawValue === undefined) return defaultLimit;

  const limit = parsePositiveInteger(rawValue, "limit");
  if (limit < 1) {
    throw new QueryValidationError("limit must be greater than or equal to 1.");
  }

  // Design choice: limit is CLAMPED, not rejected, when it exceeds
  // maxLimit — asking for "too many" rows isn't a client error worth
  // failing the request over, it's just capped to protect the service.
  return Math.min(limit, maxLimit);
}

function parsePositiveInteger(rawValue: unknown, key: string): number {
  const value = parseSingleString(rawValue, key);

  if (!/^\d+$/.test(value)) {
    throw new QueryValidationError(`${key} must be a positive integer.`);
  }

  return Number(value);
}

function parseSingleString(rawValue: unknown, key: string): string {
  if (Array.isArray(rawValue)) {
    throw new QueryValidationError(`${key} must be provided only once.`);
  }

  if (typeof rawValue !== "string") {
    throw new QueryValidationError(`${key} must be a string.`);
  }

  return rawValue.trim();
}

function isFilterOperator(value: string): value is FilterOperator {
  return SUPPORTED_OPERATORS.has(value as FilterOperator);
}
