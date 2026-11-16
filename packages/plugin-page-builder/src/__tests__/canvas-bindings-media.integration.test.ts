/**
 * The canvas's bindings into a media item, `POST /canvas-bindings`, read as
 * the person editing reads them.
 *
 * What only a server shows: the entry's upload field comes back as a media
 * id, and `media` is no collection the editor reader finds, so a binding to
 * the featured image's alt text is drawn only when the route reads the item
 * through the media library, as the person, under core's `read-media` check.
 *
 * @module __tests__/canvas-bindings-media.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text, upload } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

import { holding, person, PNG, post } from "./transfer-harness";

const POSTS = "cbm_posts";

describe.each(getConfiguredTestDialects())(
  "the canvas's bindings into a media item (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          defineCollection({
            slug: POSTS,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              upload({ name: "cover", relationTo: "media" }),
            ],
          }),
        ],
        seedPublic: true,
      });
      // The site's first person is its owner, who may read anything, so the
      // people below are judged by their roles alone.
      await person(current, "owner");
      return current;
    }

    /** A published post whose cover is an image with alt text. */
    async function postWithCover(t: TestNextly): Promise<string> {
      const image = await t.nextly.media.upload({
        file: {
          data: PNG,
          name: "harbour.png",
          mimetype: "image/png",
          size: PNG.length,
        },
        altText: "A harbour at dawn",
      });
      const row = await t.nextly.create({
        collection: POSTS,
        data: { title: "Harbour", cover: image.id, status: "published" },
        overrideAccess: true,
      });
      return String(row.item.id);
    }

    /** The entry the canvas is drawn with, for a binding to `cover.altText`. */
    async function entryFor(
      cookie: string,
      id: string
    ): Promise<Record<string, unknown>> {
      const answer = await post(cookie, ["canvas-bindings"], {
        source: { kind: "collection", slug: POSTS, id },
        demand: {
          entry: { fields: ["cover"], follows: { cover: ["altText"] } },
          singles: {},
          site: false,
          formatsDates: false,
        },
        lists: [],
      });
      expect(answer.status).toBe(200);
      const entry = answer.body.entry;
      expect(entry).toBeTypeOf("object");
      return entry as Record<string, unknown>;
    }

    it("draws a media item's alt text for a person who may read the library", async () => {
      const t = await boot();
      const id = await postWithCover(t);
      const { cookie } = await holding(t, [
        `read-${POSTS}`,
        `update-${POSTS}`,
        "read-media",
      ]);
      const entry = await entryFor(cookie, id);
      expect(entry.cover).toMatchObject({ altText: "A harbour at dawn" });
    });

    it("leaves the item unread for a person the library refuses, so the fallback shows", async () => {
      const t = await boot();
      const id = await postWithCover(t);
      const { cookie } = await holding(t, [`read-${POSTS}`, `update-${POSTS}`]);
      const entry = await entryFor(cookie, id);
      // The entry is read; the relation into media is not followed.
      expect(entry.cover).not.toMatchObject({ altText: "A harbour at dawn" });
      expect(typeof entry.cover).toBe("string");
    });
  }
);
