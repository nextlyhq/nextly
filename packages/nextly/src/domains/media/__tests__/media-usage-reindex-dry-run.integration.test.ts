/**
 * `nextly media reindex-usage --dry-run` plans the rebuild of the media usage
 * record and changes nothing, on every dialect: with one use recorded, the
 * plan names the rows the record holds now and the collection and Single the
 * rebuild reads, and the record and its marker stay as they were. The real
 * rebuild then reads those same sources. Before `nextly migrate` has made the
 * record's table, the plan is refused as the rebuild is.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text, upload } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { MEDIA_USAGE_TABLE } from "../../../schemas/media-usage/table-name";
import { MEDIA_USAGE_RECORDED_KEY } from "../usage/media-usage-store";
import {
  planMediaUsageReindex,
  reindexMediaUsage,
} from "../usage/reindex-usage";

type Doc = Record<string, unknown>;

describe.each(getConfiguredTestDialects())(
  "media reindex-usage --dry-run (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: "rxposts",
            fields: [
              text({ name: "title" }),
              upload({ name: "cover", relationTo: "media" }),
            ],
          }),
        ],
        singles: [
          defineSingle({ slug: "rxsite", fields: [text({ name: "title" })] }),
        ],
      } as never);
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    const sources = {
      collections: {
        slugs: async () => ["rxposts"],
        rebuild: (slug: string) =>
          t.getService("collectionService").rebuildMediaUsage(slug),
      },
      singles: {
        slugs: async () => ["rxsite"],
        rebuild: (slug: string) =>
          t.getService("singleEntryService").rebuildMediaUsage(slug),
      },
    };

    /** The record's rows and its marker. */
    async function state() {
      return {
        rows: await t.adapter.select<Doc>(MEDIA_USAGE_TABLE, {}),
        marker: await t.getService("metaService").get(MEDIA_USAGE_RECORDED_KEY),
      };
    }

    it("names the record's rows now and the sources it reads, and changes nothing", async () => {
      const media = randomUUID();
      await t.adapter.insert("media", {
        id: media,
        filename: "2026/11/rx.png",
        originalFilename: "rx.png",
        mimeType: "image/png",
        size: 1,
        url: "/uploads/2026/11/rx.png",
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });
      await t
        .getService("collectionsHandler")
        .createEntry(
          { collectionName: "rxposts", overrideAccess: true },
          { title: "One", cover: media }
        );
      const before = await state();
      expect(before.rows.length).toBeGreaterThan(0);

      const plan = await planMediaUsageReindex({
        adapter: t.adapter,
        ...sources,
      });
      expect(plan.rowsNow).toBe(before.rows.length);
      expect(plan.collections).toEqual(["rxposts"]);
      expect(plan.singles).toEqual(["rxsite"]);
      expect(await state()).toEqual(before);

      // The real rebuild reads what the plan named, and keeps the use.
      const result = await reindexMediaUsage({
        adapter: t.adapter,
        ...sources,
        meta: t.getService("metaService"),
      });
      expect(result.rows).toBe(plan.rowsNow);
    });

    it("is refused before the record's table exists, as the rebuild is", async () => {
      const missing = {
        ...t.adapter,
        tableExists: async (name: string) =>
          name === MEDIA_USAGE_TABLE ? false : t.adapter.tableExists(name),
        count: t.adapter.count.bind(t.adapter),
      };
      await expect(
        planMediaUsageReindex({ adapter: missing, ...sources })
      ).rejects.toThrow(/nextly migrate/);
    });
  }
);
