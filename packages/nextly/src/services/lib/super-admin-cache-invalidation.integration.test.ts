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
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { createTestNextly, type TestNextly } from "nextly/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../database/index";
import { ApiKeyService } from "../../domains/auth/services/api-key-service";
import { PermissionService } from "../../domains/auth/services/permission-service";

import {
  invalidateAllPermissionCaches,
  invalidatePermissionCache,
  isSuperAdmin,
} from "./permissions";

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

/**
 * The grants an API key holds are DERIVED from these same rows, and cached for
 * five minutes of their own under the key's id.
 *
 * Nothing retired them when a ROLE changed. `UserRoleService` evicts when a
 * role is assigned to or removed from a USER; the role services only call
 * `invalidatePermissionCache`, which knows nothing about keys. So an operator
 * revoking a role's inherited `super-admin` left that user's key holding the
 * entire catalogue until the entry aged out, and the same gap left a
 * role-based key holding a permission set its role no longer has, which a
 * comment in `UserRoleService` said was handled elsewhere and was not.
 *
 * `invalidatePermissionCache` now counts its invalidations and the key cache
 * refuses an entry resolved under an older count, so neither module has to
 * enumerate the other's keys and a path written later is covered without
 * remembering to.
 */
describe("an API key's grants are retired when the roles behind them change", () => {
  const DEPUTY = "deputy-role";

  /**
   * A fresh owner and key per case.
   *
   * Every cache in play here is module-level and outlives a harness, while the
   * database does not: the grant cache is keyed by key id and the super-admin
   * answer by user id, so a shared id makes these cases order-dependent in both
   * directions. One that ends having resolved an empty grant set, or a `false`
   * super-admin answer, hands that to the next case's first read against a
   * freshly seeded database, before it has done anything at all. Real keys and
   * real accounts have distinct ids, and so do these.
   */
  let OWNER = "";
  let KEY = "";

  /** A permission the catalogue holds and the deputy's own role does not. */
  const ONLY_IN_THE_CATALOGUE = "read-secrets";

  /**
   * The key service built from SOURCE, on the harness's adapter.
   *
   * Not `harness.getService("apiKeyService")`, which the test harness resolves
   * through `nextly/testing`, and that is the BUILT package: its
   * `services/lib/permissions` is a different module instance from the one this
   * file imports, with its own caches and its own revision counter. The two
   * could never agree, and the first version of this suite measured exactly
   * that and nothing else.
   */
  const keyService = () =>
    new ApiKeyService(harness!.adapter as never, {
      debug() {},
      info() {},
      warn() {},
      error() {},
    });

  beforeEach(() => {
    const unique = randomUUID();
    OWNER = `deputy-owner-${unique}`;
    KEY = `deputy-key-${unique}`;
  });

  async function seedDeputy(): Promise<void> {
    const db = rawDb();
    const tables = getDialectTables();
    await db.insert(tables.permissions).values([
      {
        id: "perm-notes",
        name: "Read notes",
        slug: "read-notes",
        action: "read",
        resource: "notes",
      },
      {
        id: "perm-secrets",
        name: "Read secrets",
        slug: ONLY_IN_THE_CATALOGUE,
        action: "read",
        resource: "secrets",
      },
    ]);
    await db.insert(tables.roles).values({
      id: DEPUTY,
      name: "Deputy",
      slug: "deputy",
      level: 10,
      isSystem: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Its own grant, so the ordinary branch has something to return and a
    // refusal is distinguishable from an empty one.
    await db.insert(tables.rolePermissions).values({
      id: "deputy-notes",
      roleId: DEPUTY,
      permissionId: "perm-notes",
    });
    // Built ON TOP of Super Admin: the edge `isSuperAdmin` follows.
    await db.insert(tables.roleInherits).values({
      id: "deputy-inherits",
      parentRoleId: DEPUTY,
      childRoleId: SUPER_ADMIN_ROLE,
    });
    await db.insert(tables.users).values({
      id: OWNER,
      email: `${OWNER}@example.com`,
      name: OWNER,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tables.userRoles).values({
      id: `${OWNER}-role`,
      userId: OWNER,
      roleId: DEPUTY,
    });
  }

  const grants = () =>
    keyService().resolveApiKeyPermissions("read-only", null, OWNER, KEY);

  /** Remove the inheritance WITHOUT invalidating anything. */
  async function revokeInheritance(): Promise<void> {
    const tables = getDialectTables();
    await rawDb()
      .delete(tables.roleInherits)
      .where(eq(tables.roleInherits.parentRoleId, DEPUTY));
  }

  it("holds the catalogue while the inheritance stands", async () => {
    // The precondition, and the reason the rest discriminates: the key holds a
    // permission the owner's own role does not grant, which only the catalogue
    // branch can produce.
    await seedDeputy();
    expect(await isSuperAdmin(OWNER)).toBe(true);
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
  });

  it("keeps holding it after a silent revocation, so the cache is live", async () => {
    // The control. Every assertion below is that an invalidation CHANGED the
    // answer, and without a live cache the answer would be recomputed anyway.
    await seedDeputy();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
    await revokeInheritance();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
  });

  it("loses it once the role change is announced", async () => {
    await seedDeputy();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
    await revokeInheritance();

    // Exactly what `RoleInheritanceService` calls after editing an edge.
    await invalidatePermissionCache({ roleId: DEPUTY });

    const after = await grants();
    expect(after).not.toContain(ONLY_IN_THE_CATALOGUE);
    expect(
      after,
      "their own role's grant survives, so this is a re-resolve and not a wipe"
    ).toEqual(["read-notes"]);
  });

  it("loses it when a PERMISSION row changes, which names neither", async () => {
    // A permission belongs to no user and no role, so neither hint above can
    // express it, and `PermissionService`'s own update and delete called
    // nothing at all. A role-based key kept a renamed slug and a super-admin's
    // key kept a deleted grant until their entries aged out.
    await seedDeputy();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
    await revokeInheritance();

    await invalidateAllPermissionCaches();

    expect(await grants()).not.toContain(ONLY_IN_THE_CATALOGUE);
  });

  it("loses a deleted permission through the SERVICE that deletes it", async () => {
    // Through `PermissionService`, not the invalidation primitive. The case
    // above calls that primitive directly, so it proves the primitive works
    // and says nothing about whether anything calls it — measured: removing
    // the call from the delete path leaves it green.
    await seedDeputy();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);

    await new PermissionService(harness!.adapter as never, {
      debug() {},
      info() {},
      warn() {},
      error() {},
    }).deletePermissionById("perm-secrets");

    expect(
      await grants(),
      "the deleted row is still in the key's grants"
    ).not.toContain(ONLY_IN_THE_CATALOGUE);
  });

  it("does not file a resolution that raced an invalidation as current", async () => {
    // The revision is read BEFORE the queries. Were it read after, an
    // invalidation landing while they are in flight would be stamped onto rows
    // read under the old one, and the next request would reuse grants the
    // change was meant to retire for the whole TTL.
    //
    // Observed on the CATALOGUE rather than on the super-admin answer, which
    // has a cache of its own: a new permission row is added after the raced
    // resolution, and whether the next read sees it says whether that entry
    // was served or re-resolved.
    await seedDeputy();
    const inFlight = grants();
    await invalidateAllPermissionCaches();
    await inFlight;

    const tables = getDialectTables();
    await rawDb().insert(tables.permissions).values({
      id: "perm-extra",
      name: "Read extra",
      slug: "read-extra",
      action: "read",
      resource: "extra",
    });

    expect(
      await grants(),
      "the raced entry was served back, so this row is missing"
    ).toContain("read-extra");
  });

  it("serves the cache when nothing raced it, which is what makes that a race", async () => {
    // The control. If every read re-resolved, the case above would pass on an
    // implementation that caches nothing at all.
    await seedDeputy();
    await grants();

    const tables = getDialectTables();
    await rawDb().insert(tables.permissions).values({
      id: "perm-later",
      name: "Read later",
      slug: "read-later",
      action: "read",
      resource: "later",
    });

    expect(await grants()).not.toContain("read-later");
  });

  it("loses it on a userId invalidation too, which names no role", async () => {
    await seedDeputy();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
    await revokeInheritance();

    await invalidatePermissionCache({ userId: OWNER });

    expect(await grants()).not.toContain(ONLY_IN_THE_CATALOGUE);
  });
});
