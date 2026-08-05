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
     * 🔴 Enabling localization in the same request that sends fields must COMPLETE.
     *
     * A required field moving to the companion is still a NOT NULL column on the main table until
     * the companion transition seeds and drops it. Any post-DDL check that runs before that step
     * sees a column the schema no longer declares, and marking the migration failed there skips
     * the transition while `localized: true` is already persisted — leaving reads pointed at an
     * unseeded companion with the content still on main. That is worse than not checking at all.
     */
    it("completes a localization enable sent with fields", async () => {
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });

      const slug = `${plain}_enable`;
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug,
          label: "Enable",
          fields: [{ name: "headline", type: "text", required: true }],
        }
      );

      await dispatchSingles(
        "updateSingleSchema",
        { slug },
        {
          localized: true,
          fields: [
            { name: "headline", type: "text", required: true, localized: true },
          ],
        }
      );

      expect((await registryRow(current, slug))?.migrationStatus).toBe(
        "applied"
      );
      expect(await current.adapter.tableExists(`single_${slug}_locales`)).toBe(
        true
      );
    });

    /**
     * A required UPLOAD field must not fail an otherwise-successful create.
     *
     * 🔴 The descriptor reports every `fkSingle` column as nullable on purpose — requiredness is
     * enforced in application code — while the direct create DDL emits NOT NULL for a required
     * one. A nullability comparison therefore fails a table that was created correctly.
     */
    it("keeps a create with a required upload applied", async () => {
      current = await createTestNextly({ dialect });

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: `${plain}_up`,
          label: "Up",
          fields: [{ name: "hero", type: "upload", required: true }],
        }
      );

      expect((await registryRow(current, `${plain}_up`))?.migrationStatus).toBe(
        "applied"
      );
    });

    /**
     * A normal schema UPDATE on a Single must stay `applied`.
     *
     * 🔴 The ALTER path builds its verification shape from a normalized field list that carries a
     * synthetic `title` so the generator can see the existing system column. If that list reaches
     * the descriptor unchanged, `title` is described as a Builder text field rather than the system
     * one — and on MySQL the system column is `varchar(255)` while a Builder text field is not, so
     * an ordinary successful field update would be recorded as failed.
     */
    it("keeps a schema update applied after adding a field", async () => {
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
      expect((await registryRow(current, plain))?.migrationStatus).toBe(
        "applied"
      );

      await dispatchSingles(
        "updateSingleSchema",
        { slug: plain },
        {
          fields: [
            { name: "body", type: "text" },
            { name: "subtitle", type: "text" },
          ],
        }
      );

      expect((await registryRow(current, plain))?.migrationStatus).toBe(
        "applied"
      );
    });

    /**
     * 🔴 A LOCALIZED single's repair is REFUSED, deliberately, and this pins that decision.
     *
     * The companion reconcile is told `wasLocalized: false` and `oldFields: []`, because from the
     * registry's point of view this is a brand-new localized single — the row describing the
     * previous attempt is gone. Meeting a companion that already exists, its plan asks to ADD
     * columns that are already there, and the companion path does NOT tolerate that.
     *
     * It could: the same tolerance the main table has would make this repair succeed. It is
     * withheld because a half-finished localization ENABLE reaches this code in the identical
     * state — the planner cannot tell them apart, since `existingMainColumns` is consumed only on
     * the disable path — and tolerating it there would report success while default-locale content
     * is still stranded on the main table.
     *
     * So a localized repair fails loudly and an operator sees it, rather than a half-migrated
     * entity being recorded as applied. Reverse this only together with a way to detect a partial
     * enable.
     */
    it("refuses to repair a localized single's tables, loudly", async () => {
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
      expect(row?.migrationStatus).toBe("failed");
      // The tables are untouched by the refusal — nothing is destroyed, the operator is told.
      expect(await current.adapter.tableExists(`${table}_locales`)).toBe(true);
    });
  });
}
