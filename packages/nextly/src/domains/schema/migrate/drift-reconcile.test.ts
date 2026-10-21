/**
 * @module domains/schema/migrate/drift-reconcile.test
 * @since v0.0.3-alpha (Plan C2)
 */
import { describe, it, expect, vi } from "vitest";

import { createTestDb } from "../../../__tests__/fixtures/db";
import { NextlyError } from "../../../errors/nextly-error";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../events/schema-events-repository";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import { reconcileFile, type ReconcileRepo } from "./drift-reconcile";
import { resolveMigration } from "./resolve";

const tbl = (name: string): NextlySchemaSnapshot["tables"][number] => ({
  name,
  columns: [{ name: "id", type: "text", nullable: false }],
});

const snap = (...names: string[]): NextlySchemaSnapshot => ({
  tables: names.map(tbl),
});

type FakeRepo = ReconcileRepo & {
  starts: number;
  applied: Array<{ statementsExecuted?: number | null }>;
  /** The handles the applied row was written through (`boundTo`). */
  bound: unknown[];
  failed: number;
  /** Attempts deleted after a lost race rolled back whole. */
  discarded: number;
  superseded: Array<{ supersededEventIds: string[]; byEventId: string }>;
};

/**
 * Typed as `ReconcileRepo` rather than cast away, so a method added to the
 * interface fails to compile here instead of being discovered at runtime by
 * whichever test happens to reach it.
 */
function fakeRepo(
  priorAttempts: ReadonlyArray<
    Pick<SchemaEventRow, "status" | "startedAt">
  > = []
): FakeRepo {
  const state = {
    starts: 0,
    failed: 0,
    discarded: 0,
    bound: [] as unknown[],
    applied: [] as Array<{ statementsExecuted?: number | null }>,
    superseded: [] as Array<{
      supersededEventIds: string[];
      byEventId: string;
    }>,
  };
  const repo: FakeRepo = {
    ...state,
    recordStart: () => {
      state.starts++;
      return Promise.resolve(`evt-${state.starts}`);
    },
    markApplied: (_id, args) => {
      state.applied.push(args);
      return Promise.resolve(true);
    },
    markFailed: () => {
      repo.failed++;
      return Promise.resolve();
    },
    discardAttempt: () => {
      repo.discarded++;
      return Promise.resolve();
    },
    supersede: args => {
      state.superseded.push(args);
      return Promise.resolve();
    },
    findFileApplies: () => Promise.resolve(priorAttempts),
    boundTo: handle => {
      state.bound.push(handle);
      return repo;
    },
  };
  return repo;
}

/** The handle a fake executor's transaction hands the work it runs after. */
const TX_HANDLE = { connection: "the unit's transaction" };

/**
 * An executor that runs the file's statements and then `after` with its
 * transaction's handle, as `runMigrationStatements` does.
 */
function executor(handle: unknown = TX_HANDLE) {
  return vi.fn(
    async (
      _sql: string,
      _unit: unknown,
      after: (db: unknown, statementsExecuted: number) => Promise<void>
    ) => {
      await after(handle, 1);
      return 1;
    }
  );
}

/**
 * Asserts an executor ran no statement: a file recorded without running
 * goes through it only as a unit with none, for its ledger writes'
 * transaction.
 */
function expectNoStatements(executeSql: ReturnType<typeof executor>): void {
  for (const [sql] of executeSql.mock.calls) expect(sql).toBe("");
}

const file = {
  filename: "0006_x.sql",
  sql: "CREATE TABLE b (id text);",
  path: "m/0006_x.sql",
};

/**
 * A real ledger in which `failures` attempts of the file ended as `status` —
 * failed, or left `in_progress` by a process that stopped — then cleared by
 * the real `migrate:resolve --failed-cleanup`. The cleanup flips those rows
 * to `rolled_back` in place and adds no newer row, so a fake ledger that
 * appends one models a history the command never writes.
 */
async function clearedLedger(
  failures = 1,
  status: "failed" | "in_progress" = "failed"
): Promise<SchemaEventsRepository> {
  return (await clearedLedgerWithHandle(failures, status)).repo;
}

/** `clearedLedger`, with the Drizzle handle its ledger is written through. */
async function clearedLedgerWithHandle(
  failures = 1,
  status: "failed" | "in_progress" = "failed"
): Promise<{ repo: SchemaEventsRepository; db: unknown }> {
  const { db } = await createTestDb();
  const repo = new SchemaEventsRepository(db, "sqlite");
  for (let t = 1; t <= failures; t++) {
    await repo.insertEvent({
      eventType: "file_apply",
      status,
      source: "cli-migrate",
      filename: file.filename,
      startedAt: new Date(t),
    });
  }
  await resolveMigration({
    mode: "failed-cleanup",
    filename: file.filename,
    dialect: "sqlite",
    repo,
    fileExists: () => Promise.resolve(true),
    loadTargetSnapshot: () => Promise.resolve(null),
    marksNoTransaction: () => Promise.resolve(false),
    introspectLive: () => Promise.resolve({ tables: [] }),
  });
  return { repo, db };
}

/** The file's ledger statuses, oldest attempt first. */
async function ledgerStatuses(repo: SchemaEventsRepository): Promise<string[]> {
  const rows = await repo.findFileApplies(file.filename);
  return [...rows]
    .sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt))
    .map(row => row.status);
}

describe("reconcileFile (Phase 2 three-state)", () => {
  describe("a file run outside a transaction whose last attempt failed", () => {
    const outside = { ...file, transaction: false };
    it("refuses to record it applied without running it when live ≡ target", async () => {
      // Its schema statements ran, so the database stands at its target, but
      // a data statement after the failure may never have.
      const repo = fakeRepo([
        { status: "rolled_back", startedAt: new Date(1) },
        { status: "failed", startedAt: new Date(2) },
      ]);
      const executeSql = executor();
      await expect(
        reconcileFile({
          file: outside,
          before: snap("a"),
          target: snap("a", "b"),
          live: snap("a", "b"),
          repo,
          executeSql,
        })
      ).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
        logContext: { source: "0006_x.sql", reason: "partially-applied" },
        publicMessage: expect.stringContaining(
          "mark it applied with `nextly migrate:resolve --applied 0006_x.sql` rather than running it again"
        ) as unknown,
      });
      expectNoStatements(executeSql);
      expect(repo.starts).toBe(0);
      expect(repo.applied).toEqual([]);
    });

    it("names the module recovery for a plugin module", async () => {
      await expect(
        reconcileFile({
          file: { ...outside, filename: "plugin:@acme/fx/001_init" },
          before: snap("a"),
          target: snap("a", "b"),
          live: snap("a", "b"),
          repo: fakeRepo([{ status: "failed", startedAt: new Date(1) }]),
          executeSql: executor(),
          pluginName: "@acme/fx",
        })
      ).rejects.toThrow(
        "run `nextly migrate:resolve --failed-cleanup plugin:@acme/fx/001_init` and then `nextly migrate`, which records it applied"
      );
    });

    it("records it applied once the failed attempt is cleared", async () => {
      const { repo, db } = await clearedLedgerWithHandle();
      const executeSql = executor(db);
      const r = await reconcileFile({
        file: outside,
        before: snap("a"),
        target: snap("a", "b"),
        live: snap("a", "b"),
        repo,
        executeSql,
      });
      expect(r.state).toBe("already_applied");
      expectNoStatements(executeSql);
      expect(await ledgerStatuses(repo)).toEqual(["rolled_back", "applied"]);
    });

    it("still records a file run in a transaction, whose failure was undone", async () => {
      const repo = fakeRepo([{ status: "failed", startedAt: new Date(1) }]);
      const r = await reconcileFile({
        file,
        before: snap("a"),
        target: snap("a", "b"),
        live: snap("a", "b"),
        repo,
        executeSql: executor(),
      });
      expect(r.state).toBe("already_applied");
    });
  });

  describe("a file run outside a transaction whose last attempt never finished", () => {
    // A process killed mid-attempt records neither outcome: its row stays
    // `in_progress`, and the statements it ran before it stopped stayed.
    const outside = { ...file, transaction: false };
    const crashed = () =>
      fakeRepo([{ status: "in_progress", startedAt: new Date(1) }]);

    it("refuses to record it applied without running it when live ≡ target", async () => {
      const repo = crashed();
      const executeSql = executor();
      await expect(
        reconcileFile({
          file: outside,
          before: snap("a"),
          target: snap("a", "b"),
          live: snap("a", "b"),
          repo,
          executeSql,
        })
      ).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
        publicMessage: expect.stringContaining(
          "its last attempt recorded no outcome"
        ) as unknown,
      });
      expectNoStatements(executeSql);
      expect(repo.starts).toBe(0);
    });

    it("refuses to run it again when live ≡ before", async () => {
      const repo = crashed();
      const executeSql = executor();
      await expect(
        reconcileFile({
          file: outside,
          before: snap("a"),
          target: snap("a", "b"),
          live: snap("a"),
          repo,
          executeSql,
        })
      ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED" });
      expectNoStatements(executeSql);
    });

    it("records it applied once `--failed-cleanup` clears the attempt", async () => {
      const { repo, db } = await clearedLedgerWithHandle(1, "in_progress");
      const r = await reconcileFile({
        file: outside,
        before: snap("a"),
        target: snap("a", "b"),
        live: snap("a", "b"),
        repo,
        executeSql: executor(db),
      });
      expect(r.state).toBe("already_applied");
      expect(await ledgerStatuses(repo)).toEqual(["rolled_back", "applied"]);
    });

    it.each(["postgresql", "sqlite"] as const)(
      "still records on %s a file run in a transaction, whose unfinished attempt was undone",
      async dialect => {
        const r = await reconcileFile({
          file,
          before: snap("a"),
          target: snap("a", "b"),
          live: snap("a", "b"),
          repo: crashed(),
          executeSql: executor(),
          dialect,
        });
        expect(r.state).toBe("already_applied");
      }
    );

    it("refuses on MySQL a file run in a transaction, whose schema statements committed", async () => {
      await expect(
        reconcileFile({
          file,
          before: snap("a"),
          target: snap("a", "b"),
          live: snap("a", "b"),
          repo: crashed(),
          executeSql: executor(),
          dialect: "mysql",
        })
      ).rejects.toMatchObject({
        code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
        publicMessage: expect.stringContaining(
          "0006_x.sql's last attempt recorded no outcome"
        ) as unknown,
      });
    });
  });

  it("IN_SYNC: live ≡ before → runs the SQL and records file_apply", async () => {
    const repo = fakeRepo();
    const executeSql = executor();
    const r = await reconcileFile({
      file,
      before: snap("a"),
      target: snap("a", "b"),
      live: snap("a"), // ≡ before
      repo,
      executeSql,
    });
    expect(r.state).toBe("in_sync");
    expect(executeSql).toHaveBeenCalledOnce();
    expect(repo.applied[0].statementsExecuted).toBe(1);
  });

  it("IN_SYNC: records the applied row, then what the caller records, through the handle the statements ran on", async () => {
    const repo = fakeRepo();
    const order: string[] = [];
    const recordApplied = vi.fn(async (db: unknown) => {
      order.push(`recordApplied:${String(repo.applied.length)}`);
      expect(db).toBe(TX_HANDLE);
    });
    const executeSql = vi.fn(
      async (
        _sql: string,
        _unit: unknown,
        after: (db: unknown, statementsExecuted: number) => Promise<void>
      ) => {
        order.push("statements");
        await after(TX_HANDLE, 2);
        // Still inside the executor: its transaction has not committed.
        order.push("commit");
        return 2;
      }
    );
    await reconcileFile({
      file,
      before: snap("a"),
      target: snap("a", "b"),
      live: snap("a"),
      repo,
      executeSql,
      recordApplied,
    });
    expect(repo.bound).toEqual([TX_HANDLE]);
    expect(repo.applied).toEqual([
      { statementsExecuted: 2, uniqueFilename: "0006_x.sql" },
    ]);
    expect(order).toEqual(["statements", "recordApplied:1", "commit"]);
  });

  it("IN_SYNC: an applied-row write that fails fails the executor's work, so its transaction rolls back, and the attempt is recorded failed", async () => {
    const repo = fakeRepo();
    repo.markApplied = () => Promise.reject(new Error("ledger write failed"));
    let committed = false;
    const executeSql = vi.fn(
      async (
        _sql: string,
        _unit: unknown,
        after: (db: unknown, statementsExecuted: number) => Promise<void>
      ) => {
        await after(TX_HANDLE, 1);
        committed = true;
        return 1;
      }
    );
    await expect(
      reconcileFile({
        file,
        before: snap("a"),
        target: snap("a", "b"),
        live: snap("a"),
        repo,
        executeSql,
      })
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_APPLY_FAILED" });
    expect(committed).toBe(false);
    expect(repo.failed).toBe(1);
  });

  it("records a failure's cause in the ledger and keeps it on the error it rethrows", async () => {
    // A partial failure keeps the database's reason out of its public
    // message and in its cause, so the ledger row and the rethrown error
    // must carry the cause for the operator to read it back.
    const failures: Array<string | null | undefined> = [];
    const repo = {
      ...fakeRepo(),
      markFailed: (
        _id: string,
        args: { errorMessage?: string | null }
      ): Promise<void> => {
        failures.push(args.errorMessage);
        return Promise.resolve();
      },
    };
    const driver = new Error('relation "secret_t" does not exist');
    const partial = new NextlyError({
      code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
      publicMessage: "0006_x.sql ran outside a transaction, and failed.",
      cause: driver,
    });
    const error = await reconcileFile({
      file: { ...file, transaction: false },
      before: snap("a"),
      target: snap("a", "b"),
      live: snap("a"),
      repo,
      executeSql: vi.fn().mockRejectedValue(partial),
    }).then(
      () => undefined,
      (caught: unknown) => caught as NextlyError
    );

    expect(error?.code).toBe("NEXTLY_MIGRATION_APPLY_FAILED");
    expect(error?.publicMessage).not.toContain("secret_t");
    expect(error?.cause).toBe(partial);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('relation "secret_t" does not exist');
  });

  it("ALREADY_APPLIED: live ≡ target → skips SQL, records statements=0, supersedes", async () => {
    const repo = fakeRepo();
    const executeSql = executor();
    const r = await reconcileFile({
      file,
      before: snap("a"),
      target: snap("a", "b"),
      live: snap("a", "b"), // ≡ target
      repo,
      executeSql,
      supersedableEventIds: () => Promise.resolve(["dev-1", "dev-2"]),
    });
    expect(r.state).toBe("already_applied");
    expectNoStatements(executeSql);
    expect(repo.applied[0].statementsExecuted).toBe(0);
    expect(repo.superseded[0].supersededEventIds).toEqual(["dev-1", "dev-2"]);
  });

  it("DRIFT: live matches neither → throws NEXTLY_MIGRATION_DRIFT", async () => {
    const repo = fakeRepo();
    await expect(
      reconcileFile({
        file,
        before: snap("a"),
        target: snap("a", "b"),
        live: snap("c"), // matches neither
        repo,
        executeSql: executor(),
      })
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });
  });

  describe("DRIFT names every element it finds different", () => {
    // `before` holds one table with a text `id`; each case changes one
    // element of it in the live database, so the database matches neither
    // side and the refusal must say which element differs.
    const withId = (
      over: Partial<NextlySchemaSnapshot["tables"][number]>
    ): NextlySchemaSnapshot => ({
      tables: [{ ...tbl("a"), ...over }],
    });
    // `before` tracks checks and foreign keys (an empty list), as an
    // introspected table does: a side that leaves them out has the diff skip
    // that dimension, and nothing would differ.
    const before = withId({ checks: [], foreignKeys: [] });
    const refusal = async (live: NextlySchemaSnapshot): Promise<unknown> =>
      reconcileFile({
        file,
        before,
        target: { tables: [...before.tables, tbl("b")] },
        live,
        repo: fakeRepo(),
        executeSql: executor(),
      }).catch((error: unknown) => error);
    const details = (error: unknown): string[] =>
      (
        (error as { logContext?: { driftItems?: Array<{ detail: string }> } })
          .logContext?.driftItems ?? []
      ).map(item => item.detail);

    it.each([
      [
        "a column's type",
        withId({
          columns: [{ name: "id", type: "integer", nullable: false }],
          checks: [],
          foreignKeys: [],
        }),
        "a.id",
      ],
      [
        "a column's nullability",
        withId({
          columns: [{ name: "id", type: "text", nullable: true }],
          checks: [],
          foreignKeys: [],
        }),
        "a.id",
      ],
      [
        "a column's default",
        withId({
          columns: [
            { name: "id", type: "text", nullable: false, default: "'x'" },
          ],
          checks: [],
          foreignKeys: [],
        }),
        "a.id",
      ],
      [
        "a check",
        withId({
          checks: [{ name: "a_id_check", sql: "id <> ''" }],
          foreignKeys: [],
        }),
        "a_id_check",
      ],
      [
        "a foreign key",
        withId({
          checks: [],
          foreignKeys: [
            {
              name: "fk_a_id",
              columns: ["id"],
              referencesTable: "c",
              referencesColumns: ["id"],
              onDelete: "cascade",
              onUpdate: "no action",
            },
          ],
        }),
        "fk_a_id",
      ],
    ])("names %s", async (_what, live, name) => {
      const error = await refusal(live);
      expect(error).toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });
      expect(details(error).join("\n")).toContain(name);
      expect(details(error).join("\n")).not.toMatch(/^\S+ differs$/m);
    });
  });

  it("does not offer the baseline recovery when the file already failed once", async () => {
    // Schema alone cannot tell a retried failed migration from a database
    // nobody has adopted: MySQL commits each DDL statement as it runs, so a
    // first migration that failed partway leaves its tables and the retry sees
    // an empty baseline against tables that already exist. The ledger is the
    // difference, and sending this operator to `migrate:baseline` would send
    // them past the failed-cleanup path they need.
    const withAttempt = fakeRepo([
      { status: "failed", startedAt: new Date(1) },
    ]);
    await expect(
      reconcileFile({
        file,
        before: snap(),
        target: snap("a", "b"),
        live: snap("a"), // matches neither: every difference is a `+`
        repo: withAttempt,
        executeSql: executor(),
      })
    ).rejects.toMatchObject({
      publicMessage: expect.not.stringContaining("migrate:baseline"),
    });

    // The same drift with no recorded attempt IS an adoption.
    const fresh = fakeRepo();
    await expect(
      reconcileFile({
        file,
        before: snap(),
        target: snap("a", "b"),
        live: snap("a"),
        repo: fresh,
        executeSql: executor(),
      })
    ).rejects.toMatchObject({
      publicMessage: expect.stringContaining("migrate:baseline"),
    });
  });

  it("apply failure: IN_SYNC + executeSql throws → marks failed + throws APPLY_FAILED", async () => {
    const repo = fakeRepo();
    await expect(
      reconcileFile({
        file,
        before: snap("a"),
        target: snap("a", "b"),
        live: snap("a"),
        repo,
        executeSql: () => Promise.reject(new Error("constraint violation")),
      })
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_APPLY_FAILED" });
  });
});

describe("a file run in a transaction whose last attempt failed", () => {
  const failed = [{ status: "failed" as const, startedAt: new Date(1) }];
  const args = (dialect: "postgresql" | "mysql" | "sqlite") => ({
    file,
    before: snap("a"),
    target: snap("a", "b"),
    live: snap("a", "b"),
    dialect,
    executeSql: executor(),
  });

  it("refuses to record it applied without running it on MySQL, which committed its schema statements", async () => {
    const repo = fakeRepo(failed);
    await expect(
      reconcileFile({ ...args("mysql"), repo })
    ).rejects.toMatchObject({
      code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
      logContext: { source: "0006_x.sql", reason: "partially-applied" },
      publicMessage: expect.stringContaining(
        "0006_x.sql's last attempt failed, and MySQL commits each schema statement as it runs, even inside a transaction"
      ) as unknown,
    });
    expect(repo.starts).toBe(0);
    expect(repo.applied).toEqual([]);
  });

  it.each(["postgresql", "sqlite"] as const)(
    "records it applied on %s, where the failed attempt was undone whole",
    async dialect => {
      const repo = fakeRepo(failed);
      await expect(reconcileFile({ ...args(dialect), repo })).resolves.toEqual({
        state: "already_applied",
      });
      expect(repo.applied).toEqual([
        { statementsExecuted: 0, uniqueFilename: "0006_x.sql" },
      ]);
    }
  );

  it("records it applied on MySQL once the failed attempt is cleared", async () => {
    const { repo, db } = await clearedLedgerWithHandle();
    await expect(
      reconcileFile({ ...args("mysql"), executeSql: executor(db), repo })
    ).resolves.toEqual({
      state: "already_applied",
    });
    expect(await ledgerStatuses(repo)).toEqual(["rolled_back", "applied"]);
  });
});

describe("a file whose last attempt failed, with the database at its start", () => {
  const failed = [{ status: "failed" as const, startedAt: new Date(1) }];
  // The schema statement failed, so the database stands where the file
  // starts; a data statement before it may still have run and stayed.
  const args = (
    dialect: "postgresql" | "mysql" | "sqlite",
    transaction?: boolean,
    handle?: unknown
  ) => ({
    file: { ...file, transaction },
    before: snap("a"),
    target: snap("a", "b"),
    live: snap("a"),
    dialect,
    executeSql: executor(handle),
  });

  it("refuses to run it again on MySQL, which committed what ran before the schema statement", async () => {
    const repo = fakeRepo(failed);
    const run = args("mysql");
    await expect(reconcileFile({ ...run, repo })).rejects.toMatchObject({
      code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
      logContext: { source: "0006_x.sql", reason: "partially-applied" },
      publicMessage: expect.stringContaining(
        "Running it again would repeat what of it ran and stayed"
      ) as unknown,
    });
    expect(run.executeSql).not.toHaveBeenCalled();
    expect(repo.starts).toBe(0);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "refuses to run it again on %s when it runs outside a transaction",
    async dialect => {
      const repo = fakeRepo(failed);
      const run = args(dialect, false);
      await expect(reconcileFile({ ...run, repo })).rejects.toThrow(
        "if you reverse the statements that ran, run `nextly migrate:resolve --failed-cleanup 0006_x.sql` and then `nextly migrate` again"
      );
      expect(run.executeSql).not.toHaveBeenCalled();
      expect(repo.starts).toBe(0);
    }
  );

  it.each(["postgresql", "sqlite"] as const)(
    "runs it again on %s, where the failed attempt was undone whole",
    async dialect => {
      const repo = fakeRepo(failed);
      const run = args(dialect);
      await expect(reconcileFile({ ...run, repo })).resolves.toEqual({
        state: "in_sync",
      });
      expect(run.executeSql).toHaveBeenCalledTimes(1);
    }
  );

  it("runs it on MySQL once the failed attempt is cleared", async () => {
    const { repo, db } = await clearedLedgerWithHandle();
    const run = args("mysql", undefined, db);
    await expect(reconcileFile({ ...run, repo })).resolves.toEqual({
      state: "in_sync",
    });
    expect(run.executeSql).toHaveBeenCalledTimes(1);
    expect(await ledgerStatuses(repo)).toEqual(["rolled_back", "applied"]);
  });

  it("runs it on MySQL after one cleanup of two failed attempts in a row", async () => {
    // One `--failed-cleanup` clears both: clearing only one would leave the
    // other as the newest attempt, and the file refused again.
    const { repo, db } = await clearedLedgerWithHandle(2);
    const run = args("mysql", undefined, db);
    await expect(reconcileFile({ ...run, repo })).resolves.toEqual({
      state: "in_sync",
    });
    expect(run.executeSql).toHaveBeenCalledTimes(1);
    expect(await ledgerStatuses(repo)).toEqual([
      "rolled_back",
      "rolled_back",
      "applied",
    ]);
  });
});

describe("a file whose applied row loses to another run's", () => {
  /** A ledger in which another run has recorded the file applied. */
  function lostRace(): FakeRepo {
    const repo = fakeRepo();
    repo.markApplied = () => Promise.resolve(false);
    return repo;
  }
  const args = (transaction?: boolean) => ({
    file: { ...file, transaction },
    before: snap("a"),
    target: snap("a", "b"),
    live: snap("a"),
    dialect: "sqlite" as const,
    executeSql: executor(),
  });

  it("throws inside the transaction and discards the attempt, which nothing of reached the database", async () => {
    const repo = lostRace();
    await expect(reconcileFile({ ...args(), repo })).rejects.toMatchObject({
      code: "NEXTLY_MIGRATION_CONCURRENT_RUN",
      logContext: { source: "0006_x.sql", reason: "concurrent-run" },
    });
    expect(repo.discarded).toBe(1);
    expect(repo.failed).toBe(0);
  });

  it("records the attempt failed when its statements ran outside a transaction and stayed", async () => {
    const repo = lostRace();
    await expect(reconcileFile({ ...args(false), repo })).rejects.toMatchObject(
      {
        code: "NEXTLY_MIGRATION_CONCURRENT_RUN",
        publicMessage: expect.stringContaining(
          "may have stayed applied"
        ) as unknown,
      }
    );
    expect(repo.discarded).toBe(0);
    expect(repo.failed).toBe(1);
  });

  it("refuses an adoption the other run recorded first, inside its transaction", async () => {
    const repo = lostRace();
    await expect(
      reconcileFile({ ...args(), live: snap("a", "b"), repo })
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_CONCURRENT_RUN" });
  });
});
