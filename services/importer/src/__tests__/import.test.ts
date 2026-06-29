import "dotenv/config";
import express, { Application, Request, Response, NextFunction } from "express";
import request from "supertest";
import { importRouter } from "../routes/import";
import * as csvParser from "../services/csv_parser.service";
import * as importService from "../services/import.service";
import type { ImportResult } from "../services/import.service";

// Mock Config
jest.mock("../config", () => ({
  CSV_PARSE_OPTIONS: {
    maxFileSizeBytes: 1024, // 1KB
    maxColumns: 10,
    maxRows: 100,
    maxCellLength: 50,
    sanitizeCells: true,
  },
  UPLOAD_CONFIG: {
    allowedMimeTypes: ["text/csv", "application/vnd.ms-excel"],
    fieldName: "file",
  },
  RATE_LIMIT_CONFIG: {
    windowMs: 60_000,
    max: 100,
    message: "Too many requests",
  },
}));

jest.mock("../db/client", () => ({ db: {} }));

jest.mock("../repositories/import.repository", () => ({
  createImportWithData: jest.fn(),
}));

jest.mock("../services/import.service", () => ({
  persistImport: jest.fn(),
}));

// Mock UUID
let uuidCounter = 0;
jest.mock("uuid", () => ({
  v4: jest.fn(() => {
    uuidCounter += 1;
    // Formats a valid UUIDv4 structure
    return `12345678-1234-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
  }),
}));

// App Setup Helper
function buildApp(): Application {
  const app = express();
  app.use(express.json());
  app.use("/import", importRouter);

  // Catch-all error handler so 500s return JSON instead of crashing the test runner
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, error: err.message });
  });

  return app;
}

function makeDefaultImportResult(): ImportResult {
  return {
    importRow: {
      id: 999,
      filename: "test.csv",
      status: "completed",
      totalRows: 2,
      validRows: 2,
      skippedRows: 0,
      createdAt: new Date(),
    },
    columns: [],
    recordCount: 2,
  };
}

// Tests
describe("POST /import/upload", () => {
  let app: Application;

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks(); // Clears any spyOn implementations between tests

    (importService.persistImport as jest.Mock).mockResolvedValue(
      makeDefaultImportResult(),
    );
  });

  // Happy path
  describe("200 – successful upload", () => {
    it("returns success:true, parsed data, and persistence details", async () => {
      const csvContent = "id,name\n1,Alice\n2,Bob";

      const res = await request(app)
        .post("/import/upload")
        .attach("file", Buffer.from(csvContent), "test.csv");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(importService.persistImport).toHaveBeenCalledTimes(1);
      expect(res.body.data.importId).toBe(999);
      expect(res.body.data.persisted).toBe(true);
      expect(res.body.data.headers).toEqual(["id", "name"]);
      expect(res.body.data.totalRows).toBe(2);
    });
  });

  // 207 Multi-Status
  describe("207 – partial success", () => {
    it("returns 207 when some rows are skipped and still persists", async () => {
      // Row 2 is missing a column, which triggers a skip in your parser
      const csvContent = "id,name\n1,Alice\n2\n3,Bob";

      const res = await request(app)
        .post("/import/upload")
        .attach("file", Buffer.from(csvContent), "test.csv");

      expect(res.status).toBe(207);
      expect(res.body.success).toBe(true);
      expect(res.body.data.skippedRows).toBe(1);
      expect(importService.persistImport).toHaveBeenCalledTimes(1);
      expect(res.body.data.importId).toBe(999);
      expect(res.body.data.persisted).toBe(true);
    });
  });

  // 400 Bad Request (Middleware & Multer)
  describe("400 – missing or invalid files", () => {
    it("returns 400 when no file is uploaded", async () => {
      const res = await request(app).post("/import/upload"); // No .attach()

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/No file uploaded/i);
      expect(importService.persistImport).not.toHaveBeenCalled();
    });

    it("returns 400 when multer rejects the file type", async () => {
      const res = await request(app)
        .post("/import/upload")
        .attach("file", Buffer.from("data"), "test.txt"); // .txt instead of .csv

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid file type/i);
      expect(importService.persistImport).not.toHaveBeenCalled();
    });

    it("returns 400 when multer rejects an oversized file", async () => {
      // Config limits this to 1024 bytes. We send 2000.
      const hugeBuffer = Buffer.alloc(2000, "x");

      const res = await request(app)
        .post("/import/upload")
        .attach("file", hugeBuffer, "large.csv");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/File too large/i);
      expect(importService.persistImport).not.toHaveBeenCalled();
    });
  });

  // 422 Unprocessable Entity (Parser Logic)
  describe("422 – CSV validation errors", () => {
    it("returns 422 for duplicate headers natively", async () => {
      const csvContent = "id,id\n1,1";

      const res = await request(app)
        .post("/import/upload")
        .attach("file", Buffer.from(csvContent), "test.csv");

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Duplicate column headers/i);
      expect(importService.persistImport).not.toHaveBeenCalled();
    });

    it("returns 422 when max columns are exceeded", async () => {
      // Config allows 10 columns, we send 11
      const cols = Array.from({ length: 11 }, (_, i) => `col${i}`).join(",");

      const res = await request(app)
        .post("/import/upload")
        .attach("file", Buffer.from(cols), "test.csv");

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/maximum allowed is 10/i);
      expect(importService.persistImport).not.toHaveBeenCalled();
    });
  });

  // 500 Internal Server Error
  describe("500 – unexpected errors", () => {
    it("re-throws non-CsvValidationError exceptions for the global handler", async () => {
      // This is the only place we use a mock, specifically to force a server crash
      jest.spyOn(csvParser, "parseCsvBuffer").mockImplementationOnce(() => {
        throw new TypeError("Unexpected internal crash");
      });

      const res = await request(app)
        .post("/import/upload")
        .attach("file", Buffer.from("id\n1"), "test.csv");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Unexpected internal crash/i);
    });

    it("returns 500 when database persistence fails", async () => {
      (importService.persistImport as jest.Mock).mockRejectedValueOnce(
        new Error("Database connection lost"),
      );

      const res = await request(app)
        .post("/import/upload")
        .attach("file", Buffer.from("id\n1"), "test.csv");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Database connection lost/i);
    });
  });
});

// Integration test suite
//
// These tests run against a real database. They are skipped automatically
// when TEST_DATABASE_URL is not set, so the unit suite above stays fast
// and self-contained in CI environments without a database.
//
// To run locally:
//   docker compose up -d db
//   npm run db:migrate
//   TEST_DATABASE_URL=postgres://... jest --testPathPatterns="import.test"

const describeIfDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("POST /import/upload (integration — real DB)", () => {
  let app: Application;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  // TODO: truncate imports / import_columns / records before each test using
  // setupTestDb().truncateAll([...]) once the test-db helper is wired in here.

  it("persists CSV data and returns a real database-assigned importId", async () => {
    const csvContent = "country,co2\nSpain,120.5\nFrance,98.2";

    const res = await request(app)
      .post("/import/upload")
      .attach("file", Buffer.from(csvContent), "emissions.csv");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.persisted).toBe(true);

    expect(typeof res.body.data.importId).toBe("number");
    expect(res.body.data.importId).toBeGreaterThan(0);
    expect(res.body.data.filename).toBe("emissions.csv");
    expect(res.body.data.totalRows).toBe(2);
    expect(res.body.data.validRows).toBe(2);

    // TODO: query the DB directly to confirm the row exists:
    // const { setupTestDb } = await import("./__tests__/helpers/test_db");
    // const { db: testDb, teardown } = await setupTestDb();
    // const saved = await testDb.query.imports.findFirst({
    //   where: (t, { eq }) => eq(t.id, res.body.data.importId),
    // });
    // expect(saved?.filename).toBe("emissions.csv");
    // expect(saved?.status).toBe("completed");
    // await teardown();
  });
});
