/**
 * Saved count and health cards becoming Count cards, through the real layout
 * endpoint on every configured dialect: what each reader is handed, and what
 * their save stores.
 *
 * What only the endpoint and a database can settle: the conversion follows
 * the reader's real access, a collection they may not read is never named to
 * them, and a save keeps that collection's card in the row for the day they may
 * read it.
 *
 * @module domains/widgets/__tests__/count-conversion.integration.test
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { WidgetLayoutService } from "../../../services/widgets/widget-layout-service";
import { MAX_PLACEMENTS, type WidgetPlacement } from "../layout";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Readable by everyone through its code-defined rule. */
const POSTS = "cv_blog_posts";
/** No rule: only the super admin may read it. */
const SECRET = "cv_secret";

interface LayoutRead {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
}

const card = (
  id: string,
  widgetId: string,
  patch: Partial<WidgetPlacement> = {}
): WidgetPlacement => ({
  id,
  widgetId,
  width: "quarter",
  removed: false,
  ...patch,
});

/** A row holding a readable collection's two cards, a hidden one's and a deleted one's. */
const SAVED = [
  card("count", "collection/cv-blog-posts-count", { width: "half" }),
  card("team", "core/team", { width: "third" }),
  card("health", "collection/cv-blog-posts-stats", { width: "full" }),
  card("secret", "collection/cv-secret-count"),
  card("gone", "collection/cv-gone-count"),
];

describe.each(getConfiguredTestDialects())(
  "saved count cards becoming Count cards (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    let admin: string;
    let editor: string;

    async function account(email: string): Promise<string> {
      const nextly = handle.nextly as unknown as {
        users: {
          create: (a: { data: Record<string, unknown> }) => Promise<{
            item: { id: string };
          }>;
        };
      };
      const created = await nextly.users.create({
        data: { email, password: "Password123!", name: email, isActive: true },
      });
      return created.item.id;
    }

    async function call(
      userId: string,
      method: "GET" | "PUT",
      body?: unknown
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
        process.env.NEXTLY_SECRET!
      );
      const request = new Request("http://localhost/api/dashboard/layout", {
        method,
        headers: {
          cookie: `nextly_session=${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const context = {
        params: Promise.resolve({ params: ["dashboard", "layout"] }),
      };
      const handlers = createDynamicHandlers();
      return method === "GET"
        ? handlers.GET(request, context)
        : handlers.PUT(request, context);
    }

    async function read(userId: string): Promise<LayoutRead> {
      const res = await call(userId, "GET");
      expect(res.status).toBe(200);
      return (await res.json()) as LayoutRead;
    }

    function service(): WidgetLayoutService {
      return new WidgetLayoutService(handle.adapter, silent);
    }

    beforeAll(async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: POSTS,
            access: { read: () => true },
            // A lifecycle, so core generates the posts' breakdown card, and a
            // saved one converts.
            status: true,
            fields: [text({ name: "title" })],
          }),
          defineCollection({ slug: SECRET, fields: [text({ name: "title" })] }),
        ],
      });
      // The first account of an instance is its super admin.
      admin = await account("cv-admin@example.com");
      editor = await account("cv-editor@example.com");
      // A code rule only narrows the permission, so the editor holds read on
      // the posts their rule admits everyone to.
      await grantTo(handle, editor, "read", [POSTS]);
    }, 120_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    it("hands a reader one Count card per readable collection, names no other, and keeps the rest in the row", async () => {
      await service().saveLayout("user", editor, SAVED, 0);

      const seen = await read(editor);
      const mine = seen.placements.filter(
        placement => placement.widgetId !== "core/team"
      );
      // The count and health cards are one Count card set to the real slug,
      // at the first one's place and the widest width Count allows. The
      // deleted collection's card is core's no longer -- nothing generates
      // its id -- so it is not converted, and not shown.
      expect(mine).toEqual([
        card("count", "core/count", {
          width: "half",
          config: { collection: POSTS },
        }),
      ]);
      // 🔴 The collection this reader may not read is named nowhere: not as a
      // card, not as a setting.
      expect(JSON.stringify(seen)).not.toMatch(/cv[-_]secret/);

      const res = await call(editor, "PUT", {
        placements: seen.placements,
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      // The save stores what the reader holds, converted, and carries the
      // cards they were never shown back in, in their places and as they were.
      const stored = await service().getLayout("user", editor);
      expect(
        stored.layout?.placements.filter(
          placement => placement.widgetId !== "core/team"
        )
      ).toEqual([
        card("count", "core/count", {
          width: "half",
          config: { collection: POSTS },
        }),
        card("secret", "collection/cv-secret-count"),
        card("gone", "collection/cv-gone-count"),
      ]);
    });

    it("withholds a Count card set to a collection the reader may not read, and keeps it in the row", async () => {
      const own = [
        card("mine", "core/count", { config: { collection: POSTS } }),
        card("theirs", "core/count", { config: { collection: SECRET } }),
        card("old", "core/count", { config: { collection: "cv_deleted" } }),
      ];
      const reader = await account("cv-reader@example.com");
      // The permission comes before the posts' code rule, which only narrows it.
      await grantTo(handle, reader, "read", [POSTS]);
      await service().saveLayout("user", reader, own, 0);

      const seen = await read(reader);
      // 🔴 Handed over, the card's settings would name the collection. And
      // the one set to a collection that does not exist is withheld the same
      // way: drawn instead, it would tell the reader which names exist.
      expect(seen.placements.map(placement => placement.id)).toEqual(["mine"]);
      expect(JSON.stringify(seen)).not.toMatch(/cv[-_]secret/);

      const res = await call(reader, "PUT", {
        placements: seen.placements,
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      const stored = await service().getLayout("user", reader);
      expect(stored.layout?.placements).toEqual(own);
    });

    it("withholds a Recent entries, Over time or Breakdown card set to a collection the reader may not read, as it does a Count card", async () => {
      // Every widget offered per collection reads the collection its
      // Collection setting names, so the same rule withholds each, not Count's
      // cards alone.
      const own = [
        card("recent", "core/recent-entries", {
          config: { collection: POSTS },
        }),
        card("recent-theirs", "core/recent-entries", {
          config: { collection: SECRET },
        }),
        card("over-theirs", "core/over-time", {
          config: { collection: SECRET },
        }),
        card("breakdown-theirs", "core/breakdown", {
          config: { collection: SECRET },
        }),
      ];
      const reader = await account("cv-lister@example.com");
      // The permission comes before the posts' code rule, which only narrows it.
      await grantTo(handle, reader, "read", [POSTS]);
      await service().saveLayout("user", reader, own, 0);

      const seen = await read(reader);
      expect(seen.placements.map(placement => placement.id)).toEqual([
        "recent",
      ]);
      expect(JSON.stringify(seen)).not.toMatch(/cv[-_]secret/);

      // Their save carries every withheld card back in place.
      const res = await call(reader, "PUT", {
        placements: seen.placements,
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      const stored = await service().getLayout("user", reader);
      expect(stored.layout?.placements).toEqual(own);
    });

    it("refuses a card set to a collection the reader may not read, whether it exists or not, with one answer", async () => {
      const reader = await account("cv-guesser@example.com");
      const seen = await read(reader);
      const attempt = async (collection: string) => {
        const res = await call(reader, "PUT", {
          placements: [
            ...seen.placements,
            card("guess", "core/count", { config: { collection } }),
          ],
          version: seen.version,
          scope: seen.scope,
        });
        const body = (await res.json()) as {
          error?: { code?: string; message?: string; data?: unknown };
        };
        return {
          status: res.status,
          code: body.error?.code,
          message: body.error?.message,
          data: body.error?.data,
        };
      };
      const existing = await attempt(SECRET);
      const missing = await attempt("cv_nowhere");
      // 🔴 Refused, and refused identically: a write that answered the two
      // differently would tell the reader which names exist.
      expect(existing.status).toBe(400);
      expect(missing).toEqual(existing);
      expect(JSON.stringify(existing)).not.toMatch(/cv[-_]secret/);
      // Nothing was stored for either.
      const stored = await service().getLayout("user", reader);
      expect(
        (stored.layout?.placements ?? []).some(
          placement => placement.id === "guess"
        )
      ).toBe(false);
    });

    it("turns saved list, table, timeline and breakdown cards into exactly the cards a reader adds today", async () => {
      // 🔴 The converted card is the added card: drawn from the same settings
      // by the same path. One that kept anything of the old card's beyond its
      // collection would draw differently, and would be a second card to
      // maintain.
      const converter = await account("cv-converter@example.com");
      await grantTo(handle, converter, "read", [POSTS]);
      await service().saveLayout(
        "user",
        converter,
        [
          card("list", "collection/cv-blog-posts-recent", { width: "half" }),
          card("table", "collection/cv-blog-posts-table", { width: "full" }),
          card("chart", "collection/cv-blog-posts-timeline", {
            width: "full",
          }),
          card("split", "collection/cv-blog-posts-breakdown", {
            width: "half",
          }),
        ],
        0
      );
      const converted = (await read(converter)).placements;
      // A list and a table of one collection are one Recent entries card.
      expect(converted.map(placement => placement.widgetId)).toEqual([
        "core/recent-entries",
        "core/over-time",
        "core/breakdown",
      ]);

      // Another reader holds the same cards as added today, at the same
      // places and widths: set to the collection, a breakdown by status. The first
      // is in their row already; the other two they add through a save.
      const added = converted.map(placement => ({
        ...placement,
        config:
          placement.widgetId === "core/breakdown"
            ? { collection: POSTS, groupBy: "status" }
            : { collection: POSTS },
      }));
      const adder = await account("cv-adder@example.com");
      await grantTo(handle, adder, "read", [POSTS]);
      await service().saveLayout("user", adder, added.slice(0, 1), 0);
      const before = await read(adder);
      expect(before.placements).toEqual(added.slice(0, 1));
      const res = await call(adder, "PUT", {
        placements: [...before.placements, ...added.slice(1)],
        version: before.version,
        scope: before.scope,
      });
      expect(res.status).toBe(200);
      expect((await read(adder)).placements).toEqual(converted);
    });

    it("lets a reader add a card whatever number of unconverted cards their row carries out of view", async () => {
      // 🔴 Kept and hidden, an unconverted card must never cost the reader an
      // add: the payload limit counts what they submit, and the row's own
      // ceiling drops carried cards rather than refusing, so neither answer
      // depends on cards they cannot see.
      const reader = await account("cv-hoarder@example.com");
      await grantTo(handle, reader, "read", [POSTS]);
      const hidden = Array.from({ length: MAX_PLACEMENTS }, (_, i) =>
        card(`gone${i}`, `collection/cv-gone-${i}-count`)
      );
      await service().saveLayout("user", reader, hidden, 0);
      const seen = await read(reader);
      expect(seen.placements).toEqual([]);

      const added = card("posts", "core/count", {
        config: { collection: POSTS },
      });
      const res = await call(reader, "PUT", {
        placements: [added],
        version: seen.version,
        scope: seen.scope,
      });
      expect(res.status).toBe(200);
      const stored = await service().getLayout("user", reader);
      expect(stored.layout?.placements).toEqual([...hidden, added]);
    });

    it("converts the same card for a reader who may read its collection", async () => {
      await service().saveLayout("user", admin, SAVED, 0);

      const seen = await read(admin);
      expect(
        seen.placements.filter(placement => placement.id === "secret")
      ).toEqual([
        card("secret", "core/count", { config: { collection: SECRET } }),
      ]);
    });
  }
);
