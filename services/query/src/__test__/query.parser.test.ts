import { PaginationConfig, ParsedQuery } from "../types/query.types";
import { parseQueryParams, QueryValidationError } from "../utils/query.parser";

const PAGINATION_CONFIG: PaginationConfig = {
  defaultPage: 1,
  defaultLimit: 50,
  maxLimit: 500,
};

describe("parseQueryParams", () => {
  it("parses a bare filter as an equality filter", () => {
    expect(parse({ country: "Spain" })).toMatchObject({
      filters: [{ field: "country", operator: "eq", value: "Spain" }],
    });
  });

  it("parses gte, lte, and contains bracket filters", () => {
    expect(
      parse({
        "co2_emissions[gte]": "100",
        "co2_emissions[lte]": "200",
        "country[contains]": "spa",
      }).filters,
    ).toEqual([
      { field: "co2_emissions", operator: "gte", value: "100" },
      { field: "co2_emissions", operator: "lte", value: "200" },
      { field: "country", operator: "contains", value: "spa" },
    ]);
  });

  it("parses ascending and descending sort fields", () => {
    expect(parse({ sort: "country" }).sort).toEqual({
      field: "country",
      direction: "asc",
    });

    expect(parse({ sort: "-co2_emissions" }).sort).toEqual({
      field: "co2_emissions",
      direction: "desc",
    });
  });

  it("uses default pagination when page and limit are omitted", () => {
    expect(parse({}).pagination).toEqual({
      page: 1,
      limit: 50,
      offset: 0,
    });
  });

  it("parses page and limit and computes the offset", () => {
    expect(parse({ page: "3", limit: "25" }).pagination).toEqual({
      page: 3,
      limit: 25,
      offset: 50,
    });
  });

  it("clamps limit to maxLimit instead of rejecting it", () => {
    expect(parse({ limit: "9999" }).pagination.limit).toBe(500);
  });

  describe("filter field name safety", () => {
    it("accepts field names with letters, digits, underscores, hyphens, and spaces", () => {
      expect(() =>
        parse({ "full name": "Alice", co2_emissions: "1", "co-2": "1" }),
      ).not.toThrow();
    });

    it("rejects a bare field name attempting path traversal", () => {
      expect(() => parse({ "../etc/passwd": "x" })).toThrow(
        QueryValidationError,
      );
      expect(() => parse({ "../etc/passwd": "x" })).toThrow(
        /Unsafe field name/,
      );
    });

    it("rejects a bracketed field name containing SQL-injection-style characters", () => {
      expect(() => parse({ "value;DROP TABLE[gte]": "1" })).toThrow(
        /Unsupported filter operator|Unsafe field name|Malformed/,
      );
    });

    it("rejects a field name containing angle brackets", () => {
      expect(() => parse({ "<script>": "x" })).toThrow(/Unsafe field name/);
    });

    it("rejects an unsafe sort field name", () => {
      expect(() => parse({ sort: "../etc/passwd" })).toThrow(
        /Unsafe field name/,
      );
    });

    it("rejects an unsafe sort field name with descending prefix", () => {
      expect(() => parse({ sort: "-<script>" })).toThrow(/Unsafe field name/);
    });
  });

  describe("filter value length capping", () => {
    it("truncates a filter value longer than 500 characters", () => {
      const longValue = "x".repeat(600);
      const result = parse({ "country[contains]": longValue });
      expect(result.filters[0].value).toHaveLength(500);
    });

    it("does not alter a filter value shorter than the cap", () => {
      const result = parse({ country: "Spain" });
      expect(result.filters[0].value).toBe("Spain");
    });
  });

  describe("invalid query params", () => {
    const invalidCases: Array<[string, Record<string, unknown>, string]> = [
      ["malformed missing closing bracket", { "value[gte": "1" }, "Malformed"],
      ["malformed missing opening bracket", { "value]": "1" }, "Malformed"],
      ["malformed nested brackets", { "value[[gte]]": "1" }, "Malformed"],
      [
        "unsupported operator",
        { "value[between]": "1,10" },
        "Unsupported filter operator",
      ],
      ["empty sort field", { sort: "-" }, "Sort field cannot be empty"],
      ["page zero", { page: "0" }, "page must be greater"],
      ["negative page", { page: "-1" }, "page must be a positive integer"],
      ["non-numeric page", { page: "abc" }, "page must be a positive integer"],
      ["negative limit", { limit: "-1" }, "limit must be a positive integer"],
      ["zero limit", { limit: "0" }, "limit must be greater"],
      [
        "repeated filter value",
        { country: ["Spain", "France"] },
        "country must be provided only once",
      ],
      ["non-string filter value", { country: 123 }, "country must be a string"],
    ];

    test.each(invalidCases)("%s", (_name, query, message) => {
      expect(() => parse(query)).toThrow(QueryValidationError);
      expect(() => parse(query)).toThrow(message);
    });
  });
});

function parse(query: Record<string, unknown>): ParsedQuery {
  return parseQueryParams(query, PAGINATION_CONFIG);
}
