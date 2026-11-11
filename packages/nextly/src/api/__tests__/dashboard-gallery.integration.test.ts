/**
 * What the add panel offers, through the real `GET /api/dashboard/gallery`, as readers with
 * different rights, on every configured dialect.
 *
 * - Each widget the reader may add is offered once, in one list, with its sizes and the plugin
 *   that declared it, and nothing for chips, suggestions or previews.
 * - A declared widget whose own `access` or `shows` refuses the person is not offered, though the
 *   layout read, which judges only the permission gate, still names it.
 * - Only collections the reader may read are offered, never one internal or hidden from the
 *   navigation.
 * - A reader who may read no collection is offered none, and the layout write refuses a card
 *   they add that reads one, while it keeps a card that reads none.
 */

// Must be set before the harness boots (env validation) and to sign tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { grantTo } from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { sanitizeConfig } from "../../shared/types/config";
import type { GalleryRead } from "../dashboard-gallery";

if (process.env.NEXTLY_TEST_SLOW_DB === "1") {
  vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
}

const POSTS = "gl_posts";
const PAGES = "gl_pages";
/** Internal: kept off the dashboard for everyone. */
const INTERNAL = "gl_internal";
/** Hidden from the navigation: kept off the dashboard for everyone. */
const HIDDEN = "gl_hidden";

const figure = async () => ({ total: 1 });

const gallery = definePlugin({
  name: "@test/gallery-offer",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [
      defineCollection({ slug: POSTS, fields: [text({ name: "title" })] }),
      defineCollection({ slug: PAGES, fields: [text({ name: "title" })] }),
      defineCollection({
        slug: INTERNAL,
        internal: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: HIDDEN,
        admin: { useAsTitle: "title", hidden: true },
        fields: [text({ name: "title" })],
      }),
    ],
    dashboard: {
      widgets: [
        // Offered by the permission gate to everyone; its predicate refuses everyone.
        defineWidget({
          id: "acme/refuses-everyone",
          title: "Refuses everyone",
          description: "A predicate that admits nobody",
          size: { default: { w: 4, h: 2 } },
          access: () => false,
          load: figure,
          view: "figure",
        }),
        // Only for someone who may read the posts.
        defineWidget({
          id: "acme/posts-readers",
          title: "For posts readers",
          description: "Reads the posts",
          size: { default: { w: 4, h: 2 } },
          access: { collections: [POSTS] },
          load: figure,
          view: "figure",
          // An author's fixture, which only the development preview read may send.
          preview: [{ name: "Fixture", data: { total: 73_317 } }],
        }),
        // Its own rule leaves it out for everyone.
        defineWidget({
          id: "acme/never-shown",
          title: "Never shown",
          description: "A card whose shows says no",
          size: { default: { w: 4, h: 2 } },
          shows: () => false,
          load: figure,
          view: "figure",
        }),
      ],
    },
  },
});

describe.each(getConfiguredTestDialects())(
  "what the add gallery offers (%s)",
  (dialect: TestDialect) => {
    let handle: TestNextly;
    /** The first account, which core makes super-admin. */
    let admin: string;
    /** May read the pages only. */
    let editor: string;
    /** May read nothing. */
    let nobody: string;

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

    /** A request to `path` as `userId`, through the real route handler. */
    async function send(
      userId: string,
      path: string,
      init: { method: "GET" | "PUT"; body?: unknown } = { method: "GET" }
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
      const handlers = createDynamicHandlers({
        config: sanitizeConfig({ collections: [], plugins: [gallery] }),
      });
      return handlers[init.method](
        new Request(`http://localhost/api/${path}`, {
          method: init.method,
          headers: {
            cookie: `nextly_session=${token}`,
            ...(init.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(init.body === undefined
            ? {}
            : { body: JSON.stringify(init.body) }),
        }),
        { params: Promise.resolve({ params: path.split("/") }) }
      );
    }

    async function get<T>(userId: string, path: string): Promise<T> {
      const res = await send(userId, path);
      expect(res.status).toBe(200);
      return (await res.json()) as T;
    }

    const galleryOf = (userId: string) =>
      get<GalleryRead>(userId, "dashboard/gallery");

    beforeAll(async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [gallery],
      });
      admin = await account("gl-admin@example.com");
      editor = await account("gl-editor@example.com");
      nobody = await account("gl-nobody@example.com");
      await grantTo(handle, editor, "read", [PAGES]);
    }, 180_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    it("offers each widget once, in one list, with its sizes and the plugin that declared it", async () => {
      const read = await galleryOf(admin);
      const ids = read.tiles.map(tile => tile.id);
      expect(new Set(ids).size).toBe(ids.length);
      // The collection cards first, in the panel's own order.
      expect(ids.slice(0, 4)).toEqual([
        "core/count",
        "core/recent-entries",
        "core/over-time",
        "core/breakdown",
      ]);
      const overTime = read.tiles.find(tile => tile.id === "core/over-time");
      expect(overTime).toMatchObject({
        name: "Over time",
        collectionSetting: "collection",
        allowsSeveral: true,
        size: { min: { w: 4 }, max: { w: 12 } },
      });
      // A core widget names no plugin; a plugin's names its own.
      expect(overTime).not.toHaveProperty("plugin");
      const plugins = read.tiles.find(tile => tile.id === "acme/posts-readers");
      expect(plugins).toMatchObject({ plugin: "@test/gallery-offer" });
      // Nothing for chips, suggestions or previews, and a plugin's preview case never leaves
      // the development preview read.
      for (const tile of read.tiles) {
        expect(tile).not.toHaveProperty("category");
        expect(tile).not.toHaveProperty("preview");
      }
      expect(read).not.toHaveProperty("suggested");
      expect(read).not.toHaveProperty("mostEdited");
      expect(JSON.stringify(read)).not.toContain("73317");
      // A one-card widget the default holds is offered as on the dashboard.
      expect(
        read.tiles.find(tile => tile.id === "core/team-activity")
      ).toMatchObject({ allowsSeveral: false, placed: 1 });
      // No widget named after a collection: a collection is a setting of a widget.
      expect(
        ids.filter(id => id.includes(POSTS) || id.includes(PAGES))
      ).toEqual([]);
    });

    it("offers no declared widget the person's own access or shows refuses", async () => {
      const layout = await get<{ available: string[] }>(
        admin,
        "dashboard/layout"
      );
      // The control: the layout read, which judges the permission gate alone, names both.
      expect(layout.available).toEqual(
        expect.arrayContaining(["acme/refuses-everyone", "acme/never-shown"])
      );
      const ids = (await galleryOf(admin)).tiles.map(tile => tile.id);
      expect(ids).not.toContain("acme/refuses-everyone");
      expect(ids).not.toContain("acme/never-shown");
      expect(ids).toContain("acme/posts-readers");
      // A widget that reads the posts is not offered to someone who may not read them.
      const editorIds = (await galleryOf(editor)).tiles.map(tile => tile.id);
      expect(editorIds).not.toContain("acme/posts-readers");
      expect(editorIds).toContain("core/over-time");
    });

    it("offers only the collections the reader may read, none internal or hidden", async () => {
      const mine = (await galleryOf(admin)).collections;
      const slugs = mine.map(collection => collection.slug);
      expect(slugs).toEqual(expect.arrayContaining([POSTS, PAGES]));
      expect(slugs).not.toContain(INTERNAL);
      expect(slugs).not.toContain(HIDDEN);
      expect(mine.find(c => c.slug === POSTS)).toEqual({
        slug: POSTS,
        label: expect.any(String),
        lifecycle: expect.any(Boolean),
      });

      const theirSlugs = (await galleryOf(editor)).collections.map(c => c.slug);
      expect(theirSlugs).toContain(PAGES);
      expect(theirSlugs).not.toContain(POSTS);
      expect(theirSlugs).not.toContain(INTERNAL);
      expect(theirSlugs).not.toContain(HIDDEN);
    });

    it("still lists a one-card widget whose card the reader removed, so its row can put it back", async () => {
      const read = await get<{ version: number; scope: string }>(
        editor,
        "dashboard/layout"
      );
      const saved = await send(editor, "dashboard/layout", {
        method: "PUT",
        body: {
          placements: [
            {
              id: "activity",
              widgetId: "core/team-activity",
              w: 6,
              h: 5,
              removed: true,
            },
          ],
          version: read.version,
          scope: read.scope,
        },
      });
      expect(saved.status).toBe(200);
      const layout = await get<{ available: string[] }>(
        editor,
        "dashboard/layout"
      );
      // Not offered as a new card: its one card is held, removed.
      expect(layout.available).not.toContain("core/team-activity");
      expect(
        (await galleryOf(editor)).tiles.find(
          tile => tile.id === "core/team-activity"
        )
      ).toMatchObject({ placed: 0, allowsSeveral: false });
    });

    it("refuses a card that reads a collection, added by a reader who may read none", async () => {
      expect((await galleryOf(nobody)).collections).toEqual([]);
      const read = await get<{ version: number; scope: string }>(
        nobody,
        "dashboard/layout"
      );
      const write = (widgetId: string) =>
        send(nobody, "dashboard/layout", {
          method: "PUT",
          body: {
            placements: [{ id: "added", widgetId, w: 6, h: 4, removed: false }],
            version: read.version,
            scope: read.scope,
          },
        });

      const refused = await write("core/recent-entries");
      expect(refused.status).toBe(400);
      expect(await refused.text()).toContain(
        "This card needs a collection you can read."
      );
      // The control: the same write adding a card that reads no collection is kept.
      const kept = await write("core/note");
      expect(kept.status).toBe(200);
    });
  }
);
