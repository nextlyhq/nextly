import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";

function deps(over: Record<string, unknown> = {}) {
  return {
    dialect: "postgresql" as const,
    // Answers the catalog probe the way a database with no field-group
    // registry does. Inert would let the resolution throw, and this orchestration
    // suite would then be asserting on an error from a collaborator rather than
    // on what `migrateCore` does with its steps.
    db: { execute: async () => ({ rows: [] }) },
    adapter: {} as never,
    migrationsDir: "/tmp/migrations",
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast" as const,
    reconcileCoreFn: vi.fn(async () => ({ changed: false })),
    runFileMigrationsFn: vi.fn(async () => 0),
    reconcileMetadataFn: vi.fn(async () => ({
      collectionsRegistered: 0,
      singlesRegistered: 0,
      marked: 0,
      stillPending: 0,
      unreadable: [],
    })),
    // Pass-through lock that just runs fn (so we test the core, not the lock),
    // in the real shape: the outcome is discriminated so a caller cannot
    // confuse "returned undefined" with "never ran".
    withLock: async (
      _db: unknown,
      _d: unknown,
      fn: () => Promise<unknown>
    ) => ({
      ran: true as const,
      value: await fn(),
    }),
    ...over,
  };
}

describe("migrateCore", () => {
  it("runs reconcile + file migrations, returns a result, never process.exit", async () => {
    const d = deps();
    const res = await migrateCore(d as never);
    expect(d.reconcileCoreFn).toHaveBeenCalledOnce();
    expect(d.runFileMigrationsFn).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ applied: 0, coreChanged: false });
  });

  /*
   * 🔴 Phase 3 runs UNCONDITIONALLY, including when no migration file applied.
   * A run that applies nothing can still have bookkeeping to do: the DDL landed
   * on a previous invocation and the row stayed `pending`, which is exactly the
   * production shape this phase exists for. Gating it on `applied > 0` would
   * make the stuck row unreachable by the command that repairs it.
   */
  it("records metadata even when no migration file applied", async () => {
    const d = deps({ runFileMigrationsFn: vi.fn(async () => 0) });
    const res = await migrateCore(d as never);

    expect(d.reconcileMetadataFn).toHaveBeenCalledOnce();
    expect(res.applied).toBe(0);
  });

  it("reports what the metadata pass did", async () => {
    const d = deps({
      reconcileMetadataFn: vi.fn(async () => ({
        collectionsRegistered: 2,
        singlesRegistered: 1,
        marked: 3,
        stillPending: 1,
        unreadable: [],
      })),
    });

    // Surfaced on the RESULT rather than only logged, so a caller can report
    // what happened instead of inferring it from `applied`, which counts files.
    expect((await migrateCore(d as never)).metadata).toEqual({
      collectionsRegistered: 2,
      singlesRegistered: 1,
      marked: 3,
      stillPending: 1,
      unreadable: [],
    });
  });

  /*
   * 🔴 The command SUCCEEDS when bookkeeping fails, and this is the assertion
   * that keeps it that way. By Phase 3 the DDL has already landed -- MySQL
   * commits DDL implicitly, so there is no transaction to roll back into --
   * and failing here would report a migration that worked as broken. The row
   * is repaired by the next invocation, because this phase runs every time.
   */
  it("does not fail the command when recording metadata throws", async () => {
    const d = deps({
      reconcileMetadataFn: vi.fn(async () => {
        throw new Error("registry unreachable");
      }),
      runFileMigrationsFn: vi.fn(async () => 4),
    });

    const res = await migrateCore(d as never);

    // The applied count is the load-bearing half: the files really did land,
    // and the caller must still be told so.
    expect(res.applied).toBe(4);

    // 🔴 And the failure is REPORTED, not returned as zeroes. Zero rows
    // repaired and zero rows readable are the same numbers and opposite facts:
    // without `unreadable`, a pass that could not look at anything is
    // indistinguishable from a database that needed nothing.
    expect(res.metadata.marked).toBe(0);
    expect(res.metadata.unreadable).toEqual([
      "collection",
      "single",
      "field group",
    ]);
  });

  it("runs the metadata pass INSIDE the lock", async () => {
    // Ordering is the correctness property: outside the lock, two migrates
    // could sweep the same rows while one of them is still creating tables.
    const order: string[] = [];
    const d = deps({
      runFileMigrationsFn: vi.fn(async () => {
        order.push("files");
        return 1;
      }),
      reconcileMetadataFn: vi.fn(async () => {
        order.push("metadata");
        return {
          collectionsRegistered: 0,
          singlesRegistered: 0,
          marked: 0,
          stillPending: 0,
          unreadable: [],
        };
      }),
      withLock: async (
        _db: unknown,
        _d: unknown,
        fn: () => Promise<unknown>
      ) => {
        order.push("lock:acquired");
        const value = await fn();
        order.push("lock:released");
        return { ran: true as const, value };
      },
    });

    await migrateCore(d as never);

    expect(order).toEqual([
      "lock:acquired",
      "files",
      "metadata",
      "lock:released",
    ]);
  });

  it("THROWS (does not exit) when file migrations reject", async () => {
    const d = deps({
      runFileMigrationsFn: vi.fn(async () => {
        throw new Error("apply failed");
      }),
    });
    await expect(migrateCore(d as never)).rejects.toThrow(/apply failed/);
  });
});
