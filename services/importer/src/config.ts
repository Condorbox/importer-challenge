import { CsvParseOptions } from "./types/csv.types";

export const CSV_PARSE_OPTIONS: CsvParseOptions = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxRows: 10_000,
  maxColumns: 200,
  maxCellLength: 1_000,
  sanitizeCells: true,
};

export const UPLOAD_CONFIG = {
  // Multer stores files in memory — no temp files left on disk
  storageType: "memory" as const,
  // Allowed MIME types
  allowedMimeTypes: ["text/csv", "text/plain", "application/vnd.ms-excel"],
  fieldName: "file",
} as const;

export const RATE_LIMIT_CONFIG = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max uploads per window per IP
  message: "Too many upload requests. Please try again later.",
} as const;

export const SERVER_CONFIG = {
  port: Number(process.env.PORT) || 3000,
} as const;
