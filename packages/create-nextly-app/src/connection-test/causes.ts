/**
 * Why a driver refused a connection, read from its error code, and the plain
 * words the person is told. The words are built from the server's address and
 * the database's name only: a driver's own message can quote the user name,
 * so it is never printed, and an unknown failure shows its code alone.
 */
import type { Target } from "./target";
import type { FailureCause, ServerDialect } from "./types";

/** The codes a server or the network gives that mean the server was not reached. */
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
]);

/** PostgreSQL's SQLSTATEs and MySQL's codes for a refused login. */
const LOGIN_REFUSED = new Set([
  "28P01", // invalid_password
  "28000", // invalid_authorization_specification
  "ER_ACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_NOT_SUPPORTED_AUTH_MODE",
]);

/** A database the server does not have. */
const DATABASE_MISSING = new Set([
  "3D000", // invalid_catalog_name
  "ER_BAD_DB_ERROR",
]);

/** The error's code, or undefined when it carries none. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? code : undefined;
}

/** Reads a driver's error as one of the causes the person is told about. */
export function classify(
  error: unknown
): Exclude<FailureCause, "version-unsupported"> {
  const code = errorCode(error);
  if (code && UNREACHABLE.has(code)) return "unreachable";
  if (code && LOGIN_REFUSED.has(code)) return "login-refused";
  if (code && DATABASE_MISSING.has(code)) return "database-missing";
  // node-postgres reports its own connection timeout without a code.
  const message = error instanceof Error ? error.message : "";
  if (/connection timeout|timeout expired/i.test(message)) return "unreachable";
  return "other";
}

const LABELS: Record<ServerDialect, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
};

/** What the person is told for `cause`, naming the server and the database only. */
export function failureMessage(
  cause: Exclude<FailureCause, "version-unsupported">,
  dialect: ServerDialect,
  target: Target,
  error?: unknown
): string {
  const at = `the ${LABELS[dialect]} server at ${target.server}`;
  switch (cause) {
    case "unreachable":
      return `Can't reach ${at}. Check that it is running and that the host and port in the connection string are right.`;
    case "login-refused":
      return `${capitalise(at)} refused the login. Check the user name and password in the connection string.`;
    case "database-missing":
      return target.database
        ? `The database "${target.database}" doesn't exist on ${at}.`
        : `The connection string names no database. Add its name after the host, as in ${dialect === "postgresql" ? "postgresql://localhost:5432/my_site" : "mysql://localhost:3306/my_site"}.`;
    case "other": {
      const code = errorCode(error);
      return `Couldn't connect to ${at}${code ? ` (${code})` : ""}. Check the connection string.`;
    }
  }
}

/** What the person is told when the server's version is too old for Nextly. */
export function versionMessage(server: string, required: string): string {
  return `The server runs ${server}; Nextly needs ${required}.`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
