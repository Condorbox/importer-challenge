import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import type { CsvRow } from "../types/csv.types";

/**
 * ── Design summary (JSONB hybrid) ────────────────────────────────────────
 *
 * imports          one row per CSV upload (the "batch")
 * import_columns   a dynamic schema registry: one row per detected column,
 *                   per import. This is what lets the Query API safely
 *                   resolve "?field=value" -> a known, typed column instead
 *                   of trusting arbitrary user input as a JSON path.
 * records          one row per CSV data row. The actual cell values live in
 *                   a single JSONB column, so we never need a migration
 *                   when a new CSV brings new headers.
 *
 * Why one row per record (not per cell, as classic EAV would do):
 * query cost stays flat as filters are added (no self-joins per field),
 * and table size scales with row count rather than cell count.
 * See README.md "Data modeling decisions" for the full write-up, including
 * why a typed-EAV alternative was considered and rejected.
 * ──────────────────────────────────────────────────────────────────────────
 */

export const importStatusEnum = pgEnum("import_status", [
  "processing",
  "completed",
  "failed",
]);

export const columnTypeEnum = pgEnum("column_type", [
  "text",
  "numeric",
  "date",
]);

export const imports = pgTable("imports", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  status: importStatusEnum("status").notNull().default("processing"),

  totalRows: integer("total_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per detected CSV column, scoped to a single import. `position`
 * preserves the original column order for the API/UI; `detectedType`
 * drives how the Query API casts JSONB values when filtering/sorting
 * (`numeric` -> cast to numeric, `date` -> cast to date, `text` -> as-is).
 *
 * minValue/maxValue satisfy the README's "basic aggregation post-import"
 * requirement: computed once at ingest time instead of recomputed on every
 * GET request.
 */
export const importColumns = pgTable(
  "import_columns",
  {
    id: serial("id").primaryKey(),
    importId: integer("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    position: integer("position").notNull(),
    detectedType: columnTypeEnum("detected_type").notNull().default("text"),

    // Populated only when detectedType = 'numeric'. Stored as numeric
    // (not double) to avoid floating point drift on aggregation.
    minValue: numeric("min_value", { mode: "number" }),
    maxValue: numeric("max_value", { mode: "number" }),

    // Count of cells in this column that failed to coerce to the detected
    // type (e.g. "N/A" in an otherwise-numeric column). The raw string is
    // still preserved in records.data; this is purely a quality signal.
    nonConformingCells: integer("non_conforming_cells").notNull().default(0),
  },
  (table) => [
    index("import_columns_import_id_idx").on(table.importId),
    // A column name is unique within a single import, but the same name
    // ("country", "year"...) will recur across different imports.
    index("import_columns_import_id_name_idx").on(table.importId, table.name),
  ],
);

export const records = pgTable(
  "records",
  {
    id: serial("id").primaryKey(),
    importId: integer("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),

    // 1-based position of this row within the original CSV (header = row 1,
    // so the first data row is 2) — mirrors the row numbers already used in
    // csv-parser's RowError, so error messages and stored rows line up.
    rowNumber: integer("row_number").notNull(),

    // The full row, keyed by header name, values as parsed/sanitized
    // strings — exactly CsvRow's shape. Numeric/date interpretation is
    // applied at query time via casts driven by import_columns.detectedType,
    // never baked into storage, so the raw value is never lost.
    data: jsonb("data").$type<CsvRow>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("records_import_id_idx").on(table.importId),
    // GIN index enables efficient containment/key-existence queries
    // (e.g. `data ? 'country'`) and is the prerequisite for adding
    // targeted expression indexes per hot field later
    // (e.g. `((data->>'co2_emissions')::numeric)`,) without a table rewrite.
    index("records_data_gin_idx").using("gin", table.data),
  ],
);

export type Import = typeof imports.$inferSelect;
export type NewImport = typeof imports.$inferInsert;
export type ImportColumn = typeof importColumns.$inferSelect;
export type NewImportColumn = typeof importColumns.$inferInsert;
export type Record_ = typeof records.$inferSelect;
export type NewRecord = typeof records.$inferInsert;
