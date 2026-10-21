/**
 * The last active super-admin cannot be removed, by any path, even when
 * requests race.
 *
 * Deleting, deactivating or taking the role from the only active super-admin
 * leaves nobody who can administer the install, and recovering means editing
 * the database by hand. Each removal is refused with the same message, through
 * REST and the Direct API, and every refusal is paired with a control holding
 * a second active super-admin, so a guard that refused everything fails a
 * named case rather than passing as a refusal.
 *
 * The races are what a read-then-check guard cannot hold: two requests that
 * each remove one of the last two super-admins both see the other still
 * there. The first is held open inside its transaction the moment its guard
 * has decided, before it writes anything, until the database shows the second
 * WAITING on a lock (PostgreSQL and MySQL). Without the lock the second's
 * guard would then decide too, on the same rows, and the two writes would
 * deadlock or both land; with it the second is refused once the first commits.
 * SQLite serializes write transactions, so there the second simply queues.
 *
 * Run on every configured dialect: the lock and the locking reads are
 * statements each dialect builds and runs itself.
 */

// API keys and sessions sign with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Run once, when the next guard has decided to let a removal through. */
const afterGuard = vi.hoisted(() => ({
  run: undefined as (() => Promise<void>) | undefined,
}));

// The guard runs first in each removal's transaction. Pausing once it has let
// the removal through holds that transaction open with the guard's locks and
// none of the write's, which is the moment a second removal's guard would
// otherwise read the same rows and decide the same way.
vi.mock("../services/last-super-admin", async importOriginal => {
  const real =
    await importOriginal<typeof import("../services/last-super-admin")>();
  return {
    ...real,
    refuseRemovingLastSuperAdmin: async (
      ...args: Parameters<typeof real.refuseRemovingLastSuperAdmin>
    ) => {
      await real.refuseRemovingLastSuperAdmin(...args);
      const hook = afterGuard.run;
      if (hook) {
        afterGuard.run = undefined;
        await hook();
      }
    },
  };
});

import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

/**
 * The modules a case drives, imported afresh for each instance.
 *
 * The REST dispatcher is cached at module level for the life of a process and
 * keeps the adapter it was first built on, which `destroy()` disconnects: a
 * later instance reached through REST would find that adapter closed. A fresh
 * module graph per instance gives each its own dispatcher, as each process has
 * its own. Everything below that touches the instance comes from here, so no
 * case mixes one graph's tables or caches with another's.
 */
async function loadModules() {
  vi.resetModules();
  const harness = await import("../../../plugins/test-nextly");
  const routes = await import("../../../routeHandler");
  const database = await import("../../../database/index");
  const seeders = await import("../../../database/seeders");
  const permissions = await import("../../../services/lib/permissions");
  const epoch = await import("../../../services/lib/rbac-epoch");
  const config = await import("../../../shared/types/config");
  const claims = await import("../../../auth/jwt/claims");
  const sign = await import("../../../auth/jwt/sign");
  return {
    createTestNextly: harness.createTestNextly,
    createDynamicHandlers: routes.createDynamicHandlers,
    getDialectTables: database.getDialectTables,
    seedPermissions: seeders.seedPermissions,
    isSuperAdminOrThrow: permissions.isSuperAdminOrThrow,
    resetEpochForTests: epoch.resetEpochForTests,
    sanitizeConfig: config.sanitizeConfig,
    buildClaims: claims.buildClaims,
    signAccessToken: sign.signAccessToken,
  };
}

let m: Awaited<ReturnType<typeof loadModules>>;

const PASSWORD = "Str0ng-P@ssw0rd!";
const REFUSAL = /make another user super-admin first/i;

let handle: TestNextly | undefined;
let dialect: TestDialect = "sqlite";

afterEach(async () => {
  afterGuard.run = undefined;
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

function raw(): RawDb {
  return handle!.adapter.getDrizzle() as unknown as RawDb;
}

interface DirectUsers {
  create: (a: {
    data: Record<string, unknown>;
  }) => Promise<{ item: { id: string } }>;
  update: (a: {
    id: string;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
  delete: (a: { id: string }) => Promise<unknown>;
}

interface DirectRoles {
  create: (a: {
    data: Record<string, unknown>;
  }) => Promise<{ item: { id: string } }>;
}

function direct(): { users: DirectUsers; roles: DirectRoles } {
  return handle!.nextly as unknown as {
    users: DirectUsers;
    roles: DirectRoles;
  };
}

/** What every case starts from: who exists, and the key REST calls carry. */
interface Install {
  /** The install's first account, which its creation makes super-admin. */
  first: string;
  superAdminRole: string;
  /** A role that is not super-admin, for a role replacement to move to. */
  editorRole: string;
  /** A permission to build roles from: a role must grant at least one. */
  readUsers: string;
  /** A full-access key of an account that manages users but is no super-admin. */
  operatorKey: string;
}

async function makeUser(email: string): Promise<string> {
  const created = await direct().users.create({
    data: { email, password: PASSWORD, name: email, isActive: true },
  });
  return String(created.item.id);
}

async function grant(
  userId: string,
  roleId: string,
  opts: { expiresAt?: Date } = {}
): Promise<void> {
  await raw()
    .insert(m.getDialectTables().userRoles)
    .values({
      id: `${userId}-${roleId}`,
      userId,
      roleId,
      expiresAt: opts.expiresAt ?? null,
      createdAt: new Date(),
    });
}

/** The expiry of `userId`'s assignment of `roleId`, read fresh. */
async function expiryOf(userId: string, roleId: string): Promise<unknown> {
  const { userRoles } = m.getDialectTables();
  const [row] = await raw()
    .select({ expiresAt: userRoles.expiresAt })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  expect(row, "the assignment must exist").toBeDefined();
  return row.expiresAt;
}

const IN_AN_HOUR = () => new Date(Date.now() + 60 * 60 * 1000);

/** How many times each race is run. */
const ROUNDS = 3;

async function boot(on: TestDialect): Promise<Install> {
  m = await loadModules();
  m.resetEpochForTests();
  dialect = on;
  handle = await m.createTestNextly(on === "sqlite" ? {} : { dialect: on });
  const tables = m.getDialectTables();

  const first = await makeUser("first@example.com");
  const [superAdmin] = await raw()
    .select({ id: tables.roles.id })
    .from(tables.roles)
    .where(eq(tables.roles.slug, "super-admin"));
  expect(superAdmin).toBeDefined();
  const superAdminRole = String(superAdmin.id);

  // The caller REST requests come from: it may manage users, and is not a
  // super-admin itself, so it is never one of the accounts being counted.
  // The core permissions are seeded by first-run setup, which this instance
  // never ran, so they are seeded here as setup seeds them.
  await m.seedPermissions(handle.adapter, { silent: true });
  const slugs = [
    "read-users",
    "update-users",
    "delete-users",
    "read-roles",
    "update-roles",
    "delete-roles",
  ];
  const seeded = await raw()
    .select({ id: tables.permissions.id, slug: tables.permissions.slug })
    .from(tables.permissions)
    .where(inArray(tables.permissions.slug, slugs));
  const userGrants = slugs.map(slug => {
    const found = seeded.find(p => p.slug === slug);
    expect(found, `\`${slug}\` must be seeded`).toBeDefined();
    return String(found!.id);
  });
  const userAdmin = await direct().roles.create({
    data: {
      name: "User admin",
      slug: "user-admin",
      permissionIds: userGrants,
    },
  });
  const editor = await direct().roles.create({
    data: { name: "Editor", slug: "editor", permissionIds: [userGrants[0]] },
  });
  const operator = await makeUser("operator@example.com");
  await grant(operator, userAdmin.item.id);
  const apiKeys = handle.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: { name: string; tokenType: string; expiresIn: string }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(operator, {
    name: "operator",
    tokenType: "full-access",
    expiresIn: "never",
  });

  return {
    first,
    superAdminRole,
    editorRole: editor.item.id,
    readUsers: userGrants[0],
    operatorKey: key,
  };
}

/** A second super-admin beside the first, active unless said otherwise. */
async function secondSuperAdmin(
  install: Install,
  opts: { active?: boolean } = {}
): Promise<string> {
  const second = await makeUser("second@example.com");
  await grant(second, install.superAdminRole);
  if (opts.active === false) {
    await direct().users.update({ id: second, data: { isActive: false } });
  }
  return second;
}

async function rest(
  install: Install,
  method: "POST" | "PATCH" | "DELETE",
  path: string[],
  body?: Record<string, unknown>,
  /** Sign in as this user, rather than with the operator's key. */
  as?: string
): Promise<Response> {
  const handlers = m.createDynamicHandlers({
    config: m.sanitizeConfig({ collections: [] }),
  });
  const req = new Request(`http://localhost/api/${path.join("/")}`, {
    method,
    headers: {
      ...(as === undefined
        ? { authorization: `Bearer ${install.operatorKey}` }
        : { cookie: await sessionCookie(as) }),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const ctx = { params: Promise.resolve({ params: path }) };
  return method === "POST"
    ? handlers.POST(req, ctx)
    : method === "PATCH"
      ? handlers.PATCH(req, ctx)
      : handlers.DELETE(req, ctx);
}

async function sessionCookie(userId: string): Promise<string> {
  const token = await m.signAccessToken(
    m.buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return `nextly_session=${token}`;
}

/**
 * A REST call that rejects as the Direct API does when it is refused, so a
 * race can pit a REST-only removal against another.
 */
async function restOrThrow(
  install: Install,
  method: "PATCH" | "DELETE",
  path: string[],
  body?: Record<string, unknown>
): Promise<void> {
  const res = await rest(install, method, path, body);
  if (res.status < 300) return;
  const text = await res.text();
  const parsed = JSON.parse(text) as {
    error?: { code?: string; message?: string };
  };
  throw Object.assign(new Error(text), {
    code: parsed.error?.code,
    publicMessage: parsed.error?.message,
  });
}

async function expectRestRefused(res: Response): Promise<void> {
  const text = await res.text();
  expect(res.status, text).toBe(409);
  expect(text).toMatch(REFUSAL);
}

async function expectRestAllowed(res: Response): Promise<void> {
  const text = await res.text();
  expect(res.status, text).toBeLessThan(300);
}

async function expectDirectRefused(work: Promise<unknown>): Promise<void> {
  const err = await work.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(err, "the removal must be refused").toBeDefined();
  expect(err).toMatchObject({ code: "CONFLICT" });
  expect((err as { publicMessage?: string }).publicMessage).toMatch(REFUSAL);
}

/** Whether the account exists, is active, and is a super-admin, read fresh. */
async function activeSuperAdmin(userId: string): Promise<boolean> {
  const { users } = m.getDialectTables();
  const [row] = await raw()
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId));
  if (!row || !row.isActive) return false;
  return m.isSuperAdminOrThrow(userId, handle!.adapter.getDrizzle());
}

/**
 * Resolves once another statement on this test's database is waiting for a
 * lock, or after `timeoutMs` when none does. SQLite has no such view, and
 * serializes write transactions anyway, so there it only yields.
 *
 * PostgreSQL names the wait. MySQL lists a statement blocked on a row lock
 * taken while its plan is read (`FOR UPDATE` on a unique key) in neither
 * `INNODB_TRX` nor `LOCK WAIT`, so there a statement still running after a
 * full second, while the first transaction sits paused, is the wait.
 */
async function untilAnotherWaitsOnALock(timeoutMs = 5000): Promise<boolean> {
  if (dialect === "sqlite") {
    await new Promise(resolve => setTimeout(resolve, 100));
    return false;
  }
  const probe =
    dialect === "postgresql"
      ? `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`
      : `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST
         WHERE DB = DATABASE() AND ID <> CONNECTION_ID()
           AND COMMAND = 'Query' AND TIME >= 1`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await handle!.adapter.executeQuery<{ n: number | string }>(
      probe
    );
    if (Number(rows[0]?.n ?? 0) > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

/**
 * Runs `first` and holds its transaction open once its guard has let it
 * through, before it writes; starts `second` meanwhile, and lets the first go
 * on only once the second waits on a lock (or the wait times out, in which
 * case nothing excluded the two and the outcome below says so).
 */
async function race(
  first: () => Promise<unknown>,
  second: () => Promise<unknown>
): Promise<{
  outcomes: PromiseSettledResult<unknown>[];
  secondWaited: boolean;
}> {
  let release!: () => void;
  const released = new Promise<void>(resolve => (release = resolve));
  let paused!: () => void;
  const isPaused = new Promise<void>(resolve => (paused = resolve));
  afterGuard.run = async () => {
    paused();
    await released;
  };

  const firstRun = first();
  await Promise.race([isPaused, firstRun.catch(() => undefined)]);
  const secondRun = second();
  const secondWaited = await untilAnotherWaitsOnALock();
  release();
  const outcomes = await Promise.allSettled([firstRun, secondRun]);
  return { outcomes, secondWaited };
}

function expectOneRefused(outcomes: PromiseSettledResult<unknown>[]): void {
  const fulfilled = outcomes.filter(o => o.status === "fulfilled");
  const rejected = outcomes.filter(
    (o): o is PromiseRejectedResult => o.status === "rejected"
  );
  expect(
    fulfilled.length,
    `exactly one removal may succeed: ${JSON.stringify(
      rejected.map(r => String(r.reason))
    )}`
  ).toBe(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason).toMatchObject({ code: "CONFLICT" });
  expect(
    (rejected[0].reason as { publicMessage?: string }).publicMessage
  ).toMatch(REFUSAL);
}

describe.each(getConfiguredTestDialects())(
  "the last active super-admin (%s)",
  on => {
    describe("deleting", () => {
      it("is refused through REST, and the account stays", async () => {
        const install = await boot(on);
        await expectRestRefused(
          await rest(install, "DELETE", ["users", install.first])
        );
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("is refused through the Direct API, and the account stays", async () => {
        const install = await boot(on);
        await expectDirectRefused(direct().users.delete({ id: install.first }));
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("is allowed through REST with a second active super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        await expectRestAllowed(
          await rest(install, "DELETE", ["users", install.first])
        );
        expect(await activeSuperAdmin(install.first)).toBe(false);
        expect(await activeSuperAdmin(second)).toBe(true);
      });

      it("is allowed through the Direct API with a second active super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        await direct().users.delete({ id: install.first });
        expect(await activeSuperAdmin(install.first)).toBe(false);
        expect(await activeSuperAdmin(second)).toBe(true);
      });

      it("is refused when the only other super-admin is deactivated", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install, { active: false });
        expect(await activeSuperAdmin(second)).toBe(false);
        await expectDirectRefused(direct().users.delete({ id: install.first }));
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("deletes a deactivated super-admin, which removes no active one", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install, { active: false });
        await direct().users.delete({ id: second });
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });
    });

    describe("deactivating", () => {
      it("is refused through REST, and the account stays active", async () => {
        const install = await boot(on);
        await expectRestRefused(
          await rest(install, "PATCH", ["users", install.first], {
            isActive: false,
          })
        );
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("is refused through the Direct API, and the account stays active", async () => {
        const install = await boot(on);
        await expectDirectRefused(
          direct().users.update({
            id: install.first,
            data: { isActive: false },
          })
        );
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("is allowed through REST with a second active super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        await expectRestAllowed(
          await rest(install, "PATCH", ["users", install.first], {
            isActive: false,
          })
        );
        expect(await activeSuperAdmin(install.first)).toBe(false);
        expect(await activeSuperAdmin(second)).toBe(true);
      });

      it("is allowed through the Direct API with a second active super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        await direct().users.update({
          id: install.first,
          data: { isActive: false },
        });
        expect(await activeSuperAdmin(install.first)).toBe(false);
        expect(await activeSuperAdmin(second)).toBe(true);
      });
    });

    describe("taking the role away", () => {
      it("is refused through a REST role replacement", async () => {
        const install = await boot(on);
        await expectRestRefused(
          await rest(install, "PATCH", ["users", install.first], {
            roles: [install.editorRole],
          })
        );
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("is refused through a Direct API role replacement", async () => {
        const install = await boot(on);
        await expectDirectRefused(
          direct().users.update({
            id: install.first,
            data: { roles: [install.editorRole] },
          })
        );
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("is refused through the REST role unassignment", async () => {
        const install = await boot(on);
        await expectRestRefused(
          await rest(install, "DELETE", [
            "users",
            install.first,
            "roles",
            install.superAdminRole,
          ])
        );
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("is allowed through the REST role unassignment with a second active super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        await expectRestAllowed(
          await rest(install, "DELETE", [
            "users",
            install.first,
            "roles",
            install.superAdminRole,
          ])
        );
        expect(await activeSuperAdmin(install.first)).toBe(false);
        expect(await activeSuperAdmin(second)).toBe(true);
      });

      it("is allowed through a Direct API role replacement with a second active super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        await direct().users.update({
          id: install.first,
          data: { roles: [install.editorRole] },
        });
        expect(await activeSuperAdmin(install.first)).toBe(false);
        expect(await activeSuperAdmin(second)).toBe(true);
      });
    });

    describe("a super-admin through a role that inherits the role", () => {
      /** A role built on `super-admin`, as creating a role with a base role writes it. */
      async function ownerRole(
        install: Install,
        slug = "owner"
      ): Promise<string> {
        const owner = await direct().roles.create({
          data: { name: slug, slug, permissionIds: [install.readUsers] },
        });
        await raw()
          .insert(m.getDialectTables().roleInherits)
          .values({
            id: `${slug}-inherits-super-admin`,
            parentRoleId: owner.item.id,
            childRoleId: install.superAdminRole,
          });
        return owner.item.id;
      }

      /** An heir holding a role built on `super-admin`. */
      async function heir(
        install: Install,
        slug = "owner"
      ): Promise<{ heir: string; owner: string }> {
        const owner = await ownerRole(install, slug);
        const id = await makeUser(`${slug}-heir@example.com`);
        await grant(id, owner);
        return { heir: id, owner };
      }

      /** The heir is the only super-admin: the first account no longer holds the role. */
      async function heirOnly(
        install: Install
      ): Promise<{ heir: string; owner: string }> {
        const h = await heir(install);
        const { userRoles } = m.getDialectTables();
        await raw()
          .delete(userRoles)
          .where(
            and(
              eq(userRoles.userId, install.first),
              eq(userRoles.roleId, install.superAdminRole)
            )
          );
        // The premise: the request-time check makes the heir a super-admin.
        expect(await activeSuperAdmin(h.heir)).toBe(true);
        return h;
      }

      it("stands in for the last holder of the role itself", async () => {
        const install = await boot(on);
        const h = await heir(install);
        await direct().users.delete({ id: install.first });
        expect(await activeSuperAdmin(h.heir)).toBe(true);
      });

      const removals: Array<{
        name: string;
        remove: (
          install: Install,
          h: { heir: string; owner: string }
        ) => Promise<Response>;
      }> = [
        {
          name: "removing the role's inheritance",
          remove: (i, h) =>
            rest(i, "DELETE", ["roles", h.owner, "children", i.superAdminRole]),
        },
        {
          name: "replacing the role's childRoleIds",
          remove: (i, h) =>
            rest(i, "PATCH", ["roles", h.owner], { childRoleIds: [] }),
        },
        {
          name: "deleting the role",
          remove: (i, h) => rest(i, "DELETE", ["roles", h.owner]),
        },
        {
          name: "taking the role from its holder",
          remove: (i, h) =>
            rest(i, "DELETE", ["users", h.heir, "roles", h.owner]),
        },
        {
          name: "replacing its holder's roles",
          remove: (i, h) =>
            rest(i, "PATCH", ["users", h.heir], { roles: [i.editorRole] }),
        },
        {
          name: "deleting its holder",
          remove: (i, h) => rest(i, "DELETE", ["users", h.heir]),
        },
        {
          name: "deactivating its holder",
          remove: (i, h) =>
            rest(i, "PATCH", ["users", h.heir], { isActive: false }),
        },
      ];

      describe.each(removals)("$name", removal => {
        it("is refused while its holder is the last super-admin", async () => {
          const install = await boot(on);
          const h = await heirOnly(install);
          await expectRestRefused(await removal.remove(install, h));
          expect(await activeSuperAdmin(h.heir)).toBe(true);
        });

        it("is allowed while another super-admin remains", async () => {
          const install = await boot(on);
          const h = await heir(install);
          await expectRestAllowed(await removal.remove(install, h));
          expect(await activeSuperAdmin(install.first)).toBe(true);
        });
      });
    });

    describe("a super-admin whose role expires", () => {
      it("does not stand in for the last permanent super-admin", async () => {
        const install = await boot(on);
        const temporary = await makeUser("temporary@example.com");
        await grant(temporary, install.superAdminRole, {
          expiresAt: IN_AN_HOUR(),
        });
        // The premise: until it lapses, the temporary one is a super-admin.
        expect(await activeSuperAdmin(temporary)).toBe(true);
        await expectDirectRefused(direct().users.delete({ id: install.first }));
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("is refused an expiry on the last super-admin's role, which stays permanent", async () => {
        const install = await boot(on);
        const res = await rest(
          install,
          "POST",
          ["users", install.first, "roles"],
          {
            roleId: install.superAdminRole,
            expiresAt: IN_AN_HOUR().toISOString(),
          },
          install.first
        );
        const text = await res.text();
        expect(res.status, text).toBe(409);
        expect(
          await expiryOf(install.first, install.superAdminRole)
        ).toBeNull();
      });

      it("may be given the role with an expiry beside a permanent one", async () => {
        const install = await boot(on);
        const temporary = await makeUser("temporary@example.com");
        const res = await rest(
          install,
          "POST",
          ["users", temporary, "roles"],
          {
            roleId: install.superAdminRole,
            expiresAt: IN_AN_HOUR().toISOString(),
          },
          install.first
        );
        expect(res.status, await res.text()).toBeLessThan(300);
        expect(
          await expiryOf(temporary, install.superAdminRole)
        ).not.toBeNull();
      });
    });

    describe("two removals at once of the last two", () => {
      it("two deletions leave one super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        const { outcomes, secondWaited } = await race(
          () => direct().users.delete({ id: install.first }),
          () => direct().users.delete({ id: second })
        );
        expectOneRefused(outcomes);
        if (on !== "sqlite") expect(secondWaited).toBe(true);
        expect(
          [
            await activeSuperAdmin(install.first),
            await activeSuperAdmin(second),
          ].filter(Boolean)
        ).toHaveLength(1);
      });

      it("a deletion and a deactivation leave one super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        const { outcomes, secondWaited } = await race(
          () => direct().users.delete({ id: install.first }),
          () => direct().users.update({ id: second, data: { isActive: false } })
        );
        expectOneRefused(outcomes);
        if (on !== "sqlite") expect(secondWaited).toBe(true);
        expect(
          [
            await activeSuperAdmin(install.first),
            await activeSuperAdmin(second),
          ].filter(Boolean)
        ).toHaveLength(1);
      });

      it("a deletion and a role removal leave one super-admin", async () => {
        const install = await boot(on);
        const second = await secondSuperAdmin(install);
        const { outcomes, secondWaited } = await race(
          () => direct().users.delete({ id: install.first }),
          () =>
            direct().users.update({
              id: second,
              data: { roles: [install.editorRole] },
            })
        );
        expectOneRefused(outcomes);
        if (on !== "sqlite") expect(secondWaited).toBe(true);
        expect(
          [
            await activeSuperAdmin(install.first),
            await activeSuperAdmin(second),
          ].filter(Boolean)
        ).toHaveLength(1);
      });

      /**
       * `pair` raced on a fresh install, `ROUNDS` times: one interleaving
       * passing proves little, and the lock is what has to hold every time.
       */
      async function everyRound(
        pair: (install: Install) => Promise<{
          a: () => Promise<unknown>;
          b: () => Promise<unknown>;
          left: () => Promise<boolean[]>;
        }>
      ): Promise<void> {
        for (let round = 0; round < ROUNDS; round++) {
          const install = await boot(on);
          const { a, b, left } = await pair(install);
          const { outcomes, secondWaited } = await race(a, b);
          expectOneRefused(outcomes);
          if (on !== "sqlite") expect(secondWaited).toBe(true);
          expect((await left()).filter(Boolean)).toHaveLength(1);
          await handle?.destroy();
          handle = undefined;
        }
      }

      it("two role replacements leave one super-admin, every round", async () => {
        await everyRound(async install => {
          const second = await secondSuperAdmin(install);
          const demote = (id: string) => () =>
            direct().users.update({
              id,
              data: { roles: [install.editorRole] },
            });
          return {
            a: demote(install.first),
            b: demote(second),
            left: async () => [
              await activeSuperAdmin(install.first),
              await activeSuperAdmin(second),
            ],
          };
        });
      });

      it("two unassignments leave one super-admin, every round", async () => {
        await everyRound(async install => {
          const second = await secondSuperAdmin(install);
          const unassign = (id: string) => () =>
            restOrThrow(install, "DELETE", [
              "users",
              id,
              "roles",
              install.superAdminRole,
            ]);
          return {
            a: unassign(install.first),
            b: unassign(second),
            left: async () => [
              await activeSuperAdmin(install.first),
              await activeSuperAdmin(second),
            ],
          };
        });
      });

      it("two inheritance removals leave one super-admin, every round", async () => {
        await everyRound(async install => {
          const { roleInherits, userRoles } = m.getDialectTables();
          const heirs: Array<{ id: string; role: string }> = [];
          for (const slug of ["owner-a", "owner-b"]) {
            const role = await direct().roles.create({
              data: { name: slug, slug, permissionIds: [install.readUsers] },
            });
            await raw()
              .insert(roleInherits)
              .values({
                id: `${slug}-inherits-super-admin`,
                parentRoleId: role.item.id,
                childRoleId: install.superAdminRole,
              });
            const id = await makeUser(`${slug}@example.com`);
            await grant(id, role.item.id);
            heirs.push({ id, role: role.item.id });
          }
          // The two heirs are the only super-admins.
          await raw()
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.userId, install.first),
                eq(userRoles.roleId, install.superAdminRole)
              )
            );
          const disinherit = (role: string) => () =>
            restOrThrow(install, "DELETE", [
              "roles",
              role,
              "children",
              install.superAdminRole,
            ]);
          return {
            a: disinherit(heirs[0].role),
            b: disinherit(heirs[1].role),
            left: async () => [
              await activeSuperAdmin(heirs[0].id),
              await activeSuperAdmin(heirs[1].id),
            ],
          };
        });
      });

      it("an unassignment and a deletion of the other leave one, every round", async () => {
        await everyRound(async install => {
          const second = await secondSuperAdmin(install);
          return {
            a: () =>
              restOrThrow(install, "DELETE", [
                "users",
                install.first,
                "roles",
                install.superAdminRole,
              ]),
            b: () => direct().users.delete({ id: second }),
            left: async () => [
              await activeSuperAdmin(install.first),
              await activeSuperAdmin(second),
            ],
          };
        });
      });

      it("an unassignment and a deactivation of the other leave one, every round", async () => {
        await everyRound(async install => {
          const second = await secondSuperAdmin(install);
          return {
            a: () =>
              restOrThrow(install, "DELETE", [
                "users",
                install.first,
                "roles",
                install.superAdminRole,
              ]),
            b: () =>
              direct().users.update({ id: second, data: { isActive: false } }),
            left: async () => [
              await activeSuperAdmin(install.first),
              await activeSuperAdmin(second),
            ],
          };
        });
      });
    });
  }
);
