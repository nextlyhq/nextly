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
} from "../migrate-fresh";

type FakeAdapter = {
  executeQuery: (sql: string) => Promise<unknown>;
};

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

  it("asks for the schema the DROP will resolve to, on postgresql", async () => {
    // 🔴 `dropTable` emits `DROP TABLE "name"` with no schema on it, so it
    // resolves through the search path. Discovery naming `public` asked a
    // different question, and on `tenant, public` they came apart both ways:
    // Nextly's tables in `tenant` were never listed and survived, while
    // whatever else was in `public` was listed and dropped.
    const { adapter, seen } = recordingAdapter();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await discoverTables(adapter as any, "postgresql");

    expect(seen[0]).toContain("current_schema()");
    expect(seen[0]).not.toContain("'public'");
  });

  it("still scopes MySQL to the connected database", async () => {
    // The control. "Does not say 'public'" is also satisfied by a query that
    // scopes to nothing at all, which on this command would enumerate every
    // table the role can see.
    const { adapter, seen } = recordingAdapter();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await discoverTables(adapter as any, "mysql");

    expect(seen[0]).toContain("DATABASE()");
  });
});

describe("migrate:fresh FK toggling on managed Postgres", () => {
  it("disableForeignKeyChecks swallows permission-denied on postgresql", async () => {
    const adapter = permissionDeniedAdapter();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      disableForeignKeyChecks(adapter as any, "postgresql")
    ).resolves.toBeUndefined();
    expect(adapter.executeQuery).toHaveBeenCalledOnce();
  });

  it("enableForeignKeyChecks swallows permission-denied on postgresql", async () => {
    const adapter = permissionDeniedAdapter();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      enableForeignKeyChecks(adapter as any, "postgresql")
    ).resolves.toBeUndefined();
  });

  it("still propagates non-permission errors so real failures surface", async () => {
    const adapter: FakeAdapter = {
      executeQuery: vi.fn(async () => {
        throw new Error("connection terminated unexpectedly");
      }),
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      disableForeignKeyChecks(adapter as any, "postgresql")
    ).rejects.toThrow(/connection terminated/);
  });

  it("sqlite PRAGMA path is unaffected (no swallowing)", async () => {
    const adapter: FakeAdapter = { executeQuery: vi.fn(async () => []) };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      disableForeignKeyChecks(adapter as any, "sqlite")
    ).resolves.toBeUndefined();
    expect(adapter.executeQuery).toHaveBeenCalledWith(
      "PRAGMA foreign_keys = OFF"
    );
  });
});
