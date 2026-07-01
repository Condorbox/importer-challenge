import type { ImportColumn } from "@shared/db/schema";
import {
  validateFilters,
  UnknownFieldError,
  FilterTypeMismatchError,
} from "../services/column.validator";
import type { ParsedFilter, ParsedSort } from "../types/query.types";

function makeColumn(overrides: Partial<ImportColumn>): ImportColumn {
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

const COLUMNS: ImportColumn[] = [
  makeColumn({ id: 1, name: "country", position: 0, detectedType: "text" }),
  makeColumn({
    id: 2,
    name: "co2_emissions",
    position: 1,
    detectedType: "numeric",
    minValue: 1.5,
    maxValue: 999.9,
  }),
  makeColumn({
    id: 3,
    name: "recorded_at",
    position: 2,
    detectedType: "date",
  }),
];

function filter(
  field: string,
  operator: ParsedFilter["operator"],
  value = "x",
): ParsedFilter {
  return { field, operator, value };
}

describe("validateFilters", () => {
  describe("known fields", () => {
    it("passes a single known filter field through unchanged", () => {
      const filters = [filter("country", "eq", "Spain")];
      const result = validateFilters(filters, COLUMNS);
      expect(result.valid).toBe(filters);
    });

    it("passes multiple known filter fields", () => {
      const filters = [
        filter("country", "eq", "Spain"),
        filter("co2_emissions", "gte", "100"),
      ];
      expect(() => validateFilters(filters, COLUMNS)).not.toThrow();
    });

    it("builds a columnsByName map keyed by column name", () => {
      const { columnsByName } = validateFilters([], COLUMNS);
      expect(columnsByName.get("country")).toEqual(
        expect.objectContaining({ name: "country", detectedType: "text" }),
      );
      expect(columnsByName.size).toBe(3);
    });

    it("does not throw for an empty filter list", () => {
      expect(() => validateFilters([], COLUMNS)).not.toThrow();
    });

    it("passes when the sort field is known", () => {
      const sort: ParsedSort = { field: "co2_emissions", direction: "desc" };
      expect(() => validateFilters([], COLUMNS, sort)).not.toThrow();
    });
  });

  describe("unknown fields", () => {
    it("throws UnknownFieldError for an unknown filter field", () => {
      const filters = [filter("population", "eq", "100")];
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        UnknownFieldError,
      );
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        /Unknown field\(s\): population/,
      );
    });

    it("lists available fields in the error message", () => {
      const filters = [filter("population", "eq", "100")];
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        /Available fields: country, co2_emissions, recorded_at/,
      );
    });

    it("throws UnknownFieldError for an unknown sort field", () => {
      const sort: ParsedSort = { field: "population", direction: "asc" };
      expect(() => validateFilters([], COLUMNS, sort)).toThrow(
        UnknownFieldError,
      );
      expect(() => validateFilters([], COLUMNS, sort)).toThrow(
        /Unknown field\(s\): population/,
      );
    });

    it("lists multiple unknown fields together, deduplicated", () => {
      const filters = [
        filter("population", "eq", "100"),
        filter("gdp", "eq", "100"),
        filter("population", "contains", "1"),
      ];
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        /Unknown field\(s\): population, gdp/,
      );
    });

    it("reports both an unknown filter field and an unknown sort field together", () => {
      const filters = [filter("population", "eq", "100")];
      const sort: ParsedSort = { field: "gdp", direction: "asc" };
      expect(() => validateFilters(filters, COLUMNS, sort)).toThrow(
        /Unknown field\(s\): population, gdp/,
      );
    });

    it("handles an empty columns list (e.g. import has no columns)", () => {
      const filters = [filter("country", "eq", "Spain")];
      expect(() => validateFilters(filters, [])).toThrow(
        /Available fields: \(none\)/,
      );
    });
  });

  describe("operator/type compatibility", () => {
    it("throws FilterTypeMismatchError for gte against a text column", () => {
      const filters = [filter("country", "gte", "S")];
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        FilterTypeMismatchError,
      );
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        /country\[gte\]/,
      );
    });

    it("throws FilterTypeMismatchError for lte against a text column", () => {
      const filters = [filter("country", "lte", "S")];
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        FilterTypeMismatchError,
      );
    });

    it("allows gte against a numeric column", () => {
      const filters = [filter("co2_emissions", "gte", "100")];
      expect(() => validateFilters(filters, COLUMNS)).not.toThrow();
    });

    it("allows lte against a date column", () => {
      const filters = [filter("recorded_at", "lte", "2024-01-01")];
      expect(() => validateFilters(filters, COLUMNS)).not.toThrow();
    });

    it("allows eq against a text column", () => {
      const filters = [filter("country", "eq", "Spain")];
      expect(() => validateFilters(filters, COLUMNS)).not.toThrow();
    });

    it("allows contains against a text column", () => {
      const filters = [filter("country", "contains", "Sp")];
      expect(() => validateFilters(filters, COLUMNS)).not.toThrow();
    });

    it("collects multiple type mismatches in one error", () => {
      const filters = [filter("country", "gte", "S"), filter("country", "lte", "Z")];
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        /country\[gte\].*country\[lte\]/,
      );
    });

    it("does not run type compatibility checks before the unknown-field check", () => {
      // An unknown field with an "ordered" operator should fail as
      // UnknownFieldError, not as a confusing type-mismatch lookup failure.
      const filters = [filter("population", "gte", "100")];
      expect(() => validateFilters(filters, COLUMNS)).toThrow(
        UnknownFieldError,
      );
    });
  });
});