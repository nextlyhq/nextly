/**
 * A published page's list reads what anyone may see, the same on every
 * database: published entries, public fields, a stable order and window.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createPublicReader, type PublicReader } from "../public-reader";

const SLUG = "prd_posts";

describe.each(getConfiguredTestDialects())(
  "the public reader (%s)",
  dialect => {
    let t: TestNextly;
    let reader: PublicReader;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        collections: [
          defineCollection({
            slug: SLUG,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              number({ name: "rank" }),
              text({ name: "secret", access: { read: () => false } }),
            ],
          }),
        ],
      });
      for (let i = 0; i < 8; i++) {
        await t.nextly.create({
          collection: SLUG,
          data: {
            title: `t${String(i)}`,
            rank: i % 3,
            secret: `s${String(i)}`,
            status: "published",
          },
        });
      }
      await t.nextly.create({
        collection: SLUG,
        data: { title: "draft", rank: 0, secret: "d", status: "draft" },
      });
      reader = createPublicReader(t.nextly);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("reads published entries only, without the fields the public may not read", async () => {
      const { items, meta } = await reader.find({
        collection: SLUG,
        limit: 50,
      });
      expect(meta.total).toBe(8);
      expect(items.map(item => item.title)).not.toContain("draft");
      for (const item of items) expect(item).not.toHaveProperty("secret");
    });

    it("refuses a filter or a sort on a field the public may not read", async () => {
      const refused = (query: Parameters<PublicReader["find"]>[0]) =>
        reader.find(query).then(
          () => "",
          (error: unknown) => JSON.stringify(error)
        );
      expect(
        await refused({
          collection: SLUG,
          filters: [{ field: "secret", op: "equals", value: "s1" }],
        })
      ).toContain("secret");
      expect(
        await refused({ collection: SLUG, sort: ["rank", "-secret"] })
      ).toContain("sort.secret");
    });

    it("refuses an unknown sort key rather than dropping it", async () => {
      const refusal = await reader
        .find({ collection: SLUG, sort: ["nope"] })
        .then(
          () => undefined,
          (error: unknown) => JSON.stringify(error)
        );
      expect(refusal).toContain("sort.nope");
    });

    it("filters, sorts with ties in id order, and pages by offset and page", async () => {
      const all = await reader.find({
        collection: SLUG,
        filters: [{ field: "rank", op: "gte", value: 1 }],
        sort: ["-rank"],
        limit: 50,
      });
      expect(all.items.every(item => Number(item.rank) >= 1)).toBe(true);
      const second = await reader.find({
        collection: SLUG,
        filters: [{ field: "rank", op: "gte", value: 1 }],
        sort: ["-rank"],
        limit: 2,
        page: 2,
      });
      expect(second.items.map(item => item.id)).toEqual(
        all.items.slice(2, 4).map(item => item.id)
      );
      expect(second.meta.total).toBe(all.meta.total);
      await expect(
        reader.count({
          collection: SLUG,
          filters: [{ field: "rank", op: "gte", value: 1 }],
        })
      ).resolves.toBe(all.meta.total);
    });
  }
);
