/**
 * Node-level socket errors (from `net`/`pg`'s TCP layer) the DB host is
 * unreachable, refusing connections, or the connection dropped mid-flight.
 */
const CONNECTIVITY_NODE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ECONNRESET",
]);

//  Postgres SQLSTATE codes (see https://www.postgresql.org/docs/current/errcodes-appendix.html)
const CONNECTIVITY_PG_SQLSTATE_CODES = new Set([
  "28P01", // invalid_password
  "28000", // invalid_authorization_specification
  "3D000", // invalid_catalog_name (database does not exist)
  "53300", // too_many_connections
  "57P03", // cannot_connect_now (server still starting up)
]);

export function isDatabaseConnectivityError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  // Check the current error's direct code
  const code = (err as any).code;
  if (typeof code === "string") {
    if (CONNECTIVITY_NODE_ERROR_CODES.has(code)) return true;
    if (CONNECTIVITY_PG_SQLSTATE_CODES.has(code)) return true;
  }

  // Check modern Node.js AggregateError / multi-errors (.errors array)
  const innerErrors = (err as any).errors;
  if (Array.isArray(innerErrors)) {
    for (const inner of innerErrors) {
      if (isDatabaseConnectivityError(inner)) return true;
    }
  }

  // Check chained errors (.cause property)
  const cause = (err as any).cause;
  if (cause) {
    if (isDatabaseConnectivityError(cause)) return true;
  }

  return false;
}
