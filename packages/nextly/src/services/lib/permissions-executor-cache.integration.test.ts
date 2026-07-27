/**
 * A permission check that runs on a caller-supplied transaction executor reads
 * through that caller's still-open (uncommitted) transaction, so its result must
 * be neither served from nor promoted into the process-wide permission cache: if
 * the transaction rolled back, a grant or denial that never committed would
 * otherwise be reused by later, non-transactional requests for the cache TTL.
 *
 * This pins that on a real database. The cache is exercised directly: a decision
 * is cached through a pooled check, the underlying grant is then removed WITHOUT
 * invalidating the cache (a raw row delete, not the role service), and:
 *   - a pooled check still returns the stale cached decision (cache is live), but
 *   - an executor-backed check recomputes fresh (bypasses the cache read), and
 *   - it does NOT overwrite the cache (a later pooled check is still the stale
 *     value), proving the executor path skips the cache write too.
 */
import { createTestNextly, type TestNextly } from "nextly/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../database/index";

import { hasPermission } from "./permissions";

let harness: TestNextly | undefined;

// A raw Drizzle handle for seeding/removing role rows without going through the
// role service, whose mutations invalidate the permission cache — the whole
// point here is to leave a stale cache entry in place.
function rawDb() {
  return harness!.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
    delete: (table: unknown) => {
      where: (cond: unknown) => Promise<unknown>;
    };
  };
}

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

beforeEach(async () => {
  harness = await createTestNextly();
});

describe("permission cache — transaction executor bypass (integration)", () => {
  it("bypasses the process-wide cache for executor-backed checks (read and write)", async () => {
    const db = rawDb();
    const tables = getDialectTables();

    // A permission and a role that grants it.
    const readPosts = await harness!.nextly.permissions.create({
      data: {
        action: "read",
        resource: "posts",
        name: "Read posts",
        slug: "read-posts",
      },
    });
    const viewer = await harness!.nextly.roles.create({
      data: {
        name: "Viewer",
        slug: "viewer",
        permissionIds: [readPosts.item.id],
      },
    });

    // A unique user id: the permission cache is process-wide and outlives a
    // single harness, so a shared id could collide with another test's entry.
    const userId = "cache-exec-user";
    await db.insert(tables.users).values({
      id: userId,
      email: "cache-exec@example.com",
      name: "cache-exec",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tables.userRoles).values({
      id: "cache-exec-user-role",
      userId,
      roleId: viewer.item.id,
      createdAt: new Date(),
    });

    // 1. Pooled check grants and caches the decision.
    expect(await hasPermission(userId, "read", "posts")).toBe(true);

    // 2. Remove the grant WITHOUT invalidating the cache (raw delete).
    await db
      .delete(tables.userRoles)
      .where(eq(tables.userRoles.userId, userId));

    // 3. A pooled check still returns the stale cached grant — the cache is live.
    expect(await hasPermission(userId, "read", "posts")).toBe(true);

    // 4. An executor-backed check bypasses the cache READ and recomputes against
    //    the current rows: the grant is gone, so it is denied.
    const executor = harness!.adapter.getDrizzle();
    expect(await hasPermission(userId, "read", "posts", executor)).toBe(false);

    // 5. The executor-backed check must NOT have written its `false` into the
    //    cache: a later pooled check still sees the earlier stale grant, proving
    //    the executor path skips the cache write too.
    expect(await hasPermission(userId, "read", "posts")).toBe(true);
  });
});
