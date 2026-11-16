/**
 * Which errors say a statement's wait for a lock ended, on each dialect: the database's own lock
 * timeout always, a cancelled or interrupted statement only when the try's watchdog ended it, and
 * each read through the wrappers a driver or the ORM puts around it.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { ownWriteLockError } from "../../migrate/migration-transaction";
import { endedWaiting, ownSessionId, sessionNumberOf } from "../ended-waiting";

/** `error` wrapped `depth` times, as an ORM or adapter wraps a driver's error in its `cause`. */
function wrapped(error: unknown, depth: number): unknown {
  let link = error;
  for (let i = 0; i < depth; i++) {
    link = Object.assign(new Error(`wrapper ${String(i)}`), { cause: link });
  }
  return link;
}

const pgError = (code: string) =>
  Object.assign(new Error("database error"), { code });
const mysqlError = (code: string, errno: number) =>
  Object.assign(new Error("database error"), { code, errno });

describe("endedWaiting on PostgreSQL", () => {
  it("is true for lock_not_available (55P03), whoever ended it", () => {
    expect(endedWaiting(pgError("55P03"), "postgresql", false)).toBe(true);
    expect(endedWaiting(pgError("55P03"), "postgresql", true)).toBe(true);
  });

  it("is true for query_canceled (57014) only when the watchdog fired", () => {
    expect(endedWaiting(pgError("57014"), "postgresql", true)).toBe(true);
    // A cancel the watchdog did not send is someone else's: an operator, a statement timeout.
    expect(endedWaiting(pgError("57014"), "postgresql", false)).toBe(false);
  });

  it("is false for other errors, MySQL's codes among them", () => {
    expect(endedWaiting(pgError("23505"), "postgresql", true)).toBe(false);
    expect(
      endedWaiting(mysqlError("ER_LOCK_WAIT_TIMEOUT", 1205), "postgresql", true)
    ).toBe(false);
    expect(endedWaiting(pgError("SQLITE_BUSY"), "postgresql", true)).toBe(
      false
    );
  });
});

describe("endedWaiting on MySQL", () => {
  it("is true for ER_LOCK_WAIT_TIMEOUT (1205), by code or by errno", () => {
    expect(
      endedWaiting(mysqlError("ER_LOCK_WAIT_TIMEOUT", 1205), "mysql", false)
    ).toBe(true);
    expect(
      endedWaiting(
        Object.assign(new Error("x"), { errno: 1205 }),
        "mysql",
        false
      )
    ).toBe(true);
    expect(
      endedWaiting(
        Object.assign(new Error("x"), { code: "ER_LOCK_WAIT_TIMEOUT" }),
        "mysql",
        false
      )
    ).toBe(true);
  });

  it("is true for ER_QUERY_INTERRUPTED (1317) only when the watchdog fired", () => {
    const interrupted = mysqlError("ER_QUERY_INTERRUPTED", 1317);
    expect(endedWaiting(interrupted, "mysql", true)).toBe(true);
    expect(endedWaiting(interrupted, "mysql", false)).toBe(false);
    expect(
      endedWaiting(
        Object.assign(new Error("x"), { errno: 1317 }),
        "mysql",
        true
      )
    ).toBe(true);
  });

  it("is false for other errors, PostgreSQL's codes among them", () => {
    expect(endedWaiting(mysqlError("ER_DUP_ENTRY", 1062), "mysql", true)).toBe(
      false
    );
    expect(endedWaiting(pgError("55P03"), "mysql", true)).toBe(false);
  });
});

describe("endedWaiting on SQLite", () => {
  it("is true for SQLITE_BUSY and its extended codes", () => {
    for (const code of [
      "SQLITE_BUSY",
      "SQLITE_BUSY_SNAPSHOT",
      "SQLITE_BUSY_RECOVERY",
      "SQLITE_BUSY_TIMEOUT",
    ]) {
      expect(endedWaiting(pgError(code), "sqlite", false)).toBe(true);
    }
  });

  it("is false for other errors", () => {
    expect(endedWaiting(pgError("SQLITE_CONSTRAINT"), "sqlite", true)).toBe(
      false
    );
    expect(endedWaiting(pgError("55P03"), "sqlite", true)).toBe(false);
  });

  it("is false for a stop naming this process as the lock's holder, though it carries the busy answer", () => {
    const busy = pgError("SQLITE_BUSY");
    // The busy answer alone, and wrapped as an adapter wraps it, is a wait that ended.
    expect(endedWaiting(wrapped(busy, 2), "sqlite", false)).toBe(true);
    // The same answer as the cause of this process's own-lock stop is not, at any depth.
    const stop = ownWriteLockError("20261114_000001_x.sql", wrapped(busy, 2));
    expect(endedWaiting(stop, "sqlite", false)).toBe(false);
    expect(endedWaiting(wrapped(stop, 2), "sqlite", false)).toBe(false);
  });
});

describe("endedWaiting through wrappers", () => {
  it("finds the code down the cause chain, up to six links deep", () => {
    expect(
      endedWaiting(wrapped(pgError("55P03"), 5), "postgresql", false)
    ).toBe(true);
    expect(
      endedWaiting(
        wrapped(mysqlError("ER_QUERY_INTERRUPTED", 1317), 3),
        "mysql",
        true
      )
    ).toBe(true);
  });

  it("stops past six links rather than following a chain without end", () => {
    expect(
      endedWaiting(wrapped(pgError("55P03"), 6), "postgresql", false)
    ).toBe(false);
    const loop: { cause?: unknown } = new Error("loop");
    loop.cause = loop;
    expect(endedWaiting(loop, "postgresql", true)).toBe(false);
  });

  it("is false for what is not an error", () => {
    for (const value of [undefined, null, "55P03", 1205]) {
      expect(endedWaiting(value, "postgresql", true)).toBe(false);
      expect(endedWaiting(value, "mysql", true)).toBe(false);
    }
  });
});

describe("ownSessionId", () => {
  it("reads PostgreSQL's backend pid", () => {
    const statement = ownSessionId("postgresql");
    expect(statement).toBeDefined();
    expect(new PgDialect().sqlToQuery(statement!).sql).toContain(
      "pg_backend_pid()"
    );
  });

  it("reads MySQL's connection id", () => {
    const statement = ownSessionId("mysql");
    expect(statement).toBeDefined();
    expect(new MySqlDialect().sqlToQuery(statement!).sql).toContain(
      "CONNECTION_ID()"
    );
  });

  it("is undefined on SQLite, which has no session id to name", () => {
    expect(ownSessionId("sqlite")).toBeUndefined();
  });
});

describe("sessionNumberOf", () => {
  it("reads a session id as the positive integer the database gave", () => {
    expect(sessionNumberOf("4211")).toBe(4211);
    expect(sessionNumberOf("1")).toBe(1);
  });

  it("refuses anything else, so no other text reaches a cancel or a kill", () => {
    for (const session of [
      "",
      "0",
      "-3",
      "1.5",
      "1e3",
      " 12",
      "12; KILL 1",
      "undefined",
      "99999999999999999999",
    ]) {
      expect(sessionNumberOf(session)).toBeUndefined();
    }
  });
});
