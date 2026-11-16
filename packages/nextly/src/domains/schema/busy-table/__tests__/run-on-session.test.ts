/**
 * Autocommit statements run in tries for a busy table (`runStatementsInTries`), against stand-in
 * adapters whose statements wait as each case scripts: which statements are sent again, what the
 * stop reports, and that the servers run the whole list on one session.
 *
 * Each case pauses for real between tries (about a second), as the schedule says; the schedule
 * itself is pinned by the tries' own tests.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import type { BusyTableBounds } from "../bounds";
import { runStatementsInTries } from "../run-on-session";

/** One try of a second, and three in all: tries at 0 and about 1 second, then a stop. */
const BOUNDS: BusyTableBounds = { tryMs: 1_000, totalMs: 3_000 };

/** SQLite's busy timeout running out, as its driver reports it. */
function sqliteBusy(): Error {
  return Object.assign(new Error("database is locked"), {
    code: "SQLITE_BUSY",
  });
}

/** PostgreSQL's lock_timeout running out. */
function pgLockNotAvailable(): Error {
  return Object.assign(new Error("canceling statement due to lock timeout"), {
    code: "55P03",
  });
}

/**
 * A SQLite stand-in: `fail(statement, sentBefore)` throws for a statement it wants to wait;
 * `sent` keeps every statement sent but the busy-timeout pragmas.
 */
function sqliteAdapter(
  fail: (statement: string, sentBefore: number) => Error | undefined,
  triggers: readonly string[] = []
) {
  const sent: string[] = [];
  const adapter = {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    executeQuery: (statement: string): Promise<unknown[]> => {
      if (statement === "PRAGMA busy_timeout") {
        return Promise.resolve([{ timeout: 0 }]);
      }
      if (statement.startsWith("PRAGMA busy_timeout")) {
        return Promise.resolve([]);
      }
      const sentBefore = sent.filter(s => s === statement).length;
      sent.push(statement);
      const error = fail(statement, sentBefore);
      return error === undefined ? Promise.resolve([]) : Promise.reject(error);
    },
    queryStatement: () => Promise.resolve(triggers.map(name => ({ name }))),
  };
  return { adapter: adapter as unknown as DrizzleAdapter, sent };
}

const A = "CREATE TABLE a (id integer)";
const B = "CREATE TABLE b (id integer)";
const C = "CREATE TABLE c (id integer)";

describe("runStatementsInTries", () => {
  it("sends the statement before the waiting one once, and only the waiting one again", async () => {
    const { adapter, sent } = sqliteAdapter((statement, sentBefore) =>
      statement === B && sentBefore === 0 ? sqliteBusy() : undefined
    );
    const notices: string[] = [];

    const applied = await runStatementsInTries(adapter, [A, B, C], {
      change: "nextly test",
      bounds: BOUNDS,
      notify: line => notices.push(line),
      appliedBefore: [],
    });

    expect(sent).toEqual([A, B, B, C]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("nextly test: statement 2 of 3");
    expect(applied).toEqual([
      "nextly test: statement 1 of 3",
      "nextly test: statement 2 of 3",
      "nextly test: statement 3 of 3",
    ]);
  });

  it("stops naming what ran before it and the table it waited for, never a statement's text", async () => {
    const { adapter, sent } = sqliteAdapter(statement =>
      statement === B ? sqliteBusy() : undefined
    );
    const tables = ["a", "b", "c"];

    const stopped = await runStatementsInTries(adapter, [A, B, C], {
      change: "nextly test",
      bounds: BOUNDS,
      notify: () => {},
      appliedBefore: ["an earlier step"],
      name: index => `the creation of table "${tables[index]}"`,
    }).catch((error: unknown) => error);

    expect(stopped).toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
      logContext: {
        stop: {
          change: 'nextly test: the creation of table "b"',
          ended: { table: "b" },
          tries: 2,
          appliedBefore: [
            "an earlier step",
            'nextly test: the creation of table "a"',
          ],
          outcome: { kind: "nothing-changed" },
        },
      },
    });
    // The statement after the one that waited was never sent.
    expect(sent).toEqual([A, B, B]);
    const message = String((stopped as Error).message);
    expect(message).toContain('nextly test: the creation of table "a"');
    expect(message).not.toMatch(/CREATE TABLE/);
  });

  it("stops after one try where the waiting statement may not be sent again", async () => {
    // A row change on a table with a trigger runs code the system does not know.
    const insert = "INSERT INTO t (id) VALUES (1)";
    const { adapter, sent } = sqliteAdapter(
      statement => (statement === insert ? sqliteBusy() : undefined),
      ["t"]
    );

    const stopped = await runStatementsInTries(adapter, [A, insert], {
      change: "nextly test",
      bounds: BOUNDS,
      notify: () => {},
      appliedBefore: [],
    }).catch((error: unknown) => error);

    expect(stopped).toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
      logContext: {
        stop: {
          tries: 1,
          outcome: { kind: "no-retry", statementNumber: 1, reason: "trigger" },
        },
      },
    });
    expect(sent).toEqual([A, insert]);
  });

  it("sends the same row change again where its table has no trigger", async () => {
    const insert = "INSERT INTO t (id) VALUES (1)";
    const { adapter, sent } = sqliteAdapter((statement, sentBefore) =>
      statement === insert && sentBefore === 0 ? sqliteBusy() : undefined
    );

    await runStatementsInTries(adapter, [insert], {
      change: "nextly test",
      bounds: BOUNDS,
      notify: () => {},
      appliedBefore: [],
    });

    expect(sent).toEqual([insert, insert]);
  });

  it("sets the connection's settings before the first statement and restores them after a stop", async () => {
    const { adapter, sent } = sqliteAdapter(statement =>
      statement === B ? sqliteBusy() : undefined
    );

    await runStatementsInTries(adapter, [A, B], {
      change: "nextly test",
      bounds: BOUNDS,
      notify: () => {},
      appliedBefore: [],
      settings: {
        set: async session => {
          await session.execute("PRAGMA foreign_keys = OFF");
        },
        restore: async session => {
          await session.execute("PRAGMA foreign_keys = ON");
        },
      },
    }).catch(() => undefined);

    expect(sent).toEqual([
      "PRAGMA foreign_keys = OFF",
      A,
      B,
      B,
      "PRAGMA foreign_keys = ON",
    ]);
  });

  it("lets any other failure through as it is, with no second try", async () => {
    const failure = Object.assign(new Error("no such table: x"), {
      code: "SQLITE_ERROR",
    });
    const { adapter, sent } = sqliteAdapter(statement =>
      statement === B ? failure : undefined
    );

    const stopped = await runStatementsInTries(adapter, [A, B, C], {
      change: "nextly test",
      bounds: BOUNDS,
      notify: () => {},
      appliedBefore: [],
    }).catch((error: unknown) => error);

    expect(stopped).toBe(failure);
    expect(sent).toEqual([A, B]);
  });

  it("stops after one try where a PostgreSQL DDL event trigger would fire again on the schema change", async () => {
    const onSession: string[] = [];
    const adapter = {
      getCapabilities: () => ({ dialect: "postgresql" as const }),
      // Only the event-trigger read finds anything: one enabled trigger no extension owns.
      queryStatement: (query: unknown) =>
        Promise.resolve(
          JSON.stringify(query).includes("pg_event_trigger")
            ? [{ found: 1 }]
            : []
        ),
      executeQuery: () => Promise.resolve([]),
      withSession: <T>(
        work: (session: {
          execute: (statement: string) => Promise<unknown[]>;
        }) => Promise<T>
      ): Promise<T> =>
        work({
          execute: statement => {
            onSession.push(statement);
            return statement === B
              ? Promise.reject(pgLockNotAvailable())
              : Promise.resolve([]);
          },
        }),
    } as unknown as DrizzleAdapter;

    const stopped = await runStatementsInTries(adapter, [A, B], {
      change: "nextly test",
      bounds: BOUNDS,
      notify: () => {},
      appliedBefore: [],
    }).catch((error: unknown) => error);

    expect(stopped).toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
      logContext: {
        stop: {
          tries: 1,
          outcome: {
            kind: "no-retry",
            statementNumber: 1,
            reason: "event-trigger",
          },
        },
      },
    });
    expect(onSession.filter(statement => statement === B)).toHaveLength(1);
  });

  it("runs every statement and every try of a PostgreSQL list on one session, its lock wait bounded", async () => {
    let sessions = 0;
    const onSession: string[] = [];
    let busyOnce = true;
    const adapter = {
      getCapabilities: () => ({ dialect: "postgresql" as const }),
      // The watch's polls and the holder's read: the session is never seen waiting.
      queryStatement: () => Promise.resolve([]),
      executeQuery: () => Promise.resolve([]),
      withSession: async <T>(
        work: (session: {
          execute: (statement: string) => Promise<unknown[]>;
        }) => Promise<T>
      ): Promise<T> => {
        sessions += 1;
        return work({
          execute: statement => {
            onSession.push(statement);
            if (statement === "SELECT pg_backend_pid() AS session_id") {
              return Promise.resolve([{ session_id: 4242 }]);
            }
            if (statement === B && busyOnce) {
              busyOnce = false;
              return Promise.reject(pgLockNotAvailable());
            }
            return Promise.resolve([]);
          },
        });
      },
    } as unknown as DrizzleAdapter;

    await runStatementsInTries(adapter, [A, B, C], {
      change: "nextly test",
      bounds: BOUNDS,
      notify: () => {},
      appliedBefore: [],
    });

    expect(sessions).toBe(1);
    expect(onSession).toEqual([
      "SET lock_timeout = '1500ms'",
      "SELECT pg_backend_pid() AS session_id",
      A,
      B,
      B,
      C,
      "RESET lock_timeout",
    ]);
  });
});
