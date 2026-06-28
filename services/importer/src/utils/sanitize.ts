/**
 * CSV Injection (Formula Injection) guard.
 *
 * Spreadsheet apps (Excel, Google Sheets, LibreOffice) treat cells that start
 * with =, +, -, @, TAB, or CR as formula triggers. An attacker can craft a
 * cell like `=HYPERLINK("http://evil.com","click me")` or even execute shell
 * commands on older Excel versions via DDE.
 *
 * We neutralise this by prepending a single quote when any of those characters
 * lead a cell. The quote is the standard "escape" understood by spreadsheet
 * apps — the value is stored verbatim without being evaluated.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Strip non-printable ASCII control characters (0x00-0x1F) except ordinary
 * whitespace (0x09 tab, 0x0A newline, 0x0D carriage-return). These can be
 * used to hide content or confuse downstream parsers.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeCell(value: string): string {
  // Remove invisible control characters
  let clean = value.replace(CONTROL_CHARS, "");

  // Neutralise formula-injection triggers
  if (FORMULA_TRIGGER.test(clean)) {
    clean = `'${clean}`;
  }

  return clean;
}

// Oversized cells are a vector for DoS (memory exhaustion) and log injection
export function normaliseCellLength(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

/**
 * Validate that a header name is safe to use as an object key / DB column.
 * Rejects anything that isn't alphanumeric + underscore/hyphen/space.
 */
const SAFE_HEADER = /^[\w\s\-]{1,64}$/;

export function isSafeHeader(header: string): boolean {
  return SAFE_HEADER.test(header);
}