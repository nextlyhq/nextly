// Regression test: migrate:fresh must not abort on managed Postgres.
//
// `session_replication_role` is a superuser-only parameter; Neon/RDS/Supabase
// reject `SET session_replication_role` with "permission denied to set
// parameter". The drop path already uses `DROP TABLE ... CASCADE` (which
// resolves FK dependencies), so the SET is best-effort: a permission failure
// must be swallowed, not propagated.

import { describe, expect, it, vi } from "vitest";

import {
  disableForeignKeyChecks,
  discoverTables,
  enableForeignKeyChecks,
  type SqlRunner,
} from "../migrate-fresh";

/**
 * The double is typed as the surface under test, not as a shape of its own.
 *
 * 🔴 It used to be a hand-written `{ executeQuery: (sql: string) => ... }` that
 * only fitted through a cast — and the cast was hiding that it did not match:
 * the real `executeQuery` is generic and takes params. A double checked against
 * the real surface fails to compile when that surface changes, which is the
 * whole reason to have one.
 */
type FakeAdapter = SqlRunner;

function permissionDeniedAdapter(): FakeAdapter {
  return {
    executeQuery: vi.fn(async (sql: string) => {
      if (sql.includes("session_replication_role")) {
        throw new Error(
          'permission denied to set parameter "session_replication_role"'
        );
      }
      return [];
    }),
  };
}

describe("migrate:fresh discovers what it is about to drop", () => {
  /** Record the SQL the command hands the database, and answer with nothing. */
  function recordingAdapter(): { adapter: FakeAdapter; seen: string[] } {
    const seen: string[] = [];
    return {
      adapter: {
        executeQuery: vi.fn(async (sql: string) => {
          seen.push(sql);
          return [];
        }),
      },
      seen,
    };
  }

  it("asks which relations the DROP will resolve to, on postgresql", async () => {
    // 🔴 `dropTable` emits `DROP TABLE "name"` with no schema on it, so it
    // resolves through the WHOLE search path. Discovery has to ask that same
    // question or the two come apart in both directions: tables the drop would
    // reach go unlisted and survive a reset, and tables it would never reach
    // are listed and handed to it.
    const { adapter, seen } = recordingAdapter();
    await discoverTables(adapter, "postgresql");

    expect(seen[0]).toContain("pg_table_is_visible");
    // Neither way of naming a schema instead: `public` may hold none of these
    // tables, and `current_schema()` is only the first entry of the path, so it
    // misses one the drop still reaches through a later entry.
    expect(seen[0]).not.toContain("'public'");
    expect(seen[0]).not.toContain("current_schema()");
    // The system schemas sit on every path implicitly, so visibility on its own
    // would hand `pg_catalog` to a DROP.
    expect(seen[0]).toContain("pg_catalog");
  });

  it("still scopes MySQL to the connected database", async () => {
    // The control. "Does not say 'public'" is also satisfied by a query that
    // scopes to nothing at all, which on this command would enumerate every
    // table the role can see.
    const { adapter, seen } = recordingAdapter();
    await discoverTables(adapter, "mysql");

    expect(seen[0]).toContain("DATABASE()");
  });
});

describe("migrate:fresh FK toggling on managed Postgres", () => {
  it("disableForeignKeyChecks swallows permission-denied on postgresql", async () => {
    const adapter = permissionDeniedAdapter();
    await expect(
      disableForeignKeyChecks(adapter, "postgresql")
    ).resolves.toBeUndefined();
    expect(adapter.executeQuery).toHaveBeenCalledOnce();
  });

  it("enableForeignKeyChecks swallows permission-denied on postgresql", async () => {
    const adapter = permissionDeniedAdapter();
    await expect(
      enableForeignKeyChecks(adapter, "postgresql")
    ).resolves.toBeUndefined();
  });

  it("still propagates non-permission errors so real failures surface", async () => {
    const adapter: FakeAdapter = {
      executeQuery: vi.fn(async () => {
        throw new Error("connection terminated unexpectedly");
      }),
    };
    await expect(
      disableForeignKeyChecks(adapter, "postgresql")
    ).rejects.toThrow(/connection terminated/);
  });

  it("sqlite PRAGMA path is unaffected (no swallowing)", async () => {
    const adapter: FakeAdapter = { executeQuery: vi.fn(async () => []) };
    await expect(
      disableForeignKeyChecks(adapter, "sqlite")
    ).resolves.toBeUndefined();
    expect(adapter.executeQuery).toHaveBeenCalledWith(
      "PRAGMA foreign_keys = OFF"
    );
  });
});
