/**
 * Editing a role, on every dialect: its name, its permissions and its child
 * roles, together, read back from the database afterwards.
 *
 * The edit is one transaction. On SQLite the driver runs a transaction
 * callback synchronously and refuses one that returns a promise, so an edit
 * written against the query builder's transaction failed there before it
 * changed anything, while PostgreSQL and MySQL accepted it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { seedPermissionsAndRolePresets } from "../../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { ServiceContainer } from "../../../../services/index";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect });
  await seedPermissionsAndRolePresets();
  return current;
}

/** The ids of the first `count` seeded permissions, in a stable order. */
async function permissionIds(t: TestNextly, count: number): Promise<string[]> {
  const rows = await t.adapter.select<{ id: string; slug: string }>(
    "permissions",
    {}
  );
  return rows
    .map(row => ({ id: String(row.id), slug: row.slug }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(0, count)
    .map(row => row.id);
}

let roleSeq = 0;

async function role(t: TestNextly, permissions: string[]): Promise<string> {
  roleSeq += 1;
  const created = await new ServiceContainer(t.adapter).roles.createRole({
    name: `Role ${roleSeq}`,
    slug: `role-update-${roleSeq}`,
    permissionIds: permissions,
  });
  return created.id;
}

/** What the database holds for a role once the edit is done. */
async function stored(t: TestNextly, roleId: string) {
  const roles = await t.adapter.select<{ id: string; name: string }>(
    "roles",
    {}
  );
  const grants = await t.adapter.select<{
    roleId: string;
    permissionId: string;
  }>("role_permissions", {});
  const inherits = await t.adapter.select<{
    parentRoleId: string;
    childRoleId: string;
  }>("role_inherits", {});
  return {
    name: roles.find(row => String(row.id) === roleId)?.name,
    permissions: grants
      .filter(row => String(row.roleId) === roleId)
      .map(row => String(row.permissionId))
      .sort(),
    children: inherits
      .filter(row => String(row.parentRoleId) === roleId)
      .map(row => String(row.childRoleId))
      .sort(),
  };
}

describe.each(getConfiguredTestDialects())(
  "editing a role (%s)",
  (dialect: TestDialect) => {
    it("changes its name, its permissions and its child roles together", async () => {
      const t = await boot(dialect);
      const [first, second, third] = await permissionIds(t, 3);
      const edited = await role(t, [first!]);
      // A role needs a permission of its own to be created.
      const childA = await role(t, [first!]);
      const childB = await role(t, [first!]);

      await new ServiceContainer(t.adapter).roles.updateRole(edited, {
        name: "Renamed",
        permissionIds: [second!, third!],
        childRoleIds: [childA, childB],
      });

      expect(await stored(t, edited)).toEqual({
        name: "Renamed",
        permissions: [second!, third!].sort(),
        children: [childA, childB].sort(),
      });
    });

    it("changes its name alone, keeping its permissions", async () => {
      const t = await boot(dialect);
      const [first] = await permissionIds(t, 1);
      const edited = await role(t, [first!]);

      await new ServiceContainer(t.adapter).roles.updateRole(edited, {
        name: "Only the name",
      });

      expect(await stored(t, edited)).toEqual({
        name: "Only the name",
        permissions: [first!],
        children: [],
      });
    });
  }
);
