/**
 * A user's external identities, listed and unlinked through both doors —
 * the REST endpoints and the Direct API's users namespace — under the same
 * rule: a signed-in person manages their own with no permission at all,
 * and another account's only with the user-management permissions (the
 * user read to list, the user update to unlink), each refused before
 * anything is read or written.
 *
 * The REST cases run through the catch-all handler with a real session
 * cookie, so the gate, the cross-site check and the dispatch are the ones
 * a browser meets. A Direct API instance (or a single call) with
 * `overrideAccess: false` and a `user` is judged as REST judges that
 * person; a trusted instance, the default, keeps doing what server code
 * asks of it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COOKIE_NAMES } from "../../auth/cookies/cookie-config";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { externalIdentityKeyDigest } from "../../schemas/external-identities";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { Nextly } from "../nextly";

/** The origin the test requests are addressed to, which is the app's own. */
const OWN_ORIGIN = "http://localhost";

/** A request through the catch-all REST handler, signed in as `userId`. */
async function rest(
  userId: string,
  method: "GET" | "DELETE",
  segments: string[],
  origin: string = OWN_ORIGIN
): Promise<Response> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET as string
  );
  const request = new Request(`${OWN_ORIGIN}/api/${segments.join("/")}`, {
    method,
    headers: {
      cookie: `${COOKIE_NAMES.accessToken}=${token}`,
      origin,
    },
  });
  const context = { params: Promise.resolve({ params: segments }) };
  const handlers = createDynamicHandlers();
  return method === "GET"
    ? handlers.GET(request, context)
    : handlers.DELETE(request, context);
}

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

/** Every row the identities tests read, as the fixture plants it. */
interface IdentityRow {
  id: string;
  userId: string;
  subject: string;
}

describe.each(getConfiguredTestDialects())(
  "the Direct API's users identity methods under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let managerId: string;
    let readerId: string;
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

    /** One identity row planted for `userId`, as a plugin's link would have. */
    async function identityFor(userId: string, subject: string) {
      const row = {
        id: randomUUID(),
        providerKey: "acme-auth:google",
        issuer: "https://accounts.google.com",
        subject,
        // The digest the unique index holds, derived exactly as the service
        // derives the ones it looks rows up by.
        keyDigest: externalIdentityKeyDigest(
          "acme-auth:google",
          "https://accounts.google.com",
          subject
        ),
        address: null,
        userId,
        createdAt: new Date("2020-01-01T00:00:00Z"),
      };
      await t.adapter.insert("nextly_external_identities", row);
      return row as IdentityRow;
    }

    /** The identities an account holds, as trusted server code reads them. */
    async function heldBy(userId: string): Promise<IdentityRow[]> {
      return trusted.users.listIdentities({ userId });
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

      managerId = await account("manager@example.com", [
        await role("identity-managers", ["read-users", "update-users"]),
      ]);
      readerId = await account("reader@example.com", [
        await role("identity-readers", ["read-users"]),
      ]);
      // Holds an unrelated grant, so the refusals below are the missing
      // user-management permissions, not a caller with nothing at all.
      lackerId = await account("lacker@example.com", [
        await role("no-user-management", ["read-media"]),
      ]);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe("a trusted instance", () => {
      it("lists and unlinks what server code names", async () => {
        const kept = await identityFor(managerId, "kept");
        const removed = await identityFor(managerId, "removed");

        const listed = await trusted.users.listIdentities({
          userId: managerId,
        });
        expect(listed.map(identity => identity.id).sort()).toEqual(
          [kept.id, removed.id].sort()
        );

        const result = await trusted.users.unlinkIdentity({
          userId: managerId,
          identityId: removed.id,
        });
        expect(result).toEqual({
          message: "Identity unlinked.",
          item: { id: removed.id },
        });
        expect((await heldBy(managerId)).map(i => i.id)).toEqual([kept.id]);
      });
    });

    describe("a person holding the user-management permissions", () => {
      it("lists and unlinks, the permission reaching any account's identities", async () => {
        const as = checkedAs(managerId);
        // The boot is one for the whole file, so every case below reads an
        // account of its own: the exact-list assertions hold whatever the
        // cases before it planted on their own accounts.
        const managed = await account("managed@example.com");
        const theirs = await identityFor(managed, "managed for someone else");

        const listed = await as.users.listIdentities({ userId: managed });
        expect(listed.map(identity => identity.id)).toEqual([theirs.id]);

        await as.users.unlinkIdentity({
          userId: managed,
          identityId: theirs.id,
        });
        expect(await heldBy(managed)).toEqual([]);
      });
    });

    describe("a person without the permissions", () => {
      it("is refused the listing, and reads nothing", async () => {
        const target = await account("unread@example.com");
        await identityFor(target, "not shown");

        await expect(
          checkedAs(lackerId).users.listIdentities({ userId: target })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      });

      it("is refused the unlink, and the identity stays", async () => {
        const target = await account("unremoved@example.com");
        const kept = await identityFor(target, "stays linked");

        await expect(
          checkedAs(lackerId).users.unlinkIdentity({
            userId: target,
            identityId: kept.id,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

        expect((await heldBy(target)).map(i => i.id)).toEqual([kept.id]);
      });
    });

    describe("a person who may read users but not update them", () => {
      it("lists, and is refused the unlink", async () => {
        const target = await account("read-only-target@example.com");
        const kept = await identityFor(target, "read but not removed");
        const as = checkedAs(readerId);

        const listed = await as.users.listIdentities({ userId: target });
        expect(listed.map(identity => identity.id)).toEqual([kept.id]);

        await expect(
          as.users.unlinkIdentity({
            userId: target,
            identityId: kept.id,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
        expect((await heldBy(target)).map(i => i.id)).toEqual([kept.id]);
      });
    });

    describe("the unlink of an identity the named account does not hold", () => {
      it("is refused as a missing one is, and the holder keeps it", async () => {
        const holder = await account("holder@example.com");
        const theirs = await identityFor(holder, "someone else's");

        await expect(
          trusted.users.unlinkIdentity({
            userId: managerId,
            identityId: theirs.id,
          })
        ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });

        expect((await heldBy(holder)).map(i => i.id)).toEqual([theirs.id]);
      });
    });

    describe("a person managing their own identities", () => {
      it("lists their own through REST with no permission, and no provider token", async () => {
        const own = await identityFor(lackerId, "own, listed over REST");

        const response = await rest(lackerId, "GET", ["me", "identities"]);
        const body = (await response.json()) as {
          identities: Record<string, unknown>[];
        };

        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.identities.map(identity => identity.id)).toContain(own.id);
        // The link's own record and nothing else: no field a provider token
        // could ride in.
        for (const identity of body.identities) {
          expect(Object.keys(identity).sort()).toEqual(
            [
              "address",
              "createdAt",
              "id",
              "issuer",
              "providerKey",
              "subject",
              "userId",
            ].sort()
          );
          expect(identity.userId).toBe(lackerId);
        }
      });

      it("unlinks their own through REST with no permission", async () => {
        const own = await identityFor(lackerId, "own, unlinked over REST");

        const response = await rest(lackerId, "DELETE", [
          "me",
          "identities",
          own.id,
        ]);

        expect(response.status, await response.clone().text()).toBe(200);
        expect((await heldBy(lackerId)).map(i => i.id)).not.toContain(own.id);
      });

      it("lists and unlinks their own through the Direct API with no permission", async () => {
        const own = await identityFor(lackerId, "own, through server code");
        const as = checkedAs(lackerId);

        const listed = await as.users.listIdentities({ userId: lackerId });
        expect(listed.map(identity => identity.id)).toContain(own.id);

        await as.users.unlinkIdentity({ userId: lackerId, identityId: own.id });
        expect((await heldBy(lackerId)).map(i => i.id)).not.toContain(own.id);
      });
    });

    describe("another account's identities over REST", () => {
      it("are refused to a person without the permissions, and stay", async () => {
        const target = await account("rest-unmanaged@example.com");
        const theirs = await identityFor(target, "not theirs to manage");

        const listing = await rest(lackerId, "GET", [
          "users",
          target,
          "identities",
        ]);
        expect(listing.status).toBe(403);

        const unlink = await rest(lackerId, "DELETE", [
          "users",
          target,
          "identities",
          theirs.id,
        ]);
        expect(unlink.status).toBe(403);
        expect((await heldBy(target)).map(i => i.id)).toEqual([theirs.id]);
      });

      it("are listed and unlinked by a person holding the user-management permissions", async () => {
        const target = await account("rest-managed@example.com");
        const theirs = await identityFor(target, "managed over REST");

        const listing = await rest(managerId, "GET", [
          "users",
          target,
          "identities",
        ]);
        const body = (await listing.json()) as {
          identities: { id: string }[];
        };
        expect(listing.status, JSON.stringify(body)).toBe(200);
        expect(body.identities.map(identity => identity.id)).toEqual([
          theirs.id,
        ]);

        const unlink = await rest(managerId, "DELETE", [
          "users",
          target,
          "identities",
          theirs.id,
        ]);
        expect(unlink.status, await unlink.clone().text()).toBe(200);
        expect(await heldBy(target)).toEqual([]);
      });
    });

    describe("a cross-site unlink", () => {
      it("is refused on the caller's own identities, and the identity stays", async () => {
        const own = await identityFor(lackerId, "kept from a forged unlink");

        const response = await rest(
          lackerId,
          "DELETE",
          ["me", "identities", own.id],
          "https://attacker.example"
        );
        const body = (await response.json()) as { error: { code: string } };

        expect(response.status).toBe(403);
        expect(body.error.code).toBe("CSRF_FAILED");
        expect((await heldBy(lackerId)).map(i => i.id)).toContain(own.id);
      });

      it("is refused on another account's identities, even with the permissions", async () => {
        const target = await account("cross-site-target@example.com");
        const theirs = await identityFor(
          target,
          "kept from a forged admin unlink"
        );

        const response = await rest(
          managerId,
          "DELETE",
          ["users", target, "identities", theirs.id],
          "https://attacker.example"
        );
        const body = (await response.json()) as { error: { code: string } };

        expect(response.status).toBe(403);
        expect(body.error.code).toBe("CSRF_FAILED");
        expect((await heldBy(target)).map(i => i.id)).toEqual([theirs.id]);
      });
    });
  }
);
