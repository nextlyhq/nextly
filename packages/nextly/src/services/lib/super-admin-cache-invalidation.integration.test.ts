/**
 * A demotion out of super-admin must not survive in a cache.
 *
 * `isSuperAdmin` answers from a process-wide map with a 60-second life, and
 * `invalidatePermissionCache` cleared the two permission tiers beside it and
 * not that map. So a user removed from the role kept the session bypass until
 * the entry aged out.
 *
 * It reaches further than one minute. An API key's grants are resolved through
 * this answer and cached for five minutes of their own, so a stale `true` could
 * be copied into a key's grants after the demotion and outlive it by both
 * windows together: the catalogue, in the hands of someone who no longer holds
 * the role that grants it.
 *
 * Exercised on a real database, against the cache itself: the role is removed
 * by a raw row delete rather than through the role service, so the only thing
 * that can clear the entry is the call under test.
 */
import { eq } from "drizzle-orm";
import { createTestNextly, type TestNextly } from "nextly/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../database/index";

import { invalidatePermissionCache, isSuperAdmin } from "./permissions";

let harness: TestNextly | undefined;

function rawDb() {
  return harness!.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
    delete: (table: unknown) => { where: (cond: unknown) => Promise<unknown> };
  };
}

/**
 * The `super-admin` role, by the slug every check reads, inserted once per
 * harness. Raw rows throughout: the role service invalidates caches as it
 * writes, and a cache left standing is the whole subject here.
 */
const SUPER_ADMIN_ROLE = "super-admin-role";

async function seedSuperAdminRole(): Promise<void> {
  const tables = getDialectTables();
  await rawDb().insert(tables.roles).values({
    id: SUPER_ADMIN_ROLE,
    name: "Super Admin",
    slug: "super-admin",
    level: 1000,
    isSystem: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** A user holding that role, by a raw row. */
async function promote(userId: string, email: string): Promise<void> {
  const db = rawDb();
  const tables = getDialectTables();
  await db.insert(tables.users).values({
    id: userId,
    email,
    name: userId,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(tables.userRoles).values({
    id: `${userId}-role`,
    userId,
    roleId: SUPER_ADMIN_ROLE,
    createdAt: new Date(),
  });
}

/** Remove every role row for a user WITHOUT going through the role service. */
async function demote(userId: string): Promise<void> {
  const tables = getDialectTables();
  await rawDb()
    .delete(tables.userRoles)
    .where(eq(tables.userRoles.userId, userId));
}

beforeEach(async () => {
  harness = await createTestNextly();
  await seedSuperAdminRole();
});

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

describe("the super-admin answer is invalidated with the permissions it is asked beside", () => {
  it("is cached, which is what makes the rest of this file mean anything", async () => {
    // The control. Every case below asserts that an invalidation CHANGED the
    // answer; without a live cache the answer would be recomputed anyway and
    // each of them would pass against a function that caches nothing.
    const userId = "super-cache-control";
    await promote(userId, "super-cache-control@example.com");
    expect(await isSuperAdmin(userId)).toBe(true);

    await demote(userId);
    expect(
      await isSuperAdmin(userId),
      "a raw demotion must still read true, or the cache is not live here"
    ).toBe(true);
  });

  it("clears the demoted user on a userId invalidation", async () => {
    const userId = "super-cache-by-user";
    await promote(userId, "super-cache-by-user@example.com");
    expect(await isSuperAdmin(userId)).toBe(true);

    await demote(userId);
    await invalidatePermissionCache({ userId });

    expect(await isSuperAdmin(userId)).toBe(false);
  });

  it("clears the demoted user on a roleId invalidation, which names no user", async () => {
    // A role's own change arrives with a roleId and nothing else, and the map
    // does not record which users a role reaches. The subset cannot be derived,
    // so the whole map goes.
    const userId = "super-cache-by-role";
    await promote(userId, "super-cache-by-role@example.com");
    expect(await isSuperAdmin(userId)).toBe(true);

    await demote(userId);
    await invalidatePermissionCache({ roleId: "any-role-at-all" });

    expect(await isSuperAdmin(userId)).toBe(false);
  });

  it("leaves an unrelated user's answer alone on a userId invalidation", async () => {
    // The discriminating control: an implementation that clears the whole map
    // for every hint passes the two cases above and is a different behaviour.
    const kept = "super-cache-kept";
    const other = "super-cache-other";
    await promote(kept, "super-cache-kept@example.com");
    await promote(other, "super-cache-other@example.com");
    expect(await isSuperAdmin(kept)).toBe(true);
    expect(await isSuperAdmin(other)).toBe(true);

    await demote(kept);
    await demote(other);
    await invalidatePermissionCache({ userId: other });

    expect(await isSuperAdmin(kept), "still cached").toBe(true);
    expect(await isSuperAdmin(other), "evicted").toBe(false);
  });
});
