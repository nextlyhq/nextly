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
     * 🔴 The other half of adoption: a create still in flight must NOT be taken over.
     *
     * `pending` is indistinguishable from "running right now". Adopting one would overwrite its
     * row with a second payload while its DDL is still building the first schema, after which the
     * original confirms `applied` against a description that is no longer its own. Refusing keeps
     * the two requests from interleaving; serialising them properly is the migration lock's job.
     */
    it("refuses to take over a create that has not recorded an outcome", async () => {
      current = await createTestNextly({ dialect });

      const payload = {
        slug: plain,
        label: "Plain",
        fields: [{ name: "body", type: "text" }],
      };
      await dispatchSingles("createSingle", {}, payload);

      const registry = current.getService("singleRegistryService");
      await registry.updateMigrationStatus(plain, "pending");

      await expect(
        dispatchSingles("createSingle", {}, payload)
      ).rejects.toThrow();
    });

    /**
     * 🔴 A removed REQUIRED field leaves a NOT NULL column the schema no longer declares.
     *
     * The re-run no-ops rather than dropping anything, so writes that omit the removed field now
     * fail its constraint — the Builder considers them valid and the database does not. Only a
     * desired-side walk would miss this, because the column is not in the desired set at all.
     */
    it("refuses when a removed required column is still enforced", async () => {
      current = await createTestNextly({ dialect });

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: plain,
          label: "Plain",
          fields: [
            { name: "body", type: "text" },
            { name: "subtitle", type: "text", required: true },
          ],
        }
      );

      const registry = current.getService("singleRegistryService");
      await registry.deleteSingle(plain, { force: true });

      // `subtitle` is gone from the schema, but its NOT NULL column survives on the table.
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
        "failed"
      );
    });

    /**
     * 🔴 Nullability is part of the shape, not a detail of it.
     *
     * A column the Builder now calls optional while the database still has it NOT NULL accepts
     * every write the Builder considers valid and then fails the constraint — a failure that
     * surfaces at write time, far from the migration that caused it.
     */
    it("refuses when an existing column has the wrong nullability", async () => {
      current = await createTestNextly({ dialect });

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: plain,
          label: "Plain",
          fields: [{ name: "body", type: "text", required: true }],
        }
      );

      const registry = current.getService("singleRegistryService");
      await registry.deleteSingle(plain, { force: true });

      // Same name, same type, now optional. The physical column keeps its NOT NULL.
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: plain,
          label: "Plain",
          fields: [{ name: "body", type: "text", required: false }],
        }
      );

      expect((await registryRow(current, plain))?.migrationStatus).toBe(
        "failed"
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

    /**
     * 🔴 An unfinished attempt must not become a permanent blocker.
     *
     * Writing the intent first is only worth doing if something can finish it. The row owns the
     * slug the moment it is written, so a create interrupted before it could record its outcome
     * would otherwise be refused as a duplicate for ever, leaving the user no way forward short of
     * editing the registry by hand — strictly worse than the orphan table this ordering prevents,
     * because an orphan at least left the slug free.
     */
    it("resumes a create that recorded a failure", async () => {
      current = await createTestNextly({ dialect });

      const payload = {
        slug: plain,
        label: "Plain",
        fields: [{ name: "body", type: "text" }],
      };

      await dispatchSingles("createSingle", {}, payload);

      // The state that is safe to take over: the attempt RECORDED its own failure, so nothing is
      // still running against this slug. A `pending` row is deliberately NOT adopted — it is
      // equally the state of a create that is in flight right now, and serialising that is the
      // migration lock's job rather than a second mechanism here.
      const registry = current.getService("singleRegistryService");
      await registry.updateMigrationStatus(plain, "failed");
      expect((await registryRow(current, plain))?.migrationStatus).toBe(
        "failed"
      );

      // The retry a user would make. It has to succeed rather than collide with its own leftovers.
      await dispatchSingles("createSingle", {}, payload);

      expect((await registryRow(current, plain))?.migrationStatus).toBe(
        "applied"
      );
    });

    /**
     * 🔴 The lifecycle columns come from create OPTIONS, not from the field list.
     *
     * A check derived from the fields alone passes here while `status` is absent, and the runtime
     * schema then writes a Draft/Published column the table does not have. Caught only because the
     * desired shape is built by the same builder the schema diff uses, which injects the system
     * columns the options ask for.
     */
    it("refuses when the existing table lacks the lifecycle column now asked for", async () => {
      current = await createTestNextly({ dialect });

      const fields = [{ name: "body", type: "text" }];
      await dispatchSingles(
        "createSingle",
        {},
        { slug: plain, label: "Plain", fields }
      );

      const registry = current.getService("singleRegistryService");
      await registry.deleteSingle(plain, { force: true });

      // Same fields, but Draft/Published now switched on. The table is untouched by the re-run.
      await dispatchSingles(
        "createSingle",
        {},
        { slug: plain, label: "Plain", fields, status: true }
      );

      expect((await registryRow(current, plain))?.migrationStatus).toBe(
        "failed"
      );
    });
  });
}
