/**
 * A role assignment that has expired grants nothing, on any path.
 *
 * A site gives a role with `expires_at` to have it lapse by itself. Each
 * reader of `user_roles` that decides access used to leave the expiry out,
 * so the lapsed role kept granting: in a session's claims, in a permission
 * check, as super-admin authority, in an API key's grants. And since nothing
 * runs when an expiry passes, a cached answer computed from the role kept
 * serving it for the rest of its life.
 *
 * Every case pairs the lapsed assignment with one in force on the same user,
 * so an answer that refused everything fails a named control rather than
 * passing as a refusal. Run on every configured dialect: each stores the
 * timestamp differently, at second precision on SQLite and MySQL.
 */

// Login and refresh sign with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET = "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { buildAuthRouterDeps } from "../../auth/handlers/deps-bridge";
import { handleLogin } from "../../auth/handlers/login";
import { handleRefresh } from "../../auth/handlers/refresh";
import { getDialectTables } from "../../database/index";
import { ApiKeyService } from "../../domains/auth/services/api-key-service";
import {
  cacheRowId,
  PermissionCacheService,
} from "../../domains/auth/services/permission-cache-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { ServiceContainer } from "../index";

import {
  hasPermission,
  hasSuperAdminExcluding,
  isSuperAdmin,
  listEffectivePermissions,
} from "./permissions";
import { resetEpochForTests } from "./rbac-epoch";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const PASSWORD = "Str0ng-P@ssw0rd!";
const ORIGIN = "http://localhost:3000";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Each role grants read on one resource, named after how it is held. */
const ROLES = {
  current: { id: "role-current", resource: "gadgets" },
  future: { id: "role-future", resource: "gizmos" },
  lapsed: { id: "role-lapsed", resource: "widgets" },
  brief: { id: "role-brief", resource: "sprockets" },
} as const;
/** The install's `super-admin` role, which the first account's creation makes. */
let SUPER_ADMIN_ROLE = "";
/** The account that creation made super-admin, holding the role from boot on. */
let FOUNDER = "";

interface RawDb {
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  delete: (table: unknown) => { where: (cond: unknown) => Promise<unknown> };
  select: (fields: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Array<{ id: string }>>;
    };
  };
}

function raw(t: TestNextly): RawDb {
  return t.adapter.getDrizzle() as unknown as RawDb;
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  // The revision every cache is filed under, started afresh so an earlier
  // instance in this process leaves nothing for this one to serve.
  resetEpochForTests();
  handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  const db = raw(handle);
  const tables = getDialectTables();
  for (const { id, resource } of Object.values(ROLES)) {
    await db.insert(tables.permissions).values({
      id: `perm-${resource}`,
      name: `Read ${resource}`,
      slug: `read-${resource}`,
      action: "read",
      resource,
    });
    await db.insert(tables.roles).values({
      id,
      name: id,
      slug: id,
      level: 10,
      isSystem: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tables.rolePermissions).values({
      id: `${id}-${resource}`,
      roleId: id,
      permissionId: `perm-${resource}`,
    });
  }
  // The first account the app provisions while nobody holds super-admin is
  // made super-admin, and its creation makes the role. A founder takes that
  // place and keeps it: were it removed, the next account created would be
  // made super-admin in its stead. So every assignment of any other account
  // below is one this file chose.
  FOUNDER = await makeUser(handle, "founder@example.com");
  const [superAdmin] = await db
    .select({ id: tables.roles.id })
    .from(tables.roles)
    .where(eq(tables.roles.slug, "super-admin"));
  expect(superAdmin).toBeDefined();
  SUPER_ADMIN_ROLE = String(superAdmin.id);
  return handle;
}

async function makeUser(t: TestNextly, email: string): Promise<string> {
  const created = await new ServiceContainer(t.adapter).users.createLocalUser({
    email,
    name: email,
    password: PASSWORD,
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return String(created.id);
}

/** Gives `roleId` to the user by a raw row, expiring at `expiresAt`. */
async function assign(
  t: TestNextly,
  userId: string,
  roleId: string,
  expiresAt: Date | null
): Promise<void> {
  await raw(t)
    .insert(getDialectTables().userRoles)
    .values({
      id: `${userId}-${roleId}`,
      userId,
      roleId,
      expiresAt,
      createdAt: new Date(),
    });
}

/** A user holding one role with no expiry, one expiring tomorrow, and one that expired yesterday. */
async function userWithThreeRoles(t: TestNextly): Promise<string> {
  const userId = await makeUser(t, "holder@example.com");
  await assign(t, userId, ROLES.current.id, null);
  await assign(t, userId, ROLES.future.id, new Date(Date.now() + DAY_MS));
  await assign(t, userId, ROLES.lapsed.id, new Date(Date.now() - DAY_MS));
  return userId;
}

function authRequest(
  path: string,
  body: Record<string, unknown>,
  cookie = "nextly_csrf=tok"
): Request {
  return new Request(`${ORIGIN}/admin/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, cookie },
    body: JSON.stringify({ csrfToken: "tok", ...body }),
  });
}

/** The role ids a response's access token carries, sorted. */
async function claimedRoles(res: Response): Promise<string[]> {
  const body = (await res.json()) as {
    accessToken?: string;
    refreshToken?: string;
  };
  expect(typeof body.accessToken).toBe("string");
  const claims = decodeJwt(body.accessToken as string) as {
    roleIds?: string[];
  };
  return [...(claims.roleIds ?? [])].sort();
}

/** Waits until the wall clock is past `at`. */
async function waitUntilPast(at: number): Promise<void> {
  const remaining = at - Date.now();
  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining + 50));
  }
}

/**
 * An expiry a few seconds ahead, on a whole second. SQLite and MySQL keep
 * whole seconds, so a fraction would be dropped on the way in and the role
 * would lapse before the moment this test waits for.
 */
function wholeSecondsAhead(seconds: number): Date {
  return new Date((Math.floor(Date.now() / 1000) + seconds) * 1000);
}

function keyService(t: TestNextly): ApiKeyService {
  return new ApiKeyService(t.adapter as never, {
    debug() {},
    info() {},
    warn() {},
    error() {},
  });
}

describe.each(getConfiguredTestDialects())(
  "an expired role assignment grants nothing (%s)",
  (dialect: TestDialect) => {
    it("leaves a lapsed role out of a login's claims and a refresh's", async () => {
      const t = await boot(dialect);
      await userWithThreeRoles(t);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );

      const login = await handleLogin(
        authRequest("login", {
          email: "holder@example.com",
          password: PASSWORD,
        }),
        deps
      );
      expect(login.status).toBe(200);
      const loginBody = (await login.clone().json()) as {
        refreshToken?: string;
      };
      expect(await claimedRoles(login)).toEqual(
        [ROLES.current.id, ROLES.future.id].sort()
      );

      const refresh = await handleRefresh(
        authRequest("refresh", {}, `nextly_refresh=${loginBody.refreshToken}`),
        deps
      );
      expect(refresh.status).toBe(200);
      expect(await claimedRoles(refresh)).toEqual(
        [ROLES.current.id, ROLES.future.id].sort()
      );
    });

    it("ends a session's token no later than a role it carries lapses", async () => {
      // A role in force at login that lapses within the token's life would
      // otherwise answer the stateless session checks until the token expired.
      const t = await boot(dialect);
      const userId = await makeUser(t, "brief-holder@example.com");
      const lapses = wholeSecondsAhead(120);
      await assign(t, userId, ROLES.brief.id, lapses);
      const steady = await makeUser(t, "steady@example.com");
      await assign(t, steady, ROLES.current.id, null);
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );

      const tokenOf = async (res: Response) => {
        const body = (await res.json()) as {
          accessToken: string;
          refreshToken?: string;
        };
        const claims = decodeJwt(body.accessToken) as {
          iat: number;
          exp: number;
          roleIds?: string[];
        };
        return { claims, refreshToken: body.refreshToken };
      };

      const login = await tokenOf(
        await handleLogin(
          authRequest("login", {
            email: "brief-holder@example.com",
            password: PASSWORD,
          }),
          deps
        )
      );
      expect(login.claims.roleIds).toEqual([ROLES.brief.id]);
      expect(login.claims.exp * 1000).toBeLessThanOrEqual(lapses.getTime());

      const refreshed = await tokenOf(
        await handleRefresh(
          authRequest("refresh", {}, `nextly_refresh=${login.refreshToken}`),
          deps
        )
      );
      expect(refreshed.claims.exp * 1000).toBeLessThanOrEqual(lapses.getTime());

      // The control: roles that never lapse leave the configured lifetime.
      const control = await tokenOf(
        await handleLogin(
          authRequest("login", {
            email: "steady@example.com",
            password: PASSWORD,
          }),
          deps
        )
      );
      expect(control.claims.exp - control.claims.iat).toBe(deps.accessTokenTTL);
      expect(deps.accessTokenTTL).toBeGreaterThan(120);
    });

    it("grants no permission through a lapsed role", async () => {
      const t = await boot(dialect);
      const userId = await userWithThreeRoles(t);

      expect(await hasPermission(userId, "read", ROLES.lapsed.resource)).toBe(
        false
      );
      // The controls: the roles in force do grant.
      expect(await hasPermission(userId, "read", ROLES.current.resource)).toBe(
        true
      );
      expect(await hasPermission(userId, "read", ROLES.future.resource)).toBe(
        true
      );
      expect(await listEffectivePermissions(userId)).toEqual(
        [
          `${ROLES.current.resource}:read`,
          `${ROLES.future.resource}:read`,
        ].sort()
      );
    });

    it("gives no super-admin authority through a lapsed assignment", async () => {
      const t = await boot(dialect);
      const lapsed = await makeUser(t, "was-admin@example.com");
      await assign(t, lapsed, SUPER_ADMIN_ROLE, new Date(Date.now() - DAY_MS));
      const held = await makeUser(t, "is-admin@example.com");
      await assign(t, held, SUPER_ADMIN_ROLE, null);
      // Only now, with both accounts made, so neither was granted the role on
      // creation: the founder's own assignment goes, leaving these two the
      // only ones that name it.
      const { userRoles } = getDialectTables();
      await raw(t).delete(userRoles).where(eq(userRoles.userId, FOUNDER));

      expect(await isSuperAdmin(lapsed)).toBe(false);
      expect(await isSuperAdmin(held)).toBe(true);
      // The last-super-admin guard counts only a held assignment: with `held`
      // excluded, nobody else holds the role; with `lapsed` excluded, `held`
      // still does.
      expect(await hasSuperAdminExcluding(held)).toBe(false);
      expect(await hasSuperAdminExcluding(lapsed)).toBe(true);
    });

    it("leaves a lapsed role's grants, and a lapsed super-admin's catalogue, out of an API key", async () => {
      const t = await boot(dialect);
      const owner = await userWithThreeRoles(t);
      const grants = await keyService(t).resolveApiKeyGrants(
        "full-access",
        null,
        owner,
        `key-of-holder-${randomUUID()}`
      );
      expect(grants.map(g => g.slug).sort()).toEqual(
        [
          `read-${ROLES.current.resource}`,
          `read-${ROLES.future.resource}`,
        ].sort()
      );

      // A key whose owner's super-admin assignment has lapsed copies the
      // owner's ordinary grants, not the whole catalogue.
      const formerAdmin = await makeUser(t, "former-admin@example.com");
      await assign(
        t,
        formerAdmin,
        SUPER_ADMIN_ROLE,
        new Date(Date.now() - DAY_MS)
      );
      await assign(t, formerAdmin, ROLES.current.id, null);
      const formerGrants = await keyService(t).resolveApiKeyGrants(
        "full-access",
        null,
        formerAdmin,
        `key-of-former-admin-${randomUUID()}`
      );
      expect(formerGrants.map(g => g.slug)).toEqual([
        `read-${ROLES.current.resource}`,
      ]);
    });

    it("stops serving a cached answer once the role it came from lapses", async () => {
      // Each answer is asked while the role is in force, which caches it, and
      // again after the expiry, with no invalidation in between: only the
      // expiry can end the cached copies.
      const t = await boot(dialect);
      const userId = await makeUser(t, "brief@example.com");
      const briefKey = `key-of-brief-${randomUUID()}`;
      await assign(t, userId, ROLES.current.id, null);
      const briefUntil = wholeSecondsAhead(3);
      await assign(t, userId, ROLES.brief.id, briefUntil);
      await assign(t, userId, SUPER_ADMIN_ROLE, briefUntil);

      expect(await hasPermission(userId, "read", ROLES.brief.resource)).toBe(
        true
      );
      expect(await isSuperAdmin(userId)).toBe(true);
      const before = await keyService(t).resolveApiKeyGrants(
        "full-access",
        null,
        userId,
        briefKey
      );
      expect(before.map(g => g.slug)).toContain(`read-${ROLES.brief.resource}`);

      await waitUntilPast(briefUntil.getTime());

      expect(await hasPermission(userId, "read", ROLES.brief.resource)).toBe(
        false
      );
      expect(await isSuperAdmin(userId)).toBe(false);
      const after = await keyService(t).resolveApiKeyGrants(
        "full-access",
        null,
        userId,
        briefKey
      );
      expect(after.map(g => g.slug)).toEqual([
        `read-${ROLES.current.resource}`,
      ]);
      // The control: the role with no expiry still grants, from cache or not.
      expect(await hasPermission(userId, "read", ROLES.current.resource)).toBe(
        true
      );
    }, 20_000);

    it("lists only the roles in force, and gives a lapsed role again when asked", async () => {
      const t = await boot(dialect);
      const userId = await userWithThreeRoles(t);
      const userRoles = new ServiceContainer(t.adapter).userRoles;

      expect((await userRoles.listUserRoles(userId)).sort()).toEqual(
        [ROLES.current.id, ROLES.future.id].sort()
      );
      expect((await userRoles.listUserRoleNames(userId)).sort()).toEqual(
        [ROLES.current.id, ROLES.future.id].sort()
      );

      // Assigning the lapsed role again gives it, rather than answering that
      // it is already assigned while it grants nothing.
      const assigned = await userRoles.assignRoleToUser(
        userId,
        ROLES.lapsed.id
      );
      expect(assigned.success).toBe(true);
      expect(await hasPermission(userId, "read", ROLES.lapsed.resource)).toBe(
        true
      );
      // A role held now is still refused as already assigned.
      const again = await userRoles.assignRoleToUser(userId, ROLES.current.id);
      expect(again.statusCode).toBe(409);
    });

    it("gives a lapsed role again when a full role list names it", async () => {
      const t = await boot(dialect);
      const userId = await userWithThreeRoles(t);
      const userRoles = new ServiceContainer(t.adapter).userRoles;

      const changed = await userRoles.replaceUserRoles(
        userId,
        [ROLES.current.id, ROLES.future.id, ROLES.lapsed.id],
        t.adapter.getDrizzle()
      );
      expect(changed).toBe(true);
      expect(await hasPermission(userId, "read", ROLES.lapsed.resource)).toBe(
        true
      );
    });

    it("keeps a grant another request made between the check and the replacement", async () => {
      // Giving a lapsed role again replaces its lapsed row. The check that
      // finds it lapsed is a read, so another request can grant the role in
      // between, and the replacement must leave that grant as it was rather
      // than put this request's expiry over it. The other request runs at the
      // last moment it could: as this one's delete is about to execute.
      const t = await boot(dialect);
      const userId = await makeUser(t, "regrant@example.com");
      await assign(t, userId, ROLES.lapsed.id, new Date(Date.now() - DAY_MS));
      const { userRoles } = getDialectTables();
      const service = new ServiceContainer(t.adapter).userRoles;

      let granted = false;
      const otherRequest = async () => {
        granted = true;
        await raw(t).delete(userRoles).where(eq(userRoles.userId, userId));
        await assign(t, userId, ROLES.lapsed.id, null);
      };
      // The service's handle, and any transaction it opens on it, stop just
      // before their first delete until the other request is done: the
      // assignment is written inside a transaction on PostgreSQL and MySQL.
      // The other request is made by the test itself, outside that
      // transaction's flow, as a second request is.
      let reachedDelete!: () => void;
      const atDelete = new Promise<void>(resolve => (reachedDelete = resolve));
      let otherRequestDone!: () => void;
      const afterOther = new Promise<void>(
        resolve => (otherRequestDone = resolve)
      );
      const intercepted = <T extends object>(handle: T): T =>
        new Proxy(handle, {
          get(target, prop) {
            const value = Reflect.get(target, prop) as unknown;
            if (prop === "delete" && typeof value === "function" && !granted) {
              return (table: unknown) => {
                const builder = (
                  value as (t: unknown) => {
                    where: (cond: unknown) => Promise<unknown>;
                  }
                ).call(target, table);
                return {
                  where: async (cond: unknown) => {
                    granted = true;
                    reachedDelete();
                    await afterOther;
                    return builder.where(cond);
                  },
                };
              };
            }
            if (prop === "transaction" && typeof value === "function") {
              return (work: (tx: object) => Promise<unknown>) =>
                (
                  value as (w: (tx: object) => Promise<unknown>) => unknown
                ).call(target, (tx: object) => work(intercepted(tx)));
            }
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      const realDb = (service as unknown as { db: object }).db;
      const db = intercepted(realDb);
      Object.defineProperty(service, "db", { get: () => db });

      // This request asks for an hour; the grant made meanwhile has no end.
      const assigning = service.assignRoleToUser(userId, ROLES.lapsed.id, {
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await Promise.race([atDelete, assigning]);
      await otherRequest();
      otherRequestDone();
      await assigning;

      expect(granted).toBe(true);
      const rows = (await raw(t)
        .select({ id: userRoles.id, expiresAt: userRoles.expiresAt })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.roleId, ROLES.lapsed.id)
          )
        )) as unknown as Array<{ id: string; expiresAt: unknown }>;
      expect(rows).toEqual([
        { id: `${userId}-${ROLES.lapsed.id}`, expiresAt: null },
      ]);
    });

    it("serves no cached answer an earlier release wrote", async () => {
      // An earlier release ended a cached row only at the cache TTL, whatever
      // the roles it came from. After an upgrade, one that granted through a
      // role since lapsed must not answer for the rest of that TTL.
      const t = await boot(dialect);
      const userId = await makeUser(t, "upgraded@example.com");
      await assign(t, userId, ROLES.lapsed.id, new Date(Date.now() - DAY_MS));
      const cache = new PermissionCacheService(t.adapter as never, {
        debug() {},
        info() {},
        warn() {},
        error() {},
      });
      const { userPermissionCache } = getDialectTables();
      /** A granting row for `resource`, filed under `id`, ending in five minutes. */
      const grantRow = (id: string, resource: string) =>
        raw(t)
          .insert(userPermissionCache)
          .values({
            id,
            userId,
            action: "read",
            resource,
            hasPermission: true,
            roleIds:
              dialect === "sqlite"
                ? JSON.stringify([ROLES.lapsed.id])
                : [ROLES.lapsed.id],
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            createdAt: new Date(),
          });
      // The control: the same row under the id this release files it under
      // is read back, so the miss below is about the id, not a cache that
      // reads nothing. Truthy rather than `true`: what is under test is that
      // the row is found, and MySQL hands back the stored flag as `1`.
      await grantRow(
        cacheRowId(userId, "read", ROLES.current.resource),
        ROLES.current.resource
      );
      expect(
        await cache.getCachedPermission(userId, "read", ROLES.current.resource)
      ).toBeTruthy();

      // The row as that release filed it: under `user|action|resource`.
      await grantRow(
        `${userId}|read|${ROLES.lapsed.resource}`,
        ROLES.lapsed.resource
      );

      expect(
        await cache.getCachedPermission(userId, "read", ROLES.lapsed.resource)
      ).toBeNull();
      expect(await hasPermission(userId, "read", ROLES.lapsed.resource)).toBe(
        false
      );
    });
  }
);
