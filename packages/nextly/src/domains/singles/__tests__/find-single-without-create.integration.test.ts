/**
 * Reading a Single without creating its document.
 *
 * Every read of a Single that has no stored document creates its default
 * document first. `createIfMissing: false` is the read that must not: a page
 * render, say, reading settings that may never have been saved. The property
 * that separates a correct implementation from a plausible broken one is the
 * DATABASE afterwards, not the value returned: a read that created the row and
 * then answered `null` would pass a check on the answer alone, so the Single's
 * table is counted after the read, and read again.
 *
 * @module domains/singles/__tests__/find-single-without-create.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
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

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        fields: [text({ name: "notice" })],
      }),
    ],
  });
  return current;
}

/** How many documents the Single's table holds. */
async function storedDocuments(t: TestNextly): Promise<number> {
  return (await t.adapter.select<{ id: string }>(TABLE, {})).length;
}

describe.each(getConfiguredTestDialects())(
  "reading a Single without creating it (%s)",
  dialect => {
    it("answers null for a Single with no document, and leaves it absent", async () => {
      const t = await boot(dialect);
      expect(await storedDocuments(t)).toBe(0);

      const first = await t.nextly.findSingle({
        slug: SLUG,
        createIfMissing: false,
      });

      expect(first).toBeNull();
      expect(await storedDocuments(t)).toBe(0);
      // Read again: a first read that created the row and answered null anyway
      // would show here.
      expect(
        await t.nextly.findSingle({ slug: SLUG, createIfMissing: false })
      ).toBeNull();
      expect(await storedDocuments(t)).toBe(0);
    });

    it("still creates the default document when the option is left out", async () => {
      const t = await boot(dialect);

      const created = await t.nextly.findSingle({ slug: SLUG });

      expect(created).toMatchObject({ id: expect.any(String) });
      expect(await storedDocuments(t)).toBe(1);
    });

    it("answers a stored document the same with or without the option", async () => {
      const t = await boot(dialect);
      await t.nextly.updateSingle({
        slug: SLUG,
        data: { notice: "Closed on Monday", _overwrite: true },
      });

      const withOption = await t.nextly.findSingle({
        slug: SLUG,
        createIfMissing: false,
      });
      const without = await t.nextly.findSingle({ slug: SLUG });

      expect(withOption).toMatchObject({ notice: "Closed on Monday" });
      expect(withOption).toEqual(without);
      expect(await storedDocuments(t)).toBe(1);
    });
  }
);
