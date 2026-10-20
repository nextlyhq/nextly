/**
 * The Direct API's `apiKeys` namespace is checked when its caller asks to be.
 *
 * A Nextly instance (or a single call) with `overrideAccess: false` and a
 * `user` is judged as the REST routes judge that user: the same permissions,
 * keys made and changed only by and for that person, and writes refused to an
 * API key. Every refusal leaves the keys as they were. A trusted instance, the
 * default, keeps doing what server code asks of it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import type { ApiKeyMeta } from "../../domains/auth/services/api-key-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { Nextly, nextly } from "../nextly";

/** The part of the Direct API the set-up drives, typed where the shim is not. */
interface Direct {
  users: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  permissions: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
}

/** Every permission the key routes name, so a holder may do each operation. */
const KEY_PERMISSIONS = [
  "read-api-keys",
  "create-api-keys",
  "update-api-keys",
  "delete-api-keys",
];

describe.each(getConfiguredTestDialects())(
  "the Direct API's apiKeys namespace under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let superAdminId: string;
    let holderId: string;
    let lackerId: string;

    async function account(email: string, roles: string[] = []) {
      const created = await (t.nextly as unknown as Direct).users.create({
        data: {
          email,
          password: "Password123!",
          name: email,
          isActive: true,
          ...(roles.length > 0 ? { roles } : {}),
        },
      });
      return created.item.id;
    }

    /** A role holding exactly the named, seeded permissions. */
    async function role(slug: string, permissionSlugs: string[]) {
      const direct = t.nextly as unknown as Direct;
      const seeded = await direct.permissions.find({ limit: 1000 });
      const ids = permissionSlugs.map(wanted => {
        const found = seeded.items.find(p => p.slug === wanted);
        expect(found, `\`${wanted}\` must be seeded`).toBeDefined();
        return found!.id;
      });
      const created = await direct.roles.create({
        data: { name: slug, slug, permissionIds: ids },
      });
      return created.item.id;
    }

    /** An instance that asks to be checked, as this person. */
    function checkedAs(userId: string): Nextly {
      return new Nextly({ overrideAccess: false, user: { id: userId } });
    }

    /** A key made by trusted server code, for the operations below to act on. */
    async function keyOf(
      userId: string,
      name = "subject"
    ): Promise<ApiKeyMeta> {
      const { doc } = await trusted.apiKeys.create({
        userId,
        name,
        tokenType: "read-only",
        expiresIn: "unlimited",
      });
      return doc;
    }

    /** A key as trusted server code reads it back. */
    async function stored(id: string): Promise<ApiKeyMeta | null> {
      return trusted.apiKeys.findByID({ id });
    }

    /** How many keys a person owns, as trusted server code counts them. */
    async function ownedBy(userId: string): Promise<number> {
      return (await trusted.apiKeys.list({ userId })).length;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      trusted = new Nextly();
      // What a real boot does before serving anything: the harness boots
      // without it, and the roles below are made of these permissions.
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();

      // The install's first account holds super-admin.
      superAdminId = await account("owner@example.com");
      holderId = await account("holder@example.com", [
        await role("key-holders", KEY_PERMISSIONS),
      ]);
      lackerId = await account("lacker@example.com", [
        await role("no-keys", ["read-users"]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("a person without the permission", () => {
      it("is refused creating a key, and none is made", async () => {
        const before = await ownedBy(lackerId);

        await expect(
          checkedAs(lackerId).apiKeys.create({
            userId: lackerId,
            name: "refused",
            tokenType: "read-only",
            expiresIn: "unlimited",
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

        expect(await ownedBy(lackerId)).toBe(before);
      });

      it("is refused updating their own key, and it keeps its name", async () => {
        const key = await keyOf(lackerId, "kept name");

        await expect(
          checkedAs(lackerId).apiKeys.update({ id: key.id, name: "changed" })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

        expect((await stored(key.id))?.name).toBe("kept name");
      });

      it("is refused revoking their own key, and it stays active", async () => {
        const key = await keyOf(lackerId);

        await expect(
          checkedAs(lackerId).apiKeys.revoke({ id: key.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

        expect((await stored(key.id))?.isActive).toBe(true);
      });

      it("is refused reading keys", async () => {
        await expect(checkedAs(lackerId).apiKeys.list()).rejects.toMatchObject({
          code: "FORBIDDEN",
          statusCode: 403,
        });
        const key = await keyOf(lackerId);
        await expect(
          checkedAs(lackerId).apiKeys.findByID({ id: key.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      });
    });

    describe("a person holding the permission", () => {
      it("creates, renames and revokes their own key", async () => {
        const as = checkedAs(holderId);
        const { doc, key } = await as.apiKeys.create({
          userId: holderId,
          name: "mine",
          tokenType: "read-only",
          expiresIn: "unlimited",
        });
        expect(key).toMatch(/^nx_/);
        expect(doc.owner?.id).toBe(holderId);

        expect(
          (await as.apiKeys.update({ id: doc.id, name: "renamed" })).name
        ).toBe("renamed");
        await expect(as.apiKeys.revoke({ id: doc.id })).resolves.toEqual({
          success: true,
        });
        expect((await stored(doc.id))?.isActive).toBe(false);
      });

      it("may not create a key for someone else, as the admin cannot", async () => {
        const before = await ownedBy(lackerId);

        for (const caller of [holderId, superAdminId]) {
          await expect(
            checkedAs(caller).apiKeys.create({
              userId: lackerId,
              name: "for someone else",
              tokenType: "read-only",
              expiresIn: "unlimited",
            })
          ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        }

        expect(await ownedBy(lackerId)).toBe(before);
      });

      it("finds someone else's key missing to update or revoke, and it is left as it was", async () => {
        const key = await keyOf(lackerId, "theirs");

        for (const caller of [holderId, superAdminId]) {
          await expect(
            checkedAs(caller).apiKeys.update({ id: key.id, name: "taken" })
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
          await expect(
            checkedAs(caller).apiKeys.revoke({ id: key.id })
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
        }

        const after = await stored(key.id);
        expect(after?.name).toBe("theirs");
        expect(after?.isActive).toBe(true);
      });

      it("reads only their own keys, unless they are a super-admin", async () => {
        const mine = await keyOf(holderId, "listed mine");
        const theirs = await keyOf(lackerId, "listed theirs");
        const as = checkedAs(holderId);

        const listed = (await as.apiKeys.list()).map(k => k.id);
        expect(listed).toContain(mine.id);
        expect(listed).not.toContain(theirs.id);
        expect((await as.apiKeys.findByID({ id: mine.id }))?.id).toBe(mine.id);
        expect(await as.apiKeys.findByID({ id: theirs.id })).toBeNull();
        await expect(
          as.apiKeys.list({ userId: lackerId })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

        const admin = checkedAs(superAdminId);
        const all = (await admin.apiKeys.list()).map(k => k.id);
        expect(all).toEqual(expect.arrayContaining([mine.id, theirs.id]));
        expect(
          (await admin.apiKeys.list({ userId: lackerId })).map(k => k.id)
        ).toContain(theirs.id);
        expect((await admin.apiKeys.findByID({ id: theirs.id }))?.id).toBe(
          theirs.id
        );
      });
    });

    describe("who is asking", () => {
      it("refuses a checked call that names nobody", async () => {
        const anonymous = new Nextly({ overrideAccess: false });
        await expect(
          anonymous.apiKeys.create({
            userId: holderId,
            name: "nobody",
            tokenType: "read-only",
            expiresIn: "unlimited",
          })
        ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
        await expect(anonymous.apiKeys.list()).rejects.toMatchObject({
          code: "AUTH_REQUIRED",
        });
      });

      it("refuses an API key making or changing keys, whatever its grants", async () => {
        const actor: AuthenticatedScope = {
          actorType: "apiKey",
          permissions: KEY_PERMISSIONS,
        };
        const asKey = new Nextly({
          overrideAccess: false,
          user: { id: holderId },
          actor,
        });
        const key = await keyOf(holderId, "kept by key");
        const before = await ownedBy(holderId);

        await expect(
          asKey.apiKeys.create({
            userId: holderId,
            name: "by a key",
            tokenType: "read-only",
            expiresIn: "unlimited",
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        await expect(
          asKey.apiKeys.update({ id: key.id, name: "by a key" })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        await expect(
          asKey.apiKeys.revoke({ id: key.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

        expect(await ownedBy(holderId)).toBe(before);
        expect(await stored(key.id)).toMatchObject({
          name: "kept by key",
          isActive: true,
        });
      });

      it("lets an API key read keys by its own grants, naming owners only if it may read users", async () => {
        await keyOf(holderId, "seen by a key");
        const reading = (permissions: string[]) =>
          new Nextly({
            overrideAccess: false,
            user: { id: holderId },
            actor: { actorType: "apiKey", permissions },
          });

        // The owner holds every key permission; the key's own scope decides.
        await expect(
          reading(["read-users"]).apiKeys.list()
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

        const unnamed = await reading(["read-api-keys"]).apiKeys.list();
        expect(unnamed.length).toBeGreaterThan(0);
        expect(unnamed.every(k => k.owner === null)).toBe(true);

        const named = await reading([
          "read-api-keys",
          "read-users",
        ]).apiKeys.list();
        expect(named.every(k => k.owner?.id === holderId)).toBe(true);
      });
    });

    describe("where the request to be checked comes from", () => {
      it("honours it on a single call through the shared instance", async () => {
        const before = await ownedBy(lackerId);

        await expect(
          nextly.apiKeys.create({
            userId: lackerId,
            name: "per call",
            tokenType: "read-only",
            expiresIn: "unlimited",
            overrideAccess: false,
            user: { id: lackerId },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

        expect(await ownedBy(lackerId)).toBe(before);
      });

      it("is not undone by a call that passes overrideAccess as undefined", async () => {
        await expect(
          checkedAs(lackerId).apiKeys.create({
            userId: lackerId,
            name: "undefined",
            tokenType: "read-only",
            expiresIn: "unlimited",
            overrideAccess: undefined,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      });

      it("leaves a trusted instance trusted: server code makes and changes anyone's keys", async () => {
        const { doc } = await trusted.apiKeys.create({
          userId: lackerId,
          name: "made by the server",
          tokenType: "read-only",
          expiresIn: "unlimited",
        });
        expect(doc.owner?.id).toBe(lackerId);

        expect(
          (
            await trusted.apiKeys.update({
              id: doc.id,
              name: "renamed by the server",
            })
          ).name
        ).toBe("renamed by the server");
        expect((await trusted.apiKeys.list()).map(k => k.id)).toContain(doc.id);
        await expect(trusted.apiKeys.revoke({ id: doc.id })).resolves.toEqual({
          success: true,
        });
        expect((await stored(doc.id))?.isActive).toBe(false);
      });
    });
  }
);
