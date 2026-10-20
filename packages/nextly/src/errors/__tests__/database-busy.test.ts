/**
 * "Database busy" as every boundary reads it.
 *
 * The busy error usually reaches a boundary raw: the adapters raise it with a
 * code of their own, Drizzle may wrap it once, and `withDbErrors` converts
 * only DbErrors. So each case starts from the error as it is thrown, never
 * from one already converted, and checks both readings: the boundary's
 * (`fromUnexpected`) and a converting service's (`toDbError` then
 * `fromDatabaseError`). The integration suite
 * `database/__tests__/pool-wait-bound.integration.test.ts` makes the real
 * adapters throw them.
 */
import {
  POOL_WAIT_TIMEOUT_CODE,
  poolWaitTimeoutError,
} from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { buildErrorResponse } from "../../api/error-response";
import { isDatabaseBusy, toDbError } from "../../database/errors";
import { NextlyError } from "../nextly-error";
import {
  DATABASE_BUSY_RETRY_AFTER_SECONDS,
  retryAfterSeconds,
} from "../retry-after";

/** What Drizzle throws for a failed query: its own error, the driver's on `cause`. */
function wrappedByDrizzle(cause: Error): Error {
  return new Error("Failed query: insert into posts ...", { cause });
}

/** better-sqlite3's error for a write that found the file held: a code, no errno. */
function sqliteError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const BUSY = [
  {
    name: "a pg pool wait timeout",
    dialect: "postgresql" as const,
    error: poolWaitTimeoutError(
      15000,
      new Error("timeout exceeded when trying to connect")
    ),
  },
  {
    name: "a pg pool wait timeout wrapped by Drizzle",
    dialect: "postgresql" as const,
    error: wrappedByDrizzle(
      poolWaitTimeoutError(
        15000,
        new Error("timeout exceeded when trying to connect")
      )
    ),
  },
  {
    name: "a mysql2 pool wait timeout",
    dialect: "mysql" as const,
    error: poolWaitTimeoutError(15000),
  },
  {
    name: "a mysql2 pool wait timeout wrapped by Drizzle",
    dialect: "mysql" as const,
    error: wrappedByDrizzle(poolWaitTimeoutError(15000)),
  },
  {
    name: "a SQLite transaction's wait timeout",
    dialect: "sqlite" as const,
    error: poolWaitTimeoutError(15000),
  },
  {
    name: "SQLITE_BUSY from another process holding the file",
    dialect: "sqlite" as const,
    error: sqliteError("SQLITE_BUSY", "database is locked"),
  },
  {
    name: "an extended SQLITE_BUSY code",
    dialect: "sqlite" as const,
    error: sqliteError("SQLITE_BUSY_SNAPSHOT", "database is locked"),
  },
];

describe("a busy database, read at a boundary", () => {
  for (const { name, dialect, error } of BUSY) {
    it(`answers ${name} as DATABASE_BUSY, with a retry hint and no driver text`, () => {
      expect(isDatabaseBusy(error)).toBe(true);

      const answered = NextlyError.fromUnexpected(error);
      expect(answered.code).toBe("DATABASE_BUSY");
      expect(answered.statusCode).toBe(503);
      expect(answered.publicData).toEqual({
        retryAfterSeconds: DATABASE_BUSY_RETRY_AFTER_SECONDS,
      });
      // What leaves the server: the generic sentence and the hint, and
      // nothing of the driver's message or code.
      const wire = JSON.stringify(answered.toResponseJSON("req-1"));
      expect(wire).not.toContain("timeout exceeded");
      expect(wire).not.toContain("database is locked");
      expect(wire).not.toContain(POOL_WAIT_TIMEOUT_CODE);
      expect(wire).not.toContain("SQLITE_BUSY");
      // The raw error stays with the operator.
      expect(answered.cause).toBe(error);

      // A converting service gives the same error from the same table row.
      const converted = NextlyError.fromDatabaseError(
        toDbError(dialect, error)
      );
      expect(converted.toResponseJSON("req-1")).toEqual(
        answered.toResponseJSON("req-1")
      );
    });
  }

  it("leaves an ordinary error an internal one", () => {
    const error = new Error("Cannot read properties of undefined");
    expect(isDatabaseBusy(error)).toBe(false);

    const answered = NextlyError.fromUnexpected(error);
    expect(answered.code).toBe("INTERNAL_ERROR");
    expect(answered.statusCode).toBe(500);
    expect(answered.publicData).toBeUndefined();
  });

  it("leaves a thrown value that is not an Error an internal one", () => {
    expect(NextlyError.fromUnexpected("boom").code).toBe("INTERNAL_ERROR");
  });

  it("keeps SQLITE_LOCKED a conflict inside the one connection, not busy", () => {
    const error = sqliteError("SQLITE_LOCKED", "database table is locked");
    expect(isDatabaseBusy(error)).toBe(false);
    expect(NextlyError.fromDatabaseError(toDbError("sqlite", error)).code).toBe(
      "CONFLICT"
    );
  });

  it("does not read busy into other database failures", () => {
    // A statement timeout and a lost connection are faults to report, not
    // waits to retry; they keep their own codes.
    const statementTimeout = Object.assign(new Error("canceling statement"), {
      code: "57014",
    });
    const lost = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    for (const error of [statementTimeout, lost]) {
      expect(isDatabaseBusy(error)).toBe(false);
      expect(
        NextlyError.fromDatabaseError(toDbError("postgresql", error)).code
      ).toBe("DATABASE_ERROR");
    }
  });
});

describe("the retry hint on the wire", () => {
  it("sends Retry-After for DATABASE_BUSY", () => {
    const response = buildErrorResponse(NextlyError.databaseBusy(), {
      requestId: "req-2",
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe(
      String(DATABASE_BUSY_RETRY_AFTER_SECONDS)
    );
  });

  it("still sends Retry-After for RATE_LIMITED", () => {
    const response = buildErrorResponse(
      NextlyError.rateLimited({ retryAfterSeconds: 30 }),
      { requestId: "req-3" }
    );
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it("sends none for an error carrying no hint", () => {
    const refused = NextlyError.rateLimited();
    expect(retryAfterSeconds(refused)).toBeUndefined();
    const response = buildErrorResponse(refused, { requestId: "req-4" });
    expect(response.headers.get("retry-after")).toBeNull();
    expect(
      buildErrorResponse(NextlyError.internal(), {
        requestId: "req-5",
      }).headers.get("retry-after")
    ).toBeNull();
  });
});
