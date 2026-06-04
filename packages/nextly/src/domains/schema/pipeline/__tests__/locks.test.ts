import { describe, expect, it, vi } from "vitest";

import { forceUnlock, withMigrateLock } from "../locks";

// Fake drizzle db: records executed SQL text; `acquireRows` controls whether the
// acquire upsert returns a row (acquired) or none (busy), per successive call.
function fakeDb(opts: { acquireRows: number[] }) {
  const calls: string[] = [];
  let acquireCall = 0;
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      const text = JSON.stringify(q);
      calls.push(text);
      if (
        text.includes("nextly_migrate_lock") &&
        text.includes("ON CONFLICT")
      ) {
        const n =
          opts.acquireRows[Math.min(acquireCall, opts.acquireRows.length - 1)];
        acquireCall++;
        return { rows: n > 0 ? [{ id: 1 }] : [] };
      }
      return { rows: [] };
    }),
  };
}

describe("withMigrateLock (postgres lock row)", () => {
  it("acquires (row returned), runs fn, releases", async () => {
    const db = fakeDb({ acquireRows: [1] });
    const ran = await withMigrateLock(db, "postgresql", async () => "ok");
    expect(ran).toBe("ok");
    expect(
      db.calls.some(
        c => c.includes("CREATE TABLE") && c.includes("nextly_migrate_lock")
      )
    ).toBe(true);
    expect(
      db.calls.some(
        c => c.includes("DELETE") && c.includes("nextly_migrate_lock")
      )
    ).toBe(true);
  });

  it("fail-fast: busy (no row) throws NEXTLY_MIGRATE_LOCK_BUSY", async () => {
    const db = fakeDb({ acquireRows: [0] });
    await expect(
      withMigrateLock(db, "postgresql", async () => "x")
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATE_LOCK_BUSY" });
  });

  it("wait mode: settles via isSettled() even if never acquired (does not run fn)", async () => {
    const db = fakeDb({ acquireRows: [0] });
    const fn = vi.fn(async () => "applied");
    const ran = await withMigrateLock(db, "postgresql", fn, {
      mode: "wait",
      maxWaitMs: 50,
      pollMs: 10,
      isSettled: async () => true,
    });
    expect(ran).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it("forceUnlock deletes the lock row unconditionally", async () => {
    const db = fakeDb({ acquireRows: [1] });
    await forceUnlock(db, "postgresql");
    expect(
      db.calls.some(
        c => c.includes("DELETE") && c.includes("nextly_migrate_lock")
      )
    ).toBe(true);
  });

  it("sqlite is a no-op pass-through", async () => {
    const db = fakeDb({ acquireRows: [0] });
    expect(await withMigrateLock(db, "sqlite", async () => "s")).toBe("s");
  });
});
