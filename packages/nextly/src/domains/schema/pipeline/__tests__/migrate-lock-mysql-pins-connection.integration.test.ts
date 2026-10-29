/**
 * The schema lock on MySQL holds the earlier version's migrate lock beside its
 * own row, so a process of an earlier version still finds it held. That lock is
 * a named lock held by a connection. The lock and its
 * release must run on that one connection: a release that lands on another
 * pooled connection leaves the lock held by the first, idle connection. And a
 * named lock belongs to the whole server, so its name carries the database.
 */
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import {
  MYSQL_MIGRATE_LOCK_NAME,
  forceUnlock,
  withMigrateLock,
} from "../locks";

// Self-skips when TEST_MYSQL_URL is unset, as the other integration suites do.
const describeMysql = getConfiguredTestDialects().includes("mysql")
  ? describe
  : describe.skip;

let handle: TestNextly;

beforeEach(async () => {
  handle = await createTestNextly({ dialect: "mysql" });
});

afterEach(async () => {
  await handle?.destroy();
});

async function holderOfLock(): Promise<number | null> {
  const db = handle.adapter.getDrizzle<{
    execute: (q: unknown) => Promise<unknown>;
  }>();
  const result = await db.execute(
    sql`SELECT IS_USED_LOCK(${MYSQL_MIGRATE_LOCK_NAME}) AS holder`
  );
  // mysql2 answers [rows, fields].
  const rows = (
    Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
  ) as Array<{
    holder: number | null;
  }>;
  return rows[0]?.holder ?? null;
}

/** Every call here is a command-line run that stops at once on a held lock. */
const FAIL_FAST = { command: "test run", mode: "fail-fast" } as const;

describeMysql("withMigrateLock on MySQL", () => {
  it("releases the lock when the work runs queries on more than one pooled connection", async () => {
    for (let i = 0; i < 5; i++) {
      await withMigrateLock(
        handle.adapter,
        "mysql",
        async () => {
          // Two queries at once make the pool use a second connection, so the
          // release is not guaranteed to run on the one that took the lock.
          await Promise.all([
            handle.adapter.executeQuery("SELECT SLEEP(0.05)"),
            handle.adapter.executeQuery("SELECT SLEEP(0.05)"),
          ]);
        },
        FAIL_FAST
      );

      expect(await holderOfLock()).toBeNull();
    }
  });

  it("holds the lock while the work runs", async () => {
    let heldInside: number | null = null;

    await withMigrateLock(
      handle.adapter,
      "mysql",
      async () => {
        heldInside = await holderOfLock();
      },
      FAIL_FAST
    );

    expect(heldInside).not.toBeNull();
  });

  it("lets two databases on one server each hold their own lock at once", async () => {
    // A second app's database on the same server: its own migrations must not
    // wait for, or be refused by, this one's.
    const scratch = await createScratchDatabase("mysql", "migrate_lock_other");
    const other = createMySqlAdapter({ url: scratch.url });
    try {
      await other.connect();
      const outcome = await withMigrateLock(
        handle.adapter,
        "mysql",
        () =>
          withMigrateLock(
            other as never,
            "mysql",
            async () => "ran",
            FAIL_FAST
          ),
        FAIL_FAST
      );
      expect(outcome).toEqual({
        ran: true,
        value: { ran: true, value: "ran" },
      });
    } finally {
      // The scratch database goes whether connecting or closing failed.
      try {
        await other.disconnect();
      } finally {
        await scratch.drop();
      }
    }
  });

  it("still refuses a second taker on the same database", async () => {
    // The second taker starts outside the first one's work, as another run would: work INSIDE a
    // holder runs in its claim, so only a separate run is a contender.
    let finish: () => void = () => {};
    const holding = new Promise<void>(resolve => {
      finish = resolve;
    });
    let entered: () => void = () => {};
    const inside = new Promise<void>(resolve => {
      entered = resolve;
    });
    const first = withMigrateLock(
      handle.adapter,
      "mysql",
      async () => {
        entered();
        await holding;
      },
      FAIL_FAST
    );
    await inside;
    try {
      await expect(
        withMigrateLock(handle.adapter, "mysql", async () => "ran", FAIL_FAST)
      ).rejects.toThrow("holds it");
    } finally {
      finish();
      await first;
    }
  });

  it("leaves the named lock alone on --force-unlock, which clears only the lock rows on MySQL", async () => {
    // A named lock goes with the connection holding it, so there is never a stale one for
    // --force-unlock to clear, and it must not release a live one. The rows it clears are the
    // schema lock's own, so the run it cleared them under is told it did not hold its lock to the
    // end — which is what forcing a live holder's lock means.
    const db = handle.adapter.getDrizzle();
    let heldAfter: number | null = null;
    await expect(
      withMigrateLock(
        handle.adapter,
        "mysql",
        async () => {
          await forceUnlock(db, "mysql");
          heldAfter = await holderOfLock();
        },
        FAIL_FAST
      )
    ).rejects.toThrow();
    expect(heldAfter).not.toBeNull();
    expect(await holderOfLock()).toBeNull();
  });

  /**
   * During an upgrade an older Nextly may still be migrating this database
   * under the lock's old, server-wide name. A new process must not run beside
   * it, so it treats that lock as busy too, until no older version is left.
   */
  describe("while an older version holds the lock's old name", () => {
    async function holdLegacyLock() {
      const { createConnection } = await import("mysql2/promise");
      const connection = await createConnection({
        uri: process.env.TEST_MYSQL_URL as string,
      });
      await connection.query("SELECT GET_LOCK('nextly:migrate', 0)");
      return {
        release: () =>
          connection.query("SELECT RELEASE_LOCK('nextly:migrate')"),
        end: () => connection.end(),
      };
    }

    it("refuses at once in fail-fast mode, and gives its own lock back", async () => {
      const legacy = await holdLegacyLock();
      try {
        let ran = false;
        await expect(
          withMigrateLock(
            handle.adapter,
            "mysql",
            async () => {
              ran = true;
            },
            FAIL_FAST
          )
        ).rejects.toThrow("MySQL lock `nextly:migrate`");
        expect(ran).toBe(false);
        expect(await holderOfLock()).toBeNull();
      } finally {
        await legacy.end();
      }
    });

    it("waits in wait mode until the old name is free, then runs", async () => {
      const legacy = await holdLegacyLock();
      try {
        const started = Date.now();
        setTimeout(() => void legacy.release(), 1500);
        const outcome = await withMigrateLock(
          handle.adapter,
          "mysql",
          async () => "ran",
          { command: "test run", mode: "wait", waitMs: 10_000, pollMs: 200 }
        );
        expect(outcome).toEqual({ ran: true, value: "ran" });
        expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
      } finally {
        await legacy.end();
      }
    });
  });

  it("releases the lock when the work throws", async () => {
    await expect(
      withMigrateLock(
        handle.adapter,
        "mysql",
        async () => {
          throw new Error("migration failed");
        },
        FAIL_FAST
      )
    ).rejects.toThrow("migration failed");

    expect(await holderOfLock()).toBeNull();
  });
});
