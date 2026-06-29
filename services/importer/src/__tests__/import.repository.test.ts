import {
  ImportRepository,
  createImportWithData,
} from "../repositories/import.repository";
import type { NewImportColumn, NewRecord } from "../db/schema";
import { isTestDbConfigured, setupTestDb, TestDb } from "./helpers/test_db";

const describeIfDb = isTestDbConfigured() ? describe : describe.skip;

describeIfDb("ImportRepository (integration)", () => {
  let testDb: TestDb;
  let repo: ImportRepository;

  beforeAll(async () => {
    testDb = await setupTestDb();
    repo = new ImportRepository(testDb.db);
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  beforeEach(async () => {
    await testDb.truncateAll(["imports", "import_columns", "records"]);
  });

  describe("createImport", () => {
    it("inserts a new import row with default status and zero counts", async () => {
      const result = await repo.createImport("emissions.csv");

      expect(result.id).toBeGreaterThan(0);
      expect(result.filename).toBe("emissions.csv");
      expect(result.status).toBe("processing");
      expect(result.totalRows).toBe(0);
      expect(result.validRows).toBe(0);
      expect(result.skippedRows).toBe(0);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("generates a unique, incrementing id for each import", async () => {
      const first = await repo.createImport("a.csv");
      const second = await repo.createImport("b.csv");
      expect(second.id).toBeGreaterThan(first.id);
    });
  });

  describe("insertColumns", () => {
    it("inserts columns and returns them with generated ids", async () => {
      const importRow = await repo.createImport("test.csv");

      const columns: NewImportColumn[] = [
        {
          importId: importRow.id,
          name: "country",
          position: 0,
          detectedType: "text",
        },
        {
          importId: importRow.id,
          name: "co2_emissions",
          position: 1,
          detectedType: "numeric",
          minValue: 1.5,
          maxValue: 999.9,
        },
      ];

      const inserted = await repo.insertColumns(columns);

      expect(inserted).toHaveLength(2);
      expect(inserted[0].name).toBe("country");
      expect(inserted[1].name).toBe("co2_emissions");
      expect(inserted[1].detectedType).toBe("numeric");
      expect(inserted[1].minValue).toBe(1.5);
      expect(inserted[1].maxValue).toBe(999.9);
    });

    it("returns an empty array without querying when given no columns", async () => {
      const result = await repo.insertColumns([]);
      expect(result).toEqual([]);
    });

    it("rejects columns referencing a non-existent import (FK constraint)", async () => {
      await expect(
        repo.insertColumns([
          {
            importId: 999999,
            name: "orphan",
            position: 0,
            detectedType: "text",
          },
        ]),
      ).rejects.toThrow();
    });
  });

  describe("insertRecords", () => {
    it("inserts rows and preserves JSONB structure on read-back", async () => {
      const importRow = await repo.createImport("test.csv");

      const rows: NewRecord[] = [
        {
          importId: importRow.id,
          rowNumber: 2,
          data: { country: "Spain", co2_emissions: "120.5" },
        },
        {
          importId: importRow.id,
          rowNumber: 3,
          data: { country: "France", co2_emissions: "98.2" },
        },
      ];

      const count = await repo.insertRecords(rows);
      expect(count).toBe(2);

      const { rows: dbRows } = await testDb.pool.query(
        "SELECT data FROM records WHERE import_id = $1 ORDER BY row_number",
        [importRow.id],
      );
      expect(dbRows).toHaveLength(2);
      expect(dbRows[0].data).toEqual({
        country: "Spain",
        co2_emissions: "120.5",
      });
    });

    it("batches inserts correctly across multiple chunks", async () => {
      // TODO Fix const 2500 RECORD_INSERT_BATCH_SIZE
      const importRow = await repo.createImport("large.csv");
      const rows: NewRecord[] = Array.from({ length: 2500 }, (_, i) => ({
        importId: importRow.id,
        rowNumber: i + 2,
        data: { value: String(i) },
      }));

      const count = await repo.insertRecords(rows);
      expect(count).toBe(2500);

      const { rows: countRows } = await testDb.pool.query(
        "SELECT COUNT(*)::int AS count FROM records WHERE import_id = $1",
        [importRow.id],
      );
      expect(countRows[0].count).toBe(2500);
    });

    it("returns 0 without inserting when given no rows", async () => {
      const count = await repo.insertRecords([]);
      expect(count).toBe(0);
    });

    it("rejects rows referencing a non-existent import (FK constraint)", async () => {
      await expect(
        repo.insertRecords([
          { importId: 999999, rowNumber: 1, data: { x: "1" } },
        ]),
      ).rejects.toThrow();
    });
  });

  describe("updateImportStatus", () => {
    it("updates the status and row counts of an existing import", async () => {
      const importRow = await repo.createImport("test.csv");

      const updated = await repo.updateImportStatus(importRow.id, "completed", {
        totalRows: 100,
        validRows: 95,
        skippedRows: 5,
      });

      expect(updated.status).toBe("completed");
      expect(updated.totalRows).toBe(100);
      expect(updated.validRows).toBe(95);
      expect(updated.skippedRows).toBe(5);
    });

    it("throws when the import does not exist", async () => {
      await expect(
        repo.updateImportStatus(999999, "failed"),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("findImportById / findColumnsByImportId", () => {
    it("retrieves a previously created import by id", async () => {
      const created = await repo.createImport("lookup.csv");
      const found = await repo.findImportById(created.id);
      expect(found?.filename).toBe("lookup.csv");
    });

    it("returns undefined for a non-existent import id", async () => {
      const found = await repo.findImportById(999999);
      expect(found).toBeUndefined();
    });

    it("retrieves columns scoped to a single import", async () => {
      const importA = await repo.createImport("a.csv");
      const importB = await repo.createImport("b.csv");

      await repo.insertColumns([
        { importId: importA.id, name: "x", position: 0, detectedType: "text" },
      ]);
      await repo.insertColumns([
        { importId: importB.id, name: "y", position: 0, detectedType: "text" },
      ]);

      const columnsForA = await repo.findColumnsByImportId(importA.id);
      expect(columnsForA).toHaveLength(1);
      expect(columnsForA[0].name).toBe("x");
    });
  });

  describe("createImportWithData (transactional)", () => {
    it("creates the import, columns, and records atomically", async () => {
      const result = await createImportWithData(testDb.db, {
        filename: "atomic.csv",
        columns: [
          { name: "country", position: 0, detectedType: "text" },
          { name: "value", position: 1, detectedType: "numeric" },
        ],
        rows: [
          { rowNumber: 2, data: { country: "Spain", value: "10" } },
          { rowNumber: 3, data: { country: "France", value: "20" } },
        ],
        totalRows: 2,
        validRows: 2,
        skippedRows: 0,
      });

      expect(result.importRow.status).toBe("completed");
      expect(result.importRow.totalRows).toBe(2);
      expect(result.columns).toHaveLength(2);
      expect(result.recordCount).toBe(2);

      const { rows } = await testDb.pool.query(
        "SELECT COUNT(*)::int AS count FROM records WHERE import_id = $1",
        [result.importRow.id],
      );
      expect(rows[0].count).toBe(2);
    });

    it("leaves no partial import behind when insertColumns fails mid-transaction", async () => {
      const before = await testDb.pool.query(
        "SELECT COUNT(*)::int AS count FROM imports",
      );

      await expect(
        createImportWithData(testDb.db, {
          filename: "partial-failure-columns.csv",
          columns: [
            {
              name: null as unknown as string,
              position: 0,
              detectedType: "text",
            },
          ],
          rows: [{ rowNumber: 2, data: { x: "1" } }],
          totalRows: 1,
          validRows: 1,
          skippedRows: 0,
        }),
      ).rejects.toThrow();

      const after = await testDb.pool.query(
        "SELECT COUNT(*)::int AS count FROM imports",
      );

      expect(after.rows[0].count).toBe(before.rows[0].count);

      const { rows: leaked } = await testDb.pool.query(
        "SELECT * FROM imports WHERE filename = $1",
        ["partial-failure-columns.csv"],
      );
      expect(leaked).toHaveLength(0);
    });

    it("leaves no partial import behind when insertRecords fails mid-transaction", async () => {
      const before = await testDb.pool.query(
        "SELECT COUNT(*)::int AS count FROM imports",
      );

      await expect(
        createImportWithData(testDb.db, {
          filename: "partial-failure-records.csv",
          columns: [{ name: "country", position: 0, detectedType: "text" }],
          rows: [
            { rowNumber: 2, data: { country: "Spain" } },
            {
              rowNumber: 3,
              data: null as unknown as Record<string, string>,
            },
          ],
          totalRows: 2,
          validRows: 2,
          skippedRows: 0,
        }),
      ).rejects.toThrow();

      const after = await testDb.pool.query(
        "SELECT COUNT(*)::int AS count FROM imports",
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);

      const { rows: leakedImport } = await testDb.pool.query(
        "SELECT * FROM imports WHERE filename = $1",
        ["partial-failure-records.csv"],
      );
      expect(leakedImport).toHaveLength(0);

      const { rows: leakedColumns } = await testDb.pool.query(
        `SELECT ic.* FROM import_columns ic
         JOIN imports i ON i.id = ic.import_id
         WHERE i.filename = $1`,
        ["partial-failure-records.csv"],
      );
      expect(leakedColumns).toHaveLength(0);
    });
  });
});