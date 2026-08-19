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
 * makes that claim worth anything is that a create can be issued again over storage a previous
 * attempt left behind: an empty table standing at the create's name is rebuilt from the retried
 * request's fields, never adopted as it stands, and one holding rows refuses the create before
 * anything is dropped or written. The repair cases are exercised directly: the registry row is
 * removed while the table stays, and a create is issued again — with the same fields, with
 * different fields, and against a table that holds data.
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
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { tableHasRows } from "../../schema/pipeline/live-table-facts";
import type { SingleEntryService } from "../services/single-entry-service";
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * The columns the live table physically carries, by name.
 *
 * Read through the same introspection the schema pipeline uses, because the property under test is
 * precisely the physical table rather than what any registry or runtime schema claims about it.
 */
async function columnsOf(
  instance: TestNextly,
  table: string
): Promise<string[]> {
  const snapshot = await introspectLiveSnapshot(
    instance.adapter.getDrizzle(),
    instance.adapter.getCapabilities().dialect,
    [table]
  );
  return (
    snapshot.tables
      .find(spec => spec.name === table)
      ?.columns.map(column => column.name) ?? []
  );
}

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
     * 🔴 The interrupted state again, but the RETRY does not repeat the request — the fields
     * changed in between.
     *
     * `CREATE TABLE IF NOT EXISTS` is a no-op over the standing table, so a create that adopted it
     * as it stands would record `applied` while binding a runtime schema that names columns the
     * table does not have — and every later read and write fails "column does not exist" far from
     * the cause. `applied` has to describe the physical table, so the create rebuilds the standing
     * wreckage from the retried request's fields.
     */
    it("rebuilds an orphaned table when the retried create changes the fields", async () => {
      current = await createTestNextly({ dialect });
      const slug = `${plain}_retry`;
      const table = `single_${slug}`;

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug,
          label: "Retry",
          fields: [{ name: "body", type: "text" }],
        }
      );
      expect(await current.adapter.tableExists(table)).toBe(true);

      // The interrupted state: the table stands, the row describing it does not.
      const registry = current.getService("singleRegistryService");
      await registry.deleteSingle(slug, { force: true });

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug,
          label: "Retry",
          fields: [
            { name: "summary", type: "text" },
            { name: "views", type: "number" },
          ],
        }
      );

      expect((await registryRow(current, slug))?.migrationStatus).toBe(
        "applied"
      );
      // The recorded `applied` has to describe the table that is actually there: the retried
      // field set present, the abandoned attempt's field gone.
      const columns = await columnsOf(current, table);
      expect(columns).toContain("summary");
      expect(columns).toContain("views");
      expect(columns).not.toContain("body");
    });

    /**
     * 🔴 A standing table that HOLDS ROWS is refused, not rebuilt — and the refusal changes
     * nothing.
     *
     * Rows are the one thing an interrupted create's wreckage cannot have: a table the registry
     * has never described has nothing that can write through it, so data proves the table is not
     * this create's to drop. The refusal comes before any statement runs and before any row is
     * written, so the slug stays free, the data stays where it is, and the error names the table
     * in the way.
     */
    it("refuses to create over a table that holds rows, and touches nothing", async () => {
      current = await createTestNextly({ dialect });
      const slug = `${plain}_occupied`;
      const table = `single_${slug}`;

      await dispatchSingles(
        "createSingle",
        {},
        {
          slug,
          label: "Occupied",
          fields: [{ name: "body", type: "text" }],
        }
      );
      const entries =
        current.getService<SingleEntryService>("singleEntryService");
      const written = await entries.update(
        slug,
        { body: "kept" },
        { overrideAccess: true }
      );
      expect(written.success).toBe(true);

      const registry = current.getService("singleRegistryService");
      await registry.deleteSingle(slug, { force: true });

      await expect(
        dispatchSingles(
          "createSingle",
          {},
          {
            slug,
            label: "Occupied",
            fields: [{ name: "headline", type: "text" }],
          }
        )
      ).rejects.toThrow(/holds rows/);

      // Nothing claimed and nothing destroyed. No registry row owns the slug, so the retry stays
      // open; the table keeps the shape and the data that made it refusable. The column checks are
      // what prove no rebuild happened — a rebuild would have put `headline` there.
      expect(await registryRow(current, slug)).toBeUndefined();
      const columns = await columnsOf(current, table);
      expect(columns).toContain("body");
      expect(columns).not.toContain("headline");
      expect(
        await tableHasRows(
          current.adapter.getDrizzle(),
          current.adapter.getCapabilities().dialect,
          table
        )
      ).toBe(true);
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
     * 🔴 A LOCALIZED single's interrupted create is repaired the same way: by rebuilding.
     *
     * The companion reconcile is told `wasLocalized: false` and `oldFields: []`, because from the
     * registry's point of view this is a brand-new localized single — the row describing the
     * previous attempt is gone. A companion left standing would meet a plan that ADDs columns
     * already there, which the companion path deliberately does not tolerate: a half-finished
     * localization ENABLE reaches that code in an identical state, and tolerating it would report
     * success while default-locale content is still stranded on the main table.
     *
     * Rebuilding resolves that ambiguity instead of tolerating it. Content is what distinguishes
     * the two states — a half-enabled single carries its rows on the main table, and a main table
     * holding rows refuses the create before anything is dropped — so a pair of empty tables has
     * nothing to strand, and both are rebuilt from this request's fields.
     */
    it("repairs a localized single's tables by rebuilding the pair", async () => {
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
      // Both halves of a localized single's storage stand after the repair: the main table and
      // the companion the translatable value lives in.
      expect(await current.adapter.tableExists(table)).toBe(true);
      expect(await current.adapter.tableExists(`${table}_locales`)).toBe(true);
    });
  });
}
