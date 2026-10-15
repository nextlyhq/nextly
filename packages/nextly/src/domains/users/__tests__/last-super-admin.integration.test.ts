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

import { eq, inArray } from "drizzle-orm";
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
  return {
    createTestNextly: harness.createTestNextly,
    createDynamicHandlers: routes.createDynamicHandlers,
    getDialectTables: database.getDialectTables,
    seedPermissions: seeders.seedPermissions,
    isSuperAdminOrThrow: permissions.isSuperAdminOrThrow,
    resetEpochForTests: epoch.resetEpochForTests,
    sanitizeConfig: config.sanitizeConfig,
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

async function grant(userId: string, roleId: string): Promise<void> {
  await raw()
    .insert(m.getDialectTables().userRoles)
    .values({
      id: `${userId}-${roleId}`,
      userId,
      roleId,
      expiresAt: null,
      createdAt: new Date(),
    });
}

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
  const slugs = ["read-users", "update-users", "delete-users"];
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
  method: "PATCH" | "DELETE",
  path: string[],
  body?: Record<string, unknown>
): Promise<Response> {
  const handlers = m.createDynamicHandlers({
    config: m.sanitizeConfig({ collections: [] }),
  });
  const req = new Request(`http://localhost/api/${path.join("/")}`, {
    method,
    headers: {
      authorization: `Bearer ${install.operatorKey}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const ctx = { params: Promise.resolve({ params: path }) };
  return method === "PATCH"
    ? handlers.PATCH(req, ctx)
    : handlers.DELETE(req, ctx);
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

    describe("a super-admin only through a role built on it", () => {
      /** A role built on `super-admin`, as creating a role with a base role writes it. */
      async function ownerRole(install: Install): Promise<string> {
        const owner = await direct().roles.create({
          data: {
            name: "Owner",
            slug: "owner",
            permissionIds: [install.readUsers],
          },
        });
        await raw().insert(m.getDialectTables().roleInherits).values({
          id: `owner-inherits-super-admin`,
          parentRoleId: owner.item.id,
          childRoleId: install.superAdminRole,
        });
        return owner.item.id;
      }

      // Such a role's inheritance can be edited away and the role deleted,
      // neither a write to an account, so it cannot be what keeps the install
      // administrable: the last holder of `super-admin` itself stays.
      it("does not stand in for the last holder of the role itself", async () => {
        const install = await boot(on);
        const heir = await makeUser("heir@example.com");
        await grant(heir, await ownerRole(install));
        // The premise: the request-time check makes the heir a super-admin.
        expect(await activeSuperAdmin(heir)).toBe(true);
        await expectDirectRefused(direct().users.delete({ id: install.first }));
        expect(await activeSuperAdmin(install.first)).toBe(true);
      });

      it("can be removed while a holder of the role itself remains", async () => {
        const install = await boot(on);
        const heir = await makeUser("heir@example.com");
        await grant(heir, await ownerRole(install));
        await direct().users.delete({ id: heir });
        expect(await activeSuperAdmin(heir)).toBe(false);
        expect(await activeSuperAdmin(install.first)).toBe(true);
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
    });
  }
);
