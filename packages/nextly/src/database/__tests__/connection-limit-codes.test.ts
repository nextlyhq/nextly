/**
 * A database out of connections, or one that closed an idle connection, as
 * core reads the driver's error.
 *
 * Small databases behind serverless functions meet both: PostgreSQL refuses a
 * connection past `max_connections` with SQLSTATE 53300, and closes a
 * connection idle past `idle_session_timeout` with 57P05; MySQL refuses one
 * past `max_connections` with error 1040. Each is the database not reached,
 * as a lost connection is, so it is read as `connection-lost`, and a page
 * rendered in production fails rather than being served without what Nextly
 * gives it (`isNextlyUnavailable`). The errors start as each driver throws
 * them, Drizzle's wrapping included.
 */
import { describe, expect, it } from "vitest";

import { isNextlyUnavailable } from "../../errors/unavailable";
import { toDbError } from "../errors";

/** What node-postgres throws for a server error with this SQLSTATE. */
function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, severity: "FATAL" });
}

/** What mysql2 throws for a server error. */
function mysqlError(code: string, errno: number, message: string): Error {
  return Object.assign(new Error(message), { code, errno });
}

/** What Drizzle throws for a failed query: its own error, the driver's on `cause`. */
function wrappedByDrizzle(cause: Error): Error {
  return new Error("Failed query: select ...", { cause });
}

describe("PostgreSQL connection-limit codes", () => {
  it.each([
    ["53300", "sorry, too many clients already"],
    ["57P05", "terminating connection due to idle-session timeout"],
  ])("reads %s as a lost connection", (code, message) => {
    const error = pgError(code, message);

    expect(toDbError("postgresql", error).kind).toBe("connection-lost");
    expect(isNextlyUnavailable(error)).toBe(true);
    expect(isNextlyUnavailable(wrappedByDrizzle(error))).toBe(true);
  });
});

describe("MySQL connection-limit code", () => {
  it("reads ER_CON_COUNT_ERROR (1040) as a lost connection", () => {
    const error = mysqlError(
      "ER_CON_COUNT_ERROR",
      1040,
      "Too many connections"
    );

    expect(toDbError("mysql", error).kind).toBe("connection-lost");
    expect(
      toDbError(
        "mysql",
        Object.assign(new Error("Too many connections"), {
          errno: 1040,
        })
      ).kind
    ).toBe("connection-lost");
    expect(isNextlyUnavailable(error)).toBe(true);
    expect(isNextlyUnavailable(wrappedByDrizzle(error))).toBe(true);
  });
});
