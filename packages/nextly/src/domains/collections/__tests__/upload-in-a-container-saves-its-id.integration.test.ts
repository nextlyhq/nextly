/**
 * An upload inside a group or a repeater is stored as its id, however the save
 * sends it.
 *
 * A read at depth gives an upload as the media object, inside a group or a
 * repeater as at the top level, and an editor saves the document back as it
 * was read. The top-level upload was reduced to its id before storage, but one
 * inside a container was not: the container is serialized to JSON whole, so the
 * media object itself was stored there. A depth-0 read gives a container as
 * stored, so it then answered that object where every other link is an id, and
 * an editor comparing the two reads took them for different versions.
 *
 * Each case saves the populated read back, as the admin does, then reads the
 * stored row itself and the document at depth 0: every upload, nested or not,
 * is its id in both. The populated read is checked to hold media objects
 * first, so the save reaches the reduction. A collection entry and a Single are both covered, since each has
 * its own write. Run on every configured dialect.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineSingle,
  group,
  repeater,
  text,
  upload,
} from "../../../config";
import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Doc = Record<string, unknown>;

const MEDIA = ["media-one", "media-two"] as const;

/** Every place an upload can sit: the top level, a group and a repeater. */
const fields = () => [
  text({ name: "title" }),
  upload({ name: "cover", relationTo: "media" }),
  group({
    name: "about",
    fields: [
      text({ name: "blurb" }),
      upload({ name: "image", relationTo: "media" }),
    ],
  }),
  repeater({
    name: "slides",
    fields: [upload({ name: "gallery", relationTo: "media", hasMany: true })],
  }),
];

/** The document as stored: every upload a bare media id. */
const stored: Doc = {
  title: "Hello",
  cover: MEDIA[0],
  about: { blurb: "About", image: MEDIA[0] },
  slides: [{ gallery: [MEDIA[1], MEDIA[0]] }],
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [defineCollection({ slug: "posts", fields: fields() })],
    singles: [defineSingle({ slug: "site", fields: fields() })],
  });
  const tables = getDialectTables();
  const db = current.adapter.getDrizzle() as unknown as {
    insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> };
  };
  for (const id of MEDIA) {
    await db.insert(tables.media).values({
      id,
      filename: `${id}.png`,
      originalFilename: `${id}.png`,
      mimeType: "image/png",
      size: 1,
      url: `/uploads/${id}.png`,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return current;
}

/** The uploads a read gives, by where they sit. */
function uploadsOf(doc: Doc): Doc {
  const about = doc.about as Doc;
  const slides = doc.slides as Doc[];
  return {
    cover: doc.cover,
    image: about.image,
    gallery: slides[0]?.gallery,
  };
}

/** A JSON column as the dialect hands it back: text, or already parsed. */
function parsed(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

/** The uploads the table's one row stores, read past every read path. */
async function storedUploads(t: TestNextly, table: string): Promise<Doc> {
  const row = await t.adapter.selectOne<Doc>(table, {});
  expect(row).toBeTruthy();
  const stored = row as Doc;
  return uploadsOf({
    cover: stored.cover,
    about: parsed(stored.about),
    slides: parsed(stored.slides),
  });
}

/** A media object as a populated read gives one. */
const mediaObject = (id: string) =>
  expect.objectContaining({ id, url: `/uploads/${id}.png` });

/** What a populated read must give before its save back can prove anything. */
const populated = {
  cover: mediaObject(MEDIA[0]),
  image: mediaObject(MEDIA[0]),
  gallery: [mediaObject(MEDIA[1]), mediaObject(MEDIA[0])],
};

/** What a depth-0 read gives once the save has stored ids. */
const asIds = {
  cover: MEDIA[0],
  image: MEDIA[0],
  gallery: [MEDIA[1], MEDIA[0]],
};

describe.each(getConfiguredTestDialects())(
  "an upload inside a group or a repeater is stored as its id (%s)",
  (dialect: TestDialect) => {
    it("in a collection entry saved back as the populated read gave it", async () => {
      const t = await boot(dialect);
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      const created = await handler.createEntry(
        { collectionName: "posts", overrideAccess: true },
        stored
      );
      expect(created.success).toBe(true);
      const entryId = String((created.data as Doc).id);
      const read = async (depth: number) => {
        const result = await handler.getEntry({
          collectionName: "posts",
          entryId,
          depth,
          overrideAccess: true,
        });
        expect(result.success).toBe(true);
        return result.data as Doc;
      };

      const before = await read(2);
      expect(uploadsOf(before)).toEqual(populated);
      const saved = await handler.updateEntry(
        { collectionName: "posts", entryId, overrideAccess: true },
        { ...before, _overwrite: true }
      );
      expect(saved.success).toBe(true);

      expect(await storedUploads(t, "dc_posts")).toEqual(asIds);
      expect(uploadsOf(await read(0))).toEqual(asIds);
      // The populated read still finds each media item by the stored id.
      expect(uploadsOf(await read(2))).toEqual(populated);
    });

    it("in a Single saved back as the populated read gave it", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService");
      const read = async (depth: number) => {
        const result = await singles.get("site", {
          depth,
          overrideAccess: true,
        });
        expect(result.success).toBe(true);
        return result.data as Doc;
      };
      const write = async (data: Doc) => {
        const result = await singles.update(
          "site",
          { ...data, _overwrite: true },
          { overrideAccess: true }
        );
        expect(result.success).toBe(true);
      };

      await write(stored);
      const before = await read(2);
      expect(uploadsOf(before)).toEqual(populated);
      await write(before);

      expect(await storedUploads(t, "single_site")).toEqual(asIds);
      expect(uploadsOf(await read(0))).toEqual(asIds);
      expect(uploadsOf(await read(2))).toEqual(populated);
    });
  }
);
