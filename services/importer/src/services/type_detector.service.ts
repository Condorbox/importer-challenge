export type DetectedColumnType = "text" | "numeric" | "date";

/**
 * A column is classified as `numeric` or `date` only if at least this
 * fraction of its NON-EMPTY cells conform to that type. Empty cells are
 * excluded from the denominator entirely — a blank cell is an absence of
 * data, not evidence against a type.
 *
 * Below this threshold, the column falls back to `text`, which accepts
 * any string and triggers no casting at query time.
 */
const TYPE_DETECTION_THRESHOLD = 0.95;

// Accepts optional sign, integer or decimal part, optional exponent
const NUMERIC_PATTERN = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

// Matches ISO 8601 date or date-time strings only (YYYY-MM-DD, optionally
// with a T-time and timezone)
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function isNumericCell(value: string): boolean {
  return NUMERIC_PATTERN.test(value.trim());
}

function isIsoDateCell(value: string): boolean {
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) return false;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return false;

  // New Date() silently rolls over out-of-range components (e.g. month 13
  // becomes January of the next year) instead of failing, so re-serialize
  // and compare the date portion to reject calendar-invalid strings like
  // "2024-13-45" or "2024-02-30" that nonetheless match the shape regex.
  return parsed.toISOString().slice(0, 10) === trimmed.slice(0, 10);
}

/**
 * Detects the most specific type that at least TYPE_DETECTION_THRESHOLD of
 * a column's non-empty values conform to. Falls back to "text" when the
 * column is empty, or when neither numeric nor date values clear the
 * threshold.
 *
 * @param values - Raw string cell values for a single column, in row order.
 *                  Already sanitized/length-normalised upstream; this
 *                  function does not mutate or re-sanitize them.
 */
export function detectColumnType(values: string[]): DetectedColumnType {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v.length > 0);

  if (nonEmpty.length === 0) {
    return "text";
  }

  const numericRatio = nonEmpty.filter(isNumericCell).length / nonEmpty.length;
  if (numericRatio >= TYPE_DETECTION_THRESHOLD) {
    return "numeric";
  }

  const dateRatio = nonEmpty.filter(isIsoDateCell).length / nonEmpty.length;
  if (dateRatio >= TYPE_DETECTION_THRESHOLD) {
    return "date";
  }

  return "text";
}

/**
 * Re-checks a single cell against an already-detected column type.
 */
export function conformsToType(
  value: string,
  type: DetectedColumnType,
): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    // Empty cells never "conform", but they're also never a non-conformity
    // worth flagging — callers should check for emptiness separately if
    // they need to distinguish "missing" from "wrong type".
    return false;
  }

  switch (type) {
    case "numeric":
      return isNumericCell(trimmed);
    case "date":
      return isIsoDateCell(trimmed);
    case "text":
      return true;
  }
}
