/**
 * Reading the default document of a Single that has none stored, without
 * storing it (`createIfMissing: false, whenAbsent: "default"`).
 *
 * A caller that counts what a Single holds must see what its first read will
 * show, and must not create it to find out. Three properties separate a
 * correct implementation from a plausible broken one: the table stays empty
 * (counted, not inferred from the answer), the answer equals the document a
 * creating read then stores, and the read is judged by the Single's access
 * rules as any read is.
 *
 * @module domains/singles/__tests__/find-single-unstored-default.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, json, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "site_notes";
/** The Single's table, as `resolveSingleTableName` names every Single's. */
const TABLE = `single_${SLUG}`;

async function boot(
  dialect: TestDialect,
  access?: { read: () => boolean }
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        ...(access === undefined ? {} : { access }),
        fields: [
          text({ name: "notice", defaultValue: "Closed on Monday" }),
          number({ name: "shelves", defaultValue: 3 }),
          json({
            name: "layout",
            defaultValue: { nodes: [{ id: "n1", type: "card" }] },
          }),
        ],
      }),
    ],
  });
  return current;
}

/** How many documents the Single's table holds. */
async function storedDocuments(t: TestNextly): Promise<number> {
  return (await t.adapter.select<{ id: string }>(TABLE, {})).length;
}

/**
 * A read's content: what the Single holds, without what differs between two
 * creations of one default (its id and timestamps) or describes the stored
 * row rather than the content (the version stamp).
 */
function contentOf(doc: unknown): Record<string, unknown> {
  const record = { ...(doc as Record<string, unknown>) };
  for (const key of Object.keys(record)) {
    if (
      key === "id" ||
      key === "createdAt" ||
      key === "updatedAt" ||
      key.startsWith("_")
    ) {
      delete record[key];
    }
  }
  return record;
}

describe.each(getConfiguredTestDialects())(
  "reading a Single's default without storing it (%s)",
  dialect => {
    it("answers the default document and stores nothing", async () => {
      const t = await boot(dialect);

      const read = () =>
        t.nextly.findSingle({
          slug: SLUG,
          createIfMissing: false,
          whenAbsent: "default",
        });
      const first = await read();

      expect(first).toMatchObject({
        notice: "Closed on Monday",
        shelves: 3,
        layout: { nodes: [{ id: "n1", type: "card" }] },
      });
      expect(await storedDocuments(t)).toBe(0);
      // Read again: a first read that stored the row would show here.
      expect(contentOf(await read())).toEqual(contentOf(first));
      expect(await storedDocuments(t)).toBe(0);
      // CONTROL: without the option the same read answers no document.
      expect(
        await t.nextly.findSingle({ slug: SLUG, createIfMissing: false })
      ).toBeNull();
    });

    it("answers what a creating read then stores", async () => {
      const t = await boot(dialect);

      const unstored = await t.nextly.findSingle({
        slug: SLUG,
        createIfMissing: false,
        whenAbsent: "default",
      });
      const created = await t.nextly.findSingle({ slug: SLUG });

      expect(await storedDocuments(t)).toBe(1);
      expect(contentOf(unstored)).toEqual(contentOf(created));
      // Once stored, the option answers the stored document.
      const stored = await t.nextly.findSingle({
        slug: SLUG,
        createIfMissing: false,
        whenAbsent: "default",
      });
      expect(stored).toMatchObject({ id: (created as { id: string }).id });
    });

    it("is judged by the Single's read rule, as any read is", async () => {
      const t = await boot(dialect, { read: () => false });

      await expect(
        t.nextly.findSingle({
          slug: SLUG,
          createIfMissing: false,
          whenAbsent: "default",
          overrideAccess: false,
        })
      ).rejects.toThrow();
      expect(await storedDocuments(t)).toBe(0);
      // CONTROL: the trusted read of the same Single answers its default.
      expect(
        await t.nextly.findSingle({
          slug: SLUG,
          createIfMissing: false,
          whenAbsent: "default",
        })
      ).toMatchObject({ notice: "Closed on Monday" });
    });

    it("is refused without createIfMissing: false", async () => {
      const t = await boot(dialect);

      await expect(
        t.nextly.findSingle({ slug: SLUG, whenAbsent: "default" })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await storedDocuments(t)).toBe(0);
    });
  }
);
