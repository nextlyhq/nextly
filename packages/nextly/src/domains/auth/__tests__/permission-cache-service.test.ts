// The cache is a store, and these test it as one.
//
// The previous version mocked Drizzle's fluent chain and asserted that
// `select` had been called. That is a claim about how the service builds a
// query, not about what the cache does — it passed while the service could not
// run at all, because a mock shaped like a query builder satisfies
// `mockDb.select` whether or not anything is stored or read back. Against the
// real fixture the questions become the ones a caller has: does a miss say
// nothing is known, does a hit return what was written, and does invalidating
// make a later read a miss again.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../../__tests__/fixtures/db";
import { userFactory } from "../../../__tests__/fixtures/users";
import { PermissionCacheService } from "../services/permission-cache-service";

describe("PermissionCacheService", () => {
  let testDb: TestDb;
  let cacheService: PermissionCacheService;

  beforeEach(async () => {
    testDb = await createTestDb();
    cacheService = new PermissionCacheService(testDb.adapter, testLogger, {
      cacheTtlSeconds: 60,
    });

    // The cache row references a real user. Against the old mock it did not
    // have to — nothing enforced the key — which is one thing this rewrite
    // gains: a write that would violate referential integrity in production
    // now fails here rather than passing.
    for (const id of ["user-1", "user-2", "user-123"]) {
      await testDb.db.insert(testDb.schema.users).values(userFactory({ id }));
    }
  });

  afterEach(async () => {
    await testDb.close();
  });

  describe("getCachedPermission", () => {
    it("says nothing is known when the entry was never written", async () => {
      // `null` rather than `false`: an absent answer and a denied one must not
      // be the same value, or a caller treats "never asked" as "refused".
      expect(
        await cacheService.getCachedPermission("user-123", "read", "users")
      ).toBeNull();
    });

    it("returns what was stored, for both verdicts", async () => {
      // Both directions, because a cache that always returns the same verdict
      // satisfies a single-value test while being useless.
      await cacheService.setCachedPermission("user-1", "read", "users", true, [
        "role-1",
      ]);
      await cacheService.setCachedPermission(
        "user-1",
        "delete",
        "users",
        false,
        ["role-1"]
      );

      expect(
        await cacheService.getCachedPermission("user-1", "read", "users")
      ).toBe(true);
      expect(
        await cacheService.getCachedPermission("user-1", "delete", "users")
      ).toBe(false);
    });

    it("keeps one user's answer out of another's", async () => {
      await cacheService.setCachedPermission("user-1", "read", "users", true, [
        "role-1",
      ]);

      expect(
        await cacheService.getCachedPermission("user-2", "read", "users")
      ).toBeNull();
    });

    it("keeps one resource's answer out of another's", async () => {
      await cacheService.setCachedPermission("user-1", "read", "users", true, [
        "role-1",
      ]);

      expect(
        await cacheService.getCachedPermission("user-1", "read", "media")
      ).toBeNull();
    });

    it("says nothing is known for an unusable key", async () => {
      expect(
        await cacheService.getCachedPermission("", "read", "users")
      ).toBeNull();
    });
  });

  describe("setCachedPermission", () => {
    it("overwrites an earlier answer for the same key", async () => {
      // A permission change has to be able to correct the cache; an insert that
      // silently kept the first verdict would serve a stale allow forever.
      await cacheService.setCachedPermission("user-1", "read", "users", true, [
        "role-1",
      ]);
      await cacheService.setCachedPermission("user-1", "read", "users", false, [
        "role-1",
      ]);

      expect(
        await cacheService.getCachedPermission("user-1", "read", "users")
      ).toBe(false);
    });

    it("stores nothing for an unusable key", async () => {
      await cacheService.setCachedPermission("", "read", "users", true, [
        "role-1",
      ]);

      expect(
        await cacheService.getCachedPermission("", "read", "users")
      ).toBeNull();
    });
  });

  describe("invalidateByUser", () => {
    it("makes that user's later reads misses again", async () => {
      await cacheService.setCachedPermission("user-1", "read", "users", true, [
        "role-1",
      ]);
      await cacheService.setCachedPermission("user-1", "read", "media", true, [
        "role-1",
      ]);

      const invalidated = await cacheService.invalidateByUser("user-1");

      // Both halves, now that the count is truthful. It previously read
      // `result.rowCount`, which better-sqlite3 does not set — it reports
      // `changes` — so the method returned 0 while having tombstoned the rows.
      // The count now goes through the shared dialect-aware helper, so a caller
      // branching on it takes the right path.
      //
      // Asserting BOTH matters: the effect alone passes even if the count lies,
      // and the count alone passes even if nothing was invalidated.
      expect(invalidated).toBe(2);
      expect(
        await cacheService.getCachedPermission("user-1", "read", "users")
      ).toBeNull();
    });

    it("leaves other users alone", async () => {
      // The control. An invalidation that cleared everything would also pass
      // the case above.
      await cacheService.setCachedPermission("user-1", "read", "users", true, [
        "role-1",
      ]);
      await cacheService.setCachedPermission("user-2", "read", "users", true, [
        "role-1",
      ]);

      await cacheService.invalidateByUser("user-1");

      expect(
        await cacheService.getCachedPermission("user-2", "read", "users")
      ).toBe(true);
    });

    it("removes nothing for an unusable userId", async () => {
      expect(await cacheService.invalidateByUser("")).toBe(0);
    });
  });

  describe("invalidateByRole", () => {
    // Restored after review: this method had NO test anywhere in the tree, and
    // it is the one a role revocation depends on. A regression here leaves
    // role-derived allows cached after the role is taken away — the user keeps
    // permissions they no longer hold, until the TTL expires. Silent, and on
    // the wrong side.
    //
    // The dialect matters here in a way it does not for invalidateByUser: the
    // roleIds column is a JSON array, and the service uses THREE different
    // containment queries for it — JSONB `@>` on Postgres, JSON_CONTAINS on
    // MySQL, and `json_each` on SQLite. This fixture exercises the SQLite arm,
    // which is the one that previously threw `unrecognized token: "@"` on every
    // authed request.
    it("makes reads miss for every user holding the revoked role", async () => {
      await cacheService.setCachedPermission("user-1", "read", "users", true, [
        "role-1",
      ]);
      await cacheService.setCachedPermission("user-2", "read", "users", true, [
        "role-1",
        "role-2",
      ]);

      await cacheService.invalidateByRole("role-1");

      // Both users held role-1 — user-2 among several roles, which is the case
      // a containment query gets wrong if it compares the column for equality
      // instead of asking whether the array contains the id.
      expect(
        await cacheService.getCachedPermission("user-1", "read", "users")
      ).toBeNull();
      expect(
        await cacheService.getCachedPermission("user-2", "read", "users")
      ).toBeNull();
    });

    it("leaves entries for other roles cached", async () => {
      // The control. Tombstoning every row would satisfy the case above, and
      // an invalidation that clears the whole cache on any role change is a
      // correctness-preserving performance bug that no assertion above sees.
      await cacheService.setCachedPermission("user-1", "read", "users", true, [
        "role-1",
      ]);
      await cacheService.setCachedPermission("user-2", "read", "users", true, [
        "role-2",
      ]);

      await cacheService.invalidateByRole("role-1");

      expect(
        await cacheService.getCachedPermission("user-2", "read", "users")
      ).toBe(true);
    });

    it("invalidates nothing for an unusable roleId", async () => {
      expect(await cacheService.invalidateByRole("")).toBe(0);
    });
  });
});
