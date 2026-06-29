import {
  detectColumnType,
  conformsToType,
} from "../services/type_detector.service";

describe("detectColumnType", () => {
  describe("numeric columns", () => {
    it("detects an all-integer column as numeric", () => {
      expect(detectColumnType(["1", "2", "3", "42"])).toBe("numeric");
    });

    it("detects a column with decimals as numeric", () => {
      expect(detectColumnType(["1.5", "2.75", "-3.2", "0.0"])).toBe("numeric");
    });

    it("detects a column with mixed integers and decimals as numeric", () => {
      expect(detectColumnType(["1", "2.5", "3", "-4.25"])).toBe("numeric");
    });

    it("tolerates a small fraction of non-numeric cells (e.g. 'N/A')", () => {
      // 19/20 = 95%, exactly at the threshold
      const values = [...Array(19).fill("100"), "N/A"];
      expect(detectColumnType(values)).toBe("numeric");
    });

    it("ignores empty cells when computing the numeric ratio", () => {
      expect(detectColumnType(["1", "2", "", "3", ""])).toBe("numeric");
    });

    it("does not treat 'NaN' or 'Infinity' strings as numeric", () => {
      expect(detectColumnType(["NaN", "Infinity", "1", "2"])).toBe("text");
    });

    it("does not treat thousands-separated numbers as numeric", () => {
      expect(detectColumnType(["1,000", "2,500", "3,000"])).toBe("text");
    });
  });

  describe("date columns (ISO 8601 only)", () => {
    it("detects an all-ISO-date column as date", () => {
      expect(detectColumnType(["2024-01-15", "2024-02-20", "2023-12-31"])).toBe(
        "date",
      );
    });

    it("detects ISO datetime strings (with time component) as date", () => {
      expect(
        detectColumnType([
          "2024-01-15T10:30:00Z",
          "2024-01-16T08:00:00.123Z",
          "2024-01-17T23:59:59+02:00",
        ]),
      ).toBe("date");
    });

    it("does not treat a bare year as a date", () => {
      expect(detectColumnType(["2021", "2022", "2023"])).toBe("numeric");
    });

    it("does not treat ambiguous slash-formatted dates as ISO dates", () => {
      expect(detectColumnType(["01/15/2024", "02/20/2024"])).toBe("text");
    });

    it("rejects calendar-invalid dates that match the shape but not a real calendar date", () => {
      expect(detectColumnType(["2024-13-45", "2024-02-30"])).toBe("text");
    });

    it("tolerates a small fraction of non-date cells", () => {
      const values = [...Array(19).fill("2024-01-01"), "not-a-date"];
      expect(detectColumnType(values)).toBe("date");
    });
  });

  describe("mixed / fallback to text", () => {
    it("falls back to text for a column with mostly free text", () => {
      expect(detectColumnType(["Alice", "Bob", "Charlie"])).toBe("text");
    });

    it("falls back to text when numeric and non-numeric cells are evenly mixed", () => {
      expect(detectColumnType(["1", "two", "3", "four", "5", "six"])).toBe(
        "text",
      );
    });

    it("falls back to text just below the 95% numeric threshold", () => {
      // 18/20 = 90%, below threshold
      const values = [...Array(18).fill("100"), "N/A", "missing"];
      expect(detectColumnType(values)).toBe("text");
    });

    it("falls back to text for country/category-style columns", () => {
      expect(detectColumnType(["Spain", "France", "Germany", "Italy"])).toBe(
        "text",
      );
    });
  });

  describe("empty columns", () => {
    it("falls back to text for a column with no values", () => {
      expect(detectColumnType([])).toBe("text");
    });

    it("falls back to text for a column with only empty strings", () => {
      expect(detectColumnType(["", "", ""])).toBe("text");
    });

    it("falls back to text for a column with only whitespace", () => {
      expect(detectColumnType(["  ", "\t", ""])).toBe("text");
    });
  });

  describe("whitespace handling", () => {
    it("trims surrounding whitespace before classifying", () => {
      expect(detectColumnType([" 1 ", " 2 ", " 3 "])).toBe("numeric");
    });
  });
});

describe("conformsToType", () => {
  describe("numeric type", () => {
    test.each(["1", "2.5", "-3.14", "1e10", "+42"])(
      "'%s' conforms to numeric",
      (value) => {
        expect(conformsToType(value, "numeric")).toBe(true);
      },
    );

    test.each(["N/A", "abc", "", "1,000", "NaN", "Infinity"])(
      "'%s' does not conform to numeric",
      (value) => {
        expect(conformsToType(value, "numeric")).toBe(false);
      },
    );
  });

  describe("date type", () => {
    test.each(["2024-01-15", "2024-01-15T10:30:00Z"])(
      "'%s' conforms to date",
      (value) => {
        expect(conformsToType(value, "date")).toBe(true);
      },
    );

    test.each(["not-a-date", "2024-13-45", "01/15/2024", ""])(
      "'%s' does not conform to date",
      (value) => {
        expect(conformsToType(value, "date")).toBe(false);
      },
    );
  });

  describe("text type", () => {
    it("accepts any non-empty string", () => {
      expect(conformsToType("anything at all", "text")).toBe(true);
      expect(conformsToType("123", "text")).toBe(true);
    });

    it("does not conform when the value is empty", () => {
      expect(conformsToType("", "text")).toBe(false);
    });
  });
});
