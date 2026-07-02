import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ImportColumn } from "@shared/db/schema";
import { buildRecordQuery } from "../services/record_query.builder";
import type { ParsedQuery } from "../types/query.types";

const dialect = new PgDialect();

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

const COLUMNS = [
  makeColumn({ id: 1, name: "country", detectedType: "text" }),
  makeColumn({ id: 2, name: "co2_emissions", detectedType: "numeric" }),
  makeColumn({ id: 3, name: "recorded_at", detectedType: "date" }),
];

const columnsByName = new Map(COLUMNS.map((column) => [column.name, column]));

function parsedQuery(overrides: Partial<ParsedQuery> = {}): ParsedQuery {
  return {
    filters: [],
    pagination: {
      page: 1,
      limit: 50,
      offset: 0,
    },
    ...overrides,
  };
}

function render(sql: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(sql);
}

describe("buildRecordQuery", () => {
  it("always scopes queries to the requested import id", () => {
    const { whereSql, orderBySql } = buildRecordQuery(
      42,
      parsedQuery(),
      columnsByName,
    );

    expect(render(whereSql)).toEqual({
      sql: '"records"."import_id" = $1',
      params: [42],
    });
    expect(orderBySql).toBeUndefined();
  });

  it("builds parameterised filters with type-aware JSONB casts", () => {
    const { whereSql } = buildRecordQuery(
      42,
      parsedQuery({
        filters: [
          { field: "country", operator: "eq", value: "Spain" },
          { field: "co2_emissions", operator: "gte", value: "100" },
          { field: "recorded_at", operator: "lte", value: "2024-01-01" },
        ],
      }),
      columnsByName,
    );

    expect(render(whereSql)).toEqual({
      sql:
        '(("records"."import_id" = $1) and ("records"."data" ->> $2 = $3) ' +
        'and ((CASE WHEN "records"."data" ->> $4 ~ $5 THEN ("records"."data" ->> $6)::numeric ELSE NULL END) >= $7) ' +
        'and ((CASE WHEN "records"."data" ->> $8 ~ $9 THEN ("records"."data" ->> $10)::timestamptz ELSE NULL END) <= $11))',
      params: [
        42,
        "country",
        "Spain",
        "co2_emissions",
        String.raw`^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$`,
        "co2_emissions",
        "100",
        "recorded_at",
        String.raw`^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$`,
        "recorded_at",
        "2024-01-01",
      ],
    });
  });

  it("escapes contains wildcards and keeps contains as a text search", () => {
    const { whereSql } = buildRecordQuery(
      42,
      parsedQuery({
        filters: [
          {
            field: "country",
            operator: "contains",
            value: String.raw`50%_Spain\Portugal`,
          },
        ],
      }),
      columnsByName,
    );

    expect(render(whereSql)).toEqual({
      sql:
        '(("records"."import_id" = $1) and ("records"."data" ->> $2 ' +
        "ILIKE $3 ESCAPE '\\'))",
      params: [42, "country", String.raw`%50\%\_Spain\\Portugal%`],
    });
  });

  it("builds typed order by clauses for numeric and date sorts", () => {
    const numericSort = buildRecordQuery(
      42,
      parsedQuery({ sort: { field: "co2_emissions", direction: "desc" } }),
      columnsByName,
    );
    const dateSort = buildRecordQuery(
      42,
      parsedQuery({ sort: { field: "recorded_at", direction: "asc" } }),
      columnsByName,
    );

    expect(render(numericSort.orderBySql!)).toEqual({
      sql: '(CASE WHEN "records"."data" ->> $1 ~ $2 THEN ("records"."data" ->> $3)::numeric ELSE NULL END) DESC',
      params: [
        "co2_emissions",
        String.raw`^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$`,
        "co2_emissions",
      ],
    });
    expect(render(dateSort.orderBySql!)).toEqual({
      sql: '(CASE WHEN "records"."data" ->> $1 ~ $2 THEN ("records"."data" ->> $3)::timestamptz ELSE NULL END) ASC',
      params: [
        "recorded_at",
        String.raw`^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$`,
        "recorded_at",
      ],
    });
  });

  it("throws a programming error when validation was skipped for filters", () => {
    expect(() =>
      buildRecordQuery(
        42,
        parsedQuery({
          filters: [{ field: "unknown", operator: "eq", value: "x" }],
        }),
        columnsByName,
      ),
    ).toThrow(/unknown filter field "unknown"/);
  });

  it("throws a programming error when validation was skipped for sort", () => {
    expect(() =>
      buildRecordQuery(
        42,
        parsedQuery({
          sort: { field: "unknown", direction: "asc" },
        }),
        columnsByName,
      ),
    ).toThrow(/unknown sort field "unknown"/);
  });
});
