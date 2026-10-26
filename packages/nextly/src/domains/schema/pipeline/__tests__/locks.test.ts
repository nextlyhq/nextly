import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { forceUnlock, withMigrateLock } from "../locks";

/**
 * A MySQL handle whose pool allows one connection. The lock's connection is
 * then the only one there is, so the work must run on it: a second checkout
 * would wait for a connection that is never released.
 */
function singleConnectionMysqlDb() {
  const getConnection = vi.fn();
  const execute = vi.fn(async () => ({ rows: [{ locked: 1 }] }));
  return {
    execute,
    getConnection,
    $client: {
      config: { connectionLimit: 1 },
      getConnection: getConnection,
      promise: () => ({ getConnection }),
    },
  };
}

describe("withMigrateLock on MySQL with a one-connection pool", () => {
  it("takes no second connection for the lock", async () => {
    const db = singleConnectionMysqlDb();

    await withMigrateLock(db, "mysql", async () => "ok");

    expect(db.getConnection).not.toHaveBeenCalled();
  });
});

describe("locks.ts loads the MySQL driver only where a MySQL lock is pinned", () => {
  it("has no top-level import of the MySQL driver", () => {
    const source = readFileSync(
      new URL("../locks.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(/^import [^;]*"drizzle-orm\/mysql2"/m);
    expect(source).toContain('import("drizzle-orm/mysql2")');
  });
});

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

  /**
   * A named lock goes with the connection holding it, so it is never stale and
   * `--force-unlock` clears nothing on MySQL: the message must not send anyone
   * there, and must say what does free it.
   */
  it("tells a MySQL user what frees the lock, not to force-unlock it", async () => {
    await expect(
      withMigrateLock(fakeMysql(0), "mysql", async () => "x")
    ).rejects.toMatchObject({
      publicMessage: expect.stringContaining("connection ends"),
    });
    await expect(
      withMigrateLock(fakeMysql(0), "mysql", async () => "x")
    ).rejects.toMatchObject({
      publicMessage: expect.not.stringContaining("run with `--force-unlock`"),
    });
  });
});

describe("withMigrateLock (mysql, while an older version holds the old name)", () => {
  /**
   * Both names share one wait. A `GET_LOCK` that used most of the budget must
   * leave the old name's check only what is left, not a fresh budget, or a
   * caller's maximum wait could nearly double.
   */
  it("spends one wait across the per-database lock and the old name", async () => {
    const db = {
      execute: vi.fn(async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes("GET_LOCK")) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          return { rows: [{ locked: 1 }] };
        }
        if (text.includes("IS_USED_LOCK")) return { rows: [{ holder: 7 }] };
        return { rows: [] };
      }),
    };
    const started = Date.now();
    const outcome = await withMigrateLock(db, "mysql", async () => "x", {
      mode: "wait",
      maxWaitMs: 1_000,
    });
    expect(outcome).toEqual({ ran: false, reason: "lock-held" });
    expect(Date.now() - started).toBeLessThan(1_800);
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

  it("points a PostgreSQL user at --force-unlock, which clears a stale row", async () => {
    await expect(
      withMigrateLock(
        fakeDb({ acquireRows: [0] }),
        "postgresql",
        async () => "x"
      )
    ).rejects.toMatchObject({
      publicMessage:
        "Another schema operation holds the migrate lock. Wait for it to finish " +
        "(a running dev server also holds it) and retry, or run with " +
        "`--force-unlock` to clear a stale lock.",
    });
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
