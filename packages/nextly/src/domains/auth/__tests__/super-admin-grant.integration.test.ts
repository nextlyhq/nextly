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

import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** Fresh modules per install, so no cache outlives the database it read. */
async function loadModules() {
  vi.resetModules();
  const harness = await import("../../../plugins/test-nextly");
  const routes = await import("../../../routeHandler");
  const database = await import("../../../database/index");
  const seeders = await import("../../../database/seeders");
  const epoch = await import("../../../services/lib/rbac-epoch");
  const config = await import("../../../shared/types/config");
  const claims = await import("../../../auth/jwt/claims");
  const sign = await import("../../../auth/jwt/sign");
  return {
    createTestNextly: harness.createTestNextly,
    createDynamicHandlers: routes.createDynamicHandlers,
    getDialectTables: database.getDialectTables,
    seedPermissions: seeders.seedPermissions,
    resetEpochForTests: epoch.resetEpochForTests,
    sanitizeConfig: config.sanitizeConfig,
    buildClaims: claims.buildClaims,
    signAccessToken: sign.signAccessToken,
  };
}

let m: Awaited<ReturnType<typeof loadModules>>;
let handle: TestNextly | undefined;

const PASSWORD = "Str0ng-P@ssw0rd!";

afterEach(async () => {
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
  method: "POST" | "PATCH",
  path: string[],
  body: Record<string, unknown>
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
    headers: { ...credentials, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ctx = { params: Promise.resolve({ params: path }) };
  return method === "POST" ? handlers.POST(req, ctx) : handlers.PATCH(req, ctx);
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

    it("refuses a role created through the API as a system role", async () => {
      const install = await boot(dialect);

      const res = await rest({ session: install.first }, "POST", ["roles"], {
        name: "Fixture",
        slug: "fixture",
        permissionIds: [install.readUsers],
        isSystem: true,
      });

      const text = await res.text();
      expect(res.status, text).toBe(400);
      expect(await roleNamed("fixture")).toBe(false);
      // The admin creates every role with `isSystem: false`, which stays fine.
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
  }
);
