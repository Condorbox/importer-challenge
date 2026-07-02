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

  describe("guarded numeric cast", () => {
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

  // ── sort direction + pagination, against a realistic multi-row fixture ──

  /**
   * 7 rows shaped like emissions.csv. Portugal deliberately has an empty
   * co2_emissions cell — same "non-conforming value in an otherwise
   * numeric column" scenario as the "1850" case above, but here used to
   * verify where the resulting NULL sorts, not just that the query survives.
   */
  async function seedEmissionsFixture(): Promise<number> {
    const { rows: importRows } = await testDb.pool.query(
      "INSERT INTO imports (filename) VALUES ($1) RETURNING id",
      ["emissions.csv"],
    );
    const importId = importRows[0].id;

    await testDb.pool.query(
      `INSERT INTO import_columns (import_id, name, position, detected_type) VALUES
         ($1, 'country', 0, 'text'),
         ($1, 'co2_emissions', 1, 'numeric'),
         ($1, 'recorded_at', 2, 'date')`,
      [importId],
    );

    const rows: Array<[string, string, string]> = [
      ["Spain", "120.5", "2024-01-15"],
      ["France", "98.2", "2023-06-10"],
      ["Germany", "210.0", "2024-03-22"],
      ["Italy", "75.3", "2023-11-05"],
      ["Portugal", "", "2024-02-01"], // non-conforming: empty numeric cell
      ["Belgium", "150.0", "2024-01-01"],
      ["Netherlands", "60.0", "2023-09-18"],
    ];

    for (const [i, [country, co2, date]] of rows.entries()) {
      await testDb.pool.query(
        "INSERT INTO records (import_id, row_number, data) VALUES ($1, $2, $3)",
        [
          importId,
          i + 2,
          JSON.stringify({
            country,
            co2_emissions: co2,
            recorded_at: date,
          }),
        ],
      );
    }

    return importId;
  }

  async function findAll(
    importId: number,
    sort: { field: string; direction: "asc" | "desc" },
  ) {
    const columns = await repo.findColumnsByImportId(importId);
    const columnsByName = new Map(columns.map((c) => [c.name, c]));
    return repo.findRecords(
      importId,
      { filters: [], sort, pagination: { page: 1, limit: 50, offset: 0 } },
      columnsByName,
    );
  }

  describe("sort direction", () => {
    it("sorts a numeric column ascending, with the non-conforming (NULL) value last", async () => {
      const importId = await seedEmissionsFixture();
      const result = await findAll(importId, {
        field: "co2_emissions",
        direction: "asc",
      });

      expect(result.records.map((r) => r.data.country)).toEqual([
        "Netherlands", // 60.0
        "Italy", // 75.3
        "France", // 98.2
        "Spain", // 120.5
        "Belgium", // 150.0
        "Germany", // 210.0
        "Portugal", // "" -> NULL, sorts last on ASC
      ]);
    });

    it("sorts a numeric column descending, with the non-conforming (NULL) value first", async () => {
      const importId = await seedEmissionsFixture();
      const result = await findAll(importId, {
        field: "co2_emissions",
        direction: "desc",
      });

      expect(result.records.map((r) => r.data.country)).toEqual([
        "Portugal", // "" -> NULL, sorts first on DESC
        "Germany", // 210.0
        "Belgium", // 150.0
        "Spain", // 120.5
        "France", // 98.2
        "Italy", // 75.3
        "Netherlands", // 60.0
      ]);
    });

    it("sorts a date column ascending as real dates, not lexicographic text", async () => {
      const importId = await seedEmissionsFixture();
      const result = await findAll(importId, {
        field: "recorded_at",
        direction: "asc",
      });

      expect(result.records.map((r) => r.data.country)).toEqual([
        "France", // 2023-06-10
        "Netherlands", // 2023-09-18
        "Italy", // 2023-11-05
        "Belgium", // 2024-01-01
        "Spain", // 2024-01-15
        "Portugal", // 2024-02-01
        "Germany", // 2024-03-22
      ]);
    });

    it("sorts a text column ascending (the uncast branch of castedField)", async () => {
      const importId = await seedEmissionsFixture();
      const result = await findAll(importId, {
        field: "country",
        direction: "asc",
      });

      expect(result.records.map((r) => r.data.country)).toEqual([
        "Belgium",
        "France",
        "Germany",
        "Italy",
        "Netherlands",
        "Portugal",
        "Spain",
      ]);
    });
  });

  describe("pagination", () => {
    it("slices results into pages of the requested limit, ordered deterministically", async () => {
      const importId = await seedEmissionsFixture();
      const columns = await repo.findColumnsByImportId(importId);
      const columnsByName = new Map(columns.map((c) => [c.name, c]));
      const sort = { field: "country", direction: "asc" as const };

      const page1 = await repo.findRecords(
        importId,
        { filters: [], sort, pagination: { page: 1, limit: 3, offset: 0 } },
        columnsByName,
      );
      const page2 = await repo.findRecords(
        importId,
        { filters: [], sort, pagination: { page: 2, limit: 3, offset: 3 } },
        columnsByName,
      );
      const page3 = await repo.findRecords(
        importId,
        { filters: [], sort, pagination: { page: 3, limit: 3, offset: 6 } },
        columnsByName,
      );

      expect(page1.records.map((r) => r.data.country)).toEqual([
        "Belgium",
        "France",
        "Germany",
      ]);
      expect(page2.records.map((r) => r.data.country)).toEqual([
        "Italy",
        "Netherlands",
        "Portugal",
      ]);
      expect(page3.records.map((r) => r.data.country)).toEqual(["Spain"]);

      // total reflects the full matching set, independent of the page/limit
      expect(page1.total).toBe(7);
      expect(page2.total).toBe(7);
      expect(page3.total).toBe(7);
    });

    it("returns an empty page (not an error) when the offset is beyond the result set", async () => {
      const importId = await seedEmissionsFixture();
      const columns = await repo.findColumnsByImportId(importId);
      const columnsByName = new Map(columns.map((c) => [c.name, c]));

      const result = await repo.findRecords(
        importId,
        {
          filters: [],
          sort: { field: "country", direction: "asc" },
          pagination: { page: 4, limit: 3, offset: 9 },
        },
        columnsByName,
      );

      expect(result.records).toEqual([]);
      expect(result.total).toBe(7); // total is unaffected by an out-of-range page
    });

    it("combines a filter, a sort, and pagination correctly", async () => {
      const importId = await seedEmissionsFixture();
      const columns = await repo.findColumnsByImportId(importId);
      const columnsByName = new Map(columns.map((c) => [c.name, c]));

      // co2_emissions >= 70 excludes Netherlands (60.0) AND Portugal (NULL)
      const query = {
        filters: [
          { field: "co2_emissions", operator: "gte" as const, value: "70" },
        ],
        sort: { field: "co2_emissions", direction: "desc" as const },
        pagination: { page: 1, limit: 2, offset: 0 },
      };

      const page1 = await repo.findRecords(importId, query, columnsByName);
      const page2 = await repo.findRecords(
        importId,
        { ...query, pagination: { page: 2, limit: 2, offset: 2 } },
        columnsByName,
      );

      expect(page1.records.map((r) => r.data.country)).toEqual([
        "Germany",
        "Belgium",
      ]);
      expect(page2.records.map((r) => r.data.country)).toEqual([
        "Spain",
        "France",
      ]);
      expect(page1.total).toBe(5); // Germany, Belgium, Spain, France, Italy
      expect(page2.total).toBe(5);
    });
  });
});
