/**
 * An orphaned permission keeps its grants.
 *
 * A permission a recorded migration no longer declares is marked orphaned
 * (`markOrphanedPermissions`, as `nextly migrate` calls it), and the next
 * start brings the preset roles back to what their predicates resolve to. The presets resolve against the declared permissions
 * only, so a preset role set by difference against that list took away its
 * grant of the orphan: the admin role lost the plugin's permission, and the
 * plugin's return gave it back, while the log said the grants were unchanged.
 *
 * On every dialect this process can reach, the plugin's permission is granted
 * to the admin preset and to a role made by hand, and then:
 * - orphaned, with the plugin gone from the configuration, it keeps every
 *   grant of it as it was, the admin preset's included, however many starts
 *   follow;
 * - a start with the plugin back clears the mark and finds the grants as they
 *   were before it was orphaned;
 * - a preset that does not hold an orphaned permission is not given it.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { seedPermissionsAndRolePresets } from "../../../../init/seed-permissions";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { ServiceContainer } from "../../../../services/index";

const ACTION = "export";
const RESOURCE = "submissions";

/** A plugin declaring one permission, as a forms plugin declares its export. */
const formsPlugin = definePlugin({
  name: "@test/forms",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    permissions: [{ action: ACTION, resource: RESOURCE, label: "Export" }],
  },
});

function db(handle: TestNextly): DrizzleAdapter {
  return handle.adapter as unknown as DrizzleAdapter;
}

function services(handle: TestNextly): ServiceContainer {
  return new ServiceContainer(db(handle));
}

/** A start's seeding: every permission, then the preset roles. */
async function start(): Promise<void> {
  await seedPermissionsAndRolePresets();
}

/**
 * The plugin's permission marked orphaned, as `nextly migrate` marks it when a
 * migration that speaks for the plugin no longer declares it.
 */
async function orphan(handle: TestNextly): Promise<void> {
  await handle
    .getService("permissionSeedService")
    .markOrphanedPermissions([], { owners: new Set([formsPlugin.name]) });
}

/**
 * The plugin gone from the configuration, or back in it, as the next start
 * finds it: seeding reads the configured plugins each time it runs.
 */
function setInstalled(handle: TestNextly, installed: boolean): void {
  const plugins = handle.getService("config").plugins;
  if (!plugins) throw new Error("the configuration lists no plugins");
  plugins.splice(0);
  if (installed) plugins.push(formsPlugin);
}

/** The plugin's permission row: its id and whether it is marked orphaned. */
async function pluginPermission(
  handle: TestNextly
): Promise<{ id: string; orphaned: boolean }> {
  const rows = await db(handle).select<{
    id: string;
    orphanedAt: unknown;
  }>("permissions", {
    where: {
      and: [
        { column: "action", op: "=", value: ACTION },
        { column: "resource", op: "=", value: RESOURCE },
      ],
    },
  });
  expect(rows).toHaveLength(1);
  return { id: String(rows[0].id), orphaned: rows[0].orphanedAt != null };
}

/** The slugs of the roles holding the plugin's permission, sorted. */
async function holders(handle: TestNextly): Promise<string[]> {
  const { id } = await pluginPermission(handle);
  const grants = await db(handle).select<{ roleId: string }>(
    "role_permissions",
    { where: { and: [{ column: "permissionId", op: "=", value: id }] } }
  );
  const roles = new Map(
    (await db(handle).select<{ id: string; slug: string }>("roles", {})).map(
      row => [String(row.id), String(row.slug)]
    )
  );
  return grants.map(grant => String(roles.get(String(grant.roleId)))).sort();
}

async function roleId(handle: TestNextly, slug: string): Promise<string> {
  const role = await services(handle).roles.findRoleIdBySlug(slug);
  if (!role) throw new Error(`no ${slug} role`);
  return String(role.id);
}

describe.each(getConfiguredTestDialects())(
  "an orphaned permission's grants (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
    });

    /**
     * A site with the plugin installed and started once, and a role made by
     * hand that holds the plugin's permission.
     */
    async function installed(where: TestDialect): Promise<TestNextly> {
      const booted = await createTestNextly({
        ...(where === "sqlite" ? {} : { dialect: where }),
        plugins: [formsPlugin],
      });
      await start();
      const { id } = await pluginPermission(booted);
      await services(booted).roles.createRole({
        name: "Exporter",
        slug: "exporter",
        permissionIds: [id],
      });
      return booted;
    }

    it("keeps every grant once orphaned, through every start, and finds them as they were when declared again", async () => {
      handle = await installed(dialect);
      const before = await holders(handle);
      // The fixture is what it claims: the admin preset and the hand-made
      // role both hold the plugin's permission before it is orphaned.
      expect(before).toContain("admin");
      expect(before).toContain("exporter");
      expect((await pluginPermission(handle)).orphaned).toBe(false);

      setInstalled(handle, false);
      await orphan(handle);
      await start();

      expect((await pluginPermission(handle)).orphaned).toBe(true);
      expect(await holders(handle)).toEqual(before);

      // A further start sets the presets again against a list that still
      // leaves the orphan out, and still takes nothing.
      await start();
      expect(await holders(handle)).toEqual(before);

      setInstalled(handle, true);
      await start();

      expect((await pluginPermission(handle)).orphaned).toBe(false);
      expect(await holders(handle)).toEqual(before);
    });

    it("does not give a preset an orphaned permission it does not hold", async () => {
      handle = await installed(dialect);
      setInstalled(handle, false);
      await orphan(handle);
      await start();
      expect((await pluginPermission(handle)).orphaned).toBe(true);

      // The admin's grant of the orphan taken away by hand.
      const admin = await roleId(handle, "admin");
      const { id } = await pluginPermission(handle);
      await services(handle).rolePermissions.removePermissionFromRole(admin, {
        action: ACTION,
        resource: RESOURCE,
      });
      const without = await holders(handle);
      expect(without).not.toContain("admin");
      expect(without).toContain("exporter");

      await start();
      expect(await holders(handle)).toEqual(without);

      // Asked for directly, the preset setter leaves the orphan out too.
      const held =
        await services(handle).rolePermissions.listRolePermissions(admin);
      await services(handle).rolePermissions.setRolePermissions(
        admin,
        [...held.map(permission => permission.id), id],
        { leaveOrphanedGrants: true }
      );
      expect(await holders(handle)).toEqual(without);
    });
  }
);
