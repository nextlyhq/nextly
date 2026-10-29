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

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { runUpgrade, type UpgradeAdapter } from "../../../cli/commands/upgrade";
import { getDialectTables } from "../../../database/index";
import { getService } from "../../../di";
import { seedSuperAdmin } from "../../../database/seeders/super-admin";
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

    /** What a start's seeding warns, as a boot runs it. */
    async function startupWarnings(): Promise<string[]> {
      const warn = vi.spyOn(getService("logger"), "warn");
      try {
        await seedPermissionsAndRolePresets();
        return warn.mock.calls.map(call => String(call[0]));
      } finally {
        warn.mockRestore();
      }
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

      it("adds manage-<resource> by action in one transaction, as one plain permission is added", async () => {
        const ids = await idsBySlug();
        const role = await services().roles.createRole({
          name: "Added at once",
          slug: "added-at-once",
          permissionIds: [ids.get("read-users")!],
        });
        const roleId = String(role.id);
        const transactions = vi.spyOn(t.adapter, "transaction");
        try {
          await services().rolePermissions.addPermissionToRole(roleId, {
            action: "read",
            resource: "roles",
          });
          const forOne = transactions.mock.calls.length;
          transactions.mockClear();
          await services().rolePermissions.addPermissionToRole(roleId, {
            action: "manage",
            resource: "settings",
          });
          // All four land together or none do, and no other writer of the
          // role's permissions lands between them.
          expect(transactions.mock.calls.length).toBe(forOne);
        } finally {
          transactions.mockRestore();
        }
        expect((await holds(roleId)).sort()).toEqual(
          ["read-users", "read-roles", ...plainOn("settings")].sort()
        );
      });

      it("takes the plain four off when manage-<resource> is taken off by action, one held before it too", async () => {
        const ids = await idsBySlug();
        // `read-media` is held on its own before `manage-media` is added, and
        // goes with it: the role stores the four it stands for, not where
        // each came from.
        const role = await services().roles.createRole({
          name: "Taken off",
          slug: "taken-off",
          permissionIds: [ids.get("read-users")!, ids.get("read-media")!],
        });
        const roleId = String(role.id);
        await services().rolePermissions.addPermissionToRole(roleId, {
          action: "manage",
          resource: "media",
        });
        await services().rolePermissions.removePermissionFromRole(roleId, {
          action: "manage",
          resource: "media",
        });
        expect(await holds(roleId)).toEqual(["read-users"]);
      });

      it("stores a permission as its row is when the role is written, not as it was read before", async () => {
        const ids = await idsBySlug();
        const role = await services().roles.createRole({
          name: "Edited between",
          slug: "edited-between",
          permissionIds: [ids.get("read-users")!],
        });
        const readMedia = ids.get("read-media")!;
        const { permissions } = getDialectTables();
        const db = t.adapter.getDrizzle() as unknown as {
          update: (table: unknown) => {
            set: (values: unknown) => {
              where: (condition: unknown) => Promise<unknown>;
            };
          };
        };
        const actionOf = (action: string) =>
          db
            .update(permissions)
            .set({ action })
            .where(eq(permissions.id, readMedia));
        const transaction = t.adapter.transaction.bind(t.adapter);
        const between = vi
          .spyOn(t.adapter, "transaction")
          .mockImplementationOnce(async work => {
            // Another writer turns `read-media` into `publish-media` after the
            // role's permissions were first read, before they are written.
            await actionOf("publish");
            return transaction(work);
          });
        try {
          await services().rolePermissions.setRolePermissions(String(role.id), [
            ids.get("manage-media")!,
          ]);
        } finally {
          between.mockRestore();
          await actionOf("read");
        }
        // Media no longer has all four plain permissions, so the retired one
        // is kept as itself, and the edited row is granted nothing.
        expect(await holds(String(role.id))).toEqual(["manage-media"]);
        // Left holding nothing, so no case after this counts the role.
        await services().rolePermissions.setRolePermissions(
          String(role.id),
          []
        );
      });

      it("creates a role storing a permission as its row is when the role is written, not as it was read before", async () => {
        const ids = await idsBySlug();
        const readMedia = ids.get("read-media")!;
        const { permissions } = getDialectTables();
        const db = t.adapter.getDrizzle() as unknown as {
          update: (table: unknown) => {
            set: (values: unknown) => {
              where: (condition: unknown) => Promise<unknown>;
            };
          };
        };
        const actionOf = (action: string) =>
          db
            .update(permissions)
            .set({ action })
            .where(eq(permissions.id, readMedia));
        const transaction = t.adapter.transaction.bind(t.adapter);
        const between = vi
          .spyOn(t.adapter, "transaction")
          .mockImplementationOnce(async work => {
            // Another writer turns `read-media` into `publish-media` after the
            // request was checked, before the role is written.
            await actionOf("publish");
            return transaction(work);
          });
        let roleId = "";
        try {
          const role = await services().roles.createRole({
            name: "Created between",
            slug: "created-between",
            permissionIds: [ids.get("manage-media")!],
          });
          roleId = String(role.id);
        } finally {
          between.mockRestore();
          await actionOf("read");
        }
        // Media no longer has all four plain permissions, so the retired one
        // is kept as itself, and the edited row is granted nothing.
        expect(await holds(roleId)).toEqual(["manage-media"]);
        // Left holding nothing, so no case after this counts the role.
        await services().rolePermissions.setRolePermissions(roleId, []);
      });

      it("updates a role in inserts within the adapter's limit, after a retired permission grew the set", async () => {
        const ids = await idsBySlug();
        const role = await services().roles.createRole({
          name: "Grown on update",
          slug: "grown-on-update",
          permissionIds: [ids.get("read-users")!],
        });
        const capabilities = t.adapter.getCapabilities();
        // A small limit, so the four plain permissions push the set past it:
        // four values a row allow five rows a statement.
        const limit = vi
          .spyOn(t.adapter, "getCapabilities")
          .mockReturnValue({ ...capabilities, maxParamsPerQuery: 20 });
        const runs: number[] = [];
        const transaction = t.adapter.transaction.bind(t.adapter);
        const recorded = vi
          .spyOn(t.adapter, "transaction")
          .mockImplementation(work =>
            transaction(tx => {
              const insertMany = tx.insertMany.bind(tx);
              tx.insertMany = (table, rows, ...rest) => {
                if (table === "role_permissions") runs.push(rows.length);
                return insertMany(table, rows, ...rest);
              };
              return work(tx);
            })
          );
        try {
          await services().roles.updateRole(String(role.id), {
            permissionIds: [
              ids.get("manage-media")!,
              ids.get("read-users")!,
              ids.get("read-roles")!,
              ids.get("read-settings")!,
            ],
          });
        } finally {
          recorded.mockRestore();
          limit.mockRestore();
        }
        expect(runs.reduce((sum, rows) => sum + rows, 0)).toBe(7);
        for (const rows of runs) expect(rows * 4).toBeLessThanOrEqual(20);
        expect((await holds(String(role.id))).sort()).toEqual(
          [
            ...plainOn("media"),
            "read-users",
            "read-roles",
            "read-settings",
          ].sort()
        );
      });

      it("takes off only what is still the permission named, when its row was edited before the removal", async () => {
        const ids = await idsBySlug();
        const manageMedia = ids.get("manage-media")!;
        const roleId = await plantedRole("edited-before-removal", [
          "manage-media",
          "read-users",
        ]);
        const { permissions } = getDialectTables();
        const db = t.adapter.getDrizzle() as unknown as {
          update: (table: unknown) => {
            set: (values: unknown) => {
              where: (condition: unknown) => Promise<unknown>;
            };
          };
        };
        const actionOf = (action: string) =>
          db
            .update(permissions)
            .set({ action })
            .where(eq(permissions.id, manageMedia));
        const transaction = t.adapter.transaction.bind(t.adapter);
        const between = vi
          .spyOn(t.adapter, "transaction")
          .mockImplementationOnce(async work => {
            // Another writer turns the role's `manage-media` row into a
            // publish permission before the removal is written.
            await actionOf("publish");
            return transaction(work);
          });
        try {
          await services().rolePermissions.removePermissionFromRole(roleId, {
            action: "manage",
            resource: "media",
          });
          // The edited row is no longer `manage-media`, so it stays.
          expect((await holds(roleId)).sort()).toEqual(
            ["publish-media", "read-users"].sort()
          );
        } finally {
          between.mockRestore();
          await actionOf("manage");
          await services().rolePermissions.setRolePermissions(roleId, []);
        }
      });

      it("takes off a retired row the role still held when manage-<resource> is added again by action", async () => {
        const roleId = await plantedRole("added-again", [
          "manage-media",
          "read-users",
        ]);
        await services().rolePermissions.addPermissionToRole(roleId, {
          action: "manage",
          resource: "media",
        });
        expect((await holds(roleId)).sort()).toEqual(
          [...plainOn("media"), "read-users"].sort()
        );
        // Left holding nothing, so no case after this counts the role.
        await services().rolePermissions.setRolePermissions(roleId, []);
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

      it("names no built-in role the same start's seeding converts", async () => {
        // A preset is brought back to its set at each boot, and its writer
        // stores a retired permission as the plain four: by the time the
        // start names anyone, the preset holds none.
        const { data } = await services().roles.listRoles({ limit: 1000 });
        const editor = data.find(role => role.slug === "editor")!;
        const ids = await idsBySlug();
        const { rolePermissions } = getDialectTables();
        await (
          t.adapter.getDrizzle() as unknown as {
            insert: (table: unknown) => {
              values: (rows: unknown) => Promise<unknown>;
            };
          }
        )
          .insert(rolePermissions)
          .values({
            id: randomUUID(),
            roleId: String(editor.id),
            permissionId: ids.get("manage-media"),
          });
        const warned = (await startupWarnings()).join("\n");
        expect(warned).toContain("planted-manager");
        expect(warned).not.toContain(`${editor.name}:`);
        expect(await holds(String(editor.id))).not.toContain("manage-media");
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

    // Last: it removes a plain permission the cases above rely on.
    describe("where a plain permission on the resource is missing", () => {
      it("keeps manage-<resource>, so the role loses nothing", async () => {
        const ids = await idsBySlug();
        const { permissions } = getDialectTables();
        const db = t.adapter.getDrizzle() as unknown as {
          delete: (table: unknown) => {
            where: (condition: unknown) => Promise<unknown>;
          };
        };
        await db
          .delete(permissions)
          .where(eq(permissions.id, ids.get("create-email-templates")!));
        const role = await services().roles.createRole({
          name: "Missing plain",
          slug: "missing-plain",
          permissionIds: [ids.get("manage-email-templates")!],
        });
        expect(await holds(String(role.id))).toEqual([
          "manage-email-templates",
        ]);
      });

      it("adds manage-<resource> as itself by action too", async () => {
        const ids = await idsBySlug();
        const role = await services().roles.createRole({
          name: "Missing plain, by action",
          slug: "missing-plain-by-action",
          permissionIds: [ids.get("read-users")!],
        });
        await services().rolePermissions.addPermissionToRole(String(role.id), {
          action: "manage",
          resource: "email-templates",
        });
        expect((await holds(String(role.id))).sort()).toEqual(
          ["manage-email-templates", "read-users"].sort()
        );
      });

      it("has nextly upgrade say how many roles it could not convert, and what to do", async () => {
        const holders = (await retiredHolders()).length;
        expect(holders).toBeGreaterThan(0);
        lines.length = 0;
        await upgrade();
        expect(
          lines.filter(line =>
            line.includes(
              `${holders} role(s) still hold a retired manage permission`
            )
          )
        ).toHaveLength(1);
        expect(lines.join("\n")).toContain("nextly upgrade");
      });
    });
  }
);
