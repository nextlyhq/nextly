/**
 * The Direct API's user writes are checked when their caller asks to be.
 *
 * An instance (or a single call) with `overrideAccess: false` and a `user` is
 * judged as the REST routes judge that user: `create-users`, `update-users`
 * and `delete-users`, through the same decision. The write then runs as that
 * caller for the rule on granting super-admin, which only a super-admin
 * person passes and an API key never does, as over REST. A checked call that
 * names nobody is refused with AUTH_REQUIRED, and every refusal leaves the
 * users as they were. A trusted instance, the default, is unchanged: server
 * code may still make anyone a super-admin.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { SUPER_ADMIN_SLUG } from "../../services/access/super-admin";
import {
  isSuperAdmin,
  isSuperAdminOrThrow,
} from "../../services/lib/permissions";
import { Nextly, nextly } from "../nextly";

const FORBIDDEN = { code: "FORBIDDEN", statusCode: 403 };
const AUTH_REQUIRED = { code: "AUTH_REQUIRED", statusCode: 401 };
const PASSWORD = "Password123!";

describe.each(getConfiguredTestDialects())(
  "the Direct API's user writes under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let superAdminId: string;
    let superAdminRoleId: string;
    let lackerId: string;
    let keeperId: string;
    let readUsersRoleId: string;
    // A role that inherits super-admin, so holding it confers super-admin.
    let elevatedRoleId: string;
    let roleKeeperId: string;
    let emails = 0;

    /** A fresh address, so no case depends on another's leftovers. */
    function email(label: string) {
      emails += 1;
      return `${label}-${emails}@example.com`;
    }

    async function account(address: string, roleIds: string[] = []) {
      const created = await trusted.users.create({
        email: address,
        password: PASSWORD,
        data: {
          name: address,
          isActive: true,
          ...(roleIds.length > 0 ? { roles: roleIds } : {}),
        },
      });
      return String((created.item as { id: string }).id);
    }

    async function role(slug: string, permissionSlugs: string[]) {
      const seeded = await trusted.permissions.find({ limit: 1000 });
      const created = await trusted.roles.create({
        data: {
          name: slug,
          slug,
          permissionIds: permissionSlugs.map(wanted => {
            const found = seeded.items.find(p => p.slug === wanted);
            expect(found, `\`${wanted}\` must be seeded`).toBeDefined();
            return found!.id;
          }),
        },
      });
      return created.item.id;
    }

    /** A seeded permission's id: a role needs at least one. */
    async function permissionId(slug: string): Promise<string> {
      const seeded = await trusted.permissions.find({ limit: 1000 });
      const found = seeded.items.find(p => p.slug === slug);
      expect(found, `\`${slug}\` must be seeded`).toBeDefined();
      return found!.id;
    }

    /** An instance that asks to be checked, as this person. */
    function checkedAs(userId: string): Nextly {
      return new Nextly({ overrideAccess: false, user: { id: userId } });
    }

    /** How many users exist, as trusted server code counts them. */
    async function userCount(): Promise<number> {
      return (await trusted.users.find({ limit: 1 })).meta.total;
    }

    async function nameOf(id: string): Promise<string | undefined> {
      const found = (await trusted.users.findByID({ id })) as {
        name?: string;
      } | null;
      return found?.name;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      trusted = new Nextly();
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();

      // The install's first account holds super-admin.
      superAdminId = await account("owner@example.com");
      const roles = await trusted.roles.find({ limit: 1000 });
      superAdminRoleId = roles.items.find(r => r.slug === SUPER_ADMIN_SLUG)!.id;
      readUsersRoleId = await role("user-readers", ["read-users"]);
      lackerId = await account("lacker@example.com", [readUsersRoleId]);
      elevatedRoleId = (
        await trusted.roles.create({
          data: {
            name: "elevated",
            slug: "elevated",
            permissionIds: [await permissionId("read-users")],
            childRoleIds: [superAdminRoleId],
          },
        })
      ).item.id;
      roleKeeperId = await account("role-keeper@example.com", [
        await role("role-keepers", [
          "read-roles",
          "create-roles",
          "update-roles",
          "delete-roles",
        ]),
      ]);
      keeperId = await account("keeper@example.com", [
        await role("user-keepers", [
          "read-users",
          "create-users",
          "update-users",
          "delete-users",
        ]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("a person without the permission", () => {
      it("is refused creating a user, and none is made", async () => {
        const before = await userCount();
        await expect(
          checkedAs(lackerId).users.create({
            email: email("refused"),
            password: PASSWORD,
            data: { name: "Refused" },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect(await userCount()).toBe(before);
      });

      it("is refused updating and deleting a user, who stays as they were", async () => {
        const subject = await account(email("kept"));
        const as = checkedAs(lackerId);

        await expect(
          as.users.update({ id: subject, data: { name: "Renamed" } })
        ).rejects.toMatchObject(FORBIDDEN);
        await expect(as.users.delete({ id: subject })).rejects.toMatchObject(
          FORBIDDEN
        );

        expect(await nameOf(subject)).not.toBe("Renamed");
        expect(await nameOf(subject)).toBeDefined();
      });
    });

    describe("a person holding the permission", () => {
      it("creates, updates and deletes a user", async () => {
        const as = checkedAs(keeperId);
        const created = await as.users.create({
          email: email("made"),
          password: PASSWORD,
          data: { name: "Made" },
        });
        const id = String((created.item as { id: string }).id);
        await as.users.update({ id, data: { name: "Remade" } });
        expect(await nameOf(id)).toBe("Remade");
        await as.users.delete({ id });
        expect(await trusted.users.findByID({ id, disableErrors: true })).toBe(
          null
        );
      });

      it("may not make anyone a super-admin, on create or on update", async () => {
        const as = checkedAs(keeperId);
        const before = await userCount();
        await expect(
          as.users.create({
            email: email("raised"),
            password: PASSWORD,
            data: { name: "Raised", roles: [superAdminRoleId] },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect(await userCount()).toBe(before);

        const subject = await account(email("not-raised"), [readUsersRoleId]);
        await expect(
          as.users.update({ id: subject, data: { roles: [superAdminRoleId] } })
        ).rejects.toMatchObject(FORBIDDEN);
        expect(await isSuperAdmin(subject)).toBe(false);
      });

      it("may not give anyone a role that inherits super-admin, on a single checked call", async () => {
        // Checked per call through the shared instance, the person named by
        // id alone: the role confers super-admin through what it inherits.
        const subject = await account(email("not-elevated"), [readUsersRoleId]);
        await expect(
          nextly.users.update({
            id: subject,
            data: { roles: [elevatedRoleId] },
            overrideAccess: false,
            user: { id: keeperId },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect(await isSuperAdminOrThrow(subject, t.adapter.getDrizzle())).toBe(
          false
        );

        const before = await userCount();
        await expect(
          checkedAs(keeperId).users.create({
            email: email("elevated"),
            password: PASSWORD,
            data: { name: "Elevated", roles: [elevatedRoleId] },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect(await userCount()).toBe(before);
      });

      it("lets a super-admin make another super-admin", async () => {
        const created = await checkedAs(superAdminId).users.create({
          email: email("second-admin"),
          password: PASSWORD,
          data: { name: "Second admin", roles: [superAdminRoleId] },
        });
        expect(
          await isSuperAdmin(String((created.item as { id: string }).id))
        ).toBe(true);
      });
    });

    describe("roles that confer super-admin", () => {
      it("refuses a role made to inherit super-admin by someone who is not one", async () => {
        const before = (await trusted.roles.find({ limit: 1000 })).meta.total;
        await expect(
          checkedAs(roleKeeperId).roles.create({
            data: {
              name: "inherits",
              slug: "inherits-super-admin",
              permissionIds: [await permissionId("read-users")],
              childRoleIds: [superAdminRoleId],
            },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect((await trusted.roles.find({ limit: 1000 })).meta.total).toBe(
          before
        );
      });

      it("lets a super-admin make one, and server code too", async () => {
        const byAdmin = await checkedAs(superAdminId).roles.create({
          data: {
            name: "by the admin",
            slug: "admin-made-elevated",
            permissionIds: [await permissionId("read-users")],
            childRoleIds: [superAdminRoleId],
          },
        });
        expect(byAdmin.item.id).toBeDefined();
        const byServer = await trusted.roles.create({
          data: {
            name: "by the server",
            slug: "server-made-elevated",
            permissionIds: [await permissionId("read-users")],
            childRoleIds: [superAdminRoleId],
          },
        });
        expect(byServer.item.id).toBeDefined();
      });
    });

    describe("who is asking", () => {
      it("refuses a checked write that names nobody", async () => {
        const anonymous = new Nextly({ overrideAccess: false });
        await expect(
          anonymous.users.create({
            email: email("nobody"),
            password: PASSWORD,
            data: { name: "Nobody" },
          })
        ).rejects.toMatchObject(AUTH_REQUIRED);
      });

      it("judges an API key by its own grants, and never lets one grant super-admin", async () => {
        // The owner is a super-admin; the key acts only by its own scope.
        const asKey = (permissions: string[]) =>
          new Nextly({
            overrideAccess: false,
            user: { id: superAdminId },
            actor: { actorType: "apiKey", permissions },
          });

        await expect(
          asKey(["read-users"]).users.create({
            email: email("by-reading-key"),
            password: PASSWORD,
            data: { name: "By a reading key" },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        await expect(
          asKey(["create-users"]).users.create({
            email: email("by-key"),
            password: PASSWORD,
            data: { name: "By a key" },
          })
        ).resolves.toBeDefined();
        await expect(
          asKey(["create-users"]).users.create({
            email: email("raised-by-key"),
            password: PASSWORD,
            data: { name: "Raised by a key", roles: [superAdminRoleId] },
          })
        ).rejects.toMatchObject(FORBIDDEN);
      });
    });

    describe("where the request to be checked comes from", () => {
      it("honours it on a single call through the shared instance", async () => {
        const subject = await account(email("per-call"));
        await expect(
          nextly.users.delete({
            id: subject,
            overrideAccess: false,
            user: { id: lackerId },
          })
        ).rejects.toMatchObject(FORBIDDEN);
        expect(await nameOf(subject)).toBeDefined();
      });

      it("is not undone by a call that passes overrideAccess as undefined", async () => {
        await expect(
          checkedAs(lackerId).users.create({
            email: email("undefined"),
            password: PASSWORD,
            data: { name: "Undefined" },
            overrideAccess: undefined,
          })
        ).rejects.toMatchObject(FORBIDDEN);
      });

      it("leaves a trusted instance trusted: server code may make, change, raise and delete anyone", async () => {
        const created = await trusted.users.create({
          email: email("by-server"),
          password: PASSWORD,
          data: { name: "By the server" },
        });
        const id = String((created.item as { id: string }).id);
        await trusted.users.update({
          id,
          data: { name: "Raised by the server", roles: [superAdminRoleId] },
        });
        expect(await isSuperAdmin(id)).toBe(true);
        await trusted.users.update({ id, data: { roles: [readUsersRoleId] } });
        await trusted.users.delete({ id });
        expect(await trusted.users.findByID({ id, disableErrors: true })).toBe(
          null
        );
      });
    });
  }
);
