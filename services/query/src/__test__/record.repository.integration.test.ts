import { RecordRepository } from "../repositories/record.repository";
import {
  isTestDbConfigured,
  setupTestDb,
  TestDb,
} from "../../../importer/src/__tests__/helpers/test_db"; // TODO put in shared

const describeIfDb = isTestDbConfigured() ? describe : describe.skip;

describeIfDb("RecordRepository (integration) — guarded numeric cast", () => {
  let testDb: TestDb;
  let repo: RecordRepository;

  beforeAll(async () => {
    testDb = await setupTestDb();
    repo = new RecordRepository(testDb.db);
  });

  afterAll(async () => {
    await testDb.teardown();
  });

  beforeEach(async () => {
    await testDb.truncateAll(["imports", "import_columns", "records"]);
  });

  async function seedSparseNumericColumn(): Promise<number> {
    const { rows: importRows } = await testDb.pool.query(
      "INSERT INTO imports (filename) VALUES ($1) RETURNING id",
      ["emissions.csv"],
    );
    const importId = importRows[0].id;

    await testDb.pool.query(
      `INSERT INTO import_columns (import_id, name, position, detected_type)
       VALUES ($1, 'country', 0, 'text'), ($1, '1850', 1, 'numeric')`,
      [importId],
    );

    await testDb.pool.query(
      `INSERT INTO records (import_id, row_number, data) VALUES
         ($1, 2, $2), ($1, 3, $3)`,
      [
        importId,
        JSON.stringify({ country: "Spain", "1850": "" }), // no data that far back
        JSON.stringify({ country: "France", "1850": "5.06" }),
      ],
    );

    return importId;
  }

  it("does not throw when an empty cell sits in a numeric column, and excludes it from gte", async () => {
    const importId = await seedSparseNumericColumn();
    const columns = await repo.findColumnsByImportId(importId);
    const columnsByName = new Map(columns.map((c) => [c.name, c]));

    const result = await repo.findRecords(
      importId,
      {
        filters: [{ field: "1850", operator: "gte", value: "5" }],
        pagination: { page: 1, limit: 50, offset: 0 },
      },
      columnsByName,
    );

    expect(result.total).toBe(1);
    expect(result.records[0].data.country).toBe("France");
  });

  it("does not throw for eq either — same crash, any operator", async () => {
    const importId = await seedSparseNumericColumn();
    const columns = await repo.findColumnsByImportId(importId);
    const columnsByName = new Map(columns.map((c) => [c.name, c]));

    const result = await repo.findRecords(
      importId,
      {
        filters: [{ field: "1850", operator: "eq", value: "5.06" }],
        pagination: { page: 1, limit: 50, offset: 0 },
      },
      columnsByName,
    );

    expect(result.total).toBe(1);
    expect(result.records[0].data.country).toBe("France");
  });
});