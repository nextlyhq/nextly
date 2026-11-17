/**
 * An entry read that also answers as stored: `?stored=1` adds `_stored`, the
 * entry as a separate depth-0 read in the same language and view returns it.
 *
 * What matters is that the two are the same read: the same access rules (a
 * related row the caller may not read is left out of the populated read and
 * kept, as its id, in the stored one), the same hooks, the same held draft and
 * the same language. And that half a pair is never answered: a refused read
 * is refused whole, and a stored read that fails fails the request.
 *
 * Driven through the REST route handler, so each request meets the gate a
 * real one meets.
 *
 * @module domains/collections/__tests__/entry-stored.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, relationship, text } from "../../../config";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

const ORIGIN = "http://localhost";
/** Read by those holding its read permission. */
const PEOPLE = "stored_people";
/** Read by nobody but the system. */
const SECRETS = "stored_secrets";
/** Drafts kept; each note names an author; a read hook marks what it read. */
const NOTES = "stored_notes";
/** Translated: its title per language, its code shared. */
const GUIDES = "stored_guides";
/** The note whose stored read the hook refuses. */
const BREAKS_STORED = "breaks-stored";

type Doc = Record<string, unknown>;

describe.each(getConfiguredTestDialects())(
  "a read with ?stored=1 answers the entry as stored beside it (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let ana: { id: string; roleId: string };
    let carl: { id: string; roleId: string };
    let noteId: string;
    let breaksId: string;
    let guideId: string;
    let hiddenId: string;

    async function session(user: { id: string; roleId: string }) {
      const token = await signAccessToken(
        buildClaims({
          userId: user.id,
          email: `${user.id}@example.com`,
          name: user.id,
          image: null,
          roleIds: [user.roleId],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }

    function send(
      headers: Record<string, string>,
      method: "GET" | "POST" | "PATCH",
      path: string,
      body?: unknown
    ): Promise<Response> {
      const [route, search = ""] = path.split("?");
      const handlers = createDynamicHandlers();
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
        { params: Promise.resolve({ params: route!.split("/") }) }
      );
    }

    async function read(user: { id: string; roleId: string }, path: string) {
      const res = await send(await session(user), "GET", path);
      return { status: res.status, doc: (await res.json()) as Doc };
    }

    async function write(
      method: "POST" | "PATCH",
      path: string,
      body: Doc
    ): Promise<Doc> {
      const res = await send(await session(ana), method, path, body);
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      return ((await res.json()) as { item: Doc }).item;
    }

    /** The populated read with `_stored`, and the separate depth-0 read. */
    async function bothWays(slug: string, id: string, view: string) {
      const together = await read(
        ana,
        `collections/${slug}/entries/${id}?depth=2&stored=1&${view}`
      );
      const apart = await read(
        ana,
        `collections/${slug}/entries/${id}?depth=0&${view}`
      );
      expect(together.status).toBe(200);
      expect(apart.status).toBe(200);
      return { together: together.doc, apart: apart.doc };
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: PEOPLE,
            fields: [text({ name: "name" })],
          }),
          defineCollection({
            slug: SECRETS,
            access: { read: () => false },
            fields: [text({ name: "name" })],
          }),
          defineCollection({
            slug: NOTES,
            status: true,
            versions: { drafts: true },
            hooks: {
              afterRead: [
                ctx => {
                  const doc = (ctx.data ?? {}) as Doc;
                  // Refuses only the depth-0 read, where the author is an id.
                  if (
                    doc.title === BREAKS_STORED &&
                    typeof doc.author === "string"
                  ) {
                    throw new Error("This read is refused by a hook.");
                  }
                  return { ...doc, hooked: true };
                },
              ],
            },
            fields: [
              text({ name: "title" }),
              relationship({ name: "author", relationTo: PEOPLE }),
              relationship({ name: "reviewer", relationTo: SECRETS }),
            ],
          }),
          defineCollection({
            slug: GUIDES,
            localized: true,
            fields: [
              text({ name: "title", localized: true }),
              text({ name: "code", localized: false }),
            ],
          }),
        ],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      await seedPermissionsAndRolePresets();

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
      const seeded = await direct.permissions.find({ limit: 1000 });
      const idOf = (slug: string) =>
        seeded.items.find(p => p.slug === slug)!.id;
      const person = async (name: string, permissions: string[]) => {
        const roleId = (
          await direct.roles.create({
            data: { name, slug: name, permissionIds: permissions.map(idOf) },
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
      // The first account made is the site's owner, whom no rule limits; the
      // reads below are an editor's.
      await person("owner", [`read-${PEOPLE}`]);
      ana = await person(
        "ana",
        [
          ...[PEOPLE, NOTES, GUIDES].flatMap(slug => [
            `create-${slug}`,
            `read-${slug}`,
            `update-${slug}`,
          ]),
          `publish-${NOTES}`,
        ]
      );
      // May read the people, not the notes.
      carl = await person("carl", [`read-${PEOPLE}`]);

      const people = t.getService("collectionsHandler") as unknown as {
        createEntry(
          ctx: Doc,
          data: Doc
        ): Promise<{ data: { id: string } | undefined }>;
      };
      const shown = await people.createEntry(
        { collectionName: PEOPLE, overrideAccess: true },
        { name: "Bea" }
      );
      const hidden = await people.createEntry(
        { collectionName: SECRETS, overrideAccess: true },
        { name: "Dov" }
      );
      const shownId = String(shown.data?.id);
      hiddenId = String(hidden.data?.id);

      const note = await write("POST", `collections/${NOTES}/entries`, {
        title: "Launch",
        author: shownId,
        reviewer: hiddenId,
        status: "published",
      });
      noteId = String(note.id);
      // A status-less edit of a published note is held as its draft.
      await write("PATCH", `collections/${NOTES}/entries/${noteId}`, {
        title: "Launch, revised",
        _overwrite: true,
      });

      const breaks = await write("POST", `collections/${NOTES}/entries`, {
        title: BREAKS_STORED,
        author: shownId,
        status: "published",
      });
      breaksId = String(breaks.id);

      const guide = await write("POST", `collections/${GUIDES}/entries`, {
        title: "Start here",
        code: "g-1",
      });
      guideId = String(guide.id);
      await write(
        "PATCH",
        `collections/${GUIDES}/entries/${guideId}?locale=es`,
        { title: "Empieza aquí", _overwrite: true }
      );
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("is the separate depth-0 read, a related row the caller may not read kept as its id", async () => {
      const { together, apart } = await bothWays(
        NOTES,
        noteId,
        "status=all"
      );
      expect(together._stored).toEqual(apart);
      // The populated half is the entry's own read, as without the option.
      const alone = await read(
        ana,
        `collections/${NOTES}/entries/${noteId}?depth=2&status=all`
      );
      const { _stored: _omitted, ...populated } = together;
      expect(populated).toEqual(alone.doc);
      // The populated read draws the readable author and leaves out the
      // reviewer the caller may not read; the stored read names both.
      expect(together.author).toMatchObject({ name: "Bea" });
      expect(JSON.stringify(together.reviewer ?? null)).not.toContain("Dov");
      expect((together._stored as Doc).reviewer).toBe(hiddenId);
      // The read hook ran on each.
      expect(together.hooked).toBe(true);
      expect((together._stored as Doc).hooked).toBe(true);
    });

    it("overlays the held draft on both reads, as two requests would", async () => {
      const { together, apart } = await bothWays(
        NOTES,
        noteId,
        "status=all&draft=true"
      );
      expect(together.title).toBe("Launch, revised");
      expect((together._stored as Doc).title).toBe("Launch, revised");
      expect(together._stored).toEqual(apart);
      // Without the draft view, both read the live note.
      const live = await bothWays(NOTES, noteId, "status=all");
      expect((live.together._stored as Doc).title).toBe("Launch");
    });

    it("reads both in the language asked, fallback included", async () => {
      const { together, apart } = await bothWays(
        GUIDES,
        guideId,
        "status=all&locale=es&fallback-locale=none"
      );
      expect(together.title).toBe("Empieza aquí");
      expect(together._stored).toEqual(apart);
      expect((together._stored as Doc).code).toBe("g-1");
    });

    it("is refused whole for a caller the entry's read refuses", async () => {
      const alone = await read(
        carl,
        `collections/${NOTES}/entries/${noteId}?depth=2&status=all`
      );
      const together = await read(
        carl,
        `collections/${NOTES}/entries/${noteId}?depth=2&stored=1&status=all`
      );
      expect(alone.status).toBeGreaterThanOrEqual(400);
      expect(together.status).toBe(alone.status);
      expect(JSON.stringify(together.doc)).not.toContain("Launch");
    });

    it("fails the request when the stored read fails", async () => {
      const alone = await read(
        ana,
        `collections/${NOTES}/entries/${breaksId}?depth=2&status=all`
      );
      expect(alone.status).toBe(200);
      const together = await read(
        ana,
        `collections/${NOTES}/entries/${breaksId}?depth=2&stored=1&status=all`
      );
      expect(together.status).toBeGreaterThanOrEqual(400);
      expect(together.doc._stored).toBeUndefined();
      expect(JSON.stringify(together.doc)).not.toContain(BREAKS_STORED);
    });

    it("answers as before without the option", async () => {
      const { doc } = await read(
        ana,
        `collections/${NOTES}/entries/${noteId}?depth=2&status=all`
      );
      expect(doc._stored).toBeUndefined();
    });
  }
);
