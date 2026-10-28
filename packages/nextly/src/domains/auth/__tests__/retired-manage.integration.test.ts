/**
 * `manage-<resource>` on media, settings, email providers and email templates
 * is retired in favour of the plain read, create, update and delete there.
 *
 * `nextly upgrade` converts each role an earlier release left holding one:
 * the role gets the four plain permissions on that resource and loses the
 * `manage` one, once; a second run finds nothing. Every path that writes a
 * role's permissions stores a `manage` one of the four as the plain four, so
 * a reboot (role presets, the super-admin seeder) never brings one back. Until
 * a role is converted, each start names it once, with the command to run.
 * `manage-background-jobs` is not retired and stays as it is.
 *
 * The roles an earlier release left are planted through the adapter, as that
 * release stored them, since every writer now stores the plain four.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runUpgrade, type UpgradeAdapter } from "../../../cli/commands/upgrade";
import { getDialectTables } from "../../../database/index";
import { seedSuperAdmin } from "../../../database/seeders/super-admin";
import { warnIfCoreSchemaIsBehind } from "../../../init/first-run";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";

/** The resources whose `manage` permission is retired. */
const RETIRED = ["media", "settings", "email-providers", "email-templates"];
const PLAIN = ["read", "create", "update", "delete"];

/** The plain four on `resource`, as slugs. */
const plainOn = (resource: string) =>
  PLAIN.map(action => `${action}-${resource}`);

type Db = {
  insert: (table: unknown) => { values: (rows: unknown) => Promise<unknown> };
};

describe.each(getConfiguredTestDialects())(
  "retired manage permissions (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    const services = () => new ServiceContainer(t.adapter);

    /** Every permission's id, by slug. */
    async function idsBySlug(): Promise<Map<string, string>> {
      const { data } = await services().permissions.listPermissions({
        limit: 1000,
      });
      return new Map(
        data.map(p => [`${p.action}-${p.resource}`, String(p.id)])
      );
    }

    /** The permission slugs a role holds directly. */
    async function holds(roleId: string): Promise<string[]> {
      return (await services().rolePermissions.listRolePermissions(roleId)).map(
        p => `${p.action}-${p.resource}`
      );
    }

    /** A role holding exactly `slugs`, stored as an earlier release stored them. */
    async function plantedRole(name: string, slugs: string[]): Promise<string> {
      const ids = await idsBySlug();
      const roleId = randomUUID();
      const { roles, rolePermissions } = getDialectTables();
      const db = t.adapter.getDrizzle() as unknown as Db;
      await db.insert(roles).values({
        id: roleId,
        name,
        slug: name,
        level: 10,
        isSystem: false,
      });
      await db.insert(rolePermissions).values(
        slugs.map(slug => ({
          id: randomUUID(),
          roleId,
          permissionId: ids.get(slug),
        }))
      );
      return roleId;
    }

    /** Every role holding a retired `manage` permission, by name. */
    async function retiredHolders(): Promise<string[]> {
      const { data } = await services().roles.listRoles({ limit: 1000 });
      const held = await Promise.all(
        data.map(async role => ({
          name: role.name,
          slugs: await holds(String(role.id)),
        }))
      );
      return held
        .filter(({ slugs }) =>
          RETIRED.some(resource => slugs.includes(`manage-${resource}`))
        )
        .map(({ name }) => name);
    }

    const lines: string[] = [];
    const upgrade = () =>
      runUpgrade(
        { confirmBackedUp: true },
        {
          adapter: t.adapter as unknown as UpgradeAdapter,
          logger: {
            info: (msg: string) => lines.push(msg),
            warn: (msg: string) => lines.push(msg),
          },
        }
      );

    /** What a start says about the core schema and stored access data. */
    async function startupWarnings(): Promise<string[]> {
      const warned: string[] = [];
      await warnIfCoreSchemaIsBehind(
        t.adapter as unknown as Parameters<typeof warnIfCoreSchemaIsBehind>[0],
        {
          info: () => undefined,
          warn: (msg: string) => warned.push(msg),
        } as unknown as Parameters<typeof warnIfCoreSchemaIsBehind>[1],
        30_000
      );
      return warned;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      // The boot's seeding: permissions and the role presets.
      await seedPermissionsAndRolePresets();
    });

    afterAll(async () => {
      await t?.destroy();
    });

    describe("every writer of a role's permissions", () => {
      it("stores manage-<resource> set by id as the plain four", async () => {
        const ids = await idsBySlug();
        const role = await services().roles.createRole({
          name: "Set by id",
          slug: "set-by-id",
          permissionIds: [ids.get("read-users")!],
        });
        await services().rolePermissions.setRolePermissions(String(role.id), [
          ids.get("manage-media")!,
          ids.get("manage-background-jobs")!,
        ]);
        expect((await holds(String(role.id))).sort()).toEqual(
          [...plainOn("media"), "manage-background-jobs"].sort()
        );
      });

      it("stores manage-<resource> given at creation and on update as the plain four", async () => {
        const ids = await idsBySlug();
        const role = await services().roles.createRole({
          name: "Made with manage",
          slug: "made-with-manage",
          permissionIds: [ids.get("manage-settings")!],
        });
        expect((await holds(String(role.id))).sort()).toEqual(
          plainOn("settings").sort()
        );
        await services().roles.updateRole(String(role.id), {
          permissionIds: [ids.get("manage-email-providers")!],
        });
        expect((await holds(String(role.id))).sort()).toEqual(
          plainOn("email-providers").sort()
        );
      });

      it("stores manage-<resource> added by action as the plain four", async () => {
        const ids = await idsBySlug();
        const role = await services().roles.createRole({
          name: "Added one",
          slug: "added-one",
          permissionIds: [ids.get("read-users")!],
        });
        await services().rolePermissions.addPermissionToRole(String(role.id), {
          action: "manage",
          resource: "email-templates",
        });
        expect((await holds(String(role.id))).sort()).toEqual(
          ["read-users", ...plainOn("email-templates")].sort()
        );
      });

      it("leaves no role holding a retired manage permission after a reboot, presets and the super-admin seeder included", async () => {
        await seedSuperAdmin(t.adapter, {
          email: "root@retired-manage.test",
          password: "Password123!",
          silent: true,
        });
        // Once more, as a later boot ensures the role holds every permission.
        await seedSuperAdmin(t.adapter, {
          email: "root@retired-manage.test",
          password: "Password123!",
          silent: true,
        });
        await seedPermissionsAndRolePresets();
        expect(await retiredHolders()).toEqual([]);
      });
    });

    describe("a role an earlier release left holding manage permissions", () => {
      let managerId: string;
      let jobsId: string;

      beforeAll(async () => {
        managerId = await plantedRole("planted-manager", [
          ...RETIRED.map(resource => `manage-${resource}`),
          "read-media",
          "manage-background-jobs",
        ]);
        jobsId = await plantedRole("planted-jobs", ["manage-background-jobs"]);
      });

      it("is named once at each start, with the command that converts it", async () => {
        const warned = (await startupWarnings()).join("\n");
        expect(warned.split("planted-manager").length - 1).toBe(1);
        expect(warned).toContain("nextly upgrade");
        expect(warned).not.toContain("planted-jobs");
      });

      it("is converted by nextly upgrade once: the plain four, no retired manage, background jobs as they were", async () => {
        await upgrade();
        expect((await holds(managerId)).sort()).toEqual(
          [...RETIRED.flatMap(plainOn), "manage-background-jobs"].sort()
        );
        expect(await holds(jobsId)).toEqual(["manage-background-jobs"]);
        expect(lines.join("\n")).toMatch(/manage[^\n]*: 1/);
      });

      it("is not converted again, and no longer named at a start", async () => {
        lines.length = 0;
        await upgrade();
        expect(lines.join("\n")).toContain("Already upgraded. Nothing to do.");
        expect((await startupWarnings()).join("\n")).not.toContain(
          "planted-manager"
        );
      });

      it("stays converted across a reboot", async () => {
        await seedPermissionsAndRolePresets();
        expect(await retiredHolders()).toEqual([]);
      });
    });
  }
);
