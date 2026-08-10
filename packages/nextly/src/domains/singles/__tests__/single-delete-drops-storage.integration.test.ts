/**
 * Deleting a Single removes its storage, not just its registry row.
 *
 * The two halves are ordered the opposite way from a create, and for the same reason. A create
 * writes the row LAST so a failure cannot leave a row describing storage that was never made; a
 * delete drops the storage FIRST so a failure cannot leave storage that no row describes. The row is
 * what makes the tables findable, so losing it while the tables survive is the worse of the two
 * states.
 *
 * Asserted against a real database because the ordering only matters to one: the companion holds a
 * foreign key to the main table, so dropping them in the wrong order is rejected by MySQL and
 * orphans on PostgreSQL. Neither failure is visible to a test that stops short of an engine.
 *
 * Self-skips per dialect on the standard rule: SQLite always runs, the servers run when their URL is
 * set, and each dialect gets its own throwaway database.
 */
import { afterEach, describe, expect, it } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

for (const dialect of getConfiguredTestDialects()) {
  describe(`deleteSingle removes the storage — ${dialect}`, () => {
    // Per-dialect slugs: the suites share one process, so a name reused across them turns a leaked
    // row into a duplicate-slug rejection in a later suite rather than a failure where it leaked.
    const plain = `sd_${dialect.slice(0, 2)}_plain`;
    const localized = `sd_${dialect.slice(0, 2)}_loc`;

    it("drops the table and removes the row", async () => {
      current = await createTestNextly({ dialect });
      const registry = current.getService("singleRegistryService");

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: plain,
          label: "Plain",
          fields: [{ name: "body", type: "text" }],
        }
      );
      // Proves the delete has something to remove. Without it, a delete that did nothing at all
      // would satisfy every assertion below.
      expect(await current.adapter.tableExists(`single_${plain}`)).toBe(true);

      await dispatchSingles("deleteSingle", { slug: plain }, {});

      expect(await current.adapter.tableExists(`single_${plain}`)).toBe(false);
      expect(await registry.getSingleBySlug(plain)).toBeFalsy();
    });

    it("drops the companion too, and in an order the database accepts", async () => {
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: localized,
          label: "Localized",
          localized: true,
          fields: [{ name: "headline", type: "text", localized: true }],
        }
      );
      expect(
        await current.adapter.tableExists(`single_${localized}_locales`)
      ).toBe(true);

      // The ordering assertion is that this RESOLVES. The companion holds a foreign key to the main
      // table, so dropping the main one first is refused outright on MySQL.
      await dispatchSingles("deleteSingle", { slug: localized }, {});

      expect(await current.adapter.tableExists(`single_${localized}`)).toBe(
        false
      );
      expect(
        await current.adapter.tableExists(`single_${localized}_locales`)
      ).toBe(false);
    });
  });
}
