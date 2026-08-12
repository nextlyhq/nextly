import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  getMigrationLockDdl,
  MIGRATION_LOCK_TABLE,
  withMigrationSession,
  type MigrationDialect,
} from "../session";

/**
 * Interpret a statement the way a driver would, against a one-row lock table.
 *
 * The statement is compiled through a real `PgDialect` first, so the double is
 * exercising the SQL and the bound parameters an adapter would actually hand
 * its driver. Reimplementing the query-builder calls instead is what let this
 * module pass its tests while being unable to run at all: the typed CRUD path
 * resolves a table through the schema registry, which has never declared this
 * one.
 */
function interpret(
  statement: SQL,
  rows: Map<number, { id: number; owner: string | null }>
): Record<string, unknown>[] {
  const { sql: text, params } = new PgDialect().sqlToQuery(statement);
  const flat = text.replace(/\s+/g, " ").trim();

  const select = /^SELECT "(\w+)" FROM "([^"]+)" WHERE "id" = \$1$/.exec(flat);
  if (select) {
    assertLockTable(select[2]);
    const row = rows.get(params[0] as number);
    return row === undefined ? [] : [{ ...row }];
  }

  const claim = /^UPDATE "([^"]+)" SET "owner" = \$1 WHERE "id" = \$2$/.exec(
    flat
  );
  if (claim) {
    assertLockTable(claim[1]);
    const row = rows.get(params[1] as number);
    if (row === undefined) return [];
    row.owner = params[0] as string | null;
    return [];
  }

  const release =
    /^UPDATE "([^"]+)" SET "owner" = NULL WHERE "id" = \$1 AND "owner" = \$2$/.exec(
      flat
    );
  if (release) {
    assertLockTable(release[1]);
    const row = rows.get(params[0] as number);
    // A release naming an owner must not clear a row held by someone else.
    if (row !== undefined && row.owner === params[1]) row.owner = null;
    return [];
  }

  throw new Error(`unrecognised statement: ${flat}`);
}

function assertLockTable(name: string | undefined): void {
  if (name !== MIGRATION_LOCK_TABLE) {
    throw new Error(`relation "${String(name)}" does not exist`);
  }
}

/**
 * A single-row lock table backed by an object, plus the two behaviours of the
 * real adapters that a naive double would omit and that hid a defect once:
 *
 * - every error escaping a transaction callback is reclassified, so a domain
 *   error thrown inside one does NOT come back out intact;
 * - each `transaction()` call takes a connection, so a fake that never counts
 *   them cannot show that the lock stops holding one.
 */
function createAdapter(options: { heldBy?: string | null } = {}) {
  const rows = new Map<number, { id: number; owner: string | null }>();
  if (options.heldBy !== undefined) {
    rows.set(1, { id: 1, owner: options.heldBy });
  }
  const ddl: string[] = [];
  let open = 0;
  let peakOpen = 0;

  const ctx = {
    lockRow: vi.fn(async () => undefined),
    insert: vi.fn(async (_t: string, data: Record<string, unknown>) => {
      const id = data.id as number;
      if (rows.has(id)) throw new Error("duplicate key");
      rows.set(id, { id, owner: (data.owner as string | null) ?? null });
      return data;
    }),
    runStatement: vi.fn(async (statement: SQL) => {
      interpret(statement, rows);
    }),
    queryStatement: vi.fn(async (statement: SQL) => interpret(statement, rows)),
  };

  const adapter = {
    executeQuery: vi.fn(async (sql: string) => {
      ddl.push(sql);
      return [];
    }),
    // The seed read runs outside any transaction, so it goes through the
    // adapter rather than the transaction context.
    queryStatement: vi.fn(async (statement: SQL) => interpret(statement, rows)),
    tableExists: vi.fn(async () => true),
    transaction: vi.fn(async (work: (c: unknown) => Promise<unknown>) => {
      open += 1;
      peakOpen = Math.max(peakOpen, open);
      try {
        return await work(ctx);
      } catch (error) {
        // What the real adapters do: anything that is not already a
        // DatabaseError is rewrapped, so a NextlyError thrown inside a
        // callback loses its identity on the way out.
        throw new Error(`DatabaseError(unknown): ${String(error)}`);
      } finally {
        open -= 1;
      }
    }),
  } as unknown as DrizzleAdapter;

  return {
    adapter,
    ctx,
    ddl,
    owner: () => rows.get(1)?.owner ?? null,
    /** Model another process claiming the row mid-run. */
    takeOver: (owner: string | null) => {
      const row = rows.get(1);
      if (row !== undefined) row.owner = owner;
    },
    peakOpen: () => peakOpen,
  };
}

describe("field-group migration session", () => {
  it("takes the lock, runs, and releases it", async () => {
    const h = createAdapter({ heldBy: null });
    const seen: (string | null)[] = [];
    await withMigrationSession(
      { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
      async () => {
        seen.push(h.owner());
      }
    );
    expect(seen[0]).toMatch(/^run-1#/);
    expect(h.owner()).toBeNull();
  });

  it("releases the lock even when the run throws", async () => {
    const h = createAdapter({ heldBy: null });
    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "mysql", label: "run-1" },
        async () => {
          throw NextlyError.internal({ logContext: { reason: "boom" } });
        }
      )
    ).rejects.toThrowError();
    expect(h.owner()).toBeNull();
  });

  // The schema pipeline's helper gives up waiting and proceeds unlocked. Two
  // concurrent runs renaming the same tables is not a survivable outcome.
  it("refuses to run when another owner holds the lock", async () => {
    const h = createAdapter({ heldBy: "other-run" });
    const ran = vi.fn();
    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => ran()
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(ran).not.toHaveBeenCalled();
    // Untouched: a refused run must not disturb the holder's claim.
    expect(h.owner()).toBe("other-run");
  });

  // The refusal is raised outside the transaction because the adapters
  // reclassify everything thrown inside one. Were it raised inside, this would
  // surface as a generic database error and lose its status and context.
  it("surfaces the refusal as a NextlyError, not a reclassified database error", async () => {
    const h = createAdapter({ heldBy: "other-run" });
    try {
      await withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => undefined
      );
      expect.fail("expected a refusal");
    } catch (error) {
      expect(NextlyError.is(error)).toBe(true);
      expect((error as NextlyError).logContext?.reason).toMatch(
        /held elsewhere/
      );
      expect((error as NextlyError).logContext?.heldBy).toBe("other-run");
    }
  });

  // Holding a pooled connection for the whole run deadlocks a `pool.max: 1`
  // configuration, because every step then asks for a second one.
  it("holds no connection open while the run executes", async () => {
    const h = createAdapter({ heldBy: null });
    let openDuringRun = 0;
    await withMigrationSession(
      { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
      async session => {
        await session.inTransaction(async () => {
          openDuringRun = h.peakOpen();
        });
      }
    );
    // One: the step's own transaction. Not two.
    expect(openDuringRun).toBe(1);
  });

  // Serialization of individual writes is not exclusion across a whole run, so
  // SQLite needs the same lock as the others rather than being skipped.
  it.each<MigrationDialect>(["postgresql", "mysql", "sqlite"])(
    "excludes a second run on %s",
    async dialect => {
      const h = createAdapter({ heldBy: null });
      await withMigrationSession(
        { adapter: h.adapter, dialect, label: "run-1" },
        async () => {
          const second = createAdapter({ heldBy: h.owner() });
          await expect(
            withMigrationSession(
              { adapter: second.adapter, dialect, label: "run-2" },
              async () => undefined
            )
          ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
        }
      );
    }
  );

  it("creates its lock table on every dialect", async () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const h = createAdapter({ heldBy: null });
      await withMigrationSession(
        { adapter: h.adapter, dialect, label: "run-1" },
        async () => undefined
      );
      expect(h.ddl.join("\n")).toContain(MIGRATION_LOCK_TABLE);
      expect(h.ddl.join("\n")).toContain("IF NOT EXISTS");
    }
  });

  it("seeds the lock row when the table is new", async () => {
    const h = createAdapter();
    await withMigrationSession(
      { adapter: h.adapter, dialect: "sqlite", label: "run-1" },
      async () => undefined
    );
    expect(h.ctx.insert).toHaveBeenCalled();
  });

  // Two processes seeding at once: the primary key decides, and the loser must
  // continue to contend rather than crash on the duplicate.
  it("tolerates losing the race to seed the row", async () => {
    const h = createAdapter();
    // The winner's row exists by the time our insert is rejected.
    h.ctx.insert.mockImplementationOnce(async (_t: string) => {
      await h.ctx.insert(MIGRATION_LOCK_TABLE, { id: 1, owner: null });
      throw new Error("duplicate key");
    });
    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => undefined
      )
    ).resolves.toBeUndefined();
  });

  it("refuses an empty owner rather than taking an unattributable lock", async () => {
    const h = createAdapter({ heldBy: null });
    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "" },
        async () => undefined
      )
    ).rejects.toThrowError(NextlyError);
    expect(h.ddl).toEqual([]);
  });

  // A run that already lost the lock must not free it on its way out: by then
  // the row belongs to whoever took it next, and clearing it would let a third
  // run start while that one is mid-migration.
  it("releases only a lock it still owns", async () => {
    const h = createAdapter({ heldBy: null });
    await withMigrationSession(
      { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
      async () => {
        // Someone else takes the row over while this run is in flight.
        h.takeOver("run-2");
      }
    );
    expect(h.owner()).toBe("run-2");
  });

  // A label is not an identity. Two processes resuming the same migration
  // would naturally pass the same one, and an occupied row that matched would
  // let both run while the first to finish released the claim under the second.
  it("refuses an occupied row even when the label is identical", async () => {
    const h = createAdapter({ heldBy: null });
    await withMigrationSession(
      { adapter: h.adapter, dialect: "postgresql", label: "resume" },
      async () => {
        const second = createAdapter({ heldBy: h.owner() });
        await expect(
          withMigrationSession(
            { adapter: second.adapter, dialect: "postgresql", label: "resume" },
            async () => undefined
          )
        ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      }
    );
  });

  it("claims under a token unique to the invocation, not the label", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      const h = createAdapter({ heldBy: null });
      await withMigrationSession(
        { adapter: h.adapter, dialect: "sqlite", label: "same" },
        async () => {
          seen.add(h.owner() ?? "");
        }
      );
    }
    expect(seen.size).toBe(2);
  });

  // A seed that fails for any reason other than losing the race leaves nothing
  // to lock. Claiming against an absent row updates nothing yet would still
  // look successful, running the migration with no exclusion at all.
  it("refuses to run when the lock row could not be established", async () => {
    const h = createAdapter();
    h.ctx.insert.mockImplementation(async () => {
      throw new Error("connection reset");
    });
    const ran = vi.fn();
    try {
      await withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => ran()
      );
      expect.fail("expected a refusal");
    } catch (error) {
      // Asserting the reason, not just the code: acquisition would refuse an
      // absent row too, so a generic assertion here cannot tell whether the
      // seed check did anything.
      expect((error as NextlyError).logContext?.reason).toMatch(
        /lock row could not be established/
      );
    }
    expect(ran).not.toHaveBeenCalled();
  });

  // A write that silently affects nothing must not read as a claim. Trusting
  // the update would run the migration believing it held a lock it never took.
  it("refuses when the claim does not actually land on the row", async () => {
    const h = createAdapter({ heldBy: null });
    // The claim write silently affects nothing, which is what a lost row or a
    // predicate that matched no rows looks like from the caller's side.
    h.ctx.runStatement.mockImplementation(async () => undefined);
    const ran = vi.fn();
    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => ran()
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(ran).not.toHaveBeenCalled();
  });

  // The mirror of the sync's recovery handler, and the reason it is opt-in: a
  // signal does not stop the work already in flight, so releasing a migration's
  // claim would free the row while it is still renaming tables and let a second
  // process resume the same run against a database the first is still writing.
  it("keeps a migration's claim held when the process is interrupted", async () => {
    const h = createAdapter({ heldBy: null });
    // Restored in `finally`: a failure before the restore would otherwise leave
    // the global mocked for every later test in the file.
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      let ownerAfterSignal: string | null = null;
      await withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => {
          process.emit("SIGINT");
          await new Promise(resolve => setImmediate(resolve));
          ownerAfterSignal = h.owner();
        }
      );

      // Still held while the run was in flight, and released only by the ordinary
      // exit path afterwards.
      expect(ownerAfterSignal).not.toBeNull();
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  // The promise `observe` makes is that nothing can write without the lock. A
  // comment cannot hold that: the callback is handed a session, and whoever adds
  // the next observing caller reads the type, not the prose.
  it("refuses to open a transaction in observe mode", async () => {
    const h = createAdapter({ heldBy: null });
    let refusal: unknown;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "preview-1",
        mode: "observe",
      },
      async session => {
        refusal = await session
          .inTransaction(async () => undefined)
          .catch((error: unknown) => error);
      }
    );

    expect(NextlyError.is(refusal)).toBe(true);
    // The lock is untouched by the attempt: refusing must not be a path that
    // half-claims and then fails.
    expect(h.owner()).toBeNull();
  });

  it("claims nothing and reports the holder in observe mode", async () => {
    const h = createAdapter({ heldBy: "someone-else" });
    let observed: string | null = null;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "preview-2",
        mode: "observe",
      },
      async session => {
        observed = session.observedLockOwner;
      }
    );

    // A claiming session refuses here; observing reports and leaves the row as
    // it found it.
    expect(observed).toBe("someone-else");
    expect(h.owner()).toBe("someone-else");
  });

  it("uses a lock table distinct from the schema pipeline's", () => {
    expect(MIGRATION_LOCK_TABLE).toBe("nextly_field_group_lock");
    expect(MIGRATION_LOCK_TABLE).not.toBe("nextly_migrate_lock");
    expect(getMigrationLockDdl("mysql")[0]).toContain("int PRIMARY KEY");
  });
});
