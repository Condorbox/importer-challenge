import { Import, ImportColumn } from "@shared/db/schema";
import {
  buildColumnStats,
  PersistFn,
  persistImport,
} from "../services/import.service";
import { ParsedCsvResult } from "../types/csv.types";

type PersistedColumn = {
  name: string;
  position: number;
  detectedType: "text" | "numeric" | "date";
  minValue: number | null;
  maxValue: number | null;
  nonConformingCells: number;
};

// Minimal ParsedCsvResult for a two-column, three-row CSV
const PARSED_NUMERIC: ParsedCsvResult = {
  uploadId: "test-uuid",
  filename: "emissions.csv",
  totalRows: 3,
  validRows: 3,
  skippedRows: 0,
  headers: ["country", "co2_emissions"],
  data: [
    { country: "Spain", co2_emissions: "120.5" },
    { country: "France", co2_emissions: "98.2" },
    { country: "Germany", co2_emissions: "210.0" },
  ],
  errors: [],
  parsedAt: new Date().toISOString(),
};

const makeStubDb = () =>
  ({
    transaction: jest.fn(),
  }) as unknown as Parameters<typeof persistImport>[1];

function makeFakeImportResult(overrides?: {
  totalRows?: number;
  validRows?: number;
  skippedRows?: number;
  columnCount?: number;
}) {
  const importRow: Import = {
    id: 1,
    filename: "emissions.csv",
    status: "completed",
    totalRows: overrides?.totalRows ?? 3,
    validRows: overrides?.validRows ?? 3,
    skippedRows: overrides?.skippedRows ?? 0,
    createdAt: new Date(),
  };

  const columns: ImportColumn[] = Array.from(
    { length: overrides?.columnCount ?? 2 },
    (_, i) => ({
      id: i + 1,
      importId: 1,
      name: `col_${i}`,
      position: i,
      detectedType: "text" as const,
      minValue: null,
      maxValue: null,
      nonConformingCells: 0,
    }),
  );

  return { importRow, columns, recordCount: overrides?.totalRows ?? 3 };
}

describe("buildColumnStats", () => {
  describe("type detection", () => {
    it("detects a text column (country names)", () => {
      const stats = buildColumnStats(
        ["country"],
        [{ country: "Spain" }, { country: "France" }],
      );
      expect(stats[0].detectedType).toBe("text");
    });

    it("detects a numeric column", () => {
      const stats = buildColumnStats(
        ["value"],
        [{ value: "1.5" }, { value: "2.0" }, { value: "3" }],
      );
      expect(stats[0].detectedType).toBe("numeric");
    });

    it("detects an ISO-date column", () => {
      const stats = buildColumnStats(
        ["recorded_at"],
        [
          { recorded_at: "2024-01-01" },
          { recorded_at: "2024-06-15" },
          { recorded_at: "2023-12-31" },
        ],
      );
      expect(stats[0].detectedType).toBe("date");
    });
  });

  describe("position assignment", () => {
    it("assigns position matching the header order", () => {
      const stats = buildColumnStats(
        ["a", "b", "c"],
        [{ a: "1", b: "2", c: "3" }],
      );
      expect(stats.map((s: { position: number }) => s.position)).toEqual([
        0, 1, 2,
      ]);
    });

    it("preserves header names exactly", () => {
      const stats = buildColumnStats(
        ["country", "co2_emissions"],
        [{ country: "Spain", co2_emissions: "100" }],
      );
      expect(stats.map((s: { name: string }) => s.name)).toEqual([
        "country",
        "co2_emissions",
      ]);
    });
  });

  describe("min/max aggregation", () => {
    it("computes min and max for a numeric column", () => {
      const stats = buildColumnStats(
        ["value"],
        [{ value: "10" }, { value: "3" }, { value: "7" }],
      );
      expect(stats[0].minValue).toBe(3);
      expect(stats[0].maxValue).toBe(10);
    });

    it("handles negative numbers correctly", () => {
      const stats = buildColumnStats(
        ["temp"],
        [{ temp: "-5" }, { temp: "0" }, { temp: "20" }],
      );
      expect(stats[0].minValue).toBe(-5);
      expect(stats[0].maxValue).toBe(20);
    });

    it("handles a single-row numeric column", () => {
      const stats = buildColumnStats(["n"], [{ n: "42" }]);
      expect(stats[0].minValue).toBe(42);
      expect(stats[0].maxValue).toBe(42);
    });

    it("does NOT set min/max for a text column", () => {
      const stats = buildColumnStats(
        ["label"],
        [{ label: "foo" }, { label: "bar" }],
      );
      expect(stats[0].minValue).toBeUndefined();
      expect(stats[0].maxValue).toBeUndefined();
    });

    it("does NOT set min/max for a date column", () => {
      const stats = buildColumnStats(
        ["created"],
        [{ created: "2024-01-01" }, { created: "2024-06-01" }],
      );
      expect(stats[0].minValue).toBeUndefined();
      expect(stats[0].maxValue).toBeUndefined();
    });
  });

  describe("non-conforming cell counting", () => {
    it("counts non-conforming cells in a mostly-numeric column", () => {
      const values = [
        ...Array(19).fill({ value: "100" }),
        { value: "N/A" },
      ] as Array<Record<string, string>>;

      const stats = buildColumnStats(["value"], values);
      expect(stats[0].detectedType).toBe("numeric");
      expect(stats[0].nonConformingCells).toBe(1);
    });

    it("does not count empty cells as non-conforming", () => {
      const stats = buildColumnStats(
        ["n"],
        [{ n: "1" }, { n: "" }, { n: "3" }],
      );
      expect(stats[0].nonConformingCells).toBe(0);
    });

    it("counts zero non-conforming cells for a clean column", () => {
      const stats = buildColumnStats(
        ["n"],
        [{ n: "1" }, { n: "2" }, { n: "3" }],
      );
      expect(stats[0].nonConformingCells).toBe(0);
    });

    it("counts multiple non-conforming cells", () => {
      const values = [
        ...Array(18).fill({ value: "42" }),
        { value: "N/A" },
        { value: "?" },
      ] as Array<Record<string, string>>;

      const stats = buildColumnStats(["value"], values);

      expect(stats[0].detectedType).toBe("text");
      expect(stats[0].nonConformingCells).toBe(0);
    });
  });

  describe("empty / edge cases", () => {
    it("returns an empty array when headers is empty", () => {
      expect(buildColumnStats([], [])).toEqual([]);
    });

    it("handles rows that are missing the column key (treats as empty)", () => {
      const stats = buildColumnStats(["n"], [{} as Record<string, string>]);
      expect(stats[0].nonConformingCells).toBe(0);
      expect(stats[0].detectedType).toBe("text");
    });

    it("handles a column that is entirely empty strings", () => {
      const stats = buildColumnStats(["n"], [{ n: "" }, { n: "" }, { n: "" }]);

      expect(stats[0].detectedType).toBe("text");
      expect(stats[0].nonConformingCells).toBe(0);
      expect(stats[0].minValue).toBeUndefined();
      expect(stats[0].maxValue).toBeUndefined();
    });

    it("correctly handles whitespace-only cells as empty", () => {
      const stats = buildColumnStats(
        ["n"],
        [{ n: "1" }, { n: "   " }, { n: "3" }],
      );

      expect(stats[0].nonConformingCells).toBe(0);
    });
  });

  describe("multi-column fixture (PARSED_NUMERIC)", () => {
    it("processes all columns from the shared fixture correctly", () => {
      const stats = buildColumnStats(
        PARSED_NUMERIC.headers,
        PARSED_NUMERIC.data,
      );
      expect(stats).toHaveLength(2);
    });

    it("classifies 'country' as text", () => {
      const stats = buildColumnStats(
        PARSED_NUMERIC.headers,
        PARSED_NUMERIC.data,
      );
      const country = stats.find(
        (s: { name: string }) => s.name === "country",
      )!;
      expect(country.detectedType).toBe("text");
    });

    it("classifies 'co2_emissions' as numeric with correct min/max", () => {
      const stats = buildColumnStats(
        PARSED_NUMERIC.headers,
        PARSED_NUMERIC.data,
      );
      const emissions = stats.find(
        (s: { name: string }) => s.name === "co2_emissions",
      )!;
      expect(emissions.detectedType).toBe("numeric");
      expect(emissions.minValue).toBe(98.2);
      expect(emissions.maxValue).toBe(210.0);
    });
  });
});

describe("persistImport", () => {
  let mockPersistFn: jest.MockedFunction<PersistFn>;

  beforeEach(() => {
    mockPersistFn = jest.fn().mockResolvedValue(makeFakeImportResult());
  });

  it("calls the persist function exactly once", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);
    expect(mockPersistFn).toHaveBeenCalledTimes(1);
  });

  it("passes the filename from ParsedCsvResult", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);
    expect(mockPersistFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filename: "emissions.csv" }),
    );
  });

  it("passes totalRows, validRows, skippedRows unchanged", async () => {
    const parsed: ParsedCsvResult = {
      ...PARSED_NUMERIC,
      totalRows: 10,
      validRows: 8,
      skippedRows: 2,
    };

    await persistImport(parsed, makeStubDb(), mockPersistFn);

    expect(mockPersistFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        totalRows: 10,
        validRows: 8,
        skippedRows: 2,
      }),
    );
  });

  it("forwards the db instance as the first argument", async () => {
    const db = makeStubDb();
    await persistImport(PARSED_NUMERIC, db, mockPersistFn);
    expect(mockPersistFn).toHaveBeenCalledWith(db, expect.anything());
  });

  it("returns the ImportResult from the persist function", async () => {
    const fakeResult = makeFakeImportResult({ totalRows: 3 });
    mockPersistFn.mockResolvedValueOnce(fakeResult);

    const result = await persistImport(
      PARSED_NUMERIC,
      makeStubDb(),
      mockPersistFn,
    );

    expect(result).toBe(fakeResult);
  });

  it("sends one column entry per header", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);

    const [, { columns }] = mockPersistFn.mock.calls[0];
    expect(columns).toHaveLength(PARSED_NUMERIC.headers.length);
  });

  it("assigns correct positions to columns", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);

    const [, { columns }] = mockPersistFn.mock.calls[0];
    expect(columns[0].position).toBe(0);
    expect(columns[1].position).toBe(1);
  });

  it("detects the correct type for each column", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);

    const [, { columns }] = mockPersistFn.mock.calls[0] as unknown as [
      unknown,
      { columns: PersistedColumn[] },
    ];
    const country = columns.find((c) => c.name === "country")!;
    const emissions = columns.find((c) => c.name === "co2_emissions")!;

    expect(country.detectedType).toBe("text");
    expect(emissions.detectedType).toBe("numeric");
  });

  it("sends null minValue/maxValue for non-numeric columns, actual values for numeric", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);

    const [, { columns }] = mockPersistFn.mock.calls[0] as unknown as [
      unknown,
      { columns: PersistedColumn[] },
    ];
    const country = columns.find((c) => c.name === "country")!;
    const emissions = columns.find((c) => c.name === "co2_emissions")!;

    expect(country.minValue).toBeNull();
    expect(country.maxValue).toBeNull();
    expect(emissions.minValue).toBeCloseTo(98.2);
    expect(emissions.maxValue).toBeCloseTo(210.0);
  });

  it("includes nonConformingCells for every column", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);

    const [, { columns }] = mockPersistFn.mock.calls[0];
    for (const col of columns) {
      expect(col).toHaveProperty("nonConformingCells");
      expect(typeof col.nonConformingCells).toBe("number");
    }
  });

  it("sends one row entry per data row", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);

    const [, { rows }] = mockPersistFn.mock.calls[0];
    expect(rows).toHaveLength(PARSED_NUMERIC.data.length);
  });

  it("assigns rowNumber starting at 2 (header occupies row 1)", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);

    const [, { rows }] = mockPersistFn.mock.calls[0];
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[1].rowNumber).toBe(3);
    expect(rows[2].rowNumber).toBe(4);
  });

  it("preserves the original data object on each row", async () => {
    await persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn);

    const [, { rows }] = mockPersistFn.mock.calls[0];
    expect(rows[0].data).toEqual({ country: "Spain", co2_emissions: "120.5" });
    expect(rows[1].data).toEqual({ country: "France", co2_emissions: "98.2" });
  });

  it("handles an empty parsed result (header-only CSV) without throwing", async () => {
    const empty: ParsedCsvResult = {
      ...PARSED_NUMERIC,
      data: [],
      totalRows: 0,
      validRows: 0,
    };

    await persistImport(empty, makeStubDb(), mockPersistFn);

    const [, { rows, columns }] = mockPersistFn.mock.calls[0];
    expect(rows).toHaveLength(0);
    expect(columns).toHaveLength(PARSED_NUMERIC.headers.length);
  });

  it("handles a CSV with only text columns (no numeric aggregation)", async () => {
    const allText: ParsedCsvResult = {
      uploadId: "uuid",
      filename: "countries.csv",
      totalRows: 2,
      validRows: 2,
      skippedRows: 0,
      headers: ["name", "region"],
      data: [
        { name: "Spain", region: "Europe" },
        { name: "Brazil", region: "Americas" },
      ],
      errors: [],
      parsedAt: new Date().toISOString(),
    };

    await persistImport(allText, makeStubDb(), mockPersistFn);

    const [, { columns }] = mockPersistFn.mock.calls[0];
    for (const col of columns) {
      expect(col.detectedType).toBe("text");
      expect(col.minValue).toBeNull();
      expect(col.maxValue).toBeNull();
    }
  });

  it("handles a partial-success result (some rows skipped)", async () => {
    const partial: ParsedCsvResult = {
      ...PARSED_NUMERIC,
      totalRows: 4,
      validRows: 3,
      skippedRows: 1,
      errors: [{ row: 3, message: "Expected 2 columns, got 1. Row skipped." }],
    };

    await persistImport(partial, makeStubDb(), mockPersistFn);

    expect(mockPersistFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skippedRows: 1, validRows: 3 }),
    );
  });

  it("propagates errors thrown by the persist function", async () => {
    mockPersistFn.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(
      persistImport(PARSED_NUMERIC, makeStubDb(), mockPersistFn),
    ).rejects.toThrow("DB connection lost");
  });
});
