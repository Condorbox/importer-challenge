import {
  detectColumnType,
  conformsToType,
  DetectedColumnType,
} from "./type_detector.service";
import { createImportWithData } from "../repositories/import.repository";
import type { Database } from "../db/client";
import type { Import, ImportColumn } from "../db/schema";
import type { ParsedCsvResult, CsvRow } from "../types/csv.types";

export interface ImportResult {
  importRow: Import;
  columns: ImportColumn[];
  recordCount: number;
}

export interface ColumnStats {
  name: string;
  position: number;
  detectedType: DetectedColumnType;
  minValue?: number;
  maxValue?: number;
  nonConformingCells: number;
}

export type PersistFn = typeof createImportWithData;

export function buildColumnStats(
  headers: string[],
  rows: CsvRow[],
): ColumnStats[] {
  return headers.map((name, position) => {
    // Collect every cell value for this column across all rows
    const allValues = rows.map((row) => row[name] ?? "");

    const detectedType = detectColumnType(allValues);

    let nonConformingCells = 0;
    let minValue: number | undefined;
    let maxValue: number | undefined;

    for (const raw of allValues) {
      const trimmed = raw.trim();

      if (trimmed.length === 0) continue;

      if (!conformsToType(trimmed, detectedType)) {
        nonConformingCells++;
        continue;
      }

      if (detectedType === "numeric") {
        const n = Number(trimmed);
        if (minValue === undefined || n < minValue) minValue = n;
        if (maxValue === undefined || n > maxValue) maxValue = n;
      }
    }

    return {
      name,
      position,
      detectedType,
      minValue,
      maxValue,
      nonConformingCells,
    };
  });
}

/**
 * Turns an already-parsed CSV result into persisted database rows.
 *
 * @param parsed            - The result of parseCsvBuffer(); must already be
 *                            validated and sanitized.
 * @param db                - Live Drizzle client used by createImportWithData()
 *                            to wrap everything in one transaction.
 * @param persistFnOverride - Injected only in unit tests; ignored in production.
 */
export async function persistImport(
  parsed: ParsedCsvResult,
  db: Database,
  persistFnOverride?: PersistFn,
): Promise<ImportResult> {
  const columnStats = buildColumnStats(parsed.headers, parsed.data);

  const columns = columnStats.map((stat) => ({
    name: stat.name,
    position: stat.position,
    detectedType: stat.detectedType,
    minValue: stat.minValue ?? null,
    maxValue: stat.maxValue ?? null,
    nonConformingCells: stat.nonConformingCells,
  }));

  // header = row 1 so first data row = row 2.
  const rows = parsed.data.map((rowData, index) => ({
    rowNumber: index + 2,
    data: rowData,
  }));

  const executePersist = persistFnOverride ?? createImportWithData;

  return executePersist(db, {
    filename: parsed.filename,
    columns,
    rows,
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    skippedRows: parsed.skippedRows,
  });
}
