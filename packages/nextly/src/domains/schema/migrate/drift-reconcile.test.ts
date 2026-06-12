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

function fakeRepo(): ReconcileRepo & {
  starts: number;
  applied: Array<{ statementsExecuted?: number | null }>;
  superseded: Array<{ supersededEventIds: string[]; byEventId: string }>;
} {
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
  } as never;
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
