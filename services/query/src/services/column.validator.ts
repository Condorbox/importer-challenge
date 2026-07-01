import type { ImportColumn } from "@shared/db/schema";
import type {
  FilterOperator,
  ParsedFilter,
  ParsedSort,
} from "../types/query.types";

/**
 * Thrown when a filter or sort field doesn't match any column actually
 * present in the import.
 */
export class UnknownFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownFieldError";
  }
}

/**
 * Thrown when an operator is applied to a column type it can't be
 * meaningfully evaluated against.
 */
export class FilterTypeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterTypeMismatchError";
  }
}

// gte/lte only make sense against columns with a meaningful ordering
// eq and contains are valid against any column type, including text.
const ORDERED_OPERATORS = new Set<FilterOperator>(["gte", "lte"]);

export interface ValidatedFilters {
  valid: ParsedFilter[];
  columnsByName: Map<string, ImportColumn>;
}

/**
 * Validates that every filter field (and, if provided, the sort field)
 * refers to a real column on this import, and that every operator is
 * compatible with its column's detected type.
 *
 * @param filters - Filters already parsed by parseQueryParams; field names
 *                  have passed the safe-identifier check but not yet been
 *                  checked against the actual schema for this import.
 * @param columns - The known columns for the import being queried, as
 *                  returned by RecordRepository.findColumnsByImportId.
 * @param sort    - Optional sort field, validated the same way as a filter
 *                  field but without an operator to check.
 */
export function validateFilters(
  filters: ParsedFilter[],
  columns: ImportColumn[],
  sort?: ParsedSort,
): ValidatedFilters {
  const columnsByName = buildColumnsByName(columns);

  assertKnownFields(filters, sort, columnsByName);
  assertOperatorTypeCompatibility(filters, columnsByName);

  return { valid: filters, columnsByName };
}

function buildColumnsByName(
  columns: ImportColumn[],
): Map<string, ImportColumn> {
  const map = new Map<string, ImportColumn>();
  for (const column of columns) {
    map.set(column.name, column);
  }
  return map;
}

function assertKnownFields(
  filters: ParsedFilter[],
  sort: ParsedSort | undefined,
  columnsByName: Map<string, ImportColumn>,
): void {
  const unknown = new Set<string>();

  for (const filter of filters) {
    if (!columnsByName.has(filter.field)) {
      unknown.add(filter.field);
    }
  }

  if (sort && !columnsByName.has(sort.field)) {
    unknown.add(sort.field);
  }

  if (unknown.size === 0) {
    return;
  }

  const available = [...columnsByName.keys()];
  throw new UnknownFieldError(
    `Unknown field(s): ${[...unknown].join(", ")}. ` +
      `Available fields: ${available.length ? available.join(", ") : "(none)"}.`,
  );
}

function assertOperatorTypeCompatibility(
  filters: ParsedFilter[],
  columnsByName: Map<string, ImportColumn>,
): void {
  const mismatches: string[] = [];

  for (const filter of filters) {
    if (!ORDERED_OPERATORS.has(filter.operator)) continue;

    // Field presence was already asserted by assertKnownFields, which runs
    // first in validateFilters, so this lookup is guaranteed to hit.
    const column = columnsByName.get(filter.field)!;

    if (column.detectedType === "text") {
      mismatches.push(`${filter.field}[${filter.operator}]`);
    }
  }

  if (mismatches.length === 0) {
    return;
  }

  throw new FilterTypeMismatchError(
    `Operator/type mismatch: ${mismatches.join(", ")}. ` +
      "gte/lte are only valid against numeric or date columns.",
  );
}
