import express, { Application, Request, Response, NextFunction } from "express";
import request from "supertest";
import type { ImportColumn, Record_ as RecordRow } from "@shared/db/schema";
import { recordsRouter } from "../routes/records";
import * as columnValidator from "../services/column.validator";
import * as recordService from "../services/record_query.service";

jest.mock("../services/record_query.service", () => ({
  findColumnsByImportId: jest.fn(),
  importExists: jest.fn(),
  findRecords: jest.fn(),
}));

jest.mock("../services/column.validator", () => {
  class UnknownFieldError extends Error {
    constructor(
      message: string,
      readonly fields: string[] = [],
    ) {
      super(message);
      this.name = "UnknownFieldError";
    }
  }

  class FilterTypeMismatchError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FilterTypeMismatchError";
    }
  }

  return {
    UnknownFieldError,
    FilterTypeMismatchError,
    validateFilters: jest.fn(),
  };
});

function buildApp(): Application {
  const app = express();
  app.use(express.json());
  app.use("/datasets", recordsRouter);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "An unexpected error occurred." });
  });

  return app;
}

function makeColumn(overrides: Partial<ImportColumn> = {}): ImportColumn {
  return {
    id: 1,
    importId: 1,
    name: "country",
    position: 0,
    detectedType: "text",
    minValue: null,
    maxValue: null,
    nonConformingCells: 0,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: 10,
    importId: 1,
    rowNumber: 2,
    data: { country: "Spain" },
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /datasets/:importId/records", () => {
  let app: Application;
  const columns = [makeColumn()];
  const columnsByName = new Map(columns.map((column) => [column.name, column]));

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();

    (recordService.findColumnsByImportId as jest.Mock).mockResolvedValue(
      columns,
    );
    (recordService.importExists as jest.Mock).mockResolvedValue(true);
    (columnValidator.validateFilters as jest.Mock).mockReturnValue({
      valid: [],
      columnsByName,
    });
    (recordService.findRecords as jest.Mock).mockResolvedValue({
      records: [makeRecord()],
      total: 1,
    });
  });

  describe("200 - successful query", () => {
    it("returns records with the pagination envelope", async () => {
      const res = await request(app).get(
        "/datasets/1/records?country=Spain&page=1&limit=25",
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.records).toEqual([
        expect.objectContaining({
          id: 10,
          importId: 1,
          rowNumber: 2,
          data: { country: "Spain" },
          createdAt: "2024-01-01T00:00:00.000Z",
        }),
      ]);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(recordService.findColumnsByImportId).toHaveBeenCalledWith(1);
      expect(columnValidator.validateFilters).toHaveBeenCalledWith(
        [{ field: "country", operator: "eq", value: "Spain" }],
        columns,
        undefined,
      );
      expect(recordService.findRecords).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          pagination: { page: 1, limit: 25, offset: 0 },
        }),
        columnsByName,
      );
    });

    it("returns an empty records array when the result set is empty", async () => {
      (recordService.findRecords as jest.Mock).mockResolvedValueOnce({
        records: [],
        total: 0,
      });

      const res = await request(app).get("/datasets/1/records");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.records).toEqual([]);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  describe("400 - bad request", () => {
    it("returns 400 for bad query syntax", async () => {
      const res = await request(app).get("/datasets/1/records?page=abc");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/page must be a positive integer/i);
      expect(columnValidator.validateFilters).not.toHaveBeenCalled();
      expect(recordService.findRecords).not.toHaveBeenCalled();
    });

    it("returns 400 with details for unknown fields", async () => {
      (columnValidator.validateFilters as jest.Mock).mockImplementationOnce(
        () => {
          throw new columnValidator.UnknownFieldError(
            "Unknown field(s): population.",
            ["population"],
          );
        },
      );

      const res = await request(app).get("/datasets/1/records?population=100");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Unknown field/);
      expect(res.body.details).toEqual(["population"]);
      expect(recordService.findRecords).not.toHaveBeenCalled();
    });
  });

  describe("404 - unknown import", () => {
    it("returns 404 when the import has no columns and no imports row", async () => {
      (recordService.findColumnsByImportId as jest.Mock).mockResolvedValueOnce(
        [],
      );
      (recordService.importExists as jest.Mock).mockResolvedValueOnce(false);

      const res = await request(app).get("/datasets/999/records");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Import 999 was not found/i);
      expect(recordService.importExists).toHaveBeenCalledWith(999);
      expect(columnValidator.validateFilters).not.toHaveBeenCalled();
      expect(recordService.findRecords).not.toHaveBeenCalled();
    });
  });

  describe("500 - unexpected errors", () => {
    it("uses the global handler shape for unexpected throws", async () => {
      (recordService.findRecords as jest.Mock).mockRejectedValueOnce(
        new Error("Database connection lost"),
      );

      const res = await request(app).get("/datasets/1/records");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "An unexpected error occurred." });
    });
  });

  describe("pagination envelope math", () => {
    it("computes hasNextPage=true and hasPreviousPage=true for a middle page", async () => {
      (recordService.findRecords as jest.Mock).mockResolvedValueOnce({
        records: [makeRecord()],
        total: 25, // 3 pages at limit=10
      });

      const res = await request(app).get("/datasets/1/records?page=2&limit=10");

      expect(res.body.data.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it("computes hasNextPage=false on the last page", async () => {
      (recordService.findRecords as jest.Mock).mockResolvedValueOnce({
        records: [makeRecord()],
        total: 25,
      });

      const res = await request(app).get("/datasets/1/records?page=3&limit=10");

      expect(res.body.data.pagination).toEqual(
        expect.objectContaining({
          page: 3,
          hasNextPage: false,
          hasPreviousPage: true,
        }),
      );
    });

    it("computes hasPreviousPage=false on page 1 even when more pages exist", async () => {
      (recordService.findRecords as jest.Mock).mockResolvedValueOnce({
        records: [makeRecord()],
        total: 25,
      });

      const res = await request(app).get("/datasets/1/records?page=1&limit=10");

      expect(res.body.data.pagination).toEqual(
        expect.objectContaining({
          page: 1,
          hasNextPage: true,
          hasPreviousPage: false,
        }),
      );
    });

    it("returns a valid, empty envelope for a page beyond the last page", async () => {
      (recordService.findRecords as jest.Mock).mockResolvedValueOnce({
        records: [],
        total: 25,
      });

      const res = await request(app).get(
        "/datasets/1/records?page=10&limit=10",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.records).toEqual([]);
      expect(res.body.data.pagination).toEqual(
        expect.objectContaining({
          page: 10,
          totalPages: 3,
          hasNextPage: false,
          hasPreviousPage: true,
        }),
      );
    });
  });
});
