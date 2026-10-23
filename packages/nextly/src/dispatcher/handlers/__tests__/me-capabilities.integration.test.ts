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

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, defineSingle, text } from "../../../config";
import type { ApiKeyService } from "../../../domains/auth/services/api-key-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

const ORIGIN = "http://localhost";

/** Every collection the install registers, and what its rule says. */
const PLAIN = ["posts", "notes"];
/** Its read rule refuses everyone, whatever permission they hold. */
const REFUSED = "secrets";
/** Its read rule admits the German language alone. */
const GERMAN = "german";

interface Capabilities {
  isSuperAdmin: boolean;
  validUntil: number | null;
  entities: Record<string, Record<string, unknown>>;
  system: Record<string, Record<string, boolean>>;
}

describe.each(getConfiguredTestDialects())(
  "what the server says a caller may do (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let readerId: string;
    let readerRoleId: string;
    let superAdminId: string;
    let readerKey: string;

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
            access: { read: ({ locale }) => locale === "de" },
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
      const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
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

    it("names every collection and Single, with the actions each one has", async () => {
      const { entities } = await ask(await session(readerId, [readerRoleId]));

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
      // refused, so the `true` above is the permission and not a default.
      expect(entities.notes).toMatchObject({ read: false, create: false });
    });

    it("refuses a read the permission allows and the collection's rule does not", async () => {
      const { entities } = await ask(await session(readerId, [readerRoleId]));

      // The role holds `read-secrets`; only the rule refuses it. An endpoint
      // answering from the held permissions alone would say `true` here.
      expect(entities[REFUSED]).toMatchObject({ read: false });
    });

    it("judges a rule in the language the request asks for", async () => {
      const headers = await session(readerId, [readerRoleId]);

      // The same caller, the same permission, the same rule: only the
      // language the read is in differs, and the rule answers by it.
      const german = await ask(headers, "?locale=de");
      const english = await ask(headers, "?locale=en");
      expect(german.entities[GERMAN]).toMatchObject({ read: true });
      expect(english.entities[GERMAN]).toMatchObject({ read: false });
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
      expect(entities[REFUSED]).toMatchObject({ read: false });
    });

    it("is never stored, and says when it stops holding", async () => {
      const res = await askRaw(await session(readerId, [readerRoleId]));

      expect(res.headers.get("cache-control")).toBe("private, no-store");
      // No assignment of the reader's role ends, so nothing limits the answer.
      expect(((await res.json()) as Capabilities).validUntil).toBeNull();
    });

    it("refuses a caller it did not authenticate", async () => {
      expect((await askRaw({})).status).toBe(401);
    });
  }
);
