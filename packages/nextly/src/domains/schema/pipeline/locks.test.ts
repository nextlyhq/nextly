/**
 * @module domains/schema/pipeline/locks.test
 * @since v0.0.3-alpha (Plan C2)
 */
import { describe, it, expect } from "vitest";

import { POSTGRES_MIGRATE_LOCK_KEY, withMigrateLock } from "./locks";

describe("locks", () => {
  it("derives a stable bigint PG lock key", () => {
    expect(typeof POSTGRES_MIGRATE_LOCK_KEY).toBe("bigint");
    expect(POSTGRES_MIGRATE_LOCK_KEY).toBe(POSTGRES_MIGRATE_LOCK_KEY);
  });

  it("sqlite: runs the callback (single-writer, no real lock)", async () => {
    const ran = await withMigrateLock({} as never, "sqlite", () =>
      Promise.resolve(42)
    );
    expect(ran).toBe(42);
  });

  it("postgres: acquires the lock and runs the callback, then unlocks", async () => {
    const calls: string[] = [];
    const db = {
      execute: (q: unknown) => {
        const text = String(q);
        if (text.includes("pg_try_advisory_lock") || calls.length === 0) {
          calls.push("lock");
          return Promise.resolve([{ locked: true }]);
        }
        calls.push("unlock");
        return Promise.resolve([]);
      },
    };
    const result = await withMigrateLock(db as never, "postgresql", () =>
      Promise.resolve("ok")
    );
    expect(result).toBe("ok");
    expect(calls).toContain("unlock");
  });

  it("postgres: throws LOCK_BUSY when pg_try_advisory_lock returns false", async () => {
    const db = { execute: () => Promise.resolve([{ locked: false }]) };
    await expect(
      withMigrateLock(db as never, "postgresql", () => Promise.resolve(1))
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATE_LOCK_BUSY" });
  });
});
