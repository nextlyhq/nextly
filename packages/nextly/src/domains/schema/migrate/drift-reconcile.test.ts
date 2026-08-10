/**
 * @module domains/schema/migrate/drift-reconcile.test
 * @since v0.0.3-alpha (Plan C2)
 */
import { describe, it, expect, vi } from "vitest";

import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { reconcileFile, type ReconcileRepo } from "./drift-reconcile";

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
  superseded: Array<{ supersededEventIds: string[]; byEventId: string }>;
};

/**
 * Typed as `ReconcileRepo` rather than cast away, so a method added to the
 * interface fails to compile here instead of being discovered at runtime by
 * whichever test happens to reach it.
 */
function fakeRepo(priorAttempts: readonly unknown[] = []): FakeRepo {
  const state = {
    starts: 0,
    applied: [] as Array<{ statementsExecuted?: number | null }>,
    superseded: [] as Array<{
      supersededEventIds: string[];
      byEventId: string;
    }>,
  };
  return {
    ...state,
    recordStart: () => {
      state.starts++;
      return Promise.resolve(`evt-${state.starts}`);
    },
    markApplied: (_id, args) => {
      state.applied.push(args);
      return Promise.resolve(true);
    },
    markFailed: () => Promise.resolve(),
    supersede: args => {
      state.superseded.push(args);
      return Promise.resolve();
    },
    findFileApplies: () => Promise.resolve(priorAttempts),
  };
}

const file = {
  filename: "0006_x.sql",
  sql: "CREATE TABLE b (id text);",
  path: "m/0006_x.sql",
};

describe("reconcileFile (Phase 2 three-state)", () => {
  it("IN_SYNC: live ≡ before → runs the SQL and records file_apply", async () => {
    const repo = fakeRepo();
    const executeSql = vi.fn().mockResolvedValue(1);
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

  it("ALREADY_APPLIED: live ≡ target → skips SQL, records statements=0, supersedes", async () => {
    const repo = fakeRepo();
    const executeSql = vi.fn();
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
    expect(executeSql).not.toHaveBeenCalled();
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
        executeSql: vi.fn(),
      })
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });
  });

  it("does not offer the baseline recovery when the file already failed once", async () => {
    // Schema alone cannot tell a retried failed migration from a database
    // nobody has adopted: MySQL commits each DDL statement as it runs, so a
    // first migration that failed partway leaves its tables and the retry sees
    // an empty baseline against tables that already exist. The ledger is the
    // difference, and sending this operator to `migrate:baseline` would send
    // them past the failed-cleanup path they need.
    const withAttempt = fakeRepo([{ status: "failed" }]);
    await expect(
      reconcileFile({
        file,
        before: snap(),
        target: snap("a", "b"),
        live: snap("a"), // matches neither: every difference is a `+`
        repo: withAttempt,
        executeSql: vi.fn(),
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
        executeSql: vi.fn(),
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
