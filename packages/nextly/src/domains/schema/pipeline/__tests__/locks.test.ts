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

/**
 * MySQL takes its wait as `GET_LOCK`'s second argument. Passing 0
 * unconditionally made `mode: "wait"` silently fail-fast there — it THREW where
 * Postgres reports `ran: false`, so the two dialects disagreed about what a busy
 * lock is, and a boot handling one outcome was unprotected on the other.
 */
function fakeMysql(locked: 0 | 1) {
  const calls: string[] = [];
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      const text = JSON.stringify(q);
      calls.push(text);
      if (text.includes("GET_LOCK")) return { rows: [{ locked }] };
      return { rows: [] };
    }),
  };
}

describe("withMigrateLock (mysql named lock)", () => {
  it("waits with a real timeout instead of polling with 0", async () => {
    const db = fakeMysql(1);

    await withMigrateLock(db, "mysql", async () => "ok", {
      mode: "wait",
      maxWaitMs: 30_000,
    });

    // `db.calls` holds `JSON.stringify` of the drizzle `sql` object, so the
    // timeout arrives as a PARAMETER rather than inside the SQL text. Asserting
    // on the rendered string `GET_LOCK(?, 0)` matched nothing either way, so it
    // could not fail — the params are where the value actually is.
    const get = db.calls.find(c => c.includes("GET_LOCK"));
    expect(get).toBeDefined();
    const params = JSON.parse(get as string) as { queryChunks?: unknown[] };
    const serialized = JSON.stringify(params);
    expect(serialized).toContain("30");
    expect(serialized).not.toContain('"value":[0]');
  });

  it("reports a busy lock as not-run in wait mode, rather than throwing", async () => {
    const db = fakeMysql(0);
    const fn = vi.fn(async () => "applied");

    const outcome = await withMigrateLock(db, "mysql", fn, {
      mode: "wait",
      maxWaitMs: 1_000,
    });

    expect(outcome).toEqual({ ran: false, reason: "lock-held" });
    expect(fn).not.toHaveBeenCalled();
  });

  /**
   * The control: fail-fast still THROWS on a busy lock. Without it the test
   * above is satisfied by a dialect that never reports busy at all.
   */
  it("still throws on a busy lock in fail-fast mode", async () => {
    const db = fakeMysql(0);

    await expect(
      withMigrateLock(db, "mysql", async () => "x")
    ).rejects.toMatchObject({ code: "NEXTLY_MIGRATE_LOCK_BUSY" });
  });
});

describe("withMigrateLock (postgres lock row)", () => {
  it("acquires (row returned), runs fn, releases", async () => {
    const db = fakeDb({ acquireRows: [1] });
    const outcome = await withMigrateLock(db, "postgresql", async () => "ok");
    expect(outcome).toEqual({ ran: true, value: "ok" });
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
    const outcome = await withMigrateLock(db, "postgresql", fn, {
      mode: "wait",
      maxWaitMs: 50,
      pollMs: 10,
      isSettled: async () => true,
    });
    // Reported as NOT RUN rather than as an undefined value, so a caller
    // cannot read it as "the body ran and returned nothing".
    expect(outcome).toEqual({ ran: false, reason: "lock-held" });
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
    expect(await withMigrateLock(db, "sqlite", async () => "s")).toEqual({
      ran: true,
      value: "s",
    });
  });
});
