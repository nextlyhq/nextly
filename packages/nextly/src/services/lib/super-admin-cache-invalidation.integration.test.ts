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

import { eq, sql } from "drizzle-orm";
import { createTestNextly, type TestNextly } from "nextly/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDialectTables } from "../../database/index";
import { container } from "../../di/container";
import { ApiKeyService } from "../../domains/auth/services/api-key-service";
import { PermissionService } from "../../domains/auth/services/permission-service";
import {
  createStoredPermissionAnswersTable,
  insertRow,
} from "../../init/__tests__/retired-auth-tables-fixture";

import {
  inPermissionSweep,
  invalidateAllPermissionCaches,
  invalidatePermissionCache,
  isSuperAdmin,
  rbacRevision,
  resolvedUnderCurrentRevision,
} from "./permissions";
import {
  EPOCH_TTL_MS,
  currentEpoch,
  refreshEpoch,
  resetEpochForTests,
} from "./rbac-epoch";

let harness: TestNextly | undefined;

/**
 * An upgraded database's retired `user_permission_cache`, holding one stored
 * "yes" for `userId`, as an instance on an earlier release would have filed it.
 */
async function leftoverStoredAnswers(userId: string): Promise<void> {
  await createStoredPermissionAnswersTable(harness!.adapter, "sqlite");
  await insertRow(harness!.adapter, "sqlite", "user_permission_cache", [
    `${userId}|read|notes`,
    userId,
    "read",
    "notes",
    1,
    "[]",
    Date.now() + 300_000,
    Date.now(),
  ]);
}

/** The stored answers an earlier release would still read. */
async function storedAnswerCount(): Promise<number> {
  const rows = (await harness!.adapter.executeQuery(
    "SELECT COUNT(*) AS n FROM user_permission_cache"
  )) as Array<{ n: number | string }> | { rows: Array<{ n: number | string }> };
  const list = Array.isArray(rows) ? rows : rows.rows;
  return Number(list[0]?.n);
}

/** Make every delete from the stored answers fail, as an unwritable table would. */
async function refuseEmptyingStoredAnswers(): Promise<void> {
  await harness!.adapter.executeQuery(
    "CREATE TRIGGER upc_refuse BEFORE DELETE ON user_permission_cache BEGIN SELECT RAISE(ABORT, 'refused'); END"
  );
}

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
  // The database is rebuilt per test and the epoch module is not, so its cached
  // stamp would outlive the counter it describes — and a fresh counter can read
  // identically to the one before it. Reset together or the two disagree.
  resetEpochForTests();
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

  it("retires every in-memory answer, not only the user it names", async () => {
    // A deliberate loss of scoping, and the reason is structural rather than a
    // shortcut: the counter other instances read carries a number and not a
    // user id, so a change they see cannot be narrower than "something in RBAC
    // moved". Keeping the scope locally while broadcasting a global signal
    // would mean the instance that made the change was the only one applying it
    // narrowly, which is the inconsistency this replaced.
    //
    // The cost is a role change emptying the in-memory tiers rather than one
    // entry. It is bounded by how often roles change, which is rarely, and by
    // what refilling costs, which is a couple of indexed queries. A stale
    // answer costs the install a grant it revoked.
    const kept = `scope-kept-${randomUUID()}`;
    const other = `scope-other-${randomUUID()}`;
    await promote(kept, `${kept}@example.com`);
    await promote(other, `${other}@example.com`);
    expect(await isSuperAdmin(kept)).toBe(true);
    expect(await isSuperAdmin(other)).toBe(true);

    await demote(kept);
    await demote(other);
    await invalidatePermissionCache({ userId: other });

    expect(await isSuperAdmin(other), "the named user").toBe(false);
    expect(await isSuperAdmin(kept), "and everyone else").toBe(false);
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

  it("loses it inside a batch, which announces nothing until it exits", async () => {
    // A batch defers the shared announcement on purpose, and the local
    // retirement empties the maps this module owns. A key's copied grants are
    // neither: they live in another module, so no list of maps to clear was
    // ever going to reach them, and a key went on holding revoked grants for
    // the batch's whole length — which for a seeder is not bounded by anything
    // this module controls.
    //
    // What reaches them is the predicate all three tiers already ask. A batch
    // holds a retirement open, and nothing is current while one is running.
    await seedDeputy();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
    await revokeInheritance();

    const insideBatch = await inPermissionSweep(async () => {
      await invalidateAllPermissionCaches();
      return grants();
    });

    expect(insideBatch).not.toContain(ONLY_IN_THE_CATALOGUE);
  });

  it("loses it here when the stored table cannot even be asked about, though nothing is announced", async () => {
    // A probe that fails tells nothing about the stored answers, so it is
    // handled as a failed emptying: nothing announced, and what this process
    // kept retired all the same.
    await seedDeputy();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
    await revokeInheritance();
    // The adapter the retirement asks, which is the registered one.
    const adapter = container.get<{
      tableExists(table: string): Promise<boolean>;
    }>("adapter");
    const probe = vi
      .spyOn(adapter, "tableExists")
      .mockRejectedValue(new Error("the catalogue is unreadable"));
    const before = rbacRevision();
    let asked = 0;
    try {
      await invalidateAllPermissionCaches();
    } finally {
      // Counted before the restore, which clears the spy's calls.
      asked = probe.mock.calls.length;
      probe.mockRestore();
    }

    // POPULATION CONTROL: the probe was asked, and nothing was announced.
    expect(asked).toBeGreaterThan(0);
    expect(rbacRevision()).toBe(before);
    expect(await grants()).not.toContain(ONLY_IN_THE_CATALOGUE);
  });

  it("loses it here when the stored answers could not be emptied, though nothing is announced", async () => {
    // A failed emptying withholds the epoch from every other instance, so the
    // epoch alone would let this process's own copy of the key's grants stand
    // for the rest of their life. This process knows the roles changed
    // whatever the stored answers did.
    await seedDeputy();
    expect(await grants()).toContain(ONLY_IN_THE_CATALOGUE);
    await revokeInheritance();
    await leftoverStoredAnswers(OWNER);
    await refuseEmptyingStoredAnswers();
    const before = rbacRevision();

    await invalidateAllPermissionCaches();

    // POPULATION CONTROL: the failure path ran, so nothing was announced.
    expect(rbacRevision()).toBe(before);
    expect(await grants()).not.toContain(ONLY_IN_THE_CATALOGUE);
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
    // Warm the stamp first. Capturing it is a database read now, so an unwarmed
    // resolution can still be waiting on that read when the invalidation lands
    // and would then capture the value AFTER it — which is a race in the test's
    // setup rather than the behaviour under test.
    await refreshEpoch();
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

  it("does not let an in-flight super-admin lookup repopulate the answer", async () => {
    // The same race one level IN, and it defeats the outer fix on its own.
    // `isSuperAdmin` awaits two queries and then writes its cache. A lookup
    // started before a demotion completes after it, putting `true` back into
    // the map the invalidation had just cleared; the next key request then
    // correctly rejects the outer entry, immediately consumes that stale inner
    // one, and caches catalogue-wide grants under the NEW revision for another
    // five minutes.
    await seedDeputy();
    expect(await isSuperAdmin(OWNER)).toBe(true);

    // A lookup in flight across the revocation.
    const inFlight = isSuperAdmin(`${OWNER}-cold`);
    await revokeInheritance();
    await invalidatePermissionCache({ roleId: DEPUTY });
    await inFlight;

    // The owner is no longer a super-admin, so nothing may answer otherwise.
    expect(await isSuperAdmin(OWNER)).toBe(false);
    expect(
      await grants(),
      "the key took the catalogue branch, so a stale answer was served"
    ).not.toContain(ONLY_IN_THE_CATALOGUE);
  });

  it("does not cache a super-admin answer resolved before an invalidation", async () => {
    // Directly on the map this time, and on the OWNER's own entry, which is the
    // one the case above depends on. The lookup is started, the caches are
    // invalidated while it runs, and the entry it would have written must not
    // be there: a later read has to go back to the rows.
    await seedDeputy();
    const inFlight = isSuperAdmin(OWNER);
    await invalidateAllPermissionCaches();
    expect(await inFlight, "it still answers from the rows it read").toBe(true);

    await revokeInheritance();
    expect(
      await isSuperAdmin(OWNER),
      "a cached true would answer here without reading anything"
    ).toBe(false);
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

/**
 * A batch of permission writes publishes the role version ONCE.
 *
 * Every publish sends every instance back to read its users' access again.
 * That is the right cost once and the wrong cost per row: a seeder ensures one
 * permission at a time, so a single new collection would publish once per
 * permission, each publish after the first retiring access the previous one
 * had already retired.
 */
/**
 * An upgraded database keeps the retired `user_permission_cache` until the
 * operator drops it, and an instance still on an earlier release reads it,
 * even one upgrading past the release in between. The epoch tells that
 * instance only to drop what it holds in memory, so the stored answers are
 * emptied first, and a failure to empty them publishes nothing.
 */
describe("the retired stored answers, while an upgraded database has them", () => {
  it("empties them on an access change, and then announces it", async () => {
    const userId = `stored-${randomUUID()}`;
    await leftoverStoredAnswers(userId);
    expect(await storedAnswerCount()).toBe(1);
    const before = rbacRevision();

    await invalidatePermissionCache({ userId });

    // What an earlier release reads after the revocation: nothing to serve.
    expect(await storedAnswerCount()).toBe(0);
    expect(rbacRevision()).not.toBe(before);
  });

  it("announces nothing when they could not be emptied", async () => {
    // Announcing anyway is worse than silence: an instance on an earlier
    // release rejects its in-memory answer BECAUSE the epoch moved, reads the
    // stored row the failure left live, and files it under the new epoch.
    const userId = `stored-${randomUUID()}`;
    await leftoverStoredAnswers(userId);
    await refuseEmptyingStoredAnswers();
    const before = rbacRevision();

    await invalidatePermissionCache({ userId });

    // POPULATION CONTROL: the row is still there, so the emptying did fail.
    expect(await storedAnswerCount()).toBe(1);
    expect(rbacRevision()).toBe(before);
  });
});

describe("a sweep of permission writes", () => {
  it("files nothing as current while the batch is open", async () => {
    // A resolution running alongside the batch has to be refused. What refuses
    // it is not the counter, which stays where it is until the batch exits:
    // the open retirement is.
    harness = harness ?? (await createTestNextly());
    const before = rbacRevision();
    const cacheable: boolean[] = [];
    const announced: string[] = [];

    await inPermissionSweep(async () => {
      await invalidateAllPermissionCaches();
      cacheable.push(resolvedUnderCurrentRevision(rbacRevision()));
      announced.push(rbacRevision());
      await invalidateAllPermissionCaches();
      cacheable.push(resolvedUnderCurrentRevision(rbacRevision()));
      announced.push(rbacRevision());
    });

    // Nothing was cacheable at any point inside the batch...
    expect(cacheable).toEqual([false, false]);
    // ...and nothing was announced while it ran.
    expect(new Set(announced)).toEqual(new Set([before]));
    // The announcement happens once, on the way out, however many writes.
    const count = (revision: string) => Number(revision.split(":")[1]);
    expect(count(rbacRevision())).toBe(count(before) + 1);
  });

  it("still empties the tiers it holds in memory, per write", async () => {
    // The half a batch never deferred. Emptying memory costs nothing, so an
    // answer this process is already holding must not outlive the row it came
    // from just because the expensive half is being batched.
    const userId = `sweep-memory-${randomUUID()}`;
    await promote(userId, `${userId}@example.com`);
    expect(await isSuperAdmin(userId)).toBe(true);
    await demote(userId);

    const insideBatch = await inPermissionSweep(async () => {
      await invalidateAllPermissionCaches();
      return isSuperAdmin(userId);
    });

    expect(insideBatch).toBe(false);
  });

  it("clears the process caches by the time the batch returns", async () => {
    // Deferred is not skipped. The flush happens on the way out, so a caller
    // that awaited the batch sees retired caches.
    const userId = `sweep-${randomUUID()}`;
    await seedSuperAdminRole().catch(() => {});
    await promote(userId, `${userId}@example.com`);
    expect(await isSuperAdmin(userId)).toBe(true);

    await demote(userId);
    await inPermissionSweep(async () => {
      await invalidateAllPermissionCaches();
    });

    expect(await isSuperAdmin(userId)).toBe(false);
  });

  it("retires a revocation raised OUTSIDE the batch without waiting for it", async () => {
    // The batch belongs to the operation that opened it, not to the process.
    // Counted for the process, an unrelated revocation raised while any seeder
    // happened to be awaiting was read as part of that seeder's batch and held
    // until it finished — so a permission revoked during a long seed went on
    // authorizing requests for as long as the seed took.
    const userId = `outside-${randomUUID()}`;
    await seedSuperAdminRole().catch(() => {});
    await promote(userId, `${userId}@example.com`);
    expect(await isSuperAdmin(userId)).toBe(true);
    await demote(userId);

    // Held open so the revocation lands while the batch is genuinely running.
    let releaseBatch: () => void = () => {};
    const batchRunning = new Promise<void>(resolve => {
      releaseBatch = resolve;
    });
    const batch = inPermissionSweep(async () => {
      await invalidateAllPermissionCaches();
      await batchRunning;
    });

    // The revocation, from outside the batch.
    await invalidateAllPermissionCaches();

    // Answered while the batch is still open. Deferred, this is still `true`.
    const duringBatch = await isSuperAdmin(userId);

    releaseBatch();
    await batch;

    expect(duringBatch).toBe(false);
  });

  it("flushes even when the batch throws, since a partial write still changed rows", async () => {
    const userId = `sweep-throw-${randomUUID()}`;
    await promote(userId, `${userId}@example.com`);
    expect(await isSuperAdmin(userId)).toBe(true);

    await demote(userId);
    await expect(
      inPermissionSweep(async () => {
        await invalidateAllPermissionCaches();
        throw new Error("half of the batch landed");
      })
    ).rejects.toThrow("half of the batch landed");

    expect(await isSuperAdmin(userId)).toBe(false);
  });
});

/**
 * The counter is shared, so a change made ELSEWHERE retires what is cached here.
 *
 * This is the property the module left memory for, and it cannot be observed
 * from one process by ordinary means: everything a test calls bumps the local
 * copy as a side effect. So the other instance is played by writing the shared
 * row directly — which is exactly what a second process's bump looks like from
 * this one — and the only thing that can then retire the cached answer is a
 * refresh reading a value this process never set.
 */
describe("an epoch bumped by another instance", () => {
  /** Advance the shared counter without touching this process's copy. */
  async function bumpElsewhere(): Promise<void> {
    const db = harness!.adapter.getDrizzle() as unknown as {
      update: (table: unknown) => {
        set: (patch: unknown) => { where: (cond: unknown) => Promise<unknown> };
      };
      insert: (table: unknown) => {
        values: (row: unknown) => Promise<unknown>;
      };
    };
    const tables = getDialectTables() as unknown as {
      nextlyRbacEpoch: { id: unknown; revision: unknown; generation: unknown };
    };
    const table = tables.nextlyRbacEpoch;
    // The number alone is not the stamp: the row's generation is half of it, so
    // a bump made here has to move the number and leave the identity alone,
    // exactly as another instance's bump would.
    try {
      await db.insert(table).values({
        id: "global",
        revision: 1,
        generation: `another-instance-${randomUUID()}`,
        updatedAt: new Date(),
      });
    } catch {
      // A row already exists, which is the ordinary case once anything has
      // invalidated here. Move its number without touching its identity.
      await db
        .update(table)
        .set({ revision: sql`${table.revision} + 5`, updatedAt: new Date() })
        .where(eq(table.id as never, "global"));
    }
  }

  it("is visible here once the read interval has passed", async () => {
    // The subject. Nothing in this process bumped anything, so a local counter
    // would answer with what it last set and never move.
    const before = currentEpoch();
    await bumpElsewhere();

    await new Promise(resolve => setTimeout(resolve, EPOCH_TTL_MS + 50));
    const after = await refreshEpoch();

    expect(after).not.toBe(before);
  });

  it("retires a super-admin answer this process had cached", async () => {
    // What the counter is FOR, end to end: the demotion happens by a raw row
    // delete, so nothing in this process clears the cache, and the answer flips
    // only because the shared counter moved.
    const userId = `elsewhere-${randomUUID()}`;
    await seedSuperAdminRole().catch(() => {});
    await promote(userId, `${userId}@example.com`);
    expect(await isSuperAdmin(userId)).toBe(true);

    await demote(userId);
    // Still cached: nothing has told this process anything changed.
    expect(await isSuperAdmin(userId)).toBe(true);

    await bumpElsewhere();
    await new Promise(resolve => setTimeout(resolve, EPOCH_TTL_MS + 50));

    expect(await isSuperAdmin(userId)).toBe(false);
  });

  it("keeps serving inside the interval, which is what makes the read cheap", async () => {
    // The control on both cases above. Without it, "the answer changed" is
    // equally satisfied by reading the shared row on every single check — the
    // per-request query this design exists to avoid — and the interval would be
    // free to regress to zero unnoticed.
    const userId = `within-${randomUUID()}`;
    await promote(userId, `${userId}@example.com`);
    expect(await isSuperAdmin(userId)).toBe(true);

    await demote(userId);
    await bumpElsewhere();

    // No wait. The shared row has moved and this process has not looked.
    expect(await isSuperAdmin(userId)).toBe(true);
  });
});
