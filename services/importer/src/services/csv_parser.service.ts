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

export function parseCsvBuffer(
  buffer: Buffer,
  filename: string,
  options: CsvParseOptions = CSV_PARSE_OPTIONS,
): ParsedCsvResult {
  const uploadId = uuidv4();
  const errors: RowError[] = [];

  const rows = parseCsv(buffer, errors);

  if (rows.length === 0) {
    return emptyResult(uploadId, filename, errors);
  }

  const headers = validateHeaders(rows[0], options);

  const dataRows = rows.slice(1);

  validateRowCount(dataRows, options);

  const { data, skippedRows } = processRows(dataRows, headers, options, errors);

  return buildResult({
    uploadId,
    filename,
    headers,
    data,
    skippedRows,
    totalRows: dataRows.length,
    errors,
  });
}

function parseCsv(buffer: Buffer, errors: RowError[]): string[][] {
  const raw = buffer.toString("utf8").replace(/^\uFEFF/, "");

  const parsed = Papa.parse<string[]>(raw, {
    header: false,
    skipEmptyLines: true,
    delimiter: ",",
  });

  parsed.errors.forEach((error) => {
    errors.push({
      row: error.row ?? 0,
      message: `Parse error: ${error.message}`,
    });
  });

  return parsed.data as string[][];
}

function validateHeaders(
  rawHeaders: string[],
  options: CsvParseOptions,
): string[] {
  const headers = rawHeaders.map((header) => header.trim());

  validateColumnCount(headers, options.maxColumns);
  validateSafeHeaders(headers);
  validateAllowedHeaders(headers, options.allowedHeaders);
  validateDuplicateHeaders(headers);

  return headers;
}

function validateColumnCount(headers: string[], maxColumns: number) {
  if (headers.length > maxColumns) {
    throw new CsvValidationError(
      `File has ${headers.length} columns; maximum allowed is ${maxColumns}.`,
    );
  }
}

function validateSafeHeaders(headers: string[]) {
  const unsafeHeaders = headers.filter((header) => !isSafeHeader(header));

  if (unsafeHeaders.length) {
    throw new CsvValidationError(
      `Unsafe header name(s) detected: ${unsafeHeaders.join(", ")}. ` +
        "Headers must contain only letters, digits, spaces, hyphens, and underscores.",
    );
  }
}

function validateAllowedHeaders(headers: string[], allowedHeaders?: string[]) {
  if (!allowedHeaders?.length) {
    return;
  }

  const missing = allowedHeaders.filter((header) => !headers.includes(header));
  const extra = headers.filter((header) => !allowedHeaders.includes(header));

  if (!missing.length && !extra.length) {
    return;
  }

  const details: string[] = [];

  if (missing.length) {
    details.push(`Missing columns: ${missing.join(", ")}`);
  }

  if (extra.length) {
    details.push(`Unexpected columns: ${extra.join(", ")}`);
  }

  throw new CsvValidationError(details.join(" | "));
}

function validateDuplicateHeaders(headers: string[]) {
  if (new Set(headers).size !== headers.length) {
    throw new CsvValidationError("Duplicate column headers are not allowed.");
  }
}

function validateRowCount(rows: string[][], options: CsvParseOptions) {
  if (rows.length > options.maxRows) {
    throw new CsvValidationError(
      `File has ${rows.length} data rows; maximum allowed is ${options.maxRows}.`,
    );
  }
}

function processRows(
  rows: string[][],
  headers: string[],
  options: CsvParseOptions,
  errors: RowError[],
) {
  const data: CsvRow[] = [];
  let skippedRows = 0;

  rows.forEach((cells, index) => {
    const rowNumber = index + 2;

    if (cells.length !== headers.length) {
      errors.push({
        row: rowNumber,
        message: `Expected ${headers.length} columns, got ${cells.length}. Row skipped.`,
      });

      skippedRows++;
      return;
    }

    data.push(buildRow(cells, headers, options));
  });

  return { data, skippedRows };
}

function buildRow(
  cells: string[],
  headers: string[],
  options: CsvParseOptions,
): CsvRow {
  return headers.reduce<CsvRow>((row, header, index) => {
    let value = normaliseCellLength(cells[index] ?? "", options.maxCellLength);

    if (options.sanitizeCells) {
      value = sanitizeCell(value);
    }

    row[header] = value;

    return row;
  }, {});
}

interface BuildResultArgs {
  uploadId: string;
  filename: string;
  headers: string[];
  data: CsvRow[];
  skippedRows: number;
  totalRows: number;
  errors: RowError[];
}

function buildResult({
  uploadId,
  filename,
  headers,
  data,
  skippedRows,
  totalRows,
  errors,
}: BuildResultArgs): ParsedCsvResult {
  return {
    uploadId,
    filename,
    totalRows,
    validRows: data.length,
    skippedRows,
    headers,
    data,
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
