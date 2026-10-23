/**
 * Only a super-admin person may give anyone super-admin authority, by any
 * role change.
 *
 * Super-admin authority is held directly or through a role that inherits the
 * super-admin role, so every change that can create it is the same act:
 * assigning the role or one that inherits it, replacing or creating a user's
 * roles with one, and making a role inherit it, by adding inheritance or
 * through `childRoleIds`. Each is tried by three callers through REST:
 *
 * - a person who manages users and roles but is no super-admin: refused, and
 *   nothing is written;
 * - a full-access key made by a super-admin: refused, since a key never grants
 *   super-admin, whoever made it;
 * - a super-admin person: allowed, the control that shows each request is one
 *   the route would otherwise carry out.
 *
 * Trusted server code, the Direct API with no caller, keeps being allowed.
 */

// API keys and sessions sign with `env.NEXTLY_SECRET`; set before any module reads env.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

type GrantModule = typeof import("../services/super-admin-grant");

/**
 * The real grant module of the install under test, and a hook run once when
 * the next grant check has made its decision.
 */
const afterGrantCheck = vi.hoisted(() => ({
  real: undefined as GrantModule | undefined,
  run: undefined as (() => Promise<void>) | undefined,
  /**
   * Run once BEFORE the next grant check, which is before it takes the
   * `super-admin` row's lock. That is the moment a change which locked rows
   * of its own first would be holding them while it waits for that one.
   */
  before: undefined as (() => Promise<void>) | undefined,
}));

// Pausing a change once its check has decided, inside its transaction and
// before it writes, is the moment a second change's check would otherwise
// read the roles as the first found them.
//
// Each export forwards to the real module `loadModules` imported after its
// reset, rather than to one taken when this factory first ran: the mock
// outlives a reset, and a module kept from before it would read the
// environment of the dialect that booted first.
vi.mock("../services/super-admin-grant", () => {
  const real = (): GrantModule => afterGrantCheck.real!;
  return {
    rolesConferSuperAdmin: ((...args) =>
      real().rolesConferSuperAdmin(
        ...args
      )) as GrantModule["rolesConferSuperAdmin"],
    refuseGrantingSuperAdmin: (async (...args) => {
      const first = afterGrantCheck.before;
      if (first) {
        afterGrantCheck.before = undefined;
        await first();
      }
      await real().refuseGrantingSuperAdmin(...args);
      const hook = afterGrantCheck.run;
      if (hook) {
        afterGrantCheck.run = undefined;
        await hook();
      }
    }) as GrantModule["refuseGrantingSuperAdmin"],
  };
});

import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** Fresh modules per install, so no cache outlives the database it read. */
async function loadModules() {
  vi.resetModules();
  afterGrantCheck.real = await vi.importActual<GrantModule>(
    "../services/super-admin-grant"
  );
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
let handle: TestNextly | undefined;
let dialect: TestDialect = "sqlite";

const PASSWORD = "Str0ng-P@ssw0rd!";

afterEach(async () => {
  afterGrantCheck.run = undefined;
  afterGrantCheck.before = undefined;
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

interface Direct {
  users: {
    create: (a: {
      data: Record<string, unknown>;
    }) => Promise<{ item: { id: string } }>;
    update: (a: {
      id: string;
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  roles: {
    create: (a: {
      data: Record<string, unknown>;
    }) => Promise<{ item: { id: string } }>;
  };
}

function direct(): Direct {
  return handle!.nextly as unknown as Direct;
}

/** Who exists, and the credentials each caller carries. */
interface Install {
  first: string;
  superAdminRole: string;
  /** A role that inherits super-admin: holding it is super-admin authority. */
  elevatedRole: string;
  /** A plain role, the one a role change would elevate. */
  staffRole: string;
  /** A user with no roles, the one an assignment would elevate. */
  target: string;
  readUsers: string;
  /** Manages users and roles; is no super-admin. */
  manager: string;
  /** A full-access key made by the super-admin `first`. */
  superAdminKey: string;
}

type Caller = { session: string } | { key: string };

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
  dialect = on;
  m = await loadModules();
  m.resetEpochForTests();
  handle = await m.createTestNextly(on === "sqlite" ? {} : { dialect: on });
  const tables = m.getDialectTables();

  // The install's first account is made super-admin by its creation.
  const first = await makeUser("first@example.com");
  const [superAdmin] = await raw()
    .select({ id: tables.roles.id })
    .from(tables.roles)
    .where(eq(tables.roles.slug, "super-admin"));
  expect(superAdmin).toBeDefined();
  const superAdminRole = String(superAdmin.id);

  await m.seedPermissions(handle.adapter, { silent: true });
  const slugs = [
    "read-users",
    "create-users",
    "update-users",
    "read-roles",
    "create-roles",
    "update-roles",
  ];
  const seeded = await raw()
    .select({ id: tables.permissions.id, slug: tables.permissions.slug })
    .from(tables.permissions)
    .where(inArray(tables.permissions.slug, slugs));
  const ids = slugs.map(slug => {
    const found = seeded.find(p => p.slug === slug);
    expect(found, `\`${slug}\` must be seeded`).toBeDefined();
    return String(found!.id);
  });

  // Built by trusted server code, which may give a role super-admin.
  const elevated = await direct().roles.create({
    data: {
      name: "Elevated",
      slug: "elevated",
      permissionIds: [ids[0]],
      childRoleIds: [superAdminRole],
    },
  });
  const staff = await direct().roles.create({
    data: { name: "Staff", slug: "staff", permissionIds: [ids[0]] },
  });
  const managerRole = await direct().roles.create({
    data: { name: "Manager", slug: "manager", permissionIds: ids },
  });
  const manager = await makeUser("manager@example.com");
  await grant(manager, managerRole.item.id);
  const target = await makeUser("target@example.com");

  const apiKeys = handle.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: { name: string; tokenType: string; expiresIn: string }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(first, {
    name: "automation",
    tokenType: "full-access",
    expiresIn: "never",
  });

  return {
    first,
    superAdminRole,
    elevatedRole: elevated.item.id,
    staffRole: staff.item.id,
    target,
    readUsers: ids[0],
    manager,
    superAdminKey: key,
  };
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

async function rest(
  caller: Caller,
  method: "POST" | "PATCH" | "DELETE",
  path: string[],
  body?: Record<string, unknown>
): Promise<Response> {
  const handlers = m.createDynamicHandlers({
    config: m.sanitizeConfig({ collections: [] }),
  });
  const credentials: Record<string, string> =
    "key" in caller
      ? { authorization: `Bearer ${caller.key}` }
      : { cookie: await sessionCookie(caller.session) };
  const req = new Request(`http://localhost/api/${path.join("/")}`, {
    method,
    headers: {
      ...credentials,
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

async function holds(userId: string, roleId: string): Promise<boolean> {
  const { userRoles } = m.getDialectTables();
  const rows = await raw()
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  return rows.length > 0;
}

async function inherits(parent: string, child: string): Promise<boolean> {
  const { roleInherits } = m.getDialectTables();
  const rows = await raw()
    .select({ id: roleInherits.id })
    .from(roleInherits)
    .where(
      and(
        eq(roleInherits.parentRoleId, parent),
        eq(roleInherits.childRoleId, child)
      )
    );
  return rows.length > 0;
}

/** Whether `userId` is an active super-admin, as the grant rule judges a person. */
async function activeSuperAdmin(userId: string): Promise<boolean> {
  const { users } = m.getDialectTables();
  const [row] = await raw()
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId));
  if (!row || !row.isActive) return false;
  return m.isSuperAdminOrThrow(userId, handle!.adapter.getDrizzle());
}

async function userNamed(email: string): Promise<boolean> {
  const { users } = m.getDialectTables();
  const rows = await raw()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  return rows.length > 0;
}

async function roleNamed(slug: string): Promise<boolean> {
  const { roles } = m.getDialectTables();
  const rows = await raw()
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.slug, slug));
  return rows.length > 0;
}

/**
 * Resolves once another statement on this test's database waits for a lock,
 * or after `timeoutMs` when none does. SQLite serializes write transactions,
 * so there it only yields. MySQL lists a statement blocked on a row lock in
 * neither `INNODB_TRX` nor `LOCK WAIT`, so there a statement still running
 * after a full second is the wait.
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

/** One way to give someone super-admin, and how to see that it happened. */
interface Elevation {
  name: string;
  send: (install: Install, caller: Caller) => Promise<Response>;
  happened: (install: Install) => Promise<boolean>;
}

const ELEVATIONS: Elevation[] = [
  {
    name: "assigning the super-admin role",
    send: (i, c) =>
      rest(c, "POST", ["users", i.target, "roles"], {
        roleId: i.superAdminRole,
      }),
    happened: i => holds(i.target, i.superAdminRole),
  },
  {
    name: "assigning a role that inherits super-admin",
    send: (i, c) =>
      rest(c, "POST", ["users", i.target, "roles"], {
        roleId: i.elevatedRole,
      }),
    happened: i => holds(i.target, i.elevatedRole),
  },
  {
    name: "replacing a user's roles with one that inherits super-admin",
    send: (i, c) =>
      rest(c, "PATCH", ["users", i.target], { roles: [i.elevatedRole] }),
    happened: i => holds(i.target, i.elevatedRole),
  },
  {
    name: "creating a user with a role that inherits super-admin",
    send: (i, c) =>
      rest(c, "POST", ["users"], {
        email: "new@example.com",
        password: PASSWORD,
        name: "New",
        roles: [i.elevatedRole],
      }),
    happened: () => userNamed("new@example.com"),
  },
  {
    name: "making a role inherit super-admin",
    send: (i, c) =>
      rest(c, "POST", ["roles", i.staffRole, "children"], {
        childRoleId: i.superAdminRole,
      }),
    happened: i => inherits(i.staffRole, i.superAdminRole),
  },
  {
    name: "making a role inherit one that inherits super-admin",
    send: (i, c) =>
      rest(c, "POST", ["roles", i.staffRole, "children"], {
        childRoleId: i.elevatedRole,
      }),
    happened: i => inherits(i.staffRole, i.elevatedRole),
  },
  {
    name: "giving a role super-admin through its childRoleIds",
    send: (i, c) =>
      rest(c, "PATCH", ["roles", i.staffRole], {
        childRoleIds: [i.superAdminRole],
      }),
    happened: i => inherits(i.staffRole, i.superAdminRole),
  },
  {
    name: "creating a role that inherits super-admin",
    send: (i, c) =>
      rest(c, "POST", ["roles"], {
        name: "Shadow",
        slug: "shadow",
        permissionIds: [i.readUsers],
        childRoleIds: [i.superAdminRole],
      }),
    happened: () => roleNamed("shadow"),
  },
];

describe.each(getConfiguredTestDialects())(
  "only a super-admin person may give super-admin authority (%s)",
  dialect => {
    describe.each(ELEVATIONS)("$name", elevation => {
      it("is refused to a person who is no super-admin, and nothing is written", async () => {
        const install = await boot(dialect);

        const res = await elevation.send(install, { session: install.manager });

        const text = await res.text();
        expect(res.status, text).toBe(403);
        expect(await elevation.happened(install)).toBe(false);
      });

      it("is refused to a full-access key made by a super-admin", async () => {
        const install = await boot(dialect);

        const res = await elevation.send(install, {
          key: install.superAdminKey,
        });

        const text = await res.text();
        expect(res.status, text).toBe(403);
        expect(await elevation.happened(install)).toBe(false);
      });

      it("is carried out for a super-admin person", async () => {
        const install = await boot(dialect);

        const res = await elevation.send(install, { session: install.first });

        const text = await res.text();
        expect(res.status, text).toBeLessThan(300);
        expect(await elevation.happened(install)).toBe(true);
      });
    });

    it("lets trusted server code give super-admin, as it always has", async () => {
      const install = await boot(dialect);

      await direct().users.update({
        id: install.target,
        data: { roles: [install.elevatedRole] },
      });

      expect(await holds(install.target, install.elevatedRole)).toBe(true);
    });

    it.each([true, 1, "true", "false", {}])(
      "refuses a role created through the API as a system role (isSystem: %j)",
      async isSystem => {
        const install = await boot(dialect);

        const res = await rest({ session: install.first }, "POST", ["roles"], {
          name: "Fixture",
          slug: "fixture",
          permissionIds: [install.readUsers],
          isSystem,
        });

        const text = await res.text();
        expect(res.status, text).toBe(400);
        expect(await roleNamed("fixture")).toBe(false);
      }
    );

    it("refuses a change to what a system role inherits", async () => {
      const install = await boot(dialect);
      const { roleInherits } = m.getDialectTables();

      const added = await rest(
        { session: install.first },
        "POST",
        ["roles", install.superAdminRole, "children"],
        { childRoleId: install.staffRole }
      );
      expect(added.status, await added.text()).toBe(403);
      expect(await inherits(install.superAdminRole, install.staffRole)).toBe(
        false
      );

      // And one written by hand stays: removing it is the same change.
      await raw().insert(roleInherits).values({
        id: "super-admin-inherits-staff",
        parentRoleId: install.superAdminRole,
        childRoleId: install.staffRole,
      });
      const handlers = m.createDynamicHandlers({
        config: m.sanitizeConfig({ collections: [] }),
      });
      const path = [
        "roles",
        install.superAdminRole,
        "children",
        install.staffRole,
      ];
      const removed = await handlers.DELETE(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method: "DELETE",
          headers: { cookie: await sessionCookie(install.first) },
        }),
        { params: Promise.resolve({ params: path }) }
      );
      expect(removed.status, await removed.text()).toBe(403);
      expect(await inherits(install.superAdminRole, install.staffRole)).toBe(
        true
      );
    });

    it("accepts a role created as not a system role", async () => {
      const install = await boot(dialect);
      // The admin creates every role with `isSystem: false`.
      const ordinary = await rest(
        { session: install.first },
        "POST",
        ["roles"],
        {
          name: "Ordinary",
          slug: "ordinary",
          permissionIds: [install.readUsers],
          isSystem: false,
        }
      );
      expect(ordinary.status, await ordinary.text()).toBeLessThan(300);
    });

    it("refuses a role given while a super-admin is making it inherit super-admin", async () => {
      const install = await boot(dialect);
      // The super-admin's change has decided, and is held open before it
      // writes the inheritance; the manager then gives the same role.
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      let paused!: () => void;
      const isPaused = new Promise<void>(resolve => (paused = resolve));
      afterGrantCheck.run = async () => {
        paused();
        await released;
      };

      const elevation = rest(
        { session: install.first },
        "POST",
        ["roles", install.staffRole, "children"],
        { childRoleId: install.superAdminRole }
      );
      await Promise.race([isPaused, elevation.then(() => undefined)]);
      const assignment = rest(
        { session: install.manager },
        "POST",
        ["users", install.target, "roles"],
        { roleId: install.staffRole }
      );
      const waited = await untilAnotherWaitsOnALock();
      release();

      const [elevated, assigned] = await Promise.all([elevation, assignment]);
      expect(elevated.status, await elevated.text()).toBeLessThan(300);
      // Judged once the elevation committed, on the role as it now stands.
      expect(assigned.status, await assigned.text()).toBe(403);
      expect(await holds(install.target, install.staffRole)).toBe(false);
      if (dialect !== "sqlite") expect(waited).toBe(true);
    });

    /**
     * Each change that takes super-admin authority from `heir`, who holds it
     * only through `elevated`, a role that inherits super-admin. Made by the
     * first account, which stays a super-admin, so no change is refused as
     * removing the last one.
     */
    const AUTHORITY_REMOVALS: Array<{
      name: string;
      remove: (install: Install, heir: string) => Promise<Response>;
    }> = [
      {
        name: "removing the role's inheritance",
        remove: i =>
          rest({ session: i.first }, "DELETE", [
            "roles",
            i.elevatedRole,
            "children",
            i.superAdminRole,
          ]),
      },
      {
        name: "replacing the role's childRoleIds with none",
        remove: i =>
          rest({ session: i.first }, "PATCH", ["roles", i.elevatedRole], {
            childRoleIds: [],
          }),
      },
      {
        name: "deleting the role",
        remove: i =>
          rest({ session: i.first }, "DELETE", ["roles", i.elevatedRole]),
      },
      {
        name: "taking the role from its holder",
        remove: (i, heir) =>
          rest({ session: i.first }, "DELETE", [
            "users",
            heir,
            "roles",
            i.elevatedRole,
          ]),
      },
      {
        name: "replacing its holder's roles",
        remove: (i, heir) =>
          rest({ session: i.first }, "PATCH", ["users", heir], {
            roles: [i.staffRole],
          }),
      },
      {
        name: "deleting its holder",
        remove: (i, heir) =>
          rest({ session: i.first }, "DELETE", ["users", heir]),
      },
      {
        name: "deactivating its holder",
        remove: (i, heir) =>
          rest({ session: i.first }, "PATCH", ["users", heir], {
            isActive: false,
          }),
      },
    ];

    describe.each(AUTHORITY_REMOVALS)(
      "a grant by a super-admin whose authority is taken meanwhile, by $name",
      removal => {
        it("commits before the authority is taken, never after", async () => {
          const install = await boot(dialect);
          const heir = await makeUser("heir@example.com");
          await grant(heir, install.elevatedRole);
          expect(await activeSuperAdmin(heir)).toBe(true);

          // The heir's grant has decided on the roles as they stand, and is
          // held open before it writes; the heir's authority is then taken.
          let release!: () => void;
          const released = new Promise<void>(resolve => (release = resolve));
          let paused!: () => void;
          const isPaused = new Promise<void>(resolve => (paused = resolve));
          afterGrantCheck.run = async () => {
            paused();
            await released;
          };

          const granting = rest(
            { session: heir },
            "POST",
            ["users", install.target, "roles"],
            { roleId: install.superAdminRole }
          );
          await Promise.race([isPaused, granting.then(() => undefined)]);
          let releasedYet = false;
          let removedWhileHeld = false;
          const removing = removal.remove(install, heir).then(res => {
            removedWhileHeld = !releasedYet;
            return res;
          });
          const waited = await untilAnotherWaitsOnALock();
          releasedYet = true;
          release();

          const [granted, removed] = await Promise.all([granting, removing]);
          expect(granted.status, await granted.text()).toBeLessThan(300);
          expect(removed.status, await removed.text()).toBeLessThan(300);
          // The removal waited for the grant, so the grant was made while its
          // maker was still a super-admin, and the authority went after it.
          expect(removedWhileHeld).toBe(false);
          if (dialect !== "sqlite") expect(waited).toBe(true);
          expect(await holds(install.target, install.superAdminRole)).toBe(
            true
          );
          expect(await activeSuperAdmin(heir)).toBe(false);
        });
      }
    );

    it("creates no account whose role was made to inherit super-admin meanwhile", async () => {
      const install = await boot(dialect);
      // The account's request has passed its early check, which holds no
      // lock, and is held there; the role is then elevated.
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      let paused!: () => void;
      const isPaused = new Promise<void>(resolve => (paused = resolve));
      afterGrantCheck.run = async () => {
        paused();
        await released;
      };

      const creation = rest({ session: install.manager }, "POST", ["users"], {
        email: "late@example.com",
        password: PASSWORD,
        name: "Late",
        roles: [install.staffRole],
      });
      await Promise.race([isPaused, creation.then(() => undefined)]);
      const elevated = await rest(
        { session: install.first },
        "POST",
        ["roles", install.staffRole, "children"],
        { childRoleId: install.superAdminRole }
      );
      expect(elevated.status, await elevated.text()).toBeLessThan(300);
      release();

      const created = await creation;
      // Judged again where the roles are written, with the account: refused,
      // and the account goes with them rather than being left without them.
      expect(created.status, await created.text()).toBe(403);
      expect(await userNamed("late@example.com")).toBe(false);
    });

    it("creates no account with a role deleted after it was looked up", async () => {
      const install = await boot(dialect);
      // The account's request has looked its roles up and passed its early
      // check, and is held there; one of its roles is then deleted.
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      let paused!: () => void;
      const isPaused = new Promise<void>(resolve => (paused = resolve));
      afterGrantCheck.run = async () => {
        paused();
        await released;
      };

      const creation = rest({ session: install.first }, "POST", ["users"], {
        email: "dangling@example.com",
        password: PASSWORD,
        name: "Dangling",
        roles: [install.staffRole],
      });
      await Promise.race([isPaused, creation.then(() => undefined)]);
      const { roles } = m.getDialectTables();
      await (
        handle!.adapter.getDrizzle() as unknown as {
          delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> };
        }
      )
        .delete(roles)
        .where(eq(roles.id, install.staffRole));
      release();

      const created = await creation;
      // Read again where the roles are written: the missing one refuses the
      // account rather than leaving it with an assignment to nothing.
      expect(created.status, await created.text()).toBe(400);
      expect(await userNamed("dangling@example.com")).toBe(false);
    });

    it("creates an account beside a deletion of the role it asks for", async () => {
      const install = await boot(dialect);
      // Both changes want the `super-admin` row and the requested role's row.
      // Taken in opposite orders they deadlock, and the database aborts one,
      // so the account creation or the role deletion fails for a reason
      // neither caller did anything to cause. The account's request is held
      // inside its transaction at the moment before its grant check there,
      // having taken every lock it takes before that one; the deletion, which
      // takes the `super-admin` row first and the role's row last, then runs.
      // The account's first grant check, made early and outside the
      // transaction, holds no lock and is let through.
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      let paused!: () => void;
      const isPaused = new Promise<void>(resolve => (paused = resolve));
      afterGrantCheck.before = async () => {
        afterGrantCheck.before = async () => {
          paused();
          await released;
        };
      };

      const creation = rest({ session: install.first }, "POST", ["users"], {
        email: "beside@example.com",
        password: PASSWORD,
        name: "Beside",
        roles: [install.staffRole],
      });
      await Promise.race([isPaused, creation.then(() => undefined)]);
      const deletion = rest({ session: install.first }, "DELETE", [
        "roles",
        install.staffRole,
      ]);
      await untilAnotherWaitsOnALock();
      release();

      const [created, deleted] = await Promise.all([creation, deletion]);
      // Neither is aborted. The deletion goes through, and the account is
      // either created with its role before it, or refused for the role the
      // deletion removed, and then not created at all.
      expect(deleted.status, await deleted.text()).toBeLessThan(300);
      expect(await roleNamed("staff")).toBe(false);
      const createdText = await created.text();
      expect([201, 400], createdText).toContain(created.status);
      expect(await userNamed("beside@example.com")).toBe(
        created.status === 201
      );
    });

    it("answers an assignment to an account that doesn't exist as not found", async () => {
      const install = await boot(dialect);

      const res = await rest(
        { session: install.first },
        "POST",
        ["users", "no-such-user", "roles"],
        { roleId: install.staffRole }
      );

      expect(res.status, await res.text()).toBe(404);
    });
  }
);
