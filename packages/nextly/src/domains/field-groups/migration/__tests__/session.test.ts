import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  MIGRATION_LOCK_NAME,
  withMigrationSession,
  type MigrationDialect,
} from "../session";

/**
 * Stands in for an adapter, recording which connection each statement ran on.
 *
 * The connection identity is the point: an advisory lock belongs to the
 * connection that took it, so a release issued anywhere else releases nothing.
 */
function createAdapter(options: { locked?: boolean } = {}) {
  const locked = options.locked !== false;
  const statements: { conn: number; sql: string }[] = [];
  let connections = 0;

  const adapter = {
    transaction: vi.fn(async (work: (ctx: unknown) => Promise<unknown>) => {
      connections += 1;
      const conn = connections;
      const ctx = {
        execute: vi.fn(async (sql: string) => {
          statements.push({ conn, sql });
          if (sql.includes("GET_LOCK")) return [{ locked: locked ? 1 : 0 }];
          if (sql.includes("pg_try_advisory_lock")) return [{ locked: locked }];
          return [];
        }),
      };
      return work(ctx);
    }),
  } as unknown as DrizzleAdapter;

  return { adapter, statements, connectionCount: () => connections };
}

describe("field-group migration session", () => {
  it.each<[MigrationDialect, RegExp, RegExp]>([
    ["mysql", /GET_LOCK/, /RELEASE_LOCK/],
    ["postgresql", /pg_try_advisory_lock/, /pg_advisory_unlock/],
  ])(
    "takes and releases the lock on one connection (%s)",
    async (dialect, acquireSql, releaseSql) => {
      const { adapter, statements } = createAdapter();
      await withMigrationSession({ adapter, dialect }, async () => undefined);

      const acquired = statements.find(s => acquireSql.test(s.sql));
      const released = statements.find(s => releaseSql.test(s.sql));
      expect(acquired).toBeDefined();
      expect(released).toBeDefined();
      // Same connection for both. A release on any other connection is a
      // no-op that leaves the lock held until that connection is recycled.
      expect(released?.conn).toBe(acquired?.conn);
    }
  );

  // The schema pipeline's lock helper gives up waiting and proceeds unlocked.
  // Two concurrent runs renaming the same tables is not a survivable outcome,
  // so this refuses instead.
  it.each<MigrationDialect>(["mysql", "postgresql"])(
    "refuses to run when the lock is held elsewhere (%s)",
    async dialect => {
      const { adapter } = createAdapter({ locked: false });
      const ran = vi.fn();
      await expect(
        withMigrationSession({ adapter, dialect }, async () => ran())
      ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      expect(ran).not.toHaveBeenCalled();
    }
  );

  it("releases the lock even when the run throws", async () => {
    const { adapter, statements } = createAdapter();
    await expect(
      withMigrationSession({ adapter, dialect: "mysql" }, async () => {
        throw NextlyError.internal({ logContext: { reason: "boom" } });
      })
    ).rejects.toThrowError(NextlyError);
    expect(statements.some(s => /RELEASE_LOCK/.test(s.sql))).toBe(true);
  });

  // SQLite has one writer by definition, and the adapter serializes
  // `transaction()` through a queue: an outer transaction would hold that queue
  // while every step waited on it, which never resolves.
  it("does not open a pinning transaction on sqlite", async () => {
    const { adapter, connectionCount } = createAdapter();
    const ran = vi.fn();
    await withMigrationSession({ adapter, dialect: "sqlite" }, async () =>
      ran()
    );
    expect(ran).toHaveBeenCalled();
    expect(connectionCount()).toBe(0);
  });

  // Steps must commit independently, so they run on their own connections
  // rather than the one holding the lock. Sharing it would make the whole run
  // a single transaction, and a rollback at the end would erase work the
  // marker already reports as done.
  it("runs step work on a different connection than the lock", async () => {
    const { adapter, statements } = createAdapter();
    await withMigrationSession({ adapter, dialect: "mysql" }, async session => {
      await session.inTransaction(async ctx => {
        await (ctx as { execute: (s: string) => Promise<unknown> }).execute(
          "SELECT 1"
        );
      });
    });
    const lockConn = statements.find(s => /GET_LOCK/.test(s.sql))?.conn;
    const workConn = statements.find(s => s.sql === "SELECT 1")?.conn;
    expect(lockConn).toBeDefined();
    expect(workConn).toBeDefined();
    expect(workConn).not.toBe(lockConn);
  });

  it("locks under a name distinct from the schema pipeline's", () => {
    // Conflating the two would make an ordinary schema sync and a storage
    // migration exclude each other by accident rather than by decision.
    expect(MIGRATION_LOCK_NAME).toBe("nextly_field_group_migration");
    expect(MIGRATION_LOCK_NAME).not.toBe("nextly_migrate");
  });
});
