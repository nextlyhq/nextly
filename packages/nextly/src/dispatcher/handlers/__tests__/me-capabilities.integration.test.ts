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
/**
 * Its read rule refuses German, and refuses one language read together with
 * others' translation states, while every language at once, unfiltered, may
 * be read. Readable in every language, so it is named, and each read the
 * admin sends answers by the languages that read is in.
 */
const OVERVIEW_REFUSED = "overview-refused";
/** Its publish rule refuses German; nothing else about it is refused. */
const NOT_IN_GERMAN = "not-in-german";
/**
 * Has a Draft/Published lifecycle, and the reader may read and create in it
 * but not publish: a copy of a published entry is created published.
 */
const PUBLISHED_COPY = "published-copy";

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
    /** One entry in each collection whose requests the agreement test sends. */
    let entryIn: Record<string, string>;
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
            access: {
              update: ({ locale }) => locale === "de",
              create: ({ locale }) => locale === "de",
            },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: OVERVIEW_REFUSED,
            localized: true,
            access: {
              read: ({ locale, locales }) =>
                locale !== "de" &&
                (locale === undefined || locales.length === 1),
            },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: NOT_IN_GERMAN,
            localized: true,
            status: true,
            access: { publish: ({ locale }) => locale !== "de" },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: PUBLISHED_COPY,
            status: true,
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
              idOf(`create-${GERMAN}`),
              idOf(`read-${OVERVIEW_REFUSED}`),
              idOf(`read-${NOT_IN_GERMAN}`),
              idOf(`update-${NOT_IN_GERMAN}`),
              idOf(`publish-${NOT_IN_GERMAN}`),
              idOf(`read-${PUBLISHED_COPY}`),
              idOf(`create-${PUBLISHED_COPY}`),
            ],
          },
        })
      ).item.id;
      // Written with no access check, so each request below meets only its
      // own gate.
      entryIn = {};
      for (const slug of [OVERVIEW_REFUSED, GERMAN, NOT_IN_GERMAN]) {
        const created = await t.nextly.create({
          collection: slug,
          data: { title: `one ${slug}` },
        });
        entryIn[slug] = (created.item as { id: string }).id;
      }
      const published = await t.nextly.create({
        collection: PUBLISHED_COPY,
        data: { title: "live", status: "published" },
      });
      entryIn[PUBLISHED_COPY] = (published.item as { id: string }).id;
      // A German translation, so publishing every language puts German live
      // and the publish rule is asked about it.
      await t.nextly.update({
        collection: NOT_IN_GERMAN,
        id: entryIn[NOT_IN_GERMAN]!,
        data: { title: "eins" },
        locale: "de",
      });
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
        [
          ...PLAIN,
          REFUSED,
          GERMAN,
          OVERVIEW_REFUSED,
          NOT_IN_GERMAN,
          PUBLISHED_COPY,
          "home",
        ].sort()
      );
      expect(Object.keys(entities.posts!).sort()).toEqual([
        "create",
        "createInDefaultLanguage",
        "delete",
        "duplicate",
        "kind",
        "publish",
        "publishEveryLanguage",
        "read",
        "readHistory",
        "readTranslations",
        "unpublish",
        "update",
        "updateInDefaultLanguage",
      ]);
      // A Single is one document: it is never created and never deleted, so
      // it carries neither answer rather than carrying `false`.
      expect(Object.keys(entities.home!).sort()).toEqual([
        "kind",
        "publish",
        "publishEveryLanguage",
        "read",
        "readHistory",
        "readTranslations",
        "unpublish",
        "update",
        "updateInDefaultLanguage",
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

    it("judges a read of every language's states, and the unfiltered history, in the languages those requests read", async () => {
      const headers = await session(readerId, [readerRoleId]);

      const english = (await ask(headers, "?locale=en")).entities[
        OVERVIEW_REFUSED
      ];
      const german = (await ask(headers, "?locale=de")).entities[
        OVERVIEW_REFUSED
      ];
      // English alone may be read, but not English with every language's
      // translation state, which is what the localized list and the editor's
      // overview ask for.
      expect(english).toMatchObject({ read: true, readTranslations: false });
      // The unfiltered history reads every language at once, with none read
      // alone: the rule allows that, in whichever language the answer was
      // asked, though German alone is refused.
      expect(german).toMatchObject({ read: false, readHistory: true });
      expect(english!.readHistory).toBe(true);
      // POPULATION CONTROL: a collection whose read rule reads no language
      // allows all three, so the refusals above are the rule reading the
      // languages each request is in.
      expect((await ask(headers, "?locale=en")).entities.posts).toMatchObject({
        read: true,
        readTranslations: true,
        readHistory: true,
      });
    });

    it("judges a create and an update sent with no language in the default language", async () => {
      const headers = await session(readerId, [readerRoleId]);

      // Asked in German, the rule admits the create and the update. The
      // quick-create and quick-edit modals send no language, so the server
      // writes English, which the rule refuses.
      const { entities } = await ask(headers, "?locale=de");
      expect(entities[GERMAN]).toMatchObject({
        create: true,
        update: true,
        createInDefaultLanguage: false,
        updateInDefaultLanguage: false,
      });
      // POPULATION CONTROL: a super-admin passes the rule, so the default
      // language cells can say yes and the refusals are the rule's.
      expect(
        (await ask(await session(superAdminId, []), "?locale=de")).entities[
          GERMAN
        ]
      ).toMatchObject({
        createInDefaultLanguage: true,
        updateInDefaultLanguage: true,
      });
    });

    it("agrees with the request behind each cell, for a refusal and an allow", async () => {
      const handlers = createDynamicHandlers();
      const send = (
        headers: Record<string, string>,
        method: "GET" | "POST" | "PATCH",
        path: string,
        body?: unknown
      ) => {
        const [route, search = ""] = path.split("?");
        const segments = route!.split("/");
        return handlers[method](
          new Request(`${ORIGIN}/api/${route}${search ? `?${search}` : ""}`, {
            method,
            headers: {
              origin: ORIGIN,
              ...headers,
              ...(body ? { "content-type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
          { params: Promise.resolve({ params: segments }) }
        );
      };
      /** Whether the request got through its gate. */
      const allowed = async (res: Response | Promise<Response>) =>
        (await res).status < 300;
      const reader = await session(readerId, [readerRoleId]);
      const admin = await session(superAdminId, []);
      const english = (await ask(reader, "?locale=en")).entities;
      const german = (await ask(reader, "?locale=de")).entities;
      const adminCells = (await ask(admin, "?locale=de")).entities;
      const at = (slug: string) =>
        `collections/${slug}/entries/${entryIn[slug]}`;

      const compared: [string, boolean, boolean][] = [
        [
          "a list with translation states",
          await allowed(
            send(
              reader,
              "GET",
              `collections/${OVERVIEW_REFUSED}/entries?locale=en&translation-status=1`
            )
          ),
          english[OVERVIEW_REFUSED]!.readTranslations as boolean,
        ],
        [
          "the same list where the rule reads no language",
          await allowed(
            send(
              reader,
              "GET",
              "collections/posts/entries?locale=en&translation-status=1"
            )
          ),
          english.posts!.readTranslations as boolean,
        ],
        [
          "the unfiltered history",
          await allowed(
            send(reader, "GET", `${at(OVERVIEW_REFUSED)}/versions`)
          ),
          german[OVERVIEW_REFUSED]!.readHistory as boolean,
        ],
        [
          "a create sent with no language",
          await allowed(
            send(reader, "POST", `collections/${GERMAN}/entries`, {
              title: "sent with no language",
            })
          ),
          german[GERMAN]!.createInDefaultLanguage as boolean,
        ],
        [
          "an update sent with no language",
          await allowed(
            send(reader, "PATCH", at(GERMAN), { title: "changed" })
          ),
          german[GERMAN]!.updateInDefaultLanguage as boolean,
        ],
        [
          "a duplicate",
          await allowed(send(reader, "POST", `${at(GERMAN)}/duplicate`)),
          german[GERMAN]!.duplicate as boolean,
        ],
        [
          "a duplicate of a published entry, without publish",
          await allowed(
            send(reader, "POST", `${at(PUBLISHED_COPY)}/duplicate`)
          ),
          english[PUBLISHED_COPY]!.duplicate as boolean,
        ],
        [
          "publishing every language",
          await allowed(
            send(reader, "POST", `${at(NOT_IN_GERMAN)}/publish-all`)
          ),
          english[NOT_IN_GERMAN]!.publishEveryLanguage as boolean,
        ],
        // The allow side, from a caller no rule refuses.
        [
          "an update sent with no language, by a super-admin",
          await allowed(send(admin, "PATCH", at(GERMAN), { title: "changed" })),
          adminCells[GERMAN]!.updateInDefaultLanguage as boolean,
        ],
        [
          "a duplicate, by a super-admin",
          await allowed(send(admin, "POST", `${at(GERMAN)}/duplicate`)),
          adminCells[GERMAN]!.duplicate as boolean,
        ],
        [
          "a duplicate of a published entry, by a super-admin",
          await allowed(send(admin, "POST", `${at(PUBLISHED_COPY)}/duplicate`)),
          adminCells[PUBLISHED_COPY]!.duplicate as boolean,
        ],
        [
          "publishing every language, by a super-admin",
          await allowed(
            send(admin, "POST", `${at(NOT_IN_GERMAN)}/publish-all`)
          ),
          adminCells[NOT_IN_GERMAN]!.publishEveryLanguage as boolean,
        ],
      ];
      for (const [request, route, cell] of compared) {
        expect(cell, request).toBe(route);
      }
      // POPULATION CONTROL: the comparison saw both verdicts.
      const verdicts = new Set(compared.map(([, route]) => route));
      expect([...verdicts].sort()).toEqual([false, true]);
    });

    it("refuses publishing every language where the publish rule refuses one of them", async () => {
      const headers = await session(readerId, [readerRoleId]);

      // Publishing English is allowed; publishing every language asks the
      // rule about German too, which it refuses.
      const { entities } = await ask(headers, "?locale=en");
      expect(entities[NOT_IN_GERMAN]).toMatchObject({
        update: true,
        publish: true,
        publishEveryLanguage: false,
      });
      // POPULATION CONTROL: the same answer for a super-admin, whom no rule
      // refuses, allows it, so the cell can say yes.
      expect(
        (await ask(await session(superAdminId, []), "?locale=en")).entities[
          NOT_IN_GERMAN
        ]!.publishEveryLanguage
      ).toBe(true);
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

    it("says the permission list ends when the role assignment it was read under ends", async () => {
      const permissionsOf = async (headers: Record<string, string>) => {
        const segments = ["me", "permissions"];
        const res = await createDynamicHandlers().GET(
          new Request(`${ORIGIN}/api/${segments.join("/")}`, {
            headers: { origin: ORIGIN, ...headers },
          }),
          { params: Promise.resolve({ params: segments }) }
        );
        expect(res.status).toBe(200);
        return (await res.json()) as {
          permissions: string[];
          validUntil: number | null;
        };
      };

      const visiting = await permissionsOf(
        await session(visitingId, [readerRoleId])
      );
      // POPULATION CONTROL: the assignment is live, so its permissions are
      // listed.
      expect(visiting.permissions).toContain("read-posts");
      expect(visiting.validUntil).toEqual(expect.any(Number));
      expect(
        Math.abs((visiting.validUntil ?? 0) - visitEnds.getTime())
      ).toBeLessThan(1000);
      // A role held with no end leaves the list unbounded.
      expect(
        (await permissionsOf(await session(readerId, [readerRoleId])))
          .validUntil
      ).toBeNull();
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

/**
 * A duplicate is written in the default language from what a read of the
 * source shows there, its fallbacks included, so it is judged in those
 * languages: here English, which falls back to German. A create sent with no
 * language is judged in English alone. A rule refusing any write that
 * involves German tells the two apart, which the site above, with no
 * fallback, cannot.
 */
describe.each(getConfiguredTestDialects())(
  "what the server says a caller may duplicate (%s)",
  (dialect: TestDialect) => {
    const COPIED = "copied";
    let t: TestNextly;
    let headers: Record<string, string>;
    let entryId: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: {
          locales: [{ code: "en", fallbackLocale: "de" }, "de"],
          defaultLocale: "en",
        },
        collections: [
          defineCollection({
            slug: COPIED,
            localized: true,
            access: { create: ({ locales }) => !locales.includes("de") },
            fields: [text({ name: "title" })],
          }),
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
      // The first user is the super-admin; the copier comes after.
      await direct.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const seeded = await direct.permissions.find({ limit: 1000 });
      const idOf = (slug: string) =>
        seeded.items.find(p => p.slug === slug)!.id;
      const roleId = (
        await direct.roles.create({
          data: {
            name: "copiers",
            slug: "copiers",
            permissionIds: [idOf(`read-${COPIED}`), idOf(`create-${COPIED}`)],
          },
        })
      ).item.id;
      const userId = (
        await direct.users.create({
          email: "copier@example.com",
          password: "Password123!",
          data: { name: "Copier", isActive: true, roles: [roleId] },
        })
      ).item.id;
      const created = await t.nextly.create({
        collection: COPIED,
        data: { title: "the source" },
      });
      entryId = (created.item as { id: string }).id;
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: "copier@example.com",
          name: "Copier",
          image: null,
          roleIds: [roleId],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      headers = { cookie: `nextly_session=${token}` };
    }, 120_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    function send(method: "GET" | "POST", path: string, body?: unknown) {
      const [route, search = ""] = path.split("?");
      const segments = route!.split("/");
      return createDynamicHandlers()[method](
        new Request(`${ORIGIN}/api/${route}${search ? `?${search}` : ""}`, {
          method,
          headers: {
            origin: ORIGIN,
            ...headers,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { params: Promise.resolve({ params: segments }) }
      );
    }

    it("judges a duplicate in the default language and its fallbacks, as the duplicate route does", async () => {
      const res = await send("GET", "me/capabilities");
      expect(res.status).toBe(200);
      const { entities } = (await res.json()) as {
        entities: Record<string, Record<string, unknown>>;
      };
      // A plain create writes English alone, which the rule allows; a copy
      // reads English and its German fallback, which it refuses.
      expect(entities[COPIED]).toMatchObject({
        createInDefaultLanguage: true,
        duplicate: false,
      });
      const duplicated = await send(
        "POST",
        `collections/${COPIED}/entries/${entryId}/duplicate`
      );
      expect(duplicated.status < 300).toBe(false);
      const created = await send("POST", `collections/${COPIED}/entries`, {
        title: "written in English",
      });
      expect(created.status < 300).toBe(true);
    });
  }
);
