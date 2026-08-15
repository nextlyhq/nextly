import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  getMigrationLockDdl,
  LOCK_RENEW_INTERVAL_MS,
  LOCK_RENEW_MARGIN_SECONDS,
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
  createLockStatementReader,
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
    onStatement?: (kind: LockStatementKind | undefined) => Promise<void> | void;
    /**
     * Thrown by the liveness read only, leaving every other statement working.
     *
     * Models a lock table created before `expires_at` existed: the row is there and can be seeded,
     * and only the query that selects that column fails. `lockReadError` is the blunter neighbour —
     * it fails every adapter-level read, which models a privilege problem rather than a shape one.
     */
    stateReadError?: unknown;
  } = {}
) {
  const clock = createLockClock();
  const lock = createLockRow(options.heldBy, {
    clock,
    expiresAt:
      options.expiresIn === undefined ? null : clock.now() + options.expiresIn,
  });
  const ddl: string[] = [];
  // Built once and handed to every seam below, so a schema fault this fixture models cannot be
  // present on one read path and absent from another.
  const readLock = createLockStatementReader(lock, options);
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
      readLock(statement);
      await options.onStatement?.(classifyLockStatement(statement));
    }),
    queryStatement: vi.fn(async (statement: SQL) => {
      const rows = readLock(statement);
      await options.onStatement?.(classifyLockStatement(statement));
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
      // table -- the case `tableExists` cannot distinguish from absence. Asked
      // before the reader because it denies the whole table rather than one
      // column, so nothing below it could answer either.
      if (options.lockReadError !== undefined) throw options.lockReadError;
      return readLock(statement);
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

  // MySQL's `NOW()` is the SESSION's local time and `expires_at` is a `DATETIME`, which stores no
  // zone. Two sessions configured with different `time_zone` therefore write and read the same
  // column on different scales: a holder in UTC writes an expiry a contender in UTC+05 reads as
  // hours in the past, takes the live claim, and both migrations run. Nothing about the row looks
  // wrong afterwards, which is what makes it worth pinning.
  it("uses a timezone-independent clock for MySQL leases", async () => {
    const h = createAdapter({ heldBy: null });
    await withMigrationSession(
      { adapter: h.adapter, dialect: "mysql", label: "run-1" },
      async () => undefined
    );

    const compiled = [
      ...h.ctx.runStatement.mock.calls,
      ...h.ctx.queryStatement.mock.calls,
    ].map(([statement]) => new PgDialect().sqlToQuery(statement as SQL).sql);

    // Positive control: the run has to have issued clock-bearing statements at all, or the loop
    // below iterates over nothing and passes by vacuity.
    const clockBearing = compiled.filter(text =>
      /UTC_TIMESTAMP\(\)|NOW\(\)/.test(text)
    );
    expect(clockBearing.length).toBeGreaterThan(0);

    for (const text of clockBearing) {
      expect(text).toContain("UTC_TIMESTAMP()");
      // Session-local `NOW()` must not survive anywhere in the statement. Stripping the UTC form
      // first is what stops this matching the tail of `UTC_TIMESTAMP()` itself.
      expect(text.replace(/UTC_TIMESTAMP\(\)/g, "")).not.toContain("NOW()");
    }
  });

  // `acquire` makes its decision INSIDE the transaction. Getting back out is a separate step that
  // can take arbitrarily long — the commit, the driver resolving, this process being scheduled
  // again — and none of it is visible to the checks made in there. The first elapsed-time check is
  // a whole interval away, so the callback would otherwise start on a lease that may have lapsed.
  it("refuses when acquisition itself outlasts the safety window", async () => {
    vi.useFakeTimers();
    try {
      let stalled = false;
      const h = createAdapter({
        heldBy: null,
        onStatement: kind => {
          if (kind === "claim" && !stalled) {
            stalled = true;
            // 🔴 Only the PROCESS clock moves. The model database clock stays put, so the row is
            // still comfortably usable when `acquire` judges it — which is what makes this test
            // about the post-acquisition age check rather than about the usable-lease check.
            vi.advanceTimersByTime(LOCK_LOSS_AFTER_MS + 1000);
          }
        },
      });

      const ran = vi.fn();
      await expect(
        withMigrationSession(
          { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
          async () => ran()
        )
      ).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        logContext: {
          reason:
            "migration lock claim aged past its safety window during acquisition",
        },
      });

      expect(ran).not.toHaveBeenCalled();
      expect(stalled).toBe(true);
      // Cleared, so a run that refused its own claim does not block contenders.
      expect(h.owner()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // "Not yet expired" is not "safe to start work on", and neither is "lasts past the next renewal".
  // The claim UPDATE and its read-back are two statements, and a process descheduled between them
  // comes back to a lease that is live, outlives the first renewal, and still cannot cover the
  // window in which this session will not ask again — so the row lapses mid-run and a contender
  // takes it while `fn` is still writing.
  it("refuses a claim whose lease cannot cover the loss window", async () => {
    // One second past the first renewal, and far short of the loss deadline. Chosen to sit in the
    // gap BETWEEN the two thresholds, which is the only region where this test can fail for the
    // reason it is about.
    const REMAINING = LOCK_RENEW_INTERVAL_MS / 1000 + 1;
    let paused = false;
    // 🔴 Captured AT the moment the claim is judged, not after the run. A refused acquisition now
    // clears its own row, so reading the lease afterwards observes the rollback rather than the
    // state the decision was made on — and the controls below would be asserting about the wrong
    // instant entirely.
    let remainingWhenJudged: number | null = null;
    const h = createAdapter({
      heldBy: null,
      onStatement: kind => {
        if (kind === "claim" && !paused) {
          paused = true;
          h.clock.advance(LOCK_TTL_SECONDS - REMAINING);
          remainingWhenJudged = (h.expiresAt() as number) - h.clock.now();
        }
      },
    });

    const ran = vi.fn();
    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => ran()
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    // The migration never started, which is the outcome that matters.
    expect(ran).not.toHaveBeenCalled();

    // 🔴 Three controls, each ruling out a WEAKER check that would also have gone green here. The
    // pause happened at all; the lease was still LIVE when judged, so a plain liveness test would
    // have accepted it; and it outlived the first renewal, so a one-interval margin would have
    // accepted it too. Without the third this test passes on the previous implementation and proves
    // nothing about the change it exists for.
    expect(paused).toBe(true);
    expect(remainingWhenJudged as unknown as number).toBeGreaterThan(0);
    expect(remainingWhenJudged as unknown as number).toBeGreaterThan(
      LOCK_RENEW_INTERVAL_MS / 1000
    );

    // 🔴 And the refusal must not leave OUR name on the row. The claim UPDATE has already committed
    // by this point, so a refusal that simply returned would block every contender for the residual
    // lease with nothing renewing it and no callback ever starting.
    expect(h.owner()).toBeNull();
    expect(h.expiresAt()).toBeNull();
  });

  // Being told you lost the lock AFTER the lease already expired is not a warning, it is a report:
  // by then a contender could have taken the row and started writing. The margin has to leave the
  // caller time to stop, so the loss is declared while the claim is still live.
  //
  // 🔴 This asserts the OBSERVABLE property — the row's expiry is still in the future on the
  // database's own clock at the moment the run is told — rather than comparing constants. A test
  // written in terms of `LOCK_LOSS_AFTER_MS` moves with the code when that constant changes and can
  // never fail: measured, widening the margin back to the full TTL left the whole suite green.
  it("declares the loss while the lease still has time on it", async () => {
    vi.useFakeTimers();
    try {
      const h = createAdapter({ heldBy: null });
      const realRunStatement = h.ctx.runStatement.getMockImplementation();
      h.ctx.runStatement.mockImplementation(async (statement: SQL) => {
        if (isRenewalStatement(statement)) throw new Error("connection reset");
        await realRunStatement?.(statement);
      });

      let expiryAtLoss: number | null = null;
      let nowAtLoss: number | null = null;
      const run = withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        // Never settles: the callback is still working when the claim is given up, which is the
        // whole situation the margin exists for.
        () => new Promise<void>(() => undefined)
      );

      // 🔴 The rejection handler is attached HERE, synchronously, and returns the error as a VALUE
      // rather than rethrowing. The loop below drives the timers for many turns before anything
      // awaits this, and a rejection that lands with no handler attached is an unhandled rejection:
      // vitest reports it as an error and EXITS 1 while still printing every test as passed. Awaiting
      // the assertion after the loop is what creates that gap, so the handler cannot wait for it.
      const settled = run.then(
        () => undefined,
        (error: unknown) => {
          expiryAtLoss = h.expiresAt();
          nowAtLoss = h.clock.now();
          return error;
        }
      );

      // 🔴 Let the claim land BEFORE the clock starts moving. Acquisition is asynchronous, so
      // without this it completes after the first step and writes its expiry from an
      // already-advanced clock — measured, that put the row 15s further ahead than the run really
      // held, which is exactly the slack that made this test pass on a broken margin.
      await vi.advanceTimersByTimeAsync(0);

      // The model database's clock is separate from the timers, so it is stepped WITH them —
      // otherwise the row never actually ages and its expiry means nothing.
      for (
        let elapsed = 0;
        elapsed < LOCK_TTL_SECONDS * 1000 && expiryAtLoss === null;
        elapsed += LOCK_RENEW_INTERVAL_MS
      ) {
        // 🔴 The database's clock moves FIRST. Advancing the timers first fires the tick that
        // declares the loss while the model row is still a step behind, so the expiry compared
        // below is read against a stale clock and looks live whatever the margin is — measured:
        // in that order this test passed even with the margin widened to the whole TTL.
        h.clock.advance(LOCK_RENEW_INTERVAL_MS / 1000);
        await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);
      }

      // `undefined` here would mean the run RESOLVED, which is its own failure and must not read as
      // a missing rejection.
      expect(await settled).toMatchObject({ code: "SERVICE_UNAVAILABLE" });

      // Positive control: the loss actually happened inside the loop above, so the comparison
      // below is reading values a rejection wrote rather than initialisers.
      expect(expiryAtLoss).not.toBeNull();
      expect(expiryAtLoss as unknown as number).toBeGreaterThan(
        nowAtLoss as unknown as number
      );
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

  // A lock table created by the previous release has two columns and no `expires_at`. The no-DDL
  // callers — `db:sync --no-auto-sync`, a role granted DML but not DDL — cannot add it, because the
  // upgrade ALTER runs only on the branch that may issue schema changes. Failing them would break
  // every such install that has not yet run a migration under the new release, for a lock that is
  // not even theirs: they are schema syncs, never the thing the exclusion holds back.
  it("skips a lock table that predates its expiry column, and says so", async () => {
    const warn = vi.fn();
    // The legacy shape: the row seeds fine and only the liveness read fails, exactly as a table
    // without `expires_at` behaves. 42703 is undefined_column.
    const h = createAdapter({
      heldBy: null,
      stateReadError: Object.assign(
        new Error('column "expires_at" does not exist'),
        { code: "42703" }
      ),
    });

    const observed: LockObservation[] = [];
    let ownerDuringWork: string | null = null;
    await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "sync-1",
        requireExistingLock: true,
        logger: { warn } as unknown as Parameters<
          typeof withMigrationSession
        >[0]["logger"],
      },
      async session => {
        observed.push(session.lock);
        ownerDuringWork = h.owner();
      }
    );

    // 🔴 The work RAN — a sync must not be blocked by a column its table happens to lack.
    expect(observed).toHaveLength(1);
    // 🔴 And it ran HOLDING the lock, by owner alone. Reporting `not-held` here was the earlier
    // behaviour and it meant the sync proceeded with no exclusion at all, so a migration starting
    // during it could rename tables underneath work that had already decided what exists.
    expect(observed[0]).toEqual({ kind: "held", owner: expect.any(String) });
    // The row actually named this claim while the callback ran — asserted on the DATABASE, because
    // the reported observation is this session's own claim about itself.
    expect(ownerDuringWork).toMatch(/^sync-1#/);
    // And it was cleared afterwards, so the next sync is not blocked by this one.
    expect(h.owner()).toBeNull();
    // Still reported: the operator needs to know this database is on the older shape, because the
    // claim it just took has no expiry and a killed process would leave it behind.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      reason: "migration lock table is missing expires_at",
    });
  });

  /**
   * 🔴 The property the owner-only claim exists to buy, and the one no assertion above can show.
   *
   * A test that only proves the claim is TAKEN passes just as well against a fallback that takes it
   * unconditionally — which would be worse than skipping, since it would overwrite a live
   * migration's claim. Exclusion means someone else's claim REFUSES this one.
   *
   * Refused rather than waited out, because without `expires_at` there is no basis on which to call
   * a holder dead: guessing would mean stealing the lock from a run that may still be writing.
   */
  it("refuses a legacy lock that another run already holds", async () => {
    const h = createAdapter({
      heldBy: "field-group-migration#other",
      stateReadError: Object.assign(
        new Error('column "expires_at" does not exist'),
        { code: "42703" }
      ),
    });
    const ran = vi.fn();

    const refusal = await withMigrationSession(
      {
        adapter: h.adapter,
        dialect: "postgresql",
        label: "sync-1",
        requireExistingLock: true,
      },
      async () => {
        ran();
      }
    ).catch((error: unknown) => error);

    expect(NextlyError.is(refusal)).toBe(true);
    if (NextlyError.is(refusal)) {
      // The REASON, not just the code: a lock this session could not READ and a lock another run
      // HOLDS are different situations with different remedies, and both surface as unavailable.
      expect(refusal.logContext?.reason).toBe(
        "migration lock is held elsewhere"
      );
      expect(refusal.logContext?.heldBy).toBe("field-group-migration#other");
    }
    // The work never ran, and the other run's claim is untouched.
    expect(ran).not.toHaveBeenCalled();
    expect(h.owner()).toBe("field-group-migration#other");
  });

  // A claim that outlived a failed callback would block every later sync on a table that cannot
  // expire it, so the release has to be in a `finally` rather than on the happy path.
  it("clears its legacy claim even when the work throws", async () => {
    const h = createAdapter({
      heldBy: null,
      stateReadError: Object.assign(
        new Error('column "expires_at" does not exist'),
        { code: "42703" }
      ),
    });

    await expect(
      withMigrationSession(
        {
          adapter: h.adapter,
          dialect: "postgresql",
          label: "sync-1",
          requireExistingLock: true,
        },
        async () => {
          throw new Error("sync failed");
        }
      )
    ).rejects.toThrowError();

    expect(h.owner()).toBeNull();
  });

  // A renewal already in flight when the callback finishes outlives `clearInterval`, which only
  // stops NEW attempts. That attempt is about to read the very row the release is clearing, and a
  // session that reads its own shutdown as a contender's takeover would fail a migration that held
  // its lock the whole way through and released it itself — a false alarm on the healthy path.
  //
  // 🔴 Asserted as ORDERING rather than as the failure. The fix makes the bad interleaving
  // impossible rather than merely unlikely, so no gate-based construction can exhibit it: any test
  // that makes the renewal wait for the release deadlocks against the fix itself, measured at a 10s
  // timeout. What IS observable either way is whether the release waits, so that is what this pins.
  it("settles an in-flight renewal before releasing the claim", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const h = createAdapter({
        heldBy: null,
        onStatement: async kind => {
          if (kind === undefined) return;
          order.push(kind);
          // Slow the renewal's READ-BACK specifically, so it is still outstanding when the callback
          // returns. Self-resolving, so nothing here can deadlock against the code under test.
          if (kind === "renew") {
            for (let turn = 0; turn < 20; turn++) await Promise.resolve();
          }
        },
      });

      const run = withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => {
          // Starts a renewal and returns without waiting for it.
          vi.advanceTimersByTime(LOCK_RENEW_INTERVAL_MS);
          return "migrated";
        }
      );

      await vi.advanceTimersByTimeAsync(0);
      await expect(run).resolves.toBe("migrated");

      // Positive control: the interleaving this is about actually occurred — a renewal was issued
      // and a release happened. Without it the ordering assertion below is vacuous.
      expect(order).toContain("renew");
      expect(order).toContain("release");

      // 🔴 The renewal's read-back completes BEFORE the row is cleared. Reversed, the renewal reads
      // an owner that is no longer this claim and reports the claim disproved.
      const lastStateRead = order.lastIndexOf("state");
      expect(lastStateRead).toBeLessThan(order.indexOf("release"));
      expect(h.owner()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // A renewal blocked on a connection that never comes back does not fail — it never answers at
  // all. Waiting for it without a bound leaves the caller neither resolved nor rejected, which is
  // worse than either outcome this session can report: a run that hangs holds its claim, blocks
  // every contender, and gives an operator nothing to act on.
  it("gives up on a renewal that never answers, rather than hanging the caller", async () => {
    vi.useFakeTimers();
    try {
      const h = createAdapter({
        heldBy: null,
        // The statement reaches the row and the answer never comes back — a driver that has stopped
        // responding, not one that reports a failure. Never rejects, so nothing here can be mistaken
        // for the already-covered error path.
        onStatement: kind =>
          kind === "renew" ? new Promise<never>(() => undefined) : undefined,
      });

      const run = withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => {
          // Starts a renewal and returns without waiting for it, so the shutdown below meets an
          // attempt that is still outstanding.
          vi.advanceTimersByTime(LOCK_RENEW_INTERVAL_MS);
          return "migrated";
        }
      );
      const settled = run.then(
        () => "resolved",
        (error: unknown) => error
      );

      // 🔴 The whole lease, because the wait is bounded by what remains of it. Without the bound
      // this advance settles nothing and the test times out, which is the caller's experience.
      await vi.advanceTimersByTimeAsync(LOCK_LOSS_AFTER_MS);

      expect(await settled).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        logContext: { reason: "migration lock was not held at completion" },
      });

      // 🔴 And the row was NOT cleared while that attempt is still outstanding. Releasing under a
      // stalled renewal is the failure the wait exists to prevent: the UPDATE lands afterwards and
      // re-extends a row nothing is watching any more.
      expect(h.owner()).toMatch(/^run-1#/);
    } finally {
      vi.useRealTimers();
    }
  });

  // Declaring the loss tells the CALLER it is unprotected. It does nothing about the callback,
  // which nothing here can stop and which is still writing — so giving up on renewal at that moment
  // guarantees the row lapses under work that never stopped. A loss declared because renewals could
  // not REACH the database says nothing about who owns the row, and the UPDATE is owner-scoped, so
  // continuing to try can only ever re-protect work in flight or no-op against a real takeover.
  it("keeps renewing a lost claim while the work is still running", async () => {
    vi.useFakeTimers();
    try {
      const h = createAdapter({ heldBy: null });
      const realRunStatement = h.ctx.runStatement.getMockImplementation();
      let renewalsFail = true;
      h.ctx.runStatement.mockImplementation(async (statement: SQL) => {
        if (renewalsFail && isRenewalStatement(statement)) {
          throw new Error("connection reset");
        }
        await realRunStatement?.(statement);
      });

      let finishWork: (() => void) | undefined;
      const working = new Promise<void>(resolve => {
        finishWork = resolve;
      });

      const run = withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        () => working
      );
      const settled = run.then(
        () => undefined,
        (error: unknown) => error
      );

      await vi.advanceTimersByTimeAsync(LOCK_LOSS_AFTER_MS);
      expect(await settled).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      const expiryAtLoss = h.expiresAt() as number;

      // The database comes back while the callback is still writing. The clock moves so a fresh
      // lease is distinguishable from the one already in the row.
      renewalsFail = false;
      h.clock.advance(1);
      await vi.advanceTimersByTimeAsync(LOCK_RENEW_INTERVAL_MS);

      // 🔴 The lease was RE-EXTENDED over work that never stopped — the property this exists for.
      // Asserted as a MOVEMENT rather than "not null", which the pre-existing expiry satisfies.
      expect(h.owner()).toMatch(/^run-1#/);
      expect(h.expiresAt() as number).toBeGreaterThan(expiryAtLoss);

      // And it still stops once the work does, rather than renewing an abandoned row forever.
      finishWork?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.owner()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 🔴 THE case a renewal makes worse if the exit path is naive, in BOTH directions. A renewal that
  // failed on a blip leaves the row still owned by this claim, so an owner-scoped release matches
  // and frees it — while `fn`, which nothing here can stop, carries on rewriting tables. Freeing it
  // there hands the next contender a database this run is still writing to. But leaving it alone
  // forever is the opposite failure: a renewal that was blocked when the claim was abandoned still
  // runs its UPDATE when the connection frees up, re-extending the row by a whole TTL with nobody
  // renewing it afterwards — a live claim owned by a process that gave up.
  //
  // The row is therefore held for exactly as long as the work runs, and cleared once it stops.
  it("holds a lost claim while the work runs, then clears it", async () => {
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

      // The callback stays pending until this test says otherwise, which is what lets the two
      // halves below be observed as separate moments rather than inferred from one.
      let finishWork: (() => void) | undefined;
      const working = new Promise<void>(resolve => {
        finishWork = resolve;
      });

      const run = withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        () => working
      );
      // Attached before the timers move: the rejection lands during the advance below, and with no
      // handler yet in place it would be an unhandled rejection that exits the suite non-zero.
      const settled = run.then(
        () => undefined,
        (error: unknown) => error
      );

      await vi.advanceTimersByTimeAsync(LOCK_LOSS_AFTER_MS);
      expect(await settled).toMatchObject({ code: "SERVICE_UNAVAILABLE" });

      // Half one: the caller has been told, and the row is STILL OURS, because the callback it
      // protects has not stopped. Handing it over here is the outcome the lock exists to prevent.
      expect(h.owner()).toMatch(/^run-1#/);
      expect(h.expiresAt()).not.toBeNull();

      // Half two: once the work actually stops, the claim is cleared rather than left to sit as a
      // phantom holder that later runs cannot distinguish from a healthy one.
      finishWork?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.owner()).toBeNull();
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
