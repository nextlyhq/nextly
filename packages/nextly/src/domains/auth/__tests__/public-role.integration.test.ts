/**
 * The Public role: the role every visitor is judged by.
 *
 * Boot seeding creates it once, as a built-in role holding nothing. It is the
 * one built-in role whose permissions an owner may set; everything else about
 * it is locked. It is never deleted or renamed, never given to a person or an
 * API key, and never joined to another role's inheritance in either direction,
 * since a visitor holds exactly what Public holds and nothing it could reach
 * through another role.
 *
 * A site that already had a role of its own with the slug `public` keeps it
 * under the next free slug, with its name, holders, permissions and
 * inheritance untouched, and Public takes the slug.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The roles each grants-changed notice named, in order. */
const grantsChanged = vi.hoisted(() => ({ roleIds: [] as string[] }));

// Recorded, then passed on: the notice is what clears what is cached from a
// role's grants, so a role whose slug moves must be named in one.
vi.mock("../services/role-grants-changed", async importOriginal => {
  const real =
    await importOriginal<typeof import("../services/role-grants-changed")>();
  return {
    ...real,
    afterRoleGrantsChanged: async (
      ...args: Parameters<typeof real.afterRoleGrantsChanged>
    ) => {
      grantsChanged.roleIds.push(String(args[0]));
      return real.afterRoleGrantsChanged(...args);
    },
  };
});

import { getDialectTables } from "../../../database/index";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import {
  PUBLIC_ROLE_META_KEY,
  PUBLIC_ROLE_SLUG,
} from "../services/public-role";

let t: TestNextly | undefined;
afterEach(async () => {
  grantsChanged.roleIds = [];
  await t?.destroy();
  t = undefined;
});

const PASSWORD = "Str0ng-P@ssw0rd!";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  t = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  return t;
}

const services = (nextly: TestNextly) => new ServiceContainer(nextly.adapter);

/** The role with this slug as stored, or `null`. */
async function roleBySlug(nextly: TestNextly, slug: string) {
  const found = await services(nextly).roles.findRoleIdBySlug(slug);
  return found ? services(nextly).roles.getRoleById(found.id) : null;
}

/** The Public role's id, after boot seeding created it. */
async function publicRoleId(nextly: TestNextly): Promise<string> {
  const found = await services(nextly).roles.findRoleIdBySlug(PUBLIC_ROLE_SLUG);
  if (!found) throw new Error("boot seeding created no Public role");
  return found.id;
}

/** The ids of the permissions a role holds directly. */
async function permissionsOf(nextly: TestNextly, roleId: string) {
  const held =
    await services(nextly).rolePermissions.listRolePermissions(roleId);
  return held.map(permission => permission.id).sort();
}

/** A person, made by trusted code, with no role. */
async function person(nextly: TestNextly, email: string): Promise<string> {
  const made = await nextly.nextly.users.create({
    email,
    password: PASSWORD,
    data: { name: email, isActive: true },
  });
  return String((made.item as { id: string | number }).id);
}

/** The id of the permission with this slug. */
async function permissionId(nextly: TestNextly, slug: string) {
  for (let page = 1; ; page++) {
    const found = await nextly.nextly.permissions.find({ limit: 100, page });
    const hit = found.items.find(permission => permission.slug === slug);
    if (hit) return String(hit.id);
    if (!found.meta.hasNext) throw new Error(`no permission ${slug}`);
  }
}

/** A refusal for a built-in role, in the words the caller is shown. */
const builtIn = (change: string) =>
  expect.objectContaining({
    code: "FORBIDDEN",
    publicMessage: `This role is built in, so it can't be ${change}.`,
  });

/**
 * Leaves the install as one from before the Public role: the role this boot
 * seeding created and the record that it ran are both gone, and `roleId`,
 * where one is named, takes the slug `public`, so the next seeding meets it as
 * an upgrade would.
 */
async function asBeforePublic(nextly: TestNextly, roleId?: string) {
  const { roles } = getDialectTables();
  const db = nextly.adapter.getDrizzle() as unknown as {
    delete: (table: unknown) => { where: (c: unknown) => Promise<unknown> };
    update: (table: unknown) => {
      set: (v: unknown) => { where: (c: unknown) => Promise<unknown> };
    };
  };
  await db.delete(roles).where(eq(roles.id, await publicRoleId(nextly)));
  await nextly.getService("metaService").delete(PUBLIC_ROLE_META_KEY);
  if (roleId === undefined) return;
  await db
    .update(roles)
    .set({ slug: PUBLIC_ROLE_SLUG })
    .where(eq(roles.id, roleId));
}

describe.each(getConfiguredTestDialects())("the Public role (%s)", dialect => {
  it("is created by boot seeding as a built-in role holding nothing", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();

    const id = await publicRoleId(nextly);
    expect(await roleBySlug(nextly, PUBLIC_ROLE_SLUG)).toMatchObject({
      id,
      isSystem: true,
    });
    expect(await permissionsOf(nextly, id)).toEqual([]);

    // Seeding again leaves the one role as it was.
    await seedPermissionsAndRolePresets();
    expect(await publicRoleId(nextly)).toBe(id);
  });

  it("can't be deleted or renamed", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const id = await publicRoleId(nextly);
    const roles = services(nextly).roles;

    await expect(roles.deleteRole(id)).rejects.toEqual(builtIn("deleted"));
    await expect(roles.updateRole(id, { name: "Anyone" })).rejects.toEqual(
      builtIn("changed")
    );
    await expect(roles.updateRole(id, { slug: "anyone" })).rejects.toEqual(
      builtIn("changed")
    );
    expect(await roleBySlug(nextly, PUBLIC_ROLE_SLUG)).toMatchObject({ id });
  });

  it("holds the permissions an owner sets, and keeps them through boot seeding", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const id = await publicRoleId(nextly);
    const readMedia = await permissionId(nextly, "read-media");

    await services(nextly).roles.updateRole(id, { permissionIds: [readMedia] });
    expect(await permissionsOf(nextly, id)).toEqual([readMedia]);

    // Unlike the preset roles, Public is not brought back to a set of its
    // own on the next boot: what the owner chose stays.
    await seedPermissionsAndRolePresets();
    expect(await permissionsOf(nextly, id)).toEqual([readMedia]);
  });

  it("saves the permissions a role editor sends with the role's own fields", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const id = await publicRoleId(nextly);
    const role = await services(nextly).roles.getRoleById(id);
    const readMedia = await permissionId(nextly, "read-media");

    // The whole form, as a role editor sends it: the role's own name, slug,
    // description and level, and no child roles, beside the permissions.
    await services(nextly).roles.updateRole(id, {
      name: role.name,
      slug: role.slug,
      description: role.description ?? "",
      level: role.level,
      childRoleIds: [],
      permissionIds: [readMedia],
    });
    expect(await permissionsOf(nextly, id)).toEqual([readMedia]);

    await expect(
      services(nextly).roles.updateRole(id, {
        name: "Visitors",
        slug: role.slug,
        permissionIds: [readMedia],
      })
    ).rejects.toEqual(builtIn("changed"));
  });

  it("is never given to a person", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const id = await publicRoleId(nextly);
    const userId = await person(nextly, "someone@public-role.test");
    const heldBefore = await services(nextly).userRoles.listUserRoles(userId);

    await expect(
      services(nextly).userRoles.assignRoleToUser(userId, id)
    ).rejects.toEqual(builtIn("assigned"));
    await expect(
      nextly.nextly.users.create({
        email: "joining@public-role.test",
        password: PASSWORD,
        data: { name: "joining", isActive: true, roles: [id] },
      })
    ).rejects.toEqual(builtIn("assigned"));
    await expect(
      nextly.nextly.users.update({ id: userId, data: { roles: [id] } })
    ).rejects.toEqual(builtIn("assigned"));
    const heldAfter = await services(nextly).userRoles.listUserRoles(userId);
    expect(heldAfter).toEqual(heldBefore);
    expect(heldAfter).not.toContain(id);
  });

  it("is never the role of an API key", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const id = await publicRoleId(nextly);
    const userId = await person(nextly, "maker@public-role.test");

    await expect(
      nextly.getService("apiKeyService").createApiKey(userId, {
        name: "public key",
        tokenType: "role-based",
        roleId: id,
        expiresIn: "unlimited",
      })
    ).rejects.toEqual(builtIn("assigned"));
  });

  it("never joins another role's inheritance, either way", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const id = await publicRoleId(nextly);
    const roles = services(nextly).roles;
    const readMedia = await permissionId(nextly, "read-media");
    const other = await roles.createRole({
      name: "Other",
      slug: "other",
      permissionIds: [readMedia],
    });
    const inheritance = services(nextly).roleInheritance;

    await expect(inheritance.addRoleInheritance(other.id, id)).rejects.toEqual(
      builtIn("inherited")
    );
    await expect(inheritance.addRoleInheritance(id, other.id)).rejects.toEqual(
      builtIn("inherited")
    );
    await expect(
      roles.createRole({
        name: "Wider",
        slug: "wider",
        permissionIds: [readMedia],
        childRoleIds: [id],
      })
    ).rejects.toEqual(builtIn("inherited"));
    await expect(
      roles.updateRole(other.id, { childRoleIds: [id] })
    ).rejects.toEqual(builtIn("inherited"));
    await expect(
      roles.updateRole(id, { childRoleIds: [other.id] })
    ).rejects.toEqual(builtIn("inherited"));
    expect(await roleBySlug(nextly, "wider")).toBeNull();
    expect(await inheritance.listAncestorRoles(other.id)).not.toContain(id);
    expect(await inheritance.listDescendantRoles(other.id)).not.toContain(id);
  });

  it("takes the slug from a role of the site's own, which keeps everything else", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const roles = services(nextly).roles;
    const readMedia = await permissionId(nextly, "read-media");
    const helper = await roles.createRole({
      name: "Helper",
      slug: "helper",
      permissionIds: [readMedia],
    });
    // A role the site made itself, held by a person, with a permission and a
    // role it reaches through inheritance.
    const own = await roles.createRole({
      name: "Our public desk",
      slug: "desk",
      permissionIds: [readMedia],
      childRoleIds: [helper.id],
    });
    const holder = await person(nextly, "desk@public-role.test");
    await services(nextly).userRoles.assignRoleToUser(holder, own.id);
    const heldBefore = (
      await services(nextly).userRoles.listUserRoles(holder)
    ).sort();
    const reachedBefore = await services(
      nextly
    ).roleInheritance.listDescendantRoles(own.id);
    await asBeforePublic(nextly, own.id);

    await seedPermissionsAndRolePresets();

    expect(await roles.getRoleById(own.id)).toMatchObject({
      name: "Our public desk",
      slug: "public-1",
      isSystem: false,
    });
    expect(await permissionsOf(nextly, own.id)).toEqual([readMedia]);
    expect(
      (await services(nextly).userRoles.listUserRoles(holder)).sort()
    ).toEqual(heldBefore);
    expect(heldBefore).toContain(own.id);
    expect(
      await services(nextly).roleInheritance.listDescendantRoles(own.id)
    ).toEqual(reachedBefore);
    const created = await roleBySlug(nextly, PUBLIC_ROLE_SLUG);
    expect(created).toMatchObject({ isSystem: true });
    expect(created?.id).not.toBe(own.id);

    // What is cached from the role's grants is cleared with the move.
    expect(grantsChanged.roleIds).toContain(own.id);

    // A second run renames nothing more.
    await seedPermissionsAndRolePresets();
    expect((await roles.getRoleById(own.id)).slug).toBe("public-1");
  });

  it("moves a role of the site's own off the slug even where it is marked built-in", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const readMedia = await permissionId(nextly, "read-media");
    const own = await services(nextly).roles.createRole({
      name: "Marked",
      slug: "marked",
      isSystem: true,
      permissionIds: [readMedia],
    });
    await asBeforePublic(nextly, own.id);

    await seedPermissionsAndRolePresets();

    expect(await services(nextly).roles.getRoleById(own.id)).toMatchObject({
      slug: "public-1",
      isSystem: true,
    });
    expect(await permissionsOf(nextly, own.id)).toEqual([readMedia]);
    const created = await publicRoleId(nextly);
    expect(created).not.toBe(own.id);
    expect(await permissionsOf(nextly, created)).toEqual([]);
  });

  it("takes a name of its own where a role of the site's is called Public", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    await asBeforePublic(nextly);
    const readMedia = await permissionId(nextly, "read-media");
    const own = await services(nextly).roles.createRole({
      name: "Public",
      slug: "everyone",
      permissionIds: [readMedia],
    });

    await seedPermissionsAndRolePresets();

    expect(await services(nextly).roles.getRoleById(own.id)).toMatchObject({
      name: "Public",
      slug: "everyone",
    });
    expect(await roleBySlug(nextly, PUBLIC_ROLE_SLUG)).toMatchObject({
      name: "Public built-in",
      isSystem: true,
    });
  });

  it("keeps the role it made where a boot stopped before recording it", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const id = await publicRoleId(nextly);
    const readMedia = await permissionId(nextly, "read-media");
    await services(nextly).roles.updateRole(id, { permissionIds: [readMedia] });
    // What a boot that moved the site's role, made Public and then stopped
    // leaves behind: its claim, long lapsed.
    const meta = nextly.getService("metaService");
    await meta.set(PUBLIC_ROLE_META_KEY, {
      claim: "stopped",
      at: new Date(Date.now() - 60 * 60_000).toISOString(),
      moved: true,
    });

    await seedPermissionsAndRolePresets();

    expect(await publicRoleId(nextly)).toBe(id);
    expect(await permissionsOf(nextly, id)).toEqual([readMedia]);
    expect(await roleBySlug(nextly, "public-1")).toBeNull();
    expect(await meta.get(PUBLIC_ROLE_META_KEY)).toBe("created");
  });

  it("finishes a move a boot stopped part-way through", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const readMedia = await permissionId(nextly, "read-media");
    const own = await services(nextly).roles.createRole({
      name: "Ours",
      slug: "ours",
      permissionIds: [readMedia],
    });
    // A boot recorded the site's role, moved it to `public-1` and stopped
    // before clearing what is cached from its grants or making Public.
    await asBeforePublic(nextly, own.id);
    const { roles } = getDialectTables();
    const db = nextly.adapter.getDrizzle() as unknown as {
      update: (table: unknown) => {
        set: (v: unknown) => { where: (c: unknown) => Promise<unknown> };
      };
    };
    await db
      .update(roles)
      .set({ slug: "public-1" })
      .where(eq(roles.id, own.id));
    const meta = nextly.getService("metaService");
    await meta.set(PUBLIC_ROLE_META_KEY, {
      claim: "stopped",
      at: new Date(Date.now() - 60 * 60_000).toISOString(),
      moving: own.id,
    });
    grantsChanged.roleIds = [];

    await seedPermissionsAndRolePresets();

    expect(grantsChanged.roleIds).toContain(own.id);
    expect((await services(nextly).roles.getRoleById(own.id)).slug).toBe(
      "public-1"
    );
    expect(await roleBySlug(nextly, PUBLIC_ROLE_SLUG)).toMatchObject({
      isSystem: true,
    });
    expect(await meta.get(PUBLIC_ROLE_META_KEY)).toBe("created");
  });

  it("moves a site's own `public` role to the next free slug", async () => {
    const nextly = await boot(dialect);
    await seedPermissionsAndRolePresets();
    const roles = services(nextly).roles;
    const readMedia = await permissionId(nextly, "read-media");
    const taken = await roles.createRole({
      name: "Taken",
      slug: "public-1",
      permissionIds: [readMedia],
    });
    const own = await roles.createRole({
      name: "Ours",
      slug: "ours",
      permissionIds: [readMedia],
    });
    await asBeforePublic(nextly, own.id);

    await seedPermissionsAndRolePresets();

    expect((await roles.getRoleById(own.id)).slug).toBe("public-2");
    expect((await roles.getRoleById(taken.id)).slug).toBe("public-1");
  });
});
