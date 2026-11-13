/**
 * The SQLite half of the migration transaction, on the real SQLite adapter
 * over a real better-sqlite3 database: a unit runs with foreign-key
 * enforcement off, is checked for dangling references before it commits, and
 * leaves the connection's setting as it found it.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import type Database from "better-sqlite3";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  executeTransaction,
  runMigrationStatements,
} from "../migration-transaction";

// The count of rows in a required column's way, real unless a test makes it fail: a database
// that answers the table's shape but not the count is not one SQLite can be made into.
const countFailure = vi.hoisted(() => ({
  cause: undefined as Error | undefined,
}));
// The registries the guard reads its facts from, real unless a test makes the read fail.
const registryFailure = vi.hoisted(() => ({
  cause: undefined as Error | undefined,
}));
vi.mock("../../required-column-registries", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../../required-column-registries")>();
  return {
    ...actual,
    requiredColumnRegistries: (
      ...args: Parameters<typeof actual.requiredColumnRegistries>
    ) =>
      registryFailure.cause === undefined
        ? actual.requiredColumnRegistries(...args)
        : Promise.reject(registryFailure.cause),
  };
});
vi.mock("../../pipeline/classifier/count-helpers", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../pipeline/classifier/count-helpers")
    >();
  return {
    ...actual,
    countRowsBreakingNotNull: (
      ...args: Parameters<typeof actual.countRowsBreakingNotNull>
    ) =>
      countFailure.cause === undefined
        ? actual.countRowsBreakingNotNull(...args)
        : Promise.reject(countFailure.cause),
  };
});

let adapter: ReturnType<typeof createSqliteAdapter>;
let sqlite: Database.Database;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true });
  await adapter.connect();
  sqlite = adapter.getDrizzle<{ $client: Database.Database }>().$client;
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE parent (id TEXT PRIMARY KEY, label TEXT);
    CREATE TABLE child (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE
    );
    INSERT INTO parent VALUES ('p1', 'one');
    INSERT INTO child VALUES ('c1', 'p1');
  `);
});

/** Runs statements as one migration unit, the way the executors do. */
function runUnit(statements: string[]) {
  return executeTransaction(adapter, async tx => {
    for (const statement of statements) await tx.execute(statement);
  });
}

const count = (table: string) =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number })
    .n;

describe("a SQLite migration unit", () => {
  it("rebuilds a parent table without cascading into its children's rows", async () => {
    // The lossless rebuild: new table, copy, drop the old, rename. With
    // enforcement on, dropping `parent` deletes every `child` row through
    // ON DELETE CASCADE.
    await runUnit([
      "CREATE TABLE __new_parent (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '')",
      "INSERT INTO __new_parent (id, label) SELECT id, label FROM parent",
      "DROP TABLE parent",
      "ALTER TABLE __new_parent RENAME TO parent",
    ]);

    expect(count("child")).toBe(1);
    expect(count("parent")).toBe(1);
    // Enforcement is back on, and the child's reference still resolves.
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("rolls back a unit that would leave a dangling reference", async () => {
    await expect(
      runUnit([
        "CREATE TABLE marker (id TEXT)",
        "DELETE FROM parent WHERE id = 'p1'",
      ])
    ).rejects.toMatchObject({
      code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
      logContext: { reason: "dangling-reference" },
    });

    // Nothing the unit did survives, and enforcement is back on.
    expect(count("parent")).toBe(1);
    expect(count("child")).toBe(1);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE name = 'marker'")
        .all()
    ).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("refuses to run when enforcement could not be switched off, running nothing", async () => {
    // The pragma is silently ignored while another transaction is open on
    // the connection. The adapter's own transaction cannot be opened inside
    // one, so that state is produced at the session boundary: the real
    // adapter, with the switch-off statement not reaching the connection.
    const ignoresSwitchOff = Object.assign(Object.create(adapter) as object, {
      executeQuery: (statement: string, params?: never[]) =>
        statement === "PRAGMA foreign_keys = OFF"
          ? Promise.resolve([])
          : adapter.executeQuery(statement, params),
    }) as typeof adapter;
    let ran = false;

    await expect(
      executeTransaction(ignoresSwitchOff, async tx => {
        ran = true;
        await tx.execute("CREATE TABLE marker (id TEXT)");
      })
    ).rejects.toMatchObject({
      code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
      logContext: { reason: "enforcement-still-on" },
    });
    expect(ran).toBe(false);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE name = 'marker'")
        .all()
    ).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("restores the setting it found, and restores it after a failed statement", async () => {
    sqlite.pragma("foreign_keys = OFF");
    await runUnit(["CREATE TABLE a (id TEXT)"]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(0);

    sqlite.pragma("foreign_keys = ON");
    await expect(runUnit(["CREATE TABLE a (id TEXT)"])).rejects.toThrow(
      /already exists/
    );
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("a unit run outside a transaction that fails part-way", () => {
  /** The unit's error, from a real driver failure on its last statement. */
  async function failure(
    statements: string[],
    unit: Parameters<typeof runMigrationStatements>[2]
  ): Promise<NextlyError> {
    const thrown = await runMigrationStatements(adapter, statements, unit).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(thrown).toBeInstanceOf(NextlyError);
    return thrown as NextlyError;
  }

  const FAILS_THIRD = [
    "INSERT INTO parent VALUES ('p2', 'two')",
    "INSERT INTO parent VALUES ('p3', 'three')",
    "INSERT INTO missing_secret_table VALUES ('x')",
  ];

  it("keeps the driver's reason out of the public message", async () => {
    const error = await failure(FAILS_THIRD, {
      source: "0001_x.sql",
      transaction: false,
    });

    expect(error.code).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
    expect(error.publicMessage).toBe(
      "0001_x.sql ran outside a transaction, and its statement 3 of 3 failed. The 2 statement(s) before it stayed applied, and were not undone. If you finish its remaining statements by hand, mark it applied with `nextly migrate:resolve --applied 0001_x.sql` rather than running it again; if you reverse the statements that ran, run `nextly migrate:resolve --failed-cleanup 0001_x.sql` and then `nextly migrate` again."
    );
    expect(error.publicMessage).not.toContain("missing_secret_table");
    // The reason travels where the operator reads it, not the wire.
    expect(error.logMessage).toMatch(
      /^0001_x\.sql: statement 3 of 3 failed: .*no such table: missing_secret_table$/
    );
    expect(error.cause?.message).toContain(
      "no such table: missing_secret_table"
    );
    expect(error.logContext).toEqual({
      source: "0001_x.sql",
      failedStatement: 3,
      statements: 3,
      reason: "partially-applied",
    });
    expect(error.toResponseJSON("req").message).not.toContain(
      "missing_secret_table"
    );
    expect(count("parent")).toBe(3);
  });

  it("names a module's recovery for a plugin module", async () => {
    const error = await failure(FAILS_THIRD, {
      source: "plugin:@acme/fx/001_init",
      transaction: false,
    });
    expect(error.publicMessage).toContain(
      "run `nextly migrate:resolve --failed-cleanup plugin:@acme/fx/001_init` and then `nextly migrate`, which records it applied rather than running it again"
    );
  });

  it("asks a DOWN to be finished or reversed, not marked applied", async () => {
    const error = await failure(FAILS_THIRD, {
      source: "0001_x.sql",
      transaction: false,
      direction: "down",
    });
    expect(error.publicMessage).toContain(
      "The 2 statement(s) before it stayed applied, and were not undone. Finish or reverse them by hand before running it again."
    );
    expect(error.publicMessage).not.toContain("--applied");
  });

  it("says nothing ran when the first statement fails", async () => {
    const error = await failure(
      ["INSERT INTO missing_secret_table VALUES ('x')"],
      {
        source: "0001_x.sql",
        transaction: false,
      }
    );
    expect(error.publicMessage).toBe(
      "0001_x.sql ran outside a transaction, and its statement 1 of 1 failed. No statement before it had run, so it can run again once the cause is fixed."
    );
  });
});

describe("a statement a try passes over", () => {
  const ALREADY = [
    "INSERT INTO parent VALUES ('p4', 'four')",
    "INSERT INTO missing_table VALUES ('x')",
    "INSERT INTO parent VALUES ('p5', 'five')",
  ];
  const missingTable = (error: unknown) =>
    String((error as Error).message).includes("no such table: missing_table");

  it("is passed over outside a transaction, and the unit goes on to the next", async () => {
    const seen: string[] = [];
    await expect(
      runMigrationStatements(
        adapter,
        ALREADY,
        { source: "0001_x.sql", transaction: false },
        undefined,
        {
          tryMs: 1_000,
          passOver: (error, statement) => {
            seen.push(statement);
            return missingTable(error);
          },
        }
      )
    ).resolves.toBe(3);
    expect(seen).toEqual(["INSERT INTO missing_table VALUES ('x')"]);
    const rows = await adapter.executeQuery<{ id: string }>(
      "SELECT id FROM parent WHERE id IN ('p4', 'p5') ORDER BY id"
    );
    expect(rows.map(row => row.id)).toEqual(["p4", "p5"]);
  });

  it("is never consulted in a SQLite transaction, whose refused statement aborts it", async () => {
    const passOver = vi.fn(() => true);
    await expect(
      runMigrationStatements(
        adapter,
        ALREADY,
        { source: "0001_x.sql", transaction: true },
        undefined,
        { tryMs: 1_000, passOver }
      )
    ).rejects.toThrow();
    expect(passOver).not.toHaveBeenCalled();
  });
});

describe("a unit run outside a transaction refused at a column made required", () => {
  // The refusal says itself which statements ran and that they stayed applied, so it reaches the
  // caller as it is, under its own code, rather than as a statement that failed part-way.
  it("keeps the refusal, naming the column, its count and what stayed applied", async () => {
    sqlite.exec(
      `INSERT INTO parent VALUES ('p2', NULL); INSERT INTO parent VALUES ('p3', NULL)`
    );
    const thrown = await runMigrationStatements(
      adapter,
      [
        "UPDATE parent SET label = 'two' WHERE id = 'p2'",
        "CREATE TABLE __new_parent (id TEXT PRIMARY KEY, label TEXT NOT NULL)",
        "INSERT INTO __new_parent (id, label) SELECT id, label FROM parent",
        "DROP TABLE parent",
        "ALTER TABLE __new_parent RENAME TO parent",
      ],
      { source: "0002_label.sql", transaction: false }
    ).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(NextlyError.is(thrown)).toBe(true);
    const error = thrown as NextlyError;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.publicData).toEqual({
      errors: [
        {
          path: "tables.parent.label",
          code: "REQUIRED_COLUMN_HAS_NULLS",
          message:
            "Table 'parent': column 'label' cannot become required while 1 row holds no value in it. Give that row a value first, or keep the column nullable.",
        },
      ],
    });
    expect(error.publicMessage).toContain(
      "They ran outside a transaction, and stayed applied."
    );
    // The fill before it stayed; the rebuild never started.
    expect(
      sqlite.prepare(`SELECT label FROM parent WHERE id = 'p2'`).get()
    ).toEqual({ label: "two" });
    expect(count("parent")).toBe(3);
  });

  // A count that fails at the statement comes after the write before it committed, so its
  // refusal names what ran and that it stayed, as a counted one does; it never says nothing ran.
  // Reading what to count (the registries, the catalog) comes after the write before it too, so a
  // read that fails is refused as a failed count is there, never as a bare error.
  it("a fact read that fails there is refused naming the statements that ran and that they stayed", async () => {
    sqlite.exec(`INSERT INTO parent VALUES ('p2', NULL)`);
    const cause = new Error("registry unreadable");
    registryFailure.cause = cause;
    const thrown = await runMigrationStatements(
      adapter,
      [
        "UPDATE parent SET label = 'two' WHERE id = 'p2'",
        "CREATE TABLE __new_parent (id TEXT PRIMARY KEY, label TEXT NOT NULL)",
        "INSERT INTO __new_parent (id, label) SELECT id, label FROM parent",
        "DROP TABLE parent",
        "ALTER TABLE __new_parent RENAME TO parent",
      ],
      { source: "0002_label.sql", transaction: false }
    )
      .then(
        () => undefined,
        (caught: unknown) => caught
      )
      .finally(() => {
        registryFailure.cause = undefined;
      });
    expect(NextlyError.is(thrown)).toBe(true);
    const error = thrown as NextlyError;
    expect(error.publicData).toMatchObject({
      errors: [{ code: "REQUIRED_COLUMN_UNCOUNTED", path: "fields.label" }],
    });
    expect(error.publicMessage).toContain(
      "0002_label.sql was refused at its statement 3."
    );
    expect(error.publicMessage).toContain(
      "They ran outside a transaction, and stayed applied."
    );
    expect(error.logContext).toMatchObject({
      phase: "at-statement",
      statement: 3,
    });
    expect(error.cause).toBe(cause);
  });

  it("a count that fails there is refused naming the statements that ran and that they stayed", async () => {
    sqlite.exec(`INSERT INTO parent VALUES ('p2', NULL)`);
    const cause = new Error("connection lost");
    countFailure.cause = cause;
    const thrown = await runMigrationStatements(
      adapter,
      [
        "UPDATE parent SET label = 'two' WHERE id = 'p2'",
        "CREATE TABLE __new_parent (id TEXT PRIMARY KEY, label TEXT NOT NULL)",
        "INSERT INTO __new_parent (id, label) SELECT id, label FROM parent",
        "DROP TABLE parent",
        "ALTER TABLE __new_parent RENAME TO parent",
      ],
      { source: "0002_label.sql", transaction: false }
    )
      .then(
        () => undefined,
        (caught: unknown) => caught
      )
      .finally(() => {
        countFailure.cause = undefined;
      });
    expect(NextlyError.is(thrown)).toBe(true);
    const error = thrown as NextlyError;
    expect(error.publicData).toEqual({
      errors: [
        {
          path: "fields.label",
          code: "REQUIRED_COLUMN_UNCOUNTED",
          message:
            "Table 'parent': the rows that would break making 'label' required could not be counted, so that change was refused before it ran. Check that the database can be reached and the table read, then try again.",
        },
      ],
    });
    expect(error.publicMessage).toBe(
      // A rebuild is counted at its copy, the statement that would fill the NOT NULL table.
      "0002_label.sql was refused at its statement 3. INSERT INTO __new_parent (of 5): Table 'parent': the rows that would break making 'label' required could not be counted, so that change was refused before it ran. Check that the database can be reached and the table read, then try again. The statements that ran before it: 1. UPDATE parent SET label =; 2. CREATE TABLE __new_parent. They ran outside a transaction, and stayed applied."
    );
    expect(error.logContext).toMatchObject({
      source: "0002_label.sql",
      phase: "at-statement",
      statement: 3,
    });
    expect(error.cause).toBe(cause);
    expect(
      sqlite.prepare(`SELECT label FROM parent WHERE id = 'p2'`).get()
    ).toEqual({ label: "two" });
  });
});

describe("the runner's own writes after a unit's statements", () => {
  /**
   * An adapter that logs what its transaction runs, in order: the unit's
   * statements, the Drizzle statements run for their effect (rendered as
   * PostgreSQL renders them), and `after`.
   */
  function loggingAdapter(dialect: "postgresql" | "mysql") {
    const log: string[] = [];
    const pg = new PgDialect();
    const fake = {
      getCapabilities: () => ({ dialect }),
      // No transaction is open around the unit, so it may run.
      transactionOpenInFlow: () => false,
      transaction: async <T>(
        work: (ctx: {
          execute: (statement: string) => Promise<unknown[]>;
          runStatement: (statement: SQL) => Promise<void>;
          getDrizzle: () => unknown;
        }) => Promise<T>
      ): Promise<T> =>
        work({
          execute: async statement => {
            log.push(statement);
            return [];
          },
          runStatement: async statement => {
            log.push(pg.sqlToQuery(statement).sql);
          },
          getDrizzle: () => ({}),
        }),
    };
    return { log, adapter: fake as unknown as DrizzleAdapter };
  }

  const statements = [
    "SET LOCAL search_path TO reporting",
    "SET LOCAL ROLE reporter",
    'INSERT INTO "r" VALUES (1)',
  ];
  const unit = { source: "0001_x.sql", transaction: true };

  it("restores PostgreSQL's session settings before the ledger is written", async () => {
    const { log, adapter: pgAdapter } = loggingAdapter("postgresql");
    await runMigrationStatements(pgAdapter, statements, unit, async () => {
      log.push("after");
    });
    expect(log).toEqual([
      ...statements,
      "RESET SESSION AUTHORIZATION",
      "RESET ROLE",
      "RESET search_path",
      "after",
    ]);
  });

  it("adds nothing on MySQL, whose rerouting statement is refused before the unit runs", async () => {
    const { log, adapter: mysqlAdapter } = loggingAdapter("mysql");
    await runMigrationStatements(mysqlAdapter, statements, unit, async () => {
      log.push("after");
    });
    expect(log).toEqual([...statements, "after"]);
  });
});

describe("a unit run outside a transaction, on MySQL and PostgreSQL", () => {
  /**
   * An adapter that logs where each statement ran: through `withSession`,
   * with the options it was given, or through `executeQuery` on the pool.
   */
  function sessionAdapter(dialect: "postgresql" | "mysql", failOn?: string) {
    const log: string[] = [];
    const run = async (where: string, statement: string) => {
      if (statement === failOn) throw new Error(`refused: ${statement}`);
      log.push(`${where}: ${statement}`);
      return [];
    };
    const fake = {
      getCapabilities: () => ({ dialect }),
      getDrizzle: () => ({}),
      executeQuery: (statement: string) => run("pool", statement),
      withSession: async <T>(
        work: (session: {
          execute: (statement: string) => Promise<unknown[]>;
        }) => Promise<T>,
        options?: { strictSqlMode?: boolean }
      ): Promise<T> => {
        log.push(`session open ${JSON.stringify(options ?? {})}`);
        try {
          return await work({ execute: s => run("session", s) });
        } finally {
          log.push("session closed");
        }
      },
    };
    return { log, adapter: fake as unknown as DrizzleAdapter };
  }

  const statements = [
    "ALTER TABLE t MODIFY COLUMN v varchar(5)",
    "CREATE INDEX t_v ON t (v)",
  ];
  const unit = { source: "0001_x.sql", transaction: false };

  it("runs every statement on one MySQL session in strict mode", async () => {
    const { log, adapter: mysqlAdapter } = sessionAdapter("mysql");
    await runMigrationStatements(mysqlAdapter, statements, unit, async () => {
      log.push("after");
    });
    expect(log).toEqual([
      'session open {"strictSqlMode":true}',
      `session: ${statements[0]}`,
      `session: ${statements[1]}`,
      "session closed",
      "after",
    ]);
  });

  it("still reports a MySQL statement that failed part-way, with the session closed", async () => {
    const { log, adapter: mysqlAdapter } = sessionAdapter(
      "mysql",
      statements[1]
    );
    const thrown = await runMigrationStatements(
      mysqlAdapter,
      statements,
      unit
    ).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(thrown).toBeInstanceOf(NextlyError);
    expect((thrown as NextlyError).code).toBe(
      "NEXTLY_MIGRATION_PARTIALLY_APPLIED"
    );
    expect((thrown as NextlyError).logContext).toMatchObject({
      failedStatement: 2,
      statements: 2,
    });
    expect(log).toEqual([
      'session open {"strictSqlMode":true}',
      `session: ${statements[0]}`,
      "session closed",
    ]);
  });

  it("leaves PostgreSQL's statements on the pool, one by one, as before", async () => {
    const { log, adapter: pgAdapter } = sessionAdapter("postgresql");
    await runMigrationStatements(pgAdapter, statements, unit);
    expect(log).toEqual(statements.map(s => `pool: ${s}`));
  });
});
