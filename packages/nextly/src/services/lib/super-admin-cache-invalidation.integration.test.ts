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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../database/index";
import { ApiKeyService } from "../../domains/auth/services/api-key-service";
import { PermissionCacheService } from "../../domains/auth/services/permission-cache-service";
import { PermissionService } from "../../domains/auth/services/permission-service";

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
 * A batch of permission writes retires the caches ONCE.
 *
 * The database tier is tombstoned by an unfiltered update of every cached row.
 * That is the right cost once and the wrong cost per row: a seeder ensures one
 * permission at a time, so a single new collection would rewrite and lock the
 * whole table once per permission, each pass after the first expiring rows the
 * previous one had already expired.
 */
describe("a sweep of permission writes", () => {
  it("files nothing as current while the batch is open", async () => {
    // A resolution running alongside the batch has to be refused. What refuses
    // it is not the counter: the counter stays where it is until the stored
    // rows have actually been retired, because announcing sooner tells every
    // other instance to drop its own answer and read one of those rows.
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
    // ...and nothing was announced while the stored rows were still live.
    expect(new Set(announced)).toEqual(new Set([before]));
    // The announcement happens once, on the way out, after the retirement.
    expect(rbacRevision()).not.toBe(before);
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

  it("still defers the expensive table write, which is what the batch is for", async () => {
    // The control, on the deferral that remains. The in-memory tiers no longer
    // wait for the batch — the epoch moves the moment anything invalidates, so
    // a demoted user stops reading as an admin immediately, inside a batch or
    // out of it. What a batch still saves is the unfiltered rewrite of every
    // stored row, which is the cost it was built for.
    //
    // Observed on a row put there directly, because `setCachedPermission` does
    // not take effect under `createTestNextly`. A far-future expiry is what the
    // flush overwrites, so its survival IS the deferral.
    const db = harness!.adapter.getDrizzle() as unknown as {
      insert: (t: unknown) => { values: (row: unknown) => Promise<unknown> };
      select: (p: unknown) => {
        from: (t: unknown) => { where: (c: unknown) => Promise<unknown[]> };
      };
    };
    const tables = getDialectTables();
    const rowId = `defer-${randomUUID()}`;
    const owner = `defer-user-${randomUUID()}`;
    await promote(owner, `${owner}@example.com`);
    const farFuture = new Date(Date.now() + 3_600_000);
    await db.insert(tables.userPermissionCache).values({
      id: rowId,
      userId: owner,
      action: "read",
      resource: "notes",
      hasPermission: true,
      roleIds: "[]",
      expiresAt: farFuture,
      createdAt: new Date(),
    });

    const stillFuture = async () => {
      const rows = (await db
        .select({ expiresAt: tables.userPermissionCache.expiresAt })
        .from(tables.userPermissionCache)
        .where(eq(tables.userPermissionCache.id, rowId))) as Array<{
        expiresAt: Date | number;
      }>;
      const value = rows[0]?.expiresAt;
      const ms = value instanceof Date ? value.getTime() : Number(value) * 1000;
      return ms > Date.now() + 60_000;
    };

    let releaseBatch: () => void = () => {};
    const batchRunning = new Promise<void>(resolve => {
      releaseBatch = resolve;
    });
    const batch = inPermissionSweep(async () => {
      await invalidateAllPermissionCaches();
      const duringBatch = await stillFuture();
      await batchRunning;
      return duringBatch;
    });

    releaseBatch();
    // Untouched while the batch was open...
    expect(await batch, "deferred during the batch").toBe(true);
    // ...and rewritten on the way out, so deferred is not skipped.
    expect(await stillFuture(), "flushed on exit").toBe(false);
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
 * The stored tier is emptied BEFORE the epoch that retires the rest is
 * published.
 *
 * The epoch is the only signal another instance receives, and it is a one-way
 * barrier: an answer filed before it moves is retired by the move, an answer
 * filed after it is not. Announce first and every other instance gets a window
 * in which it rejects its own in-memory answer, reads the stored row the
 * tombstone has not reached yet, and files that retired decision under the NEW
 * epoch, where nothing still to happen can reach it. Empty the stored rows
 * first and both halves close: an instance that has not seen the move files
 * under the old epoch and the move retires it, and one that has seen the move
 * finds nothing to file.
 *
 * The interleaving is the subject, and both steps have finished by the time the
 * call returns, so it cannot be seen from outside. The real retirement is left
 * to run and only asked which epoch it ran under, which is the one fact that
 * tells the two orders apart.
 */
describe("the order the two tiers are retired in", () => {
  type Tombstone = (...args: never[]) => Promise<unknown>;

  async function epochsAround(
    method: "invalidateAll" | "invalidateByUser",
    invalidate: () => Promise<void>
  ): Promise<{ before: string; during: string; after: string }> {
    const proto = PermissionCacheService.prototype as unknown as Record<
      string,
      Tombstone
    >;
    const original = proto[method];
    const before = rbacRevision();
    let during = "";
    proto[method] = function (this: unknown, ...args: never[]) {
      during = rbacRevision();
      return original.apply(this, args);
    };
    try {
      await invalidate();
    } finally {
      proto[method] = original;
    }
    return { before, during, after: rbacRevision() };
  }

  it("empties the stored rows before it announces the new epoch", async () => {
    const { before, during, after } = await epochsAround("invalidateAll", () =>
      invalidateAllPermissionCaches()
    );

    // The tombstone ran while the epoch was still the one every instance had.
    expect(during).toBe(before);
    // And the announcement did happen, so the assertion above is not passing
    // because nothing moved at all.
    expect(after).not.toBe(before);
  });

  it("raises when the stored tier refuses, rather than reporting nothing done", async () => {
    // The half the cases below cannot reach. They replace `invalidateAll` with
    // a rejection to exercise the caller, which proves nothing about whether
    // the real one rejects — and it used to catch its own database error and
    // answer `0`, which is also what a successful tombstone over an empty table
    // answers. The caller could not tell those apart, so it published either
    // way. This asks the real method, over an adapter whose write fails.
    const real = harness!.adapter;
    const unwritable = Object.create(real) as typeof real;
    (unwritable as { getDrizzle: unknown }).getDrizzle = () => ({
      update: () => ({
        set: () => Promise.reject(new Error("the stored tier is unreachable")),
      }),
    });

    const service = new PermissionCacheService(unwritable, console, {
      cacheTtlSeconds: 300,
    });

    await expect(service.invalidateAll()).rejects.toThrow(
      "the stored tier is unreachable"
    );
  });

  it("answers a count when the write succeeds, so raising is not its only mode", async () => {
    // The control. Without it, "rejects on failure" is equally satisfied by a
    // method that rejects on every call.
    const service = new PermissionCacheService(harness!.adapter, console, {
      cacheTtlSeconds: 300,
    });

    await expect(service.invalidateAll()).resolves.toBeTypeOf("number");
  });

  it("announces nothing when the stored rows could not be retired", async () => {
    // The epoch means "everything filed before this is gone". A tombstone that
    // failed leaves those rows live, so the sentence is false — and announcing
    // it anyway is worse than silence: every other instance rejects its own
    // in-memory answer BECAUSE the epoch moved, reads one of those rows, and
    // files it under the new epoch where nothing left to happen can reach it.
    const proto = PermissionCacheService.prototype as unknown as Record<
      string,
      Tombstone
    >;
    const original = proto.invalidateAll;
    const before = rbacRevision();
    proto.invalidateAll = () =>
      Promise.reject(new Error("the stored tier is unreachable"));
    try {
      await invalidateAllPermissionCaches();
    } finally {
      proto.invalidateAll = original;
    }

    expect(rbacRevision()).toBe(before);
  });

  it("announces when it CAN retire them, which is what makes silence a choice", async () => {
    // The control. Without it, "announces nothing on failure" is equally
    // satisfied by an epoch that never moves at all.
    const before = rbacRevision();

    await invalidateAllPermissionCaches();

    expect(rbacRevision()).not.toBe(before);
  });

  it("still empties its own memory when the stored tier refuses", async () => {
    // Withholding the announcement must not withhold the local retirement:
    // this process knows the rows changed whatever the shared tier did.
    const userId = `unreachable-${randomUUID()}`;
    await promote(userId, `${userId}@example.com`);
    expect(await isSuperAdmin(userId)).toBe(true);
    await demote(userId);

    const proto = PermissionCacheService.prototype as unknown as Record<
      string,
      Tombstone
    >;
    const original = proto.invalidateAll;
    proto.invalidateAll = () =>
      Promise.reject(new Error("the stored tier is unreachable"));
    try {
      await invalidateAllPermissionCaches();
    } finally {
      proto.invalidateAll = original;
    }

    expect(await isSuperAdmin(userId)).toBe(false);
  });

  it("does the same for an invalidation scoped to one user", async () => {
    // A scoped tombstone is smaller, not faster: it is still an awaited write,
    // so announcing ahead of it opens the same window.
    const userId = `order-${randomUUID()}`;
    await promote(userId, `${userId}@example.com`);

    const { before, during, after } = await epochsAround(
      "invalidateByUser",
      () => invalidatePermissionCache({ userId })
    );

    expect(during).toBe(before);
    expect(after).not.toBe(before);
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
