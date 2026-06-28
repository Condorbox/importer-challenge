import Papa from "papaparse";
import { v4 as uuidv4 } from "uuid";
import { CSV_PARSE_OPTIONS } from "../config";
import {
  isSafeHeader,
  normaliseCellLength,
  sanitizeCell,
} from "../utils/sanitize";
import type {
  CsvParseOptions,
  CsvRow,
  ParsedCsvResult,
  RowError,
} from "../types/csv.types";

// TODO Make multiple fuctions for this

/**
 * Parse a CSV buffer into a validated, sanitized result.
 *
 * @param buffer  - Raw file bytes
 * @param filename - Original filename
 * @param options - Override any default limits
 */
export function parseCsvBuffer(
  buffer: Buffer,
  filename: string,
  options: CsvParseOptions = CSV_PARSE_OPTIONS,
): ParsedCsvResult {
  const uploadId = uuidv4();
  const errors: RowError[] = [];

  // Always decode as UTF-8
  const raw = buffer.toString("utf-8").replace(/^\uFEFF/, ""); // strip BOM

  // Parse with papaparse
  const parsed = Papa.parse<string[]>(raw, {
    header: false,
    skipEmptyLines: true,
    delimiter: ",", // TODO Maybe add it as a option in config or send post atribute
  });

  if (parsed.errors.length > 0) {
    parsed.errors.forEach((e) => {
      errors.push({ row: e.row ?? 0, message: `Parse error: ${e.message}` }); // TODO Maybe instead of 0 fallback -1
    });
  }

  const rows: string[][] = parsed.data as string[][];

  if (rows.length === 0) {
    return emptyResult(uploadId, filename, errors);
  }

  // Header validation
  const rawHeaders = rows[0].map((h) => h.trim());

  if (rawHeaders.length > options.maxColumns) {
    throw new CsvValidationError(
      `File has ${rawHeaders.length} columns; maximum allowed is ${options.maxColumns}.`,
    );
  }

  // Reject unsafe header names  // TODO Maybe instead of rejecting making it safe ?
  const unsafeHeaders = rawHeaders.filter((h) => !isSafeHeader(h));
  if (unsafeHeaders.length > 0) {
    throw new CsvValidationError(
      `Unsafe header name(s) detected: ${unsafeHeaders.join(", ")}. ` +
        "Headers must contain only letters, digits, spaces, hyphens, and underscores.",
    );
  }

  // Schema enforcement if needed
  if (options.allowedHeaders && options.allowedHeaders.length > 0) {
    const missing = options.allowedHeaders.filter(
      (h) => !rawHeaders.includes(h),
    );
    const extra = rawHeaders.filter(
      (h) => !options.allowedHeaders!.includes(h),
    );
    if (missing.length > 0 || extra.length > 0) {
      const details: string[] = [];
      if (missing.length)
        details.push(`Missing columns: ${missing.join(", ")}`);
      if (extra.length) details.push(`Unexpected columns: ${extra.join(", ")}`);
      throw new CsvValidationError(details.join(" | "));
    }
  }

  // Cehck for duplicate headers
  const headerSet = new Set(rawHeaders);
  if (headerSet.size !== rawHeaders.length) {
    throw new CsvValidationError("Duplicate column headers are not allowed.");
  }

  const headers = rawHeaders;
  const dataRows = rows.slice(1);

  if (dataRows.length > options.maxRows) {
    throw new CsvValidationError(
      `File has ${dataRows.length} data rows; maximum allowed is ${options.maxRows}.`,
    );
  }

  // Row-level processing
  const validData: CsvRow[] = [];
  let skipped = 0;

  dataRows.forEach((cells, idx) => {
    const rowNum = idx + 2; // 1-based, header is row 1

    // 5a. Column count mismatch — skip the row and record the error
    if (cells.length !== headers.length) {
      errors.push({
        row: rowNum,
        message: `Expected ${headers.length} columns, got ${cells.length}. Row skipped.`,
      });
      skipped++;
      return;
    }

    // 5b. Build the row object with sanitized values
    const rowObj: CsvRow = {};
    for (let col = 0; col < headers.length; col++) {
      const raw = cells[col] ?? "";

      // Enforce max cell length first (before sanitization — avoids wasted work)
      let value = normaliseCellLength(raw, options.maxCellLength);

      // Strip control chars and neutralise formula injection
      if (options.sanitizeCells) {
        value = sanitizeCell(value);
      }

      rowObj[headers[col]] = value;
    }

    validData.push(rowObj);
  });

  return {
    uploadId,
    filename,
    totalRows: dataRows.length,
    validRows: validData.length,
    skippedRows: skipped,
    headers,
    data: validData,
    errors,
    parsedAt: new Date().toISOString(),
  };
}

export class CsvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvValidationError";
  }
}

function emptyResult(
  uploadId: string,
  filename: string,
  errors: RowError[],
): ParsedCsvResult {
  return {
    uploadId,
    filename,
    totalRows: 0,
    validRows: 0,
    skippedRows: 0,
    headers: [],
    data: [],
    errors,
    parsedAt: new Date().toISOString(),
  };
}
