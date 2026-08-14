import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  getMigrationLockDdl,
  LOCK_RENEW_INTERVAL_MS,
  LOCK_LOSS_AFTER_MS,
  LOCK_TTL_SECONDS,
  MIGRATION_LOCK_TABLE,
  observeMigrationLock,
  withMigrationSession,
  type LockObservation,
  type MigrationDialect,
} from "../session";
import {
  classifyLockStatement,
  createLockClock,
  createLockRow,
  interpretLockStatement,
  isRenewalStatement,
  type LockStatementKind,
} from "./helpers/migration-lock-double";

/**
 * A single-row lock table backed by an object, plus the two behaviours of the
 * real adapters that a naive double would omit and that hid a defect once:
 *
 * - every error escaping a transaction callback is reclassified, so a domain
 *   error thrown inside one does NOT come back out intact;
 * - each `transaction()` call takes a connection, so a fake that never counts
 *   them cannot show that the lock stops holding one.
 *
 * The lock's own semantics come from {@link interpretLockStatement}, shared with the other suites
 * that drive this module. Statements reach it compiled through a real `PgDialect`, so the double
 * exercises the SQL and the bound parameters an adapter would actually hand its driver — which is
 * what this module needs, having once passed its tests while being unable to run at all because the
 * typed CRUD path resolves a table through a registry that never declared this one.
 */
function createAdapter(
  options: {
    heldBy?: string | null;
    lockReadError?: unknown;
    /** Model a database on which no migration has ever run, so the lock table is absent. */
    lockTableMissing?: boolean;
    /**
     * Seconds from now until the seeded claim lapses; negative for one that already has.
     *
     * Absent leaves the expiry NULL, which is the row a release before this column existed left
     * behind and which the session reads as live.
     */
    expiresIn?: number;
    /**
     * Called as each transaction opens, with its 1-based sequence number.
     *
     * Awaited before the body runs, so returning a pending promise HOLDS that transaction open.
     * That is the only way to place one transaction's completion at a chosen point relative to
     * another's, which several properties here are ABOUT: a renewal and the work it protects are
     * concurrent by construction, and asserting what happens when they interleave a particular way
     * needs the interleaving to be chosen rather than hoped for.
     *
     * Throwing models a transaction that could not reach the database at all. The wrapper below
     * rewraps it exactly as a real adapter does, so a caller sees the same opaque failure it would
     * see in production rather than the error the test wrote.
     */
    onTransaction?: (seq: number) => Promise<void> | void;
    /**
     * Called after each lock statement is interpreted, with what that statement WAS.
     *
     * The renewal writes an expiry and reads it back inside ONE transaction, so a test modelling
     * time passing between those two — a process suspended or descheduled mid-transaction — has
     * nowhere else to stand: every other lever moves the clock between transactions, which is a
     * different question. Classified through {@link classifyLockStatement} rather than a regex of
     * this suite's own, so the double cannot disagree with itself about which statement is which.
     */
    onStatement?: (kind: LockStatementKind | undefined) => void;
  } = {}
) {
  const clock = createLockClock();
  const lock = createLockRow(options.heldBy, {
    clock,
    expiresAt:
      options.expiresIn === undefined ? null : clock.now() + options.expiresIn,
  });
  const ddl: string[] = [];
  let open = 0;
  let peakOpen = 0;
  let transactions = 0;

  const ctx = {
    lockRow: vi.fn(async () => undefined),
    insert: vi.fn(async (_t: string, data: Record<string, unknown>) => {
      if (lock.seeded) throw new Error("duplicate key");
      lock.seeded = true;
      lock.owner = (data.owner as string | null) ?? null;
      lock.expiresAt = null;
      return data;
    }),
    runStatement: vi.fn(async (statement: SQL) => {
      interpretLockStatement(lock, statement);
      options.onStatement?.(classifyLockStatement(statement));
    }),
    queryStatement: vi.fn(async (statement: SQL) => {
      const rows = interpretLockStatement(lock, statement);
      options.onStatement?.(classifyLockStatement(statement));
      return rows;
    }),
  };

  const adapter = {
    executeQuery: vi.fn(async (sql: string) => {
      ddl.push(sql);
      return [];
    }),
    // The seed read runs outside any transaction, so it goes through the
    // adapter rather than the transaction context.
    queryStatement: vi.fn(async (statement: SQL) => {
      // Models a role that may read the marker and registry but not the lock
      // table -- the case `tableExists` cannot distinguish from absence.
      if (options.lockReadError !== undefined) throw options.lockReadError;
      return interpretLockStatement(lock, statement);
    }),
    tableExists: vi.fn(async () => options.lockTableMissing !== true),
    transaction: vi.fn(async (work: (c: unknown) => Promise<unknown>) => {
      open += 1;
      peakOpen = Math.max(peakOpen, open);
      transactions += 1;
      const seq = transactions;
      try {
        await options.onTransaction?.(seq);
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
    clock,
    owner: () => lock.owner,
    expiresAt: () => lock.expiresAt,
    /** Model another process claiming the row mid-run. */
    takeOver: (owner: string | null) => {
      if (lock.seeded) lock.owner = owner;
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
  it("releases only a lock it still owns, and refuses to call that a success", async () => {
    const h = createAdapter({ heldBy: null });
    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => {
          // Someone else takes the row over while this run is in flight.
          h.takeOver("run-2");
        }
      )
      // 🔴 The callback COMPLETED, and the run still fails. Completing is not the same as having
      // been protected while completing: this run was writing with no exclusion from the moment the
      // row moved, which is the outcome the lock exists to prevent, so returning the callback's
      // value would hand back a result the lock never covered.
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    // And the release still leaves the contender's claim alone, which is the other half.
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
    let observed: LockObservation | undefined;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "preview-2",
        mode: "observe",
      },
      async session => {
        observed = session.lock;
      }
    );

    // A claiming session refuses here; observing reports and leaves the row as
    // it found it.
    expect(observed).toEqual({ kind: "held", owner: "someone-else" });
    expect(h.owner()).toBe("someone-else");
  });

  // 🔴 THE separating case for the three-state observation. A role that cannot
  // READ the lock table is not a database where nothing holds the lock, and the
  // two were previously indistinguishable: `tableExists` resolves through
  // privilege-filtered `information_schema`, so an invisible table came back
  // absent and the preview reported "nothing holds it" while a run held it.
  it("reports unknown when the lock cannot be read", async () => {
    const denied = Object.assign(new Error("permission denied for table"), {
      code: "42501",
    });
    const h = createAdapter({ heldBy: "someone-else", lockReadError: denied });
    let observed: LockObservation | undefined;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "preview-3",
        mode: "observe",
      },
      async session => {
        observed = session.lock;
      }
    );

    expect(observed).toEqual({ kind: "unknown", reason: "42501" });
    // And emphatically NOT the answer a caller would act on.
    expect(observed).not.toEqual({ kind: "not-held" });
  });

  // The counterpart, and the reason `unknown` is not simply "any failure": an
  // absent table IS a complete answer, because the lock is created by the first
  // run that ever claims it.
  it("reports not-held when the lock table does not exist", async () => {
    const missing = Object.assign(new Error('relation "x" does not exist'), {
      code: "42P01",
    });
    const h = createAdapter({ heldBy: null, lockReadError: missing });
    let observed: LockObservation | undefined;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "preview-4",
        mode: "observe",
      },
      async session => {
        observed = session.lock;
      }
    );

    expect(observed).toEqual({ kind: "not-held" });
  });

  // The shape a FRESH database actually produces. Drizzle wraps the driver
  // failure, so the discriminating text is on `cause` while the outer message is
  // only `Failed query` — reading the top level classifies every untouched
  // database as unreadable, which is the opposite of the truth.
  it("sees through Drizzle's wrapper on a fresh sqlite database", async () => {
    const wrapped = Object.assign(new Error("Failed query"), {
      code: "SQLITE_ERROR",
      cause: new Error("SQLITE_ERROR: no such table: nextly_field_group_lock"),
    });
    const h = createAdapter({ heldBy: null, lockReadError: wrapped });
    let observed: LockObservation | undefined;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "sqlite",
        label: "preview-5",
        mode: "observe",
      },
      async session => {
        observed = session.lock;
      }
    );

    expect(observed).toEqual({ kind: "not-held" });
  });

  // mysql2 supplies the SYMBOLIC code alongside the errno, and `safeCode`
  // prefers the symbolic one — so a check written only against 1146 or 42S02
  // never matches the value it is actually handed.
  it("accepts mysql's symbolic missing-table code", async () => {
    const missing = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("Table does not exist"), {
        code: "ER_NO_SUCH_TABLE",
        errno: 1146,
        sqlState: "42S02",
      }),
    });
    const h = createAdapter({ heldBy: null, lockReadError: missing });
    let observed: LockObservation | undefined;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "mysql",
        label: "preview-6",
        mode: "observe",
      },
      async session => {
        observed = session.lock;
      }
    );

    expect(observed).toEqual({ kind: "not-held" });
  });

  // 🔴 `requireExistingLock` deliberately runs the work WITHOUT a lock when no migration has ever
  // touched this database, so there is nothing to be excluded from. The session it hands over must
  // say so: the default observation names a claim string this branch generated and never wrote
  // anywhere, so advertising it would report exclusion on the one path that takes none.
  it("reports not-held when it deliberately skips the lock", async () => {
    const h = createAdapter({ lockTableMissing: true });
    let observed: LockObservation | undefined;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "optional-lock",
        requireExistingLock: true,
      },
      async session => {
        observed = session.lock;
      }
    );

    expect(observed).toEqual({ kind: "not-held" });
  });

  // 🔴 The claim carries an expiry, and this is the positive control for every test below it: if
  // the claim stopped writing one, the column would be NULL, every liveness assertion would read
  // "never expires", and a lock that can no longer be taken over would pass as one that renews.
  it("writes an expiry with the claim", async () => {
    const h = createAdapter({ heldBy: null });
    let expiryDuringRun: number | null = null;
    await withMigrationSession(
      { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
      async () => {
        expiryDuringRun = h.expiresAt();
      }
    );
    expect(expiryDuringRun).toBe(h.clock.now() + LOCK_TTL_SECONDS);
    // And the release takes it away again, so a freed row cannot read as a lapsed claim.
    expect(h.expiresAt()).toBeNull();
  });

  // A run that died holding the row stopped renewing, so its expiry passing is an OBSERVATION that
  // it stopped rather than a guess about how long a migration should take. Before this, the only
  // remedy was an operator clearing the row by hand.
  it("takes over a claim whose expiry has passed", async () => {
    const h = createAdapter({ heldBy: "dead-run", expiresIn: -1 });
    let ownerDuringRun: string | null = null;

    await withMigrationSession(
      { adapter: h.adapter, dialect: "postgresql", label: "run-2" },
      async () => {
        ownerDuringRun = h.owner();
      }
    );

    expect(ownerDuringRun).toMatch(/^run-2#/);
  });

  // 🔴 The deliberate asymmetry. A NULL expiry is the row a release before this column existed left
  // behind, and the process that wrote it may still be running: stealing the lock from a live
  // migration is unrecoverable, while refusing until an operator clears a stale row is merely
  // inconvenient. So age alone never makes that row claimable.
  it("refuses a claim with no expiry however much time has passed", async () => {
    const h = createAdapter({ heldBy: "pre-expiry-run" });
    h.clock.advance(LOCK_TTL_SECONDS * 1000);
    const ran = vi.fn();

    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-2" },
        async () => ran()
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(ran).not.toHaveBeenCalled();
    expect(h.owner()).toBe("pre-expiry-run");
  });

  // The observation and the acquisition answer the same question, so they must not be able to
  // disagree: naming a dead claim's owner would report contention that no contender would meet, and
  // the dry-run outcome carrying it would explain a torn read with a run that had already stopped.
  it("observes a lapsed claim as not-held, exactly as a contender would find it", async () => {
    const h = createAdapter({ heldBy: "dead-run", expiresIn: -1 });
    let observed: LockObservation | undefined;

    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "preview-7",
        mode: "observe",
      },
      async session => {
        observed = session.lock;
      }
    );

    expect(observed).toEqual({ kind: "not-held" });
  });

  // 🔴 What makes the short TTL safe. Without the renewal a migration outliving its TTL would have
  // the row taken from underneath it and two runs would rename the same objects — strictly worse
  // than the refuse-always behaviour this replaces.
  it("keeps its claim live through a run that outlasts the ttl", async () => {
    vi.useFakeTimers();
    try {
      const h = createAdapter({ heldBy: null });
      let observedMidRun: LockObservation | undefined;

      await withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "long-run" },
        async () => {
          // Twice the TTL passes on the database's clock, with the renewal firing as it would in a
          // migration that genuinely takes this long.
          const step = LOCK_RENEW_INTERVAL_MS / 1000;
          for (
            let elapsed = 0;
            elapsed < LOCK_TTL_SECONDS * 2;
            elapsed += step
          ) {
            h.clock.advance(step);
            await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);
          }
          // Read through the production observation rather than the model's field: this is the
          // answer a second run would get, which is the property that matters.
          observedMidRun = await observeMigrationLock(h.adapter, "postgresql");
        }
      );

      expect(observedMidRun).toMatchObject({ kind: "held" });
    } finally {
      vi.useRealTimers();
    }
  });

  // A renewal that comes back saying the row names someone else means the work in flight is no
  // longer protected. The run fails loudly rather than finishing against a database another run may
  // already be rewriting.
  it("fails the run when its claim was taken over", async () => {
    vi.useFakeTimers();
    try {
      const h = createAdapter({ heldBy: null });
      const reachedTheEnd = vi.fn();

      const run = withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => {
          h.takeOver("someone-else");
          await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);
          reachedTheEnd();
        }
      );

      await expect(run).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

      // 🔴 The caller sees the refusal while the work is STILL RUNNING — `reachedTheEnd` has not
      // been reached at the moment the rejection lands, and runs to completion afterwards anyway.
      // Asserted in both directions rather than left implicit, because it is the documented limit
      // of this mechanism: JavaScript has no preemption, so losing the claim stops the run being
      // WAITED on and cannot stop what it had already started. A reader who assumed cancellation
      // would be building on a guarantee that is not here.
      expect(reachedTheEnd).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(0);
      expect(reachedTheEnd).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // A renewal writes an expiry and reads it back in ONE transaction, and the gap between those two
  // statements is not zero: a suspended or descheduled process can spend longer there than the whole
  // TTL. The row then still NAMES this claim while the lease it just wrote is already in the past,
  // so ownership alone reports a successful renewal on a lock a contender may take the instant the
  // transaction commits — and the callback carries on believing it is protected.
  it("treats a renewal whose lease expired mid-transaction as lost", async () => {
    vi.useFakeTimers();
    try {
      let suspended = false;
      const h = createAdapter({
        heldBy: null,
        onStatement: kind => {
          // 🔴 Once, and only after the renewal's UPDATE — so the readback that follows it inside
          // the SAME transaction is the statement that sees the advanced clock. Advancing anywhere
          // else models time passing BETWEEN transactions, which the other tests already cover and
          // which this property is not about.
          if (kind === "renew" && !suspended) {
            suspended = true;
            h.clock.advance(LOCK_TTL_SECONDS + 1);
          }
        },
      });

      const run = withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => {
          await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);
        }
      );

      await expect(run).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        logContext: { reason: "migration lock claim lapsed or was taken over" },
      });

      // 🔴 Positive controls separating this from the takeover case, which a different guard
      // already covers. The row still names this run — nobody took it — and the hook did fire, so
      // the green above cannot be a renewal that was never reached.
      expect(h.owner()).toMatch(/^run-1#/);
      expect(suspended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // `setInterval` fires on a schedule, not on completion, so a renewal slower than the interval
  // would have a second started underneath it and then a third. Two costs, and the second is the
  // one that bites: attempts pile up against the connection pool — with `pool.max: 1` each new one
  // queues behind the last and makes it later still — and their completions arrive out of order,
  // so any judgement made from the ORDER of results is judging something else.
  it("never starts a second renewal while one is in flight", async () => {
    vi.useFakeTimers();
    try {
      let started = 0;
      let startedWhileHung = 0;
      let ungate: (() => void) | undefined;
      const hung = new Promise<void>(resolve => {
        ungate = resolve;
      });

      const h = createAdapter({
        heldBy: null,
        onTransaction: async seq => {
          // Sequence 1 is the acquisition and must complete, or nothing holds the lock at all.
          if (seq === 1) return;
          started += 1;
          await hung;
        },
      });

      await expect(
        withMigrationSession(
          { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
          async () => {
            // Several intervals, all inside the margin, so nothing here is a loss — the only
            // question is how many attempts were STARTED while the first had not come back.
            await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS * 4);
            startedWhileHung = started;
            ungate?.();
          }
        )
      ).resolves.toBeUndefined();

      // 🔴 Read INSIDE the run, before the release opens its own transaction — otherwise this
      // counts the release too and the number stops meaning what it says.
      expect(startedWhileHung).toBe(1);
      expect(h.owner()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // A renewal that fails is not proof the claim is gone, but it is proof it is no longer being
  // maintained — and the next attempt may not arrive before the TTL. The safe error is stopping a
  // run that still holds the lock, not continuing one that does not.
  it("fails the run when a renewal cannot be made at all", async () => {
    vi.useFakeTimers();
    try {
      const h = createAdapter({ heldBy: null });
      const realRunStatement = h.ctx.runStatement.getMockImplementation();
      h.ctx.runStatement.mockImplementation(async (statement: SQL) => {
        // Only the renewal fails. Failing every write for a window would also break the claim or
        // the release, and the run would then abort for a reason that has nothing to do with this.
        if (isRenewalStatement(statement)) {
          throw new Error("connection reset");
        }
        await realRunStatement?.(statement);
      });

      await expect(
        withMigrationSession(
          { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
          async () => {
            // The whole margin, because one failure is deliberately survivable.
            await vi.advanceTimersByTimeAsync(LOCK_LOSS_AFTER_MS);
          }
        )
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    } finally {
      vi.useRealTimers();
    }
  });

  // 🔴 THE case a renewal makes worse if the exit path is naive. A renewal that fails on a blip
  // leaves the row STILL OWNED by this claim, so an owner-scoped release matches and frees it —
  // while `fn`, which nothing here can stop, carries on rewriting tables. The next contender would
  // then start against a database this run is still writing to, which is worse than never having
  // renewed at all. The claim is left to lapse instead.
  it("does not free a row it still owns after losing the claim", async () => {
    vi.useFakeTimers();
    try {
      const h = createAdapter({ heldBy: null });
      const realRunStatement = h.ctx.runStatement.getMockImplementation();
      h.ctx.runStatement.mockImplementation(async (statement: SQL) => {
        if (isRenewalStatement(statement)) {
          throw new Error("connection reset");
        }
        await realRunStatement?.(statement);
      });

      const run = withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => {
          await vi.advanceTimersByTimeAsync(LOCK_LOSS_AFTER_MS);
        }
      );
      await expect(run).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      await vi.advanceTimersByTimeAsync(0);

      // Still claimed by this run, because the work it protects has not stopped. Left to expire on
      // its own rather than handed over while that work is in flight.
      expect(h.owner()).toMatch(/^run-1#/);
      expect(h.expiresAt()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 🔴 The margin the TTL exists to buy, actually spent. The interval is a quarter of the TTL so
  // that several attempts can fail before a claim lapses; treating the FIRST error as fatal threw
  // that away and let a brief connection reset abort a healthy, half-finished migration.
  it("survives renewal failures short of the margin", async () => {
    vi.useFakeTimers();
    try {
      const h = createAdapter({ heldBy: null });
      const realRunStatement = h.ctx.runStatement.getMockImplementation();
      // Ticks fire every interval, and the one AT the margin declares loss instead of attempting —
      // so this many attempts actually reach the database before the session gives up. Derived from
      // the constants rather than written as a number, so retuning either keeps this a blip instead
      // of silently turning it into a loss.
      const ATTEMPTS_BEFORE_LOSS =
        Math.floor(LOCK_LOSS_AFTER_MS / LOCK_RENEW_INTERVAL_MS) - 1;
      let failures = 0;
      h.ctx.runStatement.mockImplementation(async (statement: SQL) => {
        if (
          isRenewalStatement(statement) &&
          failures < ATTEMPTS_BEFORE_LOSS - 1
        ) {
          failures += 1;
          throw new Error("connection reset");
        }
        await realRunStatement?.(statement);
      });

      await expect(
        withMigrationSession(
          { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
          async () => {
            // Past the margin, so a run that had NOT recovered would have been declared lost.
            await vi.advanceTimersByTimeAsync(
              LOCK_LOSS_AFTER_MS + LOCK_RENEW_INTERVAL_MS
            );
          }
        )
      ).resolves.toBeUndefined();

      // 🔴 The blip has to have actually happened, or this passes on a run that never failed a
      // renewal at all — the assertion that would be satisfied by absence.
      expect(failures).toBe(ATTEMPTS_BEFORE_LOSS - 1);
      // Released normally, because the claim was never lost.
      expect(h.owner()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 🔴 `CREATE TABLE IF NOT EXISTS` is a no-op against a table that already exists, so an install
  // holding the two-column lock row never gains `expires_at` and every liveness read then names a
  // missing column. The upgrade path deadlocks on its own repair: this lock is taken BEFORE the
  // schema sync that would reconcile the column.
  it.each<MigrationDialect>(["postgresql", "mysql", "sqlite"])(
    "adds the expiry column to a pre-existing lock table on %s",
    async dialect => {
      const h = createAdapter({ heldBy: null });
      await withMigrationSession(
        { adapter: h.adapter, dialect, label: "run-1" },
        async () => undefined
      );
      const altered = h.ddl.filter(s => /ALTER TABLE/i.test(s));
      expect(altered).toHaveLength(1);
      expect(altered[0]).toContain("expires_at");
    }
  );

  // The upgrade runs unconditionally, so the SECOND run always meets a column that is already
  // there. Tolerating that by CODE is what makes the statement safe to issue every time — and a
  // failure that is NOT a duplicate must still surface, or a genuinely broken ALTER would be
  // swallowed and every later read would fail on the missing column.
  it("tolerates the expiry column already existing, but not other failures", async () => {
    const duplicate = createAdapter({ heldBy: null });
    duplicate.adapter.executeQuery = vi.fn(async (sql: string) => {
      if (/ALTER TABLE/i.test(sql))
        throw new Error("duplicate column name: expires_at");
      return [];
    }) as unknown as typeof duplicate.adapter.executeQuery;
    await expect(
      withMigrationSession(
        { adapter: duplicate.adapter, dialect: "sqlite", label: "run-1" },
        async () => undefined
      )
    ).resolves.toBeUndefined();

    const denied = createAdapter({ heldBy: null });
    denied.adapter.executeQuery = vi.fn(async (sql: string) => {
      if (/ALTER TABLE/i.test(sql))
        throw new Error("permission denied for table");
      return [];
    }) as unknown as typeof denied.adapter.executeQuery;
    await expect(
      withMigrationSession(
        { adapter: denied.adapter, dialect: "sqlite", label: "run-1" },
        async () => undefined
      )
    ).rejects.toThrowError(/permission denied/);
  });

  it("uses a lock table distinct from the schema pipeline's", () => {
    expect(MIGRATION_LOCK_TABLE).toBe("nextly_field_group_lock");
    expect(MIGRATION_LOCK_TABLE).not.toBe("nextly_migrate_lock");
    expect(getMigrationLockDdl("mysql")[0]).toContain("int PRIMARY KEY");
  });
});
