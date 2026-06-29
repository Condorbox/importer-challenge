import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

/**
 * Relational Queries v2 (drizzle-orm 1.0.0-rc).
 *
 * In RQBv1, each table's relations were declared next to it via the now-
 * removed `relations()` helper from "drizzle-orm" and exported from
 * schema.ts. In v2 all relations live in one place, built from the `r`
 * callback (autocompletes every table plus `one`/`many`/`through`), and
 * this object — not `schema` — is what gets passed into `drizzle(...)`.
 *
 * imports 1--* importColumns
 * imports 1--* records
 */
export const relations = defineRelations(schema, (r) => ({
  imports: {
    columns: r.many.importColumns(),
    records: r.many.records(),
  },
  importColumns: {
    import: r.one.imports({
      from: r.importColumns.importId,
      to: r.imports.id,
    }),
  },
  records: {
    import: r.one.imports({
      from: r.records.importId,
      to: r.imports.id,
    }),
  },
}));
