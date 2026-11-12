/**
 * Whether a media item is in use, as a plugin asks it
 * (`ctx.services.media.isInUse`), on every dialect: an item a document's
 * upload field uses is in use, one nothing uses is not, and every item reads
 * as in use while the usage record is not built, as does an id no item has.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text, upload } from "../../../config";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { MEDIA_USAGE_RECORDED_KEY } from "../usage/media-usage-store";

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ctx = undefined;
});

const probe = definePlugin({
  name: "@test/media-in-use-probe",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(context: PluginContext) {
    ctx = context;
  },
} as never);

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    plugins: [probe],
    collections: [
      defineCollection({
        slug: "inuseposts",
        fields: [
          text({ name: "title" }),
          upload({ name: "cover", relationTo: "media" }),
        ],
      }),
    ],
  });
  const t = current;
  // A record already built, as a new site's is from the start.
  await t.getService("metaService").set(MEDIA_USAGE_RECORDED_KEY, {
    rebuiltAt: new Date().toISOString(),
  });
  const item = async (name: string) => {
    const id = randomUUID();
    const url = `/uploads/2026/11/${name}-${id.slice(0, 8)}.png`;
    await t.adapter.insert("media", {
      id,
      filename: url.slice("/uploads/".length),
      originalFilename: `${name}.png`,
      mimeType: "image/png",
      size: 1,
      url,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  };
  return { t, item };
}

function media() {
  if (!ctx) throw new Error("not booted");
  return ctx.services.media;
}

describe.each(getConfiguredTestDialects())(
  "whether a media item is in use (%s)",
  dialect => {
    it("is in use while a document's field uses it, and not once nothing does", async () => {
      const { t, item } = await boot(dialect);
      const used = await item("cover");
      const free = await item("free");
      const post = await t.nextly.create({
        collection: "inuseposts",
        data: { title: "Hello", cover: used },
      });

      expect(await media().isInUse(used)).toBe(true);
      expect(await media().isInUse(free)).toBe(false);

      // The document stops using it: nothing does.
      await t.nextly.update({
        collection: "inuseposts",
        id: String(post.item.id),
        data: { cover: null, _overwrite: true },
      });
      expect(await media().isInUse(used)).toBe(false);
    });

    it("reads every item as in use while the usage record is not built", async () => {
      const { t, item } = await boot(dialect);
      const free = await item("free");
      expect(await media().isInUse(free)).toBe(false);

      await t.getService("metaService").delete(MEDIA_USAGE_RECORDED_KEY);

      expect(await media().isInUse(free)).toBe(true);
    });

    it("reads an id no item has as in use", async () => {
      await boot(dialect);
      expect(await media().isInUse(randomUUID())).toBe(true);
    });
  }
);
