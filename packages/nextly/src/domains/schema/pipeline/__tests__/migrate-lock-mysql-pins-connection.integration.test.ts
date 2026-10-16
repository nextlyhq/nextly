/**
 * MySQL's migrate lock is a named lock held by a connection. The lock and its
 * release must run on that one connection: a release that lands on another
 * pooled connection leaves the lock held by the first, idle connection.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { withMigrateLock } from "../locks";

const LOCK_NAME = "nextly:migrate";

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
  const [row] = (await handle.adapter.executeQuery(
    `SELECT IS_USED_LOCK('${LOCK_NAME}') AS holder`
  )) as Array<{ holder: number | null }>;
  return row?.holder ?? null;
}

describeMysql("withMigrateLock on MySQL", () => {
  it("releases the lock when the work runs queries on more than one pooled connection", async () => {
    const db = handle.adapter.getDrizzle();

    for (let i = 0; i < 5; i++) {
      await withMigrateLock(db, "mysql", async () => {
        // Two queries at once make the pool use a second connection, so the
        // release is not guaranteed to run on the one that took the lock.
        await Promise.all([
          handle.adapter.executeQuery("SELECT SLEEP(0.05)"),
          handle.adapter.executeQuery("SELECT SLEEP(0.05)"),
        ]);
      });

      expect(await holderOfLock()).toBeNull();
    }
  });

  it("holds the lock while the work runs", async () => {
    const db = handle.adapter.getDrizzle();
    let heldInside: number | null = null;

    await withMigrateLock(db, "mysql", async () => {
      heldInside = await holderOfLock();
    });

    expect(heldInside).not.toBeNull();
  });

  it("releases the lock when the work throws", async () => {
    const db = handle.adapter.getDrizzle();

    await expect(
      withMigrateLock(db, "mysql", async () => {
        throw new Error("migration failed");
      })
    ).rejects.toThrow("migration failed");

    expect(await holderOfLock()).toBeNull();
  });
});
