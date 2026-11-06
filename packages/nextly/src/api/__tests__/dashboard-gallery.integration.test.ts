/**
 * What the add gallery offers, through the real `GET /api/dashboard/gallery`, as readers with
 * different rights, on every configured dialect (dashboard-experience R-19, R-20).
 *
 * - Each widget the reader may add is offered once, with its chip, its sizes and its preview.
 * - A declared widget whose own `access` or `shows` refuses the person is not offered, though the
 *   layout read, which judges only the permission gate, still names it.
 * - Only collections the reader may read are offered, never one internal or hidden from the
 *   navigation, each counted as the reader.
 * - The suggestions follow the reader's own saves in the last 30 days, fall back to the
 *   collections with the most entries, leave out a pair already on the dashboard, and are none
 *   for a reader who may read no collection.
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
import { WidgetLayoutService } from "../../services/widgets/widget-layout-service";
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

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

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

    async function get<T>(userId: string, path: string): Promise<T> {
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
      const res = await createDynamicHandlers({
        config: sanitizeConfig({ collections: [], plugins: [gallery] }),
      }).GET(
        new Request(`http://localhost/api/${path}`, {
          headers: { cookie: `nextly_session=${token}` },
        }),
        { params: Promise.resolve({ params: path.split("/") }) }
      );
      expect(res.status).toBe(200);
      return (await res.json()) as T;
    }

    const galleryOf = (userId: string) =>
      get<GalleryRead>(userId, "dashboard/gallery");

    /** An entry of `collection`, and a save of it by `userId` on the activity trail. */
    async function savedBy(userId: string, collection: string): Promise<void> {
      const created = await handle.nextly.create({
        collection,
        data: { title: `Sample ${collection}` },
      });
      const entryId = String(created.item.id);
      await handle.getService("activityLogService").logActivity({
        actorType: "user",
        userId,
        action: "update",
        collection,
        entryId,
        entryTitle: `Sample ${collection}`,
        subjectKind: "collection",
        metadata: { changedFields: ["title"] },
      });
    }

    beforeAll(async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [gallery],
      });
      admin = await account("gl-admin@example.com");
      editor = await account("gl-editor@example.com");
      nobody = await account("gl-nobody@example.com");
      await grantTo(handle, editor, "read", [PAGES]);
      // The admin saves pages most, then posts; the editor saves nothing.
      for (let i = 0; i < 3; i += 1) await savedBy(admin, PAGES);
      await savedBy(admin, POSTS);
      // More posts than pages, for the fallback ranking by entries.
      for (let i = 0; i < 4; i += 1) {
        await handle.nextly.create({
          collection: POSTS,
          data: { title: `Post ${i}` },
        });
      }
    }, 180_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    it("offers each widget once, with its chip, its sizes and the preview it declares", async () => {
      const read = await galleryOf(admin);
      const ids = read.tiles.map(tile => tile.id);
      expect(new Set(ids).size).toBe(ids.length);
      const overTime = read.tiles.find(tile => tile.id === "core/over-time");
      expect(overTime).toMatchObject({
        name: "Over time",
        category: "trends",
        collectionSetting: "collection",
        allowsSeveral: true,
        size: { min: { w: 4 }, max: { w: 12 } },
      });
      // Its preview, as its card carries an answer.
      expect(overTime?.preview?.result).toMatchObject({ op: "data" });
      const plugins = read.tiles.find(tile => tile.id === "acme/posts-readers");
      expect(plugins).toMatchObject({ category: "plugins" });
      // A plugin's preview case never leaves the development preview read:
      // its tile is drawn as its sketch.
      expect(plugins).not.toHaveProperty("preview");
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

    it("offers only the collections the reader may read, none internal or hidden, counted as them", async () => {
      const mine = (await galleryOf(admin)).collections;
      const slugs = mine.map(collection => collection.slug);
      expect(slugs).toEqual(expect.arrayContaining([POSTS, PAGES]));
      expect(slugs).not.toContain(INTERNAL);
      expect(slugs).not.toContain(HIDDEN);
      // Suggested from their edits, so nothing is counted for them.
      expect(mine.filter(c => c.entries !== undefined)).toEqual([]);

      const theirs = (await galleryOf(editor)).collections;
      const theirSlugs = theirs.map(c => c.slug);
      expect(theirSlugs).toContain(PAGES);
      expect(theirSlugs).not.toContain(POSTS);
      expect(theirSlugs).not.toContain(INTERNAL);
      expect(theirSlugs).not.toContain(HIDDEN);
      // They edited nothing, so their suggestions rank by entries, counted as them.
      expect(theirs.find(c => c.slug === PAGES)?.entries).toBe(3);
    });

    it("suggests from the collections the reader saved most in the last 30 days", async () => {
      const read = await galleryOf(admin);
      expect(read.mostEdited).toBe(PAGES);
      expect(read.suggested.slice(0, 2)).toEqual([
        {
          widgetId: "core/recent-entries",
          collection: PAGES,
          label: expect.stringMatching(/^Recent /),
        },
        {
          widgetId: "core/over-time",
          collection: POSTS,
          label: expect.stringMatching(/ over time$/),
        },
      ]);
      expect(read.suggested.length).toBeLessThanOrEqual(4);
    });

    it("suggests from the readable collections with the most entries for a reader who saved none", async () => {
      const read = await galleryOf(editor);
      expect(read.mostEdited).toBeUndefined();
      expect(read.suggested.length).toBeGreaterThan(0);
      // Only collections they may read.
      for (const suggestion of read.suggested) {
        expect(suggestion.collection).not.toBe(POSTS);
      }
    });

    it("suggests nothing to a reader who may read no collection", async () => {
      const read = await galleryOf(nobody);
      expect(read.collections).toEqual([]);
      expect(read.mostEdited).toBeUndefined();
      expect(read.suggested).toEqual([]);
    });

    it("leaves out a pair the reader's dashboard already holds", async () => {
      await new WidgetLayoutService(handle.adapter, silent).saveLayout(
        "user",
        admin,
        [
          {
            id: "recent-pages",
            widgetId: "core/recent-entries",
            w: 6,
            h: 5,
            removed: false,
            config: { collection: PAGES },
          },
        ],
        0
      );
      const read = await galleryOf(admin);
      expect(
        read.suggested.some(
          s => s.widgetId === "core/recent-entries" && s.collection === PAGES
        )
      ).toBe(false);
      // The control: the next pair along is still suggested.
      expect(read.suggested[0]).toMatchObject({
        widgetId: "core/over-time",
        collection: POSTS,
      });
    });
  }
);
