/**
 * The Direct API's roles, permissions and field-group writes are checked when
 * their caller asks to be.
 *
 * An instance (or a single call) with `overrideAccess: false` and a `user` is
 * judged as the REST routes judge that user, by the same decision they ask:
 *
 * - roles: `create-roles`, `update-roles` (also for setting a role's
 *   permissions), `delete-roles`;
 * - permissions: `create-permissions` or `manage-permissions`,
 *   `delete-permissions` or `manage-permissions`;
 * - field groups: `create-settings`, `update-settings`, `delete-settings`, or
 *   `manage-settings` for any of them.
 *
 * A super-admin passes, an API key is judged by its own grants, and a checked
 * call that names nobody is refused with AUTH_REQUIRED. Every refusal leaves
 * things as they were. A trusted instance, the default, is unchanged.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { Nextly, nextly } from "../nextly";

const FORBIDDEN = { code: "FORBIDDEN", statusCode: 403 };
const POSTS = "posts";
const AUTH_REQUIRED = { code: "AUTH_REQUIRED", statusCode: 401 };

describe.each(getConfiguredTestDialects())(
  "the Direct API's roles, permissions and field-group writes under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let superAdminId: string;
    let lackerId: string;
    let roleKeeperId: string;
    let permissionKeeperId: string;
    let settingsKeeperId: string;
    /** People holding one operation's own grant and nothing broader. */
    const onlyHolds = new Map<string, string>();
    // Seeded permission ids by slug, and a role to hand out read-only grants.
    const seeded = new Map<string, string>();
    let readUsersRoleId: string;
    // Per-dialect names: the suites share one process.
    const tag = dialect.slice(0, 2);

    async function account(email: string, roleIds: string[] = []) {
      const created = await trusted.users.create({
        email,
        password: "Password123!",
        data: {
          name: email,
          isActive: true,
          ...(roleIds.length > 0 ? { roles: roleIds } : {}),
        },
      });
      return String((created.item as { id: string }).id);
    }

    /** A role holding exactly the named permissions, made by the server. */
    async function role(slug: string, permissionSlugs: string[]) {
      const created = await trusted.roles.create({
        data: {
          name: slug,
          slug,
          permissionIds: permissionSlugs.map(wanted => {
            const id = seeded.get(wanted);
            expect(id, `\`${wanted}\` must exist`).toBeDefined();
            return id!;
          }),
        },
      });
      return created.item.id;
    }

    /** An instance that asks to be checked, as this person. */
    function checkedAs(userId: string): Nextly {
      return new Nextly({ overrideAccess: false, user: { id: userId } });
    }

    async function loadPermissions() {
      const found = await trusted.permissions.find({ limit: 1000 });
      for (const p of found.items) seeded.set(p.slug, p.id);
    }

    const FIELDS = [{ name: "heading", type: "text" }];

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // A content collection, whose permissions can be made and deleted: a
        // system resource's permissions cannot be deleted by anyone.
        collections: [
          defineCollection({ slug: POSTS, fields: [text({ name: "title" })] }),
        ],
      });
      trusted = new Nextly();
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();
      await loadPermissions();
      // The permission resource's own grants, and the settings grants for
      // one action each, are not seeded, and most are hidden from the
      // permission API; the REST routes still accept them, so they are made
      // here, through the service, to prove each branch of the decision.
      for (const [action, resource] of [
        ["manage", "permissions"],
        ["create", "permissions"],
        ["delete", "permissions"],
        ["create", "settings"],
        ["update", "settings"],
        ["delete", "settings"],
      ]) {
        const made = await trusted.rbacPermissionService.ensurePermission(
          action,
          resource,
          `${action} ${resource}`,
          `${action}-${resource}`
        );
        seeded.set(`${action}-${resource}`, made.id);
      }

      // The install's first account holds super-admin.
      superAdminId = await account("owner@example.com");
      readUsersRoleId = await role(`readers-${tag}`, ["read-users"]);
      lackerId = await account("lacker@example.com", [readUsersRoleId]);
      roleKeeperId = await account("role-keeper@example.com", [
        await role(`role-keepers-${tag}`, [
          "create-roles",
          "update-roles",
          "delete-roles",
        ]),
      ]);
      permissionKeeperId = await account("permission-keeper@example.com", [
        await role(`permission-keepers-${tag}`, ["manage-permissions"]),
      ]);
      settingsKeeperId = await account("settings-keeper@example.com", [
        await role(`settings-keepers-${tag}`, ["manage-settings"]),
      ]);
      for (const slug of [
        "create-permissions",
        "delete-permissions",
        "create-settings",
        "update-settings",
        "delete-settings",
      ]) {
        onlyHolds.set(
          slug,
          await account(`only-${slug}@example.com`, [
            await role(`only-${slug}-${tag}`, [slug]),
          ])
        );
      }
      // A boot, the permission seed and a dozen accounts, each with a hashed
      // password: more than the default hook budget on a loaded machine.
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("roles", () => {
      it("refuses creating a role to someone without create-roles, and none is made", async () => {
        const before = (await trusted.roles.find({ limit: 1000 })).meta.total;
        await expect(
          checkedAs(lackerId).roles.create({
            data: {
              name: "refused",
              slug: `refused-${tag}`,
              permissionIds: [seeded.get("read-users")!],
            },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect((await trusted.roles.find({ limit: 1000 })).meta.total).toBe(
          before
        );
      });

      it("refuses updating, deleting and setting the permissions of a role, and it stays as it was", async () => {
        const subject = await role(`kept-${tag}`, ["read-users"]);
        const as = checkedAs(lackerId);

        await expect(
          as.roles.update({ id: subject, data: { name: "renamed" } })
        ).rejects.toMatchObject(FORBIDDEN);
        await expect(
          as.roles.setPermissions({
            roleId: subject,
            permissionIds: [seeded.get("read-media")!],
          })
        ).rejects.toMatchObject(FORBIDDEN);
        await expect(as.roles.delete({ id: subject })).rejects.toMatchObject(
          FORBIDDEN
        );

        expect((await trusted.roles.findByID({ id: subject })).name).toBe(
          `kept-${tag}`
        );
        expect(
          (await trusted.roles.getPermissions({ id: subject })).map(p => p.slug)
        ).toEqual(["read-users"]);
      });

      it("lets someone holding the role permissions create, update, set and delete a role", async () => {
        const as = checkedAs(roleKeeperId);
        const created = await as.roles.create({
          data: {
            name: "made",
            slug: `made-${tag}`,
            permissionIds: [seeded.get("read-users")!],
          },
        });
        const id = created.item.id;
        expect(
          (await as.roles.update({ id, data: { name: "remade" } })).item.name
        ).toBe("remade");
        expect(
          (
            await as.roles.setPermissions({
              roleId: id,
              permissionIds: [seeded.get("read-media")!],
            })
          ).map(p => p.slug)
        ).toEqual(["read-media"]);
        await expect(as.roles.delete({ id })).resolves.toMatchObject({
          item: { id },
        });
      });
    });

    describe("permissions", () => {
      it("refuses creating and deleting a permission to someone without the permission grants", async () => {
        const subject = await trusted.permissions.create({
          data: {
            name: "audit users",
            slug: `audit-${POSTS}`,
            action: "audit",
            resource: POSTS,
          },
        });
        const as = checkedAs(lackerId);

        await expect(
          as.permissions.create({
            data: {
              name: "export users",
              slug: `export-${POSTS}`,
              action: "export",
              resource: POSTS,
            },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        await expect(
          as.permissions.delete({ id: subject.item.id })
        ).rejects.toMatchObject(FORBIDDEN);

        const listed = await trusted.permissions.find({ limit: 1000 });
        expect(listed.items.map(p => p.slug)).not.toContain(`export-${POSTS}`);
        expect(listed.items.map(p => p.slug)).toContain(`audit-${POSTS}`);
      });

      it("lets someone holding manage-permissions create and delete a permission", async () => {
        const as = checkedAs(permissionKeeperId);
        const made = await as.permissions.create({
          data: {
            name: "archive users",
            slug: `archive-${POSTS}`,
            action: "archive",
            resource: POSTS,
          },
        });
        expect(made.item.slug).toBe(`archive-${POSTS}`);
        await expect(
          as.permissions.delete({ id: made.item.id })
        ).resolves.toMatchObject({ item: { id: made.item.id } });
      });
    });

    describe("an operation's own grant, without manage", () => {
      it("lets create-permissions create a permission, and only delete-permissions delete it", async () => {
        const made = await checkedAs(
          onlyHolds.get("create-permissions")!
        ).permissions.create({
          data: {
            name: "label posts",
            slug: `label-${POSTS}`,
            action: "label",
            resource: POSTS,
          },
        });
        await expect(
          checkedAs(onlyHolds.get("create-permissions")!).permissions.delete({
            id: made.item.id,
          })
        ).rejects.toMatchObject(FORBIDDEN);
        await expect(
          checkedAs(onlyHolds.get("delete-permissions")!).permissions.delete({
            id: made.item.id,
          })
        ).resolves.toMatchObject({ item: { id: made.item.id } });
      });

      it("lets each settings grant do its own field-group write and no other", async () => {
        const slug = `fg_${tag}_by_grant`;
        const creator = checkedAs(onlyHolds.get("create-settings")!);
        await creator.fieldGroups.create({
          slug,
          label: "Own",
          fields: FIELDS,
        });
        await expect(
          creator.fieldGroups.update({ slug, data: { label: "Not mine" } })
        ).rejects.toMatchObject(FORBIDDEN);

        await checkedAs(onlyHolds.get("update-settings")!).fieldGroups.update({
          slug,
          data: { label: "Updated" },
        });
        expect((await trusted.fieldGroups.findBySlug({ slug }))?.label).toBe(
          "Updated"
        );
        await expect(
          checkedAs(onlyHolds.get("update-settings")!).fieldGroups.delete({
            slug,
          })
        ).rejects.toMatchObject(FORBIDDEN);

        await checkedAs(onlyHolds.get("delete-settings")!).fieldGroups.delete({
          slug,
        });
        expect(
          await trusted.fieldGroups.findBySlug({ slug, disableErrors: true })
        ).toBeNull();
      });
    });

    describe("field groups", () => {
      it("refuses creating, updating and deleting a field group to someone without settings grants", async () => {
        const kept = `fg_${tag}_kept`;
        await trusted.fieldGroups.create({
          slug: kept,
          label: "Kept",
          fields: FIELDS,
        });
        const as = checkedAs(lackerId);

        await expect(
          as.fieldGroups.create({
            slug: `fg_${tag}_refused`,
            label: "Refused",
            fields: FIELDS,
          })
        ).rejects.toMatchObject(FORBIDDEN);
        await expect(
          as.fieldGroups.update({ slug: kept, data: { label: "Renamed" } })
        ).rejects.toMatchObject(FORBIDDEN);
        await expect(
          as.fieldGroups.delete({ slug: kept })
        ).rejects.toMatchObject(FORBIDDEN);

        expect(
          await trusted.fieldGroups.findBySlug({
            slug: `fg_${tag}_refused`,
            disableErrors: true,
          })
        ).toBeNull();
        expect(
          (await trusted.fieldGroups.findBySlug({ slug: kept }))?.label
        ).toBe("Kept");
      });

      it("lets someone holding manage-settings create, update and delete a field group", async () => {
        const slug = `fg_${tag}_managed`;
        const as = checkedAs(settingsKeeperId);
        await as.fieldGroups.create({ slug, label: "Managed", fields: FIELDS });
        await as.fieldGroups.update({ slug, data: { label: "Re-managed" } });
        expect((await trusted.fieldGroups.findBySlug({ slug }))?.label).toBe(
          "Re-managed"
        );
        await as.fieldGroups.delete({ slug });
        expect(
          await trusted.fieldGroups.findBySlug({ slug, disableErrors: true })
        ).toBeNull();
      });
    });

    describe("who is asking", () => {
      it("lets a super-admin through every checked write", async () => {
        const as = checkedAs(superAdminId);
        const made = await as.roles.create({
          data: {
            name: "by the admin",
            slug: `by-admin-${tag}`,
            permissionIds: [seeded.get("read-users")!],
          },
        });
        await expect(
          as.roles.delete({ id: made.item.id })
        ).resolves.toBeDefined();
        const slug = `fg_${tag}_admin`;
        await as.fieldGroups.create({ slug, label: "Admin", fields: FIELDS });
        await as.fieldGroups.delete({ slug });
      });

      it("refuses a checked write that names nobody", async () => {
        const anonymous = new Nextly({ overrideAccess: false });
        await expect(
          anonymous.roles.create({
            data: {
              name: "nobody",
              slug: `nobody-${tag}`,
              permissionIds: [seeded.get("read-users")!],
            },
          })
        ).rejects.toMatchObject(AUTH_REQUIRED);
        await expect(
          anonymous.fieldGroups.create({
            slug: `fg_${tag}_nobody`,
            label: "Nobody",
            fields: FIELDS,
          })
        ).rejects.toMatchObject(AUTH_REQUIRED);
      });

      it("judges an API key by its own grants, not its owner's", async () => {
        // The owner may manage roles; the key may only read them.
        const asKey = (permissions: string[]) =>
          new Nextly({
            overrideAccess: false,
            user: { id: roleKeeperId },
            actor: { actorType: "apiKey", permissions },
          });
        const subject = await role(`key-subject-${tag}`, ["read-users"]);

        await expect(
          asKey(["read-roles"]).roles.update({
            id: subject,
            data: { name: "by a reading key" },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect(
          (
            await asKey(["update-roles"]).roles.update({
              id: subject,
              data: { name: "by an updating key" },
            })
          ).item.name
        ).toBe("by an updating key");
      });
    });

    describe("where the request to be checked comes from", () => {
      it("honours it on a single call through the shared instance", async () => {
        const subject = await role(`per-call-${tag}`, ["read-users"]);
        await expect(
          nextly.roles.delete({
            id: subject,
            overrideAccess: false,
            user: { id: lackerId },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect((await trusted.roles.findByID({ id: subject })).id).toBe(
          subject
        );
      });

      it("is not undone by a call that passes overrideAccess as undefined", async () => {
        await expect(
          checkedAs(lackerId).fieldGroups.create({
            slug: `fg_${tag}_undefined`,
            label: "Undefined",
            fields: FIELDS,
            overrideAccess: undefined,
          })
        ).rejects.toMatchObject(FORBIDDEN);
      });

      it("leaves a trusted instance trusted for every one of these writes", async () => {
        const made = await trusted.roles.create({
          data: {
            name: "by the server",
            slug: `by-server-${tag}`,
            permissionIds: [seeded.get("read-users")!],
          },
        });
        await trusted.roles.update({
          id: made.item.id,
          data: { name: "renamed by the server" },
        });
        await trusted.roles.setPermissions({
          roleId: made.item.id,
          permissionIds: [seeded.get("read-media")!],
        });
        await trusted.roles.delete({ id: made.item.id });

        const permission = await trusted.permissions.create({
          data: {
            name: "review users",
            slug: `review-${POSTS}`,
            action: "review",
            resource: POSTS,
          },
        });
        await trusted.permissions.delete({ id: permission.item.id });

        const slug = `fg_${tag}_server`;
        await trusted.fieldGroups.create({
          slug,
          label: "Server",
          fields: FIELDS,
        });
        await trusted.fieldGroups.update({ slug, data: { label: "Server 2" } });
        await trusted.fieldGroups.delete({ slug });
        expect(
          await trusted.fieldGroups.findBySlug({ slug, disableErrors: true })
        ).toBeNull();
      });
    });
  }
);
