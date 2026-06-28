// A raw parsed row from PapaParse, values are always strings until validated.
export type CsvRow = Record<string, string>;

// Upload Result
export interface ParsedCsvResult {
  uploadId: string;
  filename: string;
  totalRows: number;
  validRows: number;
  skippedRows: number;
  headers: string[];
  data: CsvRow[];
  errors: RowError[];
  parsedAt: string;
}

export interface RowError {
  row: number;
  field?: string;
  message: string;
}

// Config
export interface CsvParseOptions {
  // Maximum file size in bytes
  maxFileSizeBytes: number;
  // Maximum number of rows allowed
  maxRows: number;
  // Maximum number of columns allowed
  maxColumns: number;
  // Maximum length of any single cell value
  maxCellLength: number;
  // If provided, only these headers (in any order) are accepted
  allowedHeaders?: string[];
  // Strip dangerous characters from cell values
  sanitizeCells: boolean;
}

// API Responses
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
  details?: string[];
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
