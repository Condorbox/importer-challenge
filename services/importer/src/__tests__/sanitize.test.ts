import {
  sanitizeCell,
  normaliseCellLength,
  isSafeHeader,
} from "../utils/sanitize";

describe("sanitizeCell", () => {
  describe("formula injection guard", () => {
    const formulaTriggers = ["=", "+", "-", "@"];

    test.each(formulaTriggers)(
      "prepends a quote to cells starting with '%s'",
      (trigger) => {
        const input = `${trigger}DANGEROUS_FORMULA()`;
        expect(sanitizeCell(input)).toBe(`'${input}`);
      },
    );

    it("prepends a quote to cells starting with a TAB character", () => {
      expect(sanitizeCell("\tvalue")).toBe("'\tvalue");
    });

    it("prepends a quote to cells starting with a carriage-return", () => {
      expect(sanitizeCell("\rvalue")).toBe("'\rvalue");
    });

    it("does not alter safe cells that happen to contain trigger chars mid-string", () => {
      expect(sanitizeCell("hello=world")).toBe("hello=world");
    });

    it("does not alter a regular string", () => {
      expect(sanitizeCell("Alice")).toBe("Alice");
    });

    it("does not alter an empty string", () => {
      expect(sanitizeCell("")).toBe("");
    });
  });

  describe("control character stripping", () => {
    it("removes null bytes (0x00)", () => {
      expect(sanitizeCell("hel\x00lo")).toBe("hello");
    });

    it("removes bell character (0x07)", () => {
      expect(sanitizeCell("hel\x07lo")).toBe("hello");
    });

    it("removes DEL (0x7F)", () => {
      expect(sanitizeCell("hel\x7Flo")).toBe("hello");
    });

    it("strips multiple control characters in one pass", () => {
      expect(sanitizeCell("\x01\x02\x03abc\x04\x05")).toBe("abc");
    });

    it("preserves ordinary tab (0x09)", () => {
      expect(sanitizeCell("col\t separated")).toBe("col\t separated");
    });

    it("preserves newline (0x0A)", () => {
      expect(sanitizeCell("line1\nline2")).toBe("line1\nline2");
    });
  });

  describe("combined scenarios", () => {
    it("strips control chars then applies formula guard", () => {
      // After stripping 0x01 the cell starts with '=' → gets quoted
      const result = sanitizeCell("\x01=EVIL()");
      expect(result).toBe("'=EVIL()");
    });

    it("does not quote an email address because @ is not the leading char", () => {
      expect(sanitizeCell("user@example.com")).toBe("user@example.com");
    });

    it("does quote a value that starts with @", () => {
      expect(sanitizeCell("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
    });
  });

  describe("legitimate numeric values are not treated as formulas", () => {
    test.each(["-5.06", "+42", "-1e10", "-.5", "-0"])(
      "does not quote '%s'",
      (value) => {
        expect(sanitizeCell(value)).toBe(value);
      },
    );

    test.each(["--5", "-5.06.1", "-2+3"])(
      "still quotes malformed near-numbers like '%s'",
      (value) => {
        expect(sanitizeCell(value)).toBe(`'${value}`);
      },
    );
  });
});

describe("normaliseCellLength", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normaliseCellLength("  hello  ", 100)).toBe("hello");
  });

  it("truncates values that exceed maxLen", () => {
    expect(normaliseCellLength("abcdef", 3)).toBe("abc");
  });

  it("does not truncate values shorter than maxLen", () => {
    expect(normaliseCellLength("ab", 10)).toBe("ab");
  });

  it("returns an empty string for an all-whitespace input", () => {
    expect(normaliseCellLength("   ", 100)).toBe("");
  });

  it("handles maxLen of 0", () => {
    expect(normaliseCellLength("anything", 0)).toBe("");
  });

  it("trims before truncating so whitespace does not eat into the limit", () => {
    expect(normaliseCellLength("  abc  ", 3)).toBe("abc");
  });
});

describe("isSafeHeader", () => {
  describe("valid headers", () => {
    const valid = [
      "name",
      "first_name",
      "first-name",
      "column 1",
      "UPPER",
      "mix3d_Case",
      "a",
      "a".repeat(64),
    ];

    test.each(valid)("accepts '%s'", (h) => {
      expect(isSafeHeader(h)).toBe(true);
    });
  });

  describe("invalid / dangerous headers", () => {
    const invalid = [
      "../etc/passwd",
      "column;DROP TABLE",
      "col=formula",
      "<script>",
      "",
      "a".repeat(65),
      "col\x00name",
      "col.name",
    ];

    test.each(invalid)("rejects '%s'", (h) => {
      expect(isSafeHeader(h)).toBe(false);
    });
  });
});
