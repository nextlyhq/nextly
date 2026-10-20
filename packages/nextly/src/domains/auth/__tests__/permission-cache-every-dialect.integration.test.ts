/**
 * A permission answer kept between requests is kept and served the same way on
 * PostgreSQL, MySQL and SQLite, and a change to a role is seen by the next
 * request.
 *
 * The shared tier is a table every instance reads, so an answer one instance
 * computed spares the others the role walk. It has to work on each dialect:
 * a write that fails, or a stored flag that reads back as something other than
 * a boolean, leaves every check recomputing on that dialect, which is the cost
 * the tier exists to save, with nothing to show it.
 *
 * Driven through a booted instance on every configured dialect, with real
 * users: the table's `user_id` refers to `users`, so a made-up id is refused
 * on the dialects that enforce it and would make a write look like it never
 * lands.
 */

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import {
  clearInMemoryPermissionTiersForTests,
  hasPermission,
} from "../../../services/lib/permissions";
import { resetEpochForTests } from "../../../services/lib/rbac-epoch";
import { PermissionCacheService } from "../services/permission-cache-service";

const ROLE = "role-gadget-reader";
const RESOURCE = "gadgets";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

interface RawDb {
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  delete: (table: unknown) => { where: (cond: unknown) => Promise<unknown> };
  select: (fields: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Array<Record<string, unknown>>>;
    };
  };
}

function raw(t: TestNextly): RawDb {
  return t.adapter.getDrizzle() as unknown as RawDb;
}

async function makeUser(t: TestNextly, email: string): Promise<string> {
  const created = await new ServiceContainer(t.adapter).users.createLocalUser({
    email,
    name: email,
    password: "Str0ng-P@ssw0rd!",
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

/**
 * Boot with one role that grants read on gadgets, and a user who holds it.
 *
 * The first account an install provisions is made super-admin, which answers
 * every check without the cache, so a founder takes that place first and the
 * user under test is the second account.
 */
async function boot(
  dialect: TestDialect
): Promise<{ t: TestNextly; userId: string }> {
  // Started afresh, so an earlier instance in this process leaves no revision
  // for this one to file answers under.
  resetEpochForTests();
  handle = await createTestNextly({ dialect });
  const db = raw(handle);
  const tables = getDialectTables();
  await db.insert(tables.permissions).values({
    id: `perm-${RESOURCE}`,
    name: `Read ${RESOURCE}`,
    slug: `read-${RESOURCE}`,
    action: "read",
    resource: RESOURCE,
  });
  await db.insert(tables.roles).values({
    id: ROLE,
    name: ROLE,
    slug: ROLE,
    level: 10,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(tables.rolePermissions).values({
    id: `${ROLE}-${RESOURCE}`,
    roleId: ROLE,
    permissionId: `perm-${RESOURCE}`,
  });
  await makeUser(handle, "founder@example.com");
  const userId = await makeUser(handle, "reader@example.com");
  await db.insert(tables.userRoles).values({
    id: `${userId}-${ROLE}`,
    userId,
    roleId: ROLE,
    expiresAt: null,
    createdAt: new Date(),
  });
  return { t: handle, userId };
}

function cacheService(t: TestNextly): PermissionCacheService {
  return new PermissionCacheService(t.adapter as never, {
    debug() {},
    info() {},
    warn() {},
    error() {},
  });
}

/**
 * Waits for the kept row of a check to be written. A check keeps its answer
 * after it returns, so the row lands a moment later; a write that never lands
 * leaves this to time out, which is the failure it is for.
 */
async function keptRow(
  t: TestNextly,
  userId: string
): Promise<Record<string, unknown>> {
  const { userPermissionCache } = getDialectTables();
  for (let attempt = 0; attempt < 40; attempt++) {
    const rows = await raw(t)
      .select({ id: userPermissionCache.id })
      .from(userPermissionCache)
      .where(
        and(
          eq(userPermissionCache.userId, userId),
          eq(userPermissionCache.resource, RESOURCE)
        )
      );
    if (rows.length > 0) return rows[0];
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("the check's answer was never kept");
}

/**
 * Waits until the clock is in the second half of a second. A dialect that
 * stores an expiry to the second and rounds, as MySQL does, stores a moment
 * from that half as the NEXT second, so a retirement made then is where a
 * retired row could go on being served; making the change there every time
 * turns a race into a test.
 */
async function intoSecondHalf(): Promise<void> {
  const into = Date.now() % 1000;
  const wait = into >= 600 ? 0 : 600 - into;
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}

describe.each(getConfiguredTestDialects())(
  "a permission answer kept between requests — %s",
  dialect => {
    it("keeps a grant and a denial, and serves each as the boolean it was", async () => {
      const { t, userId } = await boot(dialect);
      const service = cacheService(t);
      await service.setCachedPermission(userId, "read", RESOURCE, true, [ROLE]);
      await service.setCachedPermission(userId, "update", RESOURCE, false, [
        ROLE,
      ]);
      // Exactly `true` and `false`: a stored flag that read back as `1`
      // would pass a truthiness check and still be no answer at all.
      expect(
        (await service.getCachedDecision(userId, "read", RESOURCE))?.allowed
      ).toBe(true);
      expect(
        (await service.getCachedDecision(userId, "update", RESOURCE))?.allowed
      ).toBe(false);
    });

    it("replaces a kept answer when the same check is kept again", async () => {
      const { t, userId } = await boot(dialect);
      const service = cacheService(t);
      await service.setCachedPermission(userId, "read", RESOURCE, true, [ROLE]);
      await service.setCachedPermission(userId, "read", RESOURCE, false, [
        ROLE,
      ]);
      expect(
        (await service.getCachedDecision(userId, "read", RESOURCE))?.allowed
      ).toBe(false);
    });

    it("serves a later check from the kept answer", async () => {
      const { t, userId } = await boot(dialect);
      expect(await hasPermission(userId, "read", RESOURCE)).toBe(true);
      await keptRow(t, userId);
      // The grant goes behind the cache's back, and this process forgets what
      // it held, as another instance would never have held it. Only the kept
      // row can still answer `true`.
      const { rolePermissions } = getDialectTables();
      await raw(t)
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, ROLE));
      clearInMemoryPermissionTiersForTests();
      expect(await hasPermission(userId, "read", RESOURCE)).toBe(true);
    });

    it("sees a role changed between two requests in the second answer", async () => {
      const { t, userId } = await boot(dialect);
      expect(await hasPermission(userId, "read", RESOURCE)).toBe(true);
      await keptRow(t, userId);
      await intoSecondHalf();
      await new ServiceContainer(
        t.adapter
      ).rolePermissions.removePermissionFromRole(ROLE, {
        action: "read",
        resource: RESOURCE,
      });
      expect(await hasPermission(userId, "read", RESOURCE)).toBe(false);
    });

    it("sees a user's role taken away between two requests in the second answer", async () => {
      const { t, userId } = await boot(dialect);
      expect(await hasPermission(userId, "read", RESOURCE)).toBe(true);
      await keptRow(t, userId);
      await intoSecondHalf();
      const removed = await new ServiceContainer(
        t.adapter
      ).userRoles.unassignRoleFromUser(userId, ROLE);
      expect(removed.success).toBe(true);
      expect(await hasPermission(userId, "read", RESOURCE)).toBe(false);
    });
  }
);
