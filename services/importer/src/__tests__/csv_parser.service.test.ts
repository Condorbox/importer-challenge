import {
  parseCsvBuffer,
  CsvValidationError,
} from "../services/csv_parser.service";
import { CsvParseOptions } from "../types/csv.types";

// Mock UUID
let uuidCounter = 0;
jest.mock("uuid", () => ({
  v4: jest.fn(() => {
    uuidCounter += 1;
    // Formats a valid UUIDv4 structure
    return `12345678-1234-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
  }),
}));

const buf = (csv: string) => Buffer.from(csv, "utf-8");

const testOptions: CsvParseOptions = {
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxRows: 100,
  maxColumns: 10,
  maxCellLength: 50,
  sanitizeCells: true,
};

// Return shape
describe("parseCsvBuffer — return shape", () => {
  it("returns the expected top-level fields", () => {
    const result = parseCsvBuffer(
      buf("name,age\nAlice,30"),
      "test.csv",
      testOptions,
    );

    expect(result).toMatchObject({
      filename: "test.csv",
      totalRows: 1,
      validRows: 1,
      skippedRows: 0,
      headers: ["name", "age"],
      errors: [],
    });

    expect(typeof result.uploadId).toBe("string");
    expect(result.uploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(new Date(result.parsedAt).getTime()).not.toBeNaN();
  });

  it("generates a unique uploadId for every call", () => {
    const csv = buf("a\n1");
    const r1 = parseCsvBuffer(csv, "f.csv", testOptions);
    const r2 = parseCsvBuffer(csv, "f.csv", testOptions);
    expect(r1.uploadId).not.toBe(r2.uploadId);
  });
});

// Happy path
describe("parseCsvBuffer — happy path", () => {
  it("parses a simple two-column CSV", () => {
    const result = parseCsvBuffer(
      buf("name,age\nAlice,30\nBob,25"),
      "people.csv",
      testOptions,
    );

    expect(result.headers).toEqual(["name", "age"]);
    expect(result.data).toEqual([
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(2);
  });

  it("trims whitespace from header names", () => {
    const result = parseCsvBuffer(
      buf("  name  ,  age  \nAlice,30"),
      "f.csv",
      testOptions,
    );
    expect(result.headers).toEqual(["name", "age"]);
  });

  it("returns empty data for a header-only CSV", () => {
    const result = parseCsvBuffer(buf("name,age"), "f.csv", testOptions);
    expect(result.totalRows).toBe(0);
    expect(result.validRows).toBe(0);
    expect(result.data).toEqual([]);
  });

  it("handles quoted fields with commas inside", () => {
    const result = parseCsvBuffer(
      // eslint-disable-next-line quotes
      buf(`name,address\nAlice,"123 Main St, Suite 4"`),
      "f.csv",
      testOptions,
    );
    expect(result.data[0].address).toBe("123 Main St, Suite 4");
  });

  it("handles quoted fields with newlines inside", () => {
    const result = parseCsvBuffer(
      // eslint-disable-next-line quotes
      buf('name,notes\nAlice,"line one\nline two"'),
      "f.csv",
      testOptions,
    );
    expect(result.data[0].notes).toContain("line one");
  });

  it("skips empty lines without counting them as rows", () => {
    const result = parseCsvBuffer(
      buf("name,age\nAlice,30\n\nBob,25\n"),
      "f.csv",
      testOptions,
    );
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(2);
  });
});

// BOM
describe("parseCsvBuffer — BOM handling", () => {
  it("strips a UTF-8 BOM so the first header is not corrupted", () => {
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      buf("name,age\nAlice,30"),
    ]);
    const result = parseCsvBuffer(withBom, "f.csv", testOptions);
    expect(result.headers[0]).toBe("name");
  });
});

// Formula injection
describe("parseCsvBuffer — formula injection", () => {
  const injections = [
    ["=CMD|'/C calc'!A0", "'=CMD|'/C calc'!A0"],
    ["+HYPERLINK(evil)", "'+HYPERLINK(evil)"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1:A10)", "'@SUM(A1:A10)"],
  ];

  test.each(injections)(
    "neutralises injection payload '%s'",
    (payload, expected) => {
      const result = parseCsvBuffer(
        buf(`name,cmd\nAlice,${payload}`),
        "f.csv",
        testOptions,
      );
      expect(result.data[0].cmd).toBe(expected);
    },
  );

  it("does not modify safe cell values", () => {
    const result = parseCsvBuffer(
      buf("name,score\nAlice,100"),
      "f.csv",
      testOptions,
    );
    expect(result.data[0].score).toBe("100");
  });
});

// Header validation
describe("parseCsvBuffer — header validation", () => {
  it("throws CsvValidationError for path-traversal headers", () => {
    expect(() =>
      parseCsvBuffer(buf("name,../etc/passwd\nAlice,x"), "f.csv", testOptions),
    ).toThrow(CsvValidationError);
  });

  it("includes the offending header name in the error message", () => {
    expect(() =>
      parseCsvBuffer(buf("name,<script>\nAlice,x"), "f.csv", testOptions),
    ).toThrow(/Unsafe header name/);
  });

  it("throws on duplicate headers", () => {
    expect(() =>
      parseCsvBuffer(buf("name,name\nAlice,Bob"), "f.csv", testOptions),
    ).toThrow(/Duplicate column headers/);
  });

  it("accepts headers with underscores, hyphens, and spaces", () => {
    expect(() =>
      parseCsvBuffer(
        buf("first_name,last-name,full name\nAlice,Smith,Alice Smith"),
        "f.csv",
        testOptions,
      ),
    ).not.toThrow();
  });
});

// Limit enforcement
describe("parseCsvBuffer — limit enforcement", () => {
  it("throws when column count exceeds maxColumns", () => {
    const cols = Array.from({ length: 11 }, (_, i) => `col${i}`).join(",");
    const row = Array.from({ length: 11 }, (_, i) => `val${i}`).join(",");
    expect(() =>
      parseCsvBuffer(buf(`${cols}\n${row}`), "f.csv", {
        ...testOptions,
        maxColumns: 10,
      }),
    ).toThrow(/maximum allowed is 10/);
  });

  it("throws when row count exceeds maxRows", () => {
    const rows = ["a", ...Array.from({ length: 6 }, (_, i) => `${i}`)].join(
      "\n",
    );
    expect(() =>
      parseCsvBuffer(buf(rows), "f.csv", { ...testOptions, maxRows: 5 }),
    ).toThrow(/maximum allowed is 5/);
  });

  it("truncates cell values that exceed maxCellLength", () => {
    const longValue = "x".repeat(200);
    const result = parseCsvBuffer(buf(`name\n${longValue}`), "f.csv", {
      ...testOptions,
      maxCellLength: 10,
    });
    expect(result.data[0].name.replace(/^'/, "")).toHaveLength(10);
  });
});

// Schema enforcement
describe("parseCsvBuffer — allowedHeaders schema enforcement", () => {
  const opts: CsvParseOptions = {
    ...testOptions,
    allowedHeaders: ["name", "email"],
  };

  it("accepts a CSV that exactly matches the allowed schema", () => {
    expect(() =>
      parseCsvBuffer(buf("name,email\nAlice,a@b.com"), "f.csv", opts),
    ).not.toThrow();
  });

  it("throws when a required column is missing", () => {
    expect(() => parseCsvBuffer(buf("name\nAlice"), "f.csv", opts)).toThrow(
      /Missing columns: email/,
    );
  });

  it("throws when an unexpected column is present", () => {
    expect(() =>
      parseCsvBuffer(buf("name,email,age\nAlice,a@b.com,30"), "f.csv", opts),
    ).toThrow(/Unexpected columns: age/);
  });

  it("mentions both missing and unexpected columns when both are wrong", () => {
    expect(() =>
      parseCsvBuffer(buf("name,phone\nAlice,123"), "f.csv", opts),
    ).toThrow(/Missing columns.*email.*Unexpected columns.*phone/s);
  });
});

// Row-level error handling
describe("parseCsvBuffer — row-level error handling", () => {
  it("skips rows with too few columns and records an error", () => {
    const result = parseCsvBuffer(
      buf("name,age\nAlice,30\nBob"),
      "f.csv",
      testOptions,
    );
    expect(result.validRows).toBe(1);
    expect(result.skippedRows).toBe(1);

    const rowErrors = result.errors.filter((e) =>
      e.message.includes("Row skipped"),
    );
    expect(rowErrors).toHaveLength(1);
    expect(rowErrors[0].row).toBe(3);
    expect(rowErrors[0].message).toMatch(/Expected 2 columns, got 1/);
  });

  it("skips rows with too many columns and records an error", () => {
    const result = parseCsvBuffer(buf("a,b\n1,2,3"), "f.csv", testOptions);
    expect(result.skippedRows).toBe(1);
    expect(
      result.errors.some((e) =>
        e.message.includes("Expected 2 columns, got 3"),
      ),
    ).toBe(true);
  });

  it("continues processing valid rows after a bad row", () => {
    const result = parseCsvBuffer(
      buf("name,age\nAlice,30\nBad\nBob,25"),
      "f.csv",
      testOptions,
    );
    expect(result.validRows).toBe(2);
    expect(result.data.map((r) => r.name)).toEqual(["Alice", "Bob"]);
  });

  it("accumulates errors from multiple bad rows", () => {
    const result = parseCsvBuffer(buf("a,b\n1\n2\n3,4"), "f.csv", testOptions);
    expect(result.skippedRows).toBe(2);
    const rowErrors = result.errors.filter((e) =>
      e.message.includes("Row skipped"),
    );
    expect(rowErrors).toHaveLength(2);
  });
});

// Edge cases
describe("parseCsvBuffer — edge cases", () => {
  it("returns an empty result for a completely empty buffer", () => {
    const result = parseCsvBuffer(buf(""), "empty.csv", testOptions);
    expect(result.totalRows).toBe(0);
    expect(result.data).toEqual([]);
    expect(result.headers).toEqual([]);
  });

  it("handles a single-column CSV correctly", () => {
    const result = parseCsvBuffer(buf("id\n1\n2\n3"), "f.csv", testOptions);
    expect(result.headers).toEqual(["id"]);
    expect(result.data).toHaveLength(3);
    expect(result.data[2].id).toBe("3");
  });

  it("sanitizeCells: false skips the sanitization step", () => {
    const payload = "=EVIL()";
    const result = parseCsvBuffer(buf(`cmd\n${payload}`), "f.csv", {
      ...testOptions,
      sanitizeCells: false,
    });
    expect(result.data[0].cmd).toBe(payload);
  });
});

// CsvValidationError class
describe("CsvValidationError", () => {
  it("is an instance of Error", () => {
    expect(new CsvValidationError("boom")).toBeInstanceOf(Error);
  });

  it("has the correct name property", () => {
    expect(new CsvValidationError("x").name).toBe("CsvValidationError");
  });

  it("preserves the message", () => {
    expect(new CsvValidationError("bad input").message).toBe("bad input");
  });
});
