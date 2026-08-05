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

    /**
     * 🔴 The generator VALIDATES as well as renders, so a rejected create must leave nothing.
     *
     * A required relationship declaring `onDelete: "set null"` is refused: no database can null a
     * reference the column forbids. That refusal comes from `generateMigrationSQL`, which means it
     * happens on the same path that writes the table — so if the registry row were persisted
     * first, this request would strand a `pending` Single with its permissions seeded, and the
     * corrected retry would collide with the slug it had just created instead of succeeding.
     */
    it("leaves no row behind when the generator rejects the fields", async () => {
      current = await createTestNextly({ dialect });

      const rejected = {
        slug: `${plain}_bad`,
        label: "Bad",
        fields: [
          // `target` is the key the generator's relationship branch reads; the referenced
          // collection need not exist, because the refusal happens while the DDL is still being
          // rendered and no statement is ever run.
          {
            name: "author",
            type: "relationship",
            required: true,
            options: { target: "authors", onDelete: "set null" },
          },
        ],
      };

      await expect(
        dispatchSingles("createSingle", {}, rejected)
      ).rejects.toThrow();

      // Nothing persisted, so the corrected retry is a fresh create rather than a slug collision.
      expect(await registryRow(current, rejected.slug)).toBeUndefined();
      expect(await current.adapter.tableExists(`single_${rejected.slug}`)).toBe(
        false
      );
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

    /**
     * The same repair for a LOCALIZED single, where there are two tables to find already present.
     *
     * The companion reconcile is told `wasLocalized: false` and `oldFields: []`, because from the
     * registry's point of view this really is a brand-new localized single — the row describing the
     * previous attempt is gone. Meeting a companion that already exists, it must not try to add
     * columns that are already there.
     */
    it("re-applies over a localized single's tables", async () => {
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });

      const payload = {
        slug: localized,
        label: "Localized",
        localized: true,
        fields: [
          { name: "headline", type: "text", localized: true },
          { name: "views", type: "number" },
        ],
      };

      await dispatchSingles("createSingle", {}, payload);
      const table = `single_${localized}`;
      expect(await current.adapter.tableExists(`${table}_locales`)).toBe(true);

      const registry = current.getService("singleRegistryService");
      await registry.deleteSingle(localized, { force: true });

      await dispatchSingles("createSingle", {}, payload);

      const row = await registryRow(current, localized);
      expect(row?.migrationStatus).toBe("applied");
      expect(await current.adapter.tableExists(`${table}_locales`)).toBe(true);
    });

    /**
     * 🔴 The dangerous half of tolerating a re-run: the table is there, but it is the WRONG table.
     *
     * `CREATE TABLE IF NOT EXISTS` no-ops against an existing table on every dialect, and the
     * index statements that follow are tolerated as already-applied, so a repair over an orphan
     * left by an earlier create emits no error even when the field set has changed. Existence
     * alone would record a schema the database does not have, and every later read would address
     * columns that are not there. So "applied" has to mean the columns are present, not merely
     * that something of that name is.
     */
    it("refuses to call it applied when an existing table lacks the new columns", async () => {
      current = await createTestNextly({ dialect });

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: plain,
          label: "Plain",
          fields: [{ name: "body", type: "text" }],
        }
      );

      // The orphan state: the table survives, the row describing it does not.
      const registry = current.getService("singleRegistryService");
      await registry.deleteSingle(plain, { force: true });

      // The same slug, now asking for a column the surviving table does not have.
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: plain,
          label: "Plain",
          fields: [
            { name: "body", type: "text" },
            { name: "subtitle", type: "text" },
          ],
        }
      );

      const row = await registryRow(current, plain);
      expect(row?.migrationStatus).toBe("failed");
    });
  });
}
