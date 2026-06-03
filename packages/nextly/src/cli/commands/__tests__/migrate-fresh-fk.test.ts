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
    expect(adapter.executeQuery).toHaveBeenCalledWith("PRAGMA foreign_keys = OFF");
  });
});
