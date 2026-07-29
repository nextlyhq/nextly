import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  getMigrationLockDdl,
  MIGRATION_LOCK_TABLE,
  withMigrationSession,
  type MigrationDialect,
} from "../session";

type Where = {
  and?: { column: string; op: string; value: unknown }[];
};

/** Reads the structured predicate the adapter API uses back into plain fields. */
function readWhere(where?: Where): { id?: number; owner?: string | null } {
  const out: { id?: number; owner?: string | null } = {};
  for (const c of where?.and ?? []) {
    if (c.column === "id") out.id = c.value as number;
    if (c.column === "owner") out.owner = c.value as string | null;
  }
  return out;
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
    selectOne: vi.fn(async (_t: string, o?: { where?: Where }) => {
      const row = rows.get(readWhere(o?.where).id ?? 1);
      return row ? { ...row } : null;
    }),
    insert: vi.fn(async (_t: string, data: Record<string, unknown>) => {
      const id = data.id as number;
      if (rows.has(id)) throw new Error("duplicate key");
      rows.set(id, { id, owner: (data.owner as string | null) ?? null });
      return data;
    }),
    update: vi.fn(
      async (_t: string, data: Record<string, unknown>, where: Where) => {
        const cond = readWhere(where);
        const row = rows.get(cond.id ?? 1);
        if (!row) return [];
        // A `where` naming an owner must not match a row held by someone else.
        if (cond.owner !== undefined && row.owner !== cond.owner) return [];
        row.owner = (data.owner as string | null) ?? null;
        return [row];
      }
    ),
  };

  const adapter = {
    executeQuery: vi.fn(async (sql: string) => {
      ddl.push(sql);
      return [];
    }),
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
        h.ctx.update(
          MIGRATION_LOCK_TABLE,
          { owner: "run-2" },
          { and: [{ column: "id", op: "=", value: 1 }] }
        );
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
    h.ctx.update.mockImplementation(async () => []);
    const ran = vi.fn();
    await expect(
      withMigrationSession(
        { adapter: h.adapter, dialect: "postgresql", label: "run-1" },
        async () => ran()
      )
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(ran).not.toHaveBeenCalled();
  });

  it("uses a lock table distinct from the schema pipeline's", () => {
    expect(MIGRATION_LOCK_TABLE).toBe("nextly_field_group_lock");
    expect(MIGRATION_LOCK_TABLE).not.toBe("nextly_migrate_lock");
    expect(getMigrationLockDdl("mysql")[0]).toContain("int PRIMARY KEY");
  });
});
