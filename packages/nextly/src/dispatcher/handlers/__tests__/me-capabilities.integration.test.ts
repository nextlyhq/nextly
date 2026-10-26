/**
 * What `GET /me/capabilities` tells a caller it may do.
 *
 * The admin offers a control only where this says yes, so the answer has to
 * be the one the server would give at the door behind the control: the
 * permission and the collection's code rule together, the rule judged in the
 * language the request names, a key judged on its own scope, and a
 * super-admin past every entity rule.
 *
 * The property that separates it from a plausible broken one is that a cell
 * moves with the RULE and not only with the permission: an endpoint built
 * from `/me/permissions` alone agrees about `posts`, which is decided by the
 * permission, and disagrees about a collection whose rule refuses a read the
 * permission allows, and about one whose rule admits only one language.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, defineSingle, text } from "../../../config";
import type { ApiKeyService } from "../../../domains/auth/services/api-key-service";
import { UserRoleService } from "../../../domains/auth/services/user-role-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { consoleLogger } from "../../../services/shared";

const ORIGIN = "http://localhost";

/** Every collection the install registers, and what its rule says. */
const PLAIN = ["posts", "notes"];
/** Its read rule refuses everyone, whatever permission they hold. */
const REFUSED = "secrets";
/**
 * Readable by permission; its update rule admits the German language alone.
 * The rule is on update rather than read so the collection stays readable,
 * and so named, in every language.
 */
const GERMAN = "german";

interface Capabilities {
  isSuperAdmin: boolean;
  validUntil: number | null;
  entities: Record<string, Record<string, unknown>>;
}

describe.each(getConfiguredTestDialects())(
  "what the server says a caller may do (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let readerId: string;
    let readerRoleId: string;
    let superAdminId: string;
    let readerKey: string;
    /** Reads Posts and nothing else. */
    let postsReader: { id: string; roleId: string };
    /** Reads Posts and Notes: the control for `postsReader`. */
    let bothReader: { id: string; roleId: string };
    let visitingId: string;
    /** The visiting reader's read-only and role-based keys, and when each ends. */
    let visitingKeys: { readOnly: string; roleBased: string; keyEnds: number };
    /** When the visiting reader's one role assignment ends. */
    const visitEnds = new Date(Date.now() + 60 * 60 * 1000);

    async function session(userId: string, roleIds: string[]) {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: `${userId}@example.com`,
          name: userId,
          image: null,
          roleIds,
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }

    /** The raw response, so its headers can be read as well as its body. */
    function askRaw(headers: Record<string, string>, search = "") {
      const segments = ["me", "capabilities"];
      const handlers = createDynamicHandlers();
      return handlers.GET(
        new Request(`${ORIGIN}/api/${segments.join("/")}${search}`, {
          headers: { origin: ORIGIN, ...headers },
        }),
        { params: Promise.resolve({ params: segments }) }
      );
    }

    async function ask(
      headers: Record<string, string>,
      search = ""
    ): Promise<Capabilities> {
      const res = await askRaw(headers, search);
      expect(res.status).toBe(200);
      return (await res.json()) as Capabilities;
    }

    /** The slugs the collection or Single list shows this caller. */
    async function listed(
      headers: Record<string, string>,
      kind: "collections" | "singles"
    ): Promise<string[]> {
      const handlers = createDynamicHandlers();
      const res = await handlers.GET(
        new Request(`${ORIGIN}/api/${kind}?limit=100`, {
          headers: { origin: ORIGIN, ...headers },
        }),
        { params: Promise.resolve({ params: [kind] }) }
      );
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as {
        items: { slug?: string; name?: string }[];
      };
      return items.map(item => String(item.slug ?? item.name));
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        collections: [
          ...PLAIN.map(slug =>
            defineCollection({ slug, fields: [text({ name: "title" })] })
          ),
          defineCollection({
            slug: REFUSED,
            access: { read: () => false },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: GERMAN,
            localized: true,
            access: { update: ({ locale }) => locale === "de" },
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({ slug: "home", fields: [text({ name: "h" })] }),
        ],
      });
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();

      const direct = t.nextly as unknown as {
        users: {
          create(a: {
            email: string;
            password: string;
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
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
      };
      superAdminId = (
        await direct.users.create({
          email: "owner@example.com",
          password: "Password123!",
          data: { name: "Owner", isActive: true },
        })
      ).item.id;
      const seeded = await direct.permissions.find({ limit: 1000 });
      const idOf = (slug: string) =>
        seeded.items.find(p => p.slug === slug)!.id;
      // Reads posts outright, and holds the permission for the two
      // collections whose rule decides the answer, so each of those cells
      // shows the rule's answer rather than a missing permission.
      readerRoleId = (
        await direct.roles.create({
          data: {
            name: "readers",
            slug: "readers",
            permissionIds: [
              idOf("read-posts"),
              idOf(`read-${REFUSED}`),
              idOf(`read-${GERMAN}`),
              idOf(`update-${GERMAN}`),
            ],
          },
        })
      ).item.id;
      readerId = (
        await direct.users.create({
          email: "reader@example.com",
          password: "Password123!",
          data: { name: "Reader", isActive: true, roles: [readerRoleId] },
        })
      ).item.id;
      const readerOf = async (name: string, slugs: string[]) => {
        const roleId = (
          await direct.roles.create({
            data: { name, slug: name, permissionIds: slugs.map(idOf) },
          })
        ).item.id;
        const id = (
          await direct.users.create({
            email: `${name}@example.com`,
            password: "Password123!",
            data: { name, isActive: true, roles: [roleId] },
          })
        ).item.id;
        return { id, roleId };
      };
      postsReader = await readerOf("posts-reader", ["read-posts"]);
      bothReader = await readerOf("both-reader", ["read-posts", "read-notes"]);
      // Holds the readers' role for an hour, so the answer stops holding then.
      visitingId = (
        await direct.users.create({
          email: "visiting@example.com",
          password: "Password123!",
          data: { name: "Visiting", isActive: true },
        })
      ).item.id;
      const assigned = await new UserRoleService(
        t.adapter as never,
        consoleLogger
      ).assignRoleToUser(visitingId, readerRoleId, { expiresAt: visitEnds });
      expect(assigned.success).toBe(true);
      const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      const readOnly = await keys.createApiKey(visitingId, {
        name: "follows the visitor",
        tokenType: "read-only",
        expiresIn: "7d",
      });
      const roleBased = await keys.createApiKey(visitingId, {
        name: "carries the readers role",
        tokenType: "role-based",
        roleId: readerRoleId,
        expiresIn: "7d",
      });
      visitingKeys = {
        readOnly: readOnly.key,
        roleBased: roleBased.key,
        keyEnds: Date.parse(roleBased.meta.expiresAt ?? ""),
      };
      readerKey = (
        await keys.createApiKey(readerId, {
          name: "reads posts",
          tokenType: "read-only",
          expiresIn: "unlimited",
        })
      ).key;
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("names every collection and Single to a caller who may read them all, with the actions each one has", async () => {
      // A super-admin reads every entity, so every one is named.
      const { entities } = await ask(await session(superAdminId, []));

      expect(Object.keys(entities).sort()).toEqual(
        [...PLAIN, REFUSED, GERMAN, "home"].sort()
      );
      expect(Object.keys(entities.posts!).sort()).toEqual([
        "create",
        "delete",
        "kind",
        "publish",
        "read",
        "unpublish",
        "update",
      ]);
      // A Single is one document: it is never created and never deleted, so
      // it carries neither answer rather than carrying `false`.
      expect(Object.keys(entities.home!).sort()).toEqual([
        "kind",
        "publish",
        "read",
        "unpublish",
        "update",
      ]);
      expect(entities.posts!.kind).toBe("collection");
      expect(entities.home!.kind).toBe("single");
    });

    it("names only what the caller may read", async () => {
      const { entities } = await ask(
        await session(postsReader.id, [postsReader.roleId])
      );

      // Notes, the Single and the rule-guarded collections exist, and a role
      // that may read only Posts is not told so.
      expect(Object.keys(entities)).toEqual(["posts"]);
    });

    it("names a second collection once the caller may read it too", async () => {
      // POPULATION CONTROL for the case above: the same install, a role that
      // also reads Notes, so Notes' absence there is the missing read and not
      // a collection the answer never names.
      const { entities } = await ask(
        await session(bothReader.id, [bothReader.roleId])
      );

      expect(Object.keys(entities).sort()).toEqual(["notes", "posts"]);
    });

    it("names exactly what the collection and Single lists show the same caller", async () => {
      const headers = await session(readerId, [readerRoleId]);
      const { entities } = await ask(headers);

      expect(Object.keys(entities).sort()).toEqual(
        [
          ...(await listed(headers, "collections")),
          ...(await listed(headers, "singles")),
        ].sort()
      );
    });

    it("allows the read the role holds and refuses the writes it does not", async () => {
      const { entities } = await ask(await session(readerId, [readerRoleId]));

      expect(entities.posts).toMatchObject({
        read: true,
        create: false,
        update: false,
        delete: false,
        publish: false,
        unpublish: false,
      });
      // POPULATION CONTROL: a collection the role names no permission for is
      // not offered at all, so the `true` above is the permission and not a
      // default.
      expect(entities.notes).toBeUndefined();
    });

    it("leaves out a collection whose rule refuses a read the permission allows", async () => {
      const { entities } = await ask(await session(readerId, [readerRoleId]));

      // The role holds `read-secrets`; only the rule refuses it. An endpoint
      // answering from the held permissions alone would name it, readable.
      expect(entities[REFUSED]).toBeUndefined();
    });

    it("judges a rule in the language the request asks for", async () => {
      const headers = await session(readerId, [readerRoleId]);

      // The same caller, the same permission, the same rule: only the
      // language the update is in differs, and the rule answers by it.
      const german = await ask(headers, "?locale=de");
      const english = await ask(headers, "?locale=en");
      expect(german.entities[GERMAN]).toMatchObject({
        read: true,
        update: true,
      });
      expect(english.entities[GERMAN]).toMatchObject({
        read: true,
        update: false,
      });
      // POPULATION CONTROL: a collection whose rule reads no language is the
      // same in both, so the move above is the rule reading the language.
      expect(german.entities.posts!.read).toBe(true);
      expect(english.entities.posts!.read).toBe(true);
    });

    it("passes a super-admin through every entity rule", async () => {
      const { isSuperAdmin, entities } = await ask(
        await session(superAdminId, [])
      );

      expect(isSuperAdmin).toBe(true);
      // Past the refusing rule too, which is what makes this the gate's
      // answer rather than the rule's.
      expect(entities[REFUSED]).toMatchObject({ read: true, delete: true });
      expect(entities.posts).toMatchObject({ read: true, create: true });
    });

    it("answers an API key on the key's own scope, never as a super-admin", async () => {
      const { isSuperAdmin, entities } = await ask({
        authorization: `Bearer ${readerKey}`,
      });

      // A read-only key made by the reader: it reads what the reader reads
      // and writes nothing, and carries no super-admin authority of its own.
      expect(isSuperAdmin).toBe(false);
      expect(entities.posts).toMatchObject({ read: true, update: false });
      expect(entities[REFUSED]).toBeUndefined();
    });

    it("is never stored, and says when it stops holding", async () => {
      const res = await askRaw(await session(readerId, [readerRoleId]));

      expect(res.headers.get("cache-control")).toBe("private, no-store");
      // No assignment of the reader's role ends, so nothing limits the answer.
      expect(((await res.json()) as Capabilities).validUntil).toBeNull();
    });

    it("says the answer ends when the caller's soonest role assignment ends", async () => {
      const { validUntil, entities } = await ask(
        await session(visitingId, [readerRoleId])
      );

      // POPULATION CONTROL: the assignment is live, so the role is held.
      expect(entities.posts).toMatchObject({ read: true });
      // A database may keep whole seconds of the expiry.
      expect(validUntil).not.toBeNull();
      expect(Math.abs((validUntil ?? 0) - visitEnds.getTime())).toBeLessThan(
        1000
      );
    });

    it("ends a key's answer with the key, and with its owner's role only where the key follows it", async () => {
      // A read-only key follows its owner's roles, so it ends when the
      // visitor's role does, an hour from now, before the key's seven days.
      const followed = await ask({
        authorization: `Bearer ${visitingKeys.readOnly}`,
      });
      expect(
        Math.abs((followed.validUntil ?? 0) - visitEnds.getTime())
      ).toBeLessThan(1000);

      // A role-based key carries a role of its own, so the owner's
      // assignment does not bound it: it ends with the key.
      const ownRole = await ask({
        authorization: `Bearer ${visitingKeys.roleBased}`,
      });
      // POPULATION CONTROL: the key really ends later than the visit.
      expect(visitingKeys.keyEnds).toBeGreaterThan(visitEnds.getTime());
      expect(
        Math.abs((ownRole.validUntil ?? 0) - visitingKeys.keyEnds)
      ).toBeLessThan(1000);
    });

    it("refuses, rather than naming only some entities, when a registry cannot be read", async () => {
      const registry = t.getService("collectionRegistryService") as unknown as {
        getAllSlugs: () => Promise<string[]>;
      };
      const failed = vi
        .spyOn(registry, "getAllSlugs")
        .mockRejectedValue(new Error("registry unreachable"));
      try {
        const res = await askRaw(await session(readerId, [readerRoleId]));
        // POPULATION CONTROL: the answer reached the registry that failed.
        expect(failed).toHaveBeenCalled();
        expect(res.status).toBe(503);
      } finally {
        failed.mockRestore();
      }
    });

    it("refuses a caller it did not authenticate", async () => {
      expect((await askRaw({})).status).toBe(401);
    });
  }
);
