/**
 * Proof that a Schema-Builder create REQUEST leaves a Single that actually works: the physical
 * table exists, the registry row records it as applied, and a localized create also gets its
 * companion.
 *
 * ## Why this is an integration test and why it did not exist
 *
 * Every other test of this path stops short of a database. The dispatcher's forwarding suites pin
 * the statements the adapter is handed; the generators' snapshots pin what each renders. Neither
 * runs a statement, so neither can tell a create that works from one that emits perfectly-shaped
 * DDL a real engine then rejects.
 *
 * That gap has been exploited before: a change to how a `slug` column's width was resolved made
 * MySQL refuse the `CREATE UNIQUE INDEX` that follows the table, so the table was never created at
 * all. The full unit suite read identical before and after. Only a live database disagreed.
 *
 * The registry row and the table are written by one service and the assertions check BOTH, because
 * the failure this guards against is precisely the two halves disagreeing: a row saying "applied"
 * over a table that is not there is the state a user meets as "no such table" on first read.
 *
 * ## What the second create proves
 *
 * The service claims to be recoverable and idempotent rather than atomic — the only claim
 * available, since MySQL commits DDL implicitly and no ordering makes the pair atomic there. What
 * makes that claim worth anything is that the DDL half can be re-run over a table it already
 * created. So the repair case is exercised directly: the registry row is removed while the table
 * stays, and the same create is issued again. It has to succeed and report `applied`.
 *
 * Self-skips per dialect on the standard rule: SQLite always runs, the servers run when their URL
 * is set. Each dialect gets its own throwaway database.
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

/** The registry's own view of a slug, or undefined when it holds none. */
async function registryRow(
  instance: TestNextly,
  slug: string
): Promise<{ migrationStatus?: string; tableName?: string } | undefined> {
  const registry = instance.getService("singleRegistryService");
  return (await registry.getSingleBySlug(slug)) ?? undefined;
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`createSingle applies its schema change — ${dialect}`, () => {
    /**
     * Slugs are per-dialect rather than shared: the suites run in one process, and a name reused
     * across them turns a leaked row into a duplicate-slug rejection in a later suite rather than a
     * failure where the leak happened.
     */
    const plain = `sc_${dialect.slice(0, 2)}_plain`;
    const localized = `sc_${dialect.slice(0, 2)}_loc`;

    it("creates the table and records it as applied", async () => {
      current = await createTestNextly({ dialect });

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: plain,
          label: "Plain",
          fields: [
            { name: "body", type: "text" },
            { name: "views", type: "number" },
          ],
        }
      );

      const row = await registryRow(current, plain);

      // FIRST, because it is the informative failure: the service's own recorded outcome names the
      // problem, where a bare "table missing" only says the end state is wrong.
      expect(row?.migrationStatus).toBe("applied");
      expect(await current.adapter.tableExists(`single_${plain}`)).toBe(true);
    });

    it("gives a localized single its companion table", async () => {
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
          fields: [
            { name: "headline", type: "text", localized: true },
            { name: "views", type: "number" },
          ],
        }
      );

      const table = `single_${localized}`;
      const row = await registryRow(current, localized);

      expect(row?.migrationStatus).toBe("applied");
      expect(await current.adapter.tableExists(table)).toBe(true);
      // The other half of a localized single's storage. Without it the translatable value has
      // nowhere to live, because the main table no longer carries the column either.
      expect(await current.adapter.tableExists(`${table}_locales`)).toBe(true);
    });

    it("re-applies over a table it already created", async () => {
      current = await createTestNextly({ dialect });

      const payload = {
        slug: plain,
        label: "Plain",
        fields: [{ name: "body", type: "text" }],
      };

      await dispatchSingles("createSingle", {}, payload);
      expect(await current.adapter.tableExists(`single_${plain}`)).toBe(true);

      // The interrupted state the guarantee is about: the table landed, the row describing it did
      // not survive. Recovery has to be able to finish the operation over what is already there.
      const registry = current.getService("singleRegistryService");
      // `force` because a Single is site-wide configuration the registry refuses to drop casually;
      // here the row is being removed on purpose to recreate an interrupted create.
      await registry.deleteSingle(plain, { force: true });
      expect(await registryRow(current, plain)).toBeUndefined();

      await dispatchSingles("createSingle", {}, payload);

      const row = await registryRow(current, plain);
      expect(row?.migrationStatus).toBe("applied");
      expect(await current.adapter.tableExists(`single_${plain}`)).toBe(true);
    });
  });
}
