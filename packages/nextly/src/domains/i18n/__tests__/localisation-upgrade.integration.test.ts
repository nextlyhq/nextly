/**
 * `nextly migrate`'s data steps move an installation from before per-language storage into the model without
 * losing anything:
 * - every reader sees, in every language, what it saw before (R-11);
 * - a pending change kept as a whole document in one language is split by comparing it with what
 *   is live: the shared values it changed become the shared draft, its own values its language's
 *   draft, and where two languages changed the same shared field the later save wins and the
 *   conflict is listed (E5);
 * - its dry run lists what will move, what conflicts and what an editor should check, and writes
 *   nothing;
 * - a second upgrade has nothing to do.
 *
 * The plausible broken upgrades: one that leaves the translatable values where they were (the
 * upgraded boot then refuses, or reads them as gone), one that keeps each language's whole-document
 * draft (a language's draft then carries shared values), one that takes the first save rather than
 * the later, and a dry run that writes.
 */
import { randomUUID } from "node:crypto";

import { afterEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestNextly } from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import {
  WORKING_DRAFT_SHAPE,
  type VersionRow,
} from "../../versions/versions-repository";
import { text } from "../../../collections/fields/helpers";
import { declaredLaidOutEntitiesAsStored } from "../../../di/layout-scan-entities";
import { defineFieldGroup } from "../../../field-groups/config/define-field-group";
import { introspectLiveColumns } from "../../schema/pipeline/diff/introspect-live";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  ARTICLES,
  bootSite,
  migrateData,
  openUpgradeDatabase,
  previewMigrateData,
  refusalBeforeSchemaChanges,
  seedLegacyStates,
  SITE,
  whatEachReaderSees,
  type SeededStates,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

// Written for per-language storage as every installation runs it (`storage-layout`).
perLanguageStorageSuite();

describeEachDialect(
  "upgrading an installation into the localisation model",
  dialect => {
    let database: UpgradeDatabase | undefined;
    let site: TestNextly | undefined;

    afterEach(async () => {
      site = undefined;
      await database?.close();
      database = undefined;
      _resetPerLanguageStorage();
      vi.unstubAllEnvs();
    });

    /** The legacy site, filled with every state, and what each reader saw of it. */
    async function legacySite(): Promise<{
      seeded: SeededStates;
      before: Awaited<ReturnType<typeof whatEachReaderSees>>;
    }> {
      database = await openUpgradeDatabase(dialect);
      site = await bootSite(database, "legacy");
      const seeded = await seedLegacyStates(site, database);
      return { seeded, before: await whatEachReaderSees(site, seeded) };
    }

    /** Run `nextly migrate`'s data steps over the database, a backup confirmed, for the site's config. */
    async function upgrade(): Promise<void> {
      await migrateData(database!.adapter as never, SITE);
    }

    /** Each working draft of the entry `entryId`, by its language (`shared` for none). */
    async function pendingChangesOf(
      entryId: string
    ): Promise<Record<string, Record<string, unknown>>> {
      const rows = await database!.adapter.select<VersionRow>(VERSIONS_TABLE, {
        where: {
          and: [
            { column: "entryId", op: "=", value: entryId },
            ...WORKING_DRAFT_SHAPE,
          ],
        },
      });
      return Object.fromEntries(
        rows.map(row => [
          row.locale ?? "shared",
          (typeof row.snapshot === "string"
            ? JSON.parse(row.snapshot)
            : row.snapshot) as Record<string, unknown>,
        ])
      );
    }

    it("keeps what each reader sees in every language", async () => {
      const { seeded, before } = await legacySite();

      await upgrade();
      site = await bootSite(database!, "upgraded");

      const after = await whatEachReaderSees(site, seeded);
      const published = (seen: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(seen).filter(([key]) => key.endsWith("/published"))
        );
      expect(published(after)).toEqual(published(before));
    });

    it("splits a whole-document pending change against live, the later save winning a conflict", async () => {
      const { seeded } = await legacySite();

      await upgrade();

      const split = await pendingChangesOf(seeded.articles.split);
      // The shared field both languages changed: the later save's value, in the shared draft.
      expect(split.shared).toEqual({ code: "from-fr" });
      // Each language's draft keeps its own values and no shared one.
      expect(split.es).toMatchObject({ title: "split es 2" });
      expect(split.fr).toMatchObject({ title: "split fr 2" });
      expect(split.es).not.toHaveProperty("code");
      expect(split.fr).not.toHaveProperty("code");

      // A pending change whose shared values equal live starts no shared draft.
      const copy = await pendingChangesOf(seeded.articles["stale-copy"]);
      expect(copy.shared).toBeUndefined();
      expect(copy.es).toMatchObject({ title: "stale-copy es 2" });
      expect(copy.es).not.toHaveProperty("code");
    });

    // A collection that is not translated still keeps its translatable fields per language once
    // upgraded, so its pending change kept under no language, holding a text edit, is split as
    // a translated one's is: the text to the default language's draft, the shared edit to the
    // shared draft. Left whole, a later save of a shared field alone would drop the text edit.
    it("splits an untranslated entity's pending change by the layout it is stored in", async () => {
      const { seeded } = await legacySite();

      await upgrade();

      const pending = await pendingChangesOf(seeded.notes.pending);
      expect(pending.en).toMatchObject({ title: "pending title 2" });
      expect(pending.en).not.toHaveProperty("code");
      expect(pending.shared).toEqual({ code: "pending-code-2" });
    });

    // A pending change kept under no language and one kept under the default language become the
    // same language's draft. Where they hold different values for one field and were saved at the
    // same moment, nothing says which is the later: neither is kept on a guess.
    it("refuses a no-language and a default-language pending change saved at the same moment, keeping both", async () => {
      const { seeded } = await legacySite();
      const at = new Date("2026-08-01T10:00:00Z");
      const where = {
        and: [
          { column: "entryId", op: "=" as const, value: seeded.notes.pending },
          ...WORKING_DRAFT_SHAPE,
        ],
      };
      await database!.adapter.update(
        VERSIONS_TABLE,
        { createdAt: at, updatedAt: at },
        where
      );
      const [legacy] = await database!.adapter.select<VersionRow>(
        VERSIONS_TABLE,
        { where }
      );
      expect(legacy?.locale ?? null).toBeNull();
      await database!.adapter.insert(
        VERSIONS_TABLE,
        {
          ...legacy,
          id: randomUUID(),
          locale: "en",
          draftKey: null,
          snapshot: JSON.stringify({ title: "pending title in en" }),
          createdAt: at,
          updatedAt: at,
        },
        { returning: [] }
      );
      const before = await pendingChangesOf(seeded.notes.pending);
      expect(Object.keys(before).sort()).toEqual(["en", "shared"]);

      await expect(upgrade()).rejects.toThrow(
        new RegExp(`${seeded.notes.pending}[\\s\\S]*title`)
      );

      expect(await pendingChangesOf(seeded.notes.pending)).toEqual(before);
    });

    // Where two languages changed one shared field and were saved at the same moment, nothing says
    // which save came later: neither value is kept on a guess, and nothing is changed.
    it("refuses two languages' changes to one shared field saved at the same moment, keeping both", async () => {
      const { seeded } = await legacySite();
      const at = new Date("2026-08-01T10:00:00Z");
      await database!.adapter.update(
        VERSIONS_TABLE,
        { createdAt: at, updatedAt: at },
        {
          and: [
            { column: "entryId", op: "=", value: seeded.articles.split },
            ...WORKING_DRAFT_SHAPE,
          ],
        }
      );
      const before = await pendingChangesOf(seeded.articles.split);
      expect(Object.keys(before).sort()).toEqual(["es", "fr"]);

      await expect(upgrade()).rejects.toThrow(
        new RegExp(`${ARTICLES}[\\s\\S]*${seeded.articles.split}[\\s\\S]*code`)
      );

      expect(await pendingChangesOf(seeded.articles.split)).toEqual(before);
    });

    it("lists what moves, what conflicts and what to check in a dry run, and writes nothing", async () => {
      const { seeded } = await legacySite();
      const rowsBefore = await pendingChangesOf(seeded.articles.split);

      const plan = await previewMigrateData(database!.adapter as never, SITE);

      expect(plan.report?.move.length).toBeGreaterThan(0);
      expect(plan.report?.conflicts).toEqual([
        expect.stringMatching(
          new RegExp(`${ARTICLES}.*${seeded.articles.split}.*code.*es.*fr`)
        ),
      ]);
      expect(await pendingChangesOf(seeded.articles.split)).toEqual(rowsBefore);
    });

    it("has nothing to do the second time", async () => {
      await legacySite();
      const preview = () =>
        previewMigrateData(database!.adapter as never, SITE);
      // The legacy site has the model's work to do, so an empty second plan is the upgrade's doing.
      expect((await preview()).report?.move.length).toBeGreaterThan(0);

      await upgrade();

      const plan = await preview();
      expect(plan.changes).toEqual([]);
      expect(plan.report?.move ?? []).toEqual([]);
    });

    it("leaves what an older version recorded of its parts unknown", async () => {
      await legacySite();
      // Versions as an earlier release recorded them: nothing of which parts each changed.
      await database!.adapter.update(
        VERSIONS_TABLE,
        { changedLocales: null, sharedChanged: null },
        { and: [{ column: "versionNo", op: "IS NOT NULL" }] }
      );
      const durable = () =>
        database!.adapter.select<{
          changedLocales: unknown;
          sharedChanged: unknown;
        }>(VERSIONS_TABLE, {
          columns: ["changedLocales", "sharedChanged"],
          where: { and: [{ column: "versionNo", op: "IS NOT NULL" }] },
        });
      expect((await durable()).length).toBeGreaterThan(0);

      await upgrade();

      // Nothing inferred: an older version's parts stay unknown.
      for (const row of await durable()) {
        expect(row.changedLocales ?? null).toBeNull();
        expect(row.sharedChanged ?? null).toBeNull();
      }
    });

    it("moves the values of each entity not translated, and touches no translated one", async () => {
      await legacySite();
      const columnsOf = async (table: string) => {
        const { tables } = await introspectLiveColumns(
          database!.adapter.getDrizzle(),
          database!.adapter.dialect,
          [table]
        );
        return (tables[0]?.columns ?? []).map(column => column.name).sort();
      };
      const translated = ["dc_articles", "single_banner"];
      const before = Object.fromEntries(
        await Promise.all(
          translated.map(
            async table => [table, await columnsOf(table)] as const
          )
        )
      );
      expect(await columnsOf("dc_notes")).toContain("title");
      expect(await columnsOf("single_footer")).toContain("title");

      await upgrade();

      // Every entity keeps its translatable values per language: the ones that were not
      // translated had theirs moved off their main tables.
      expect(await columnsOf("dc_notes")).not.toContain("title");
      expect(await columnsOf("single_footer")).not.toContain("title");
      // A translated entity already kept them per language, so its main table is as it was.
      for (const table of translated) {
        expect(await columnsOf(table)).toEqual(before[table]);
      }
    });

    // A moved column leaves its main table, and an index standing on it alone goes with it, first,
    // since SQLite refuses to drop a column an index names. One standing on it and another column
    // would break, or keep something else unique, so the upgrade refuses it before anything
    // changes, naming it. Broken, SQLite stops part-way on the first, and the other dialects drop
    // or shrink the second without a word.
    it("drops an index on a moved column alone, and refuses one on it with another column", async () => {
      await legacySite();
      const adapter = database!.adapter;
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const columnsOf = async (table: string) => {
        const { tables } = await introspectLiveColumns(
          adapter.getDrizzle(),
          adapter.dialect,
          [table]
        );
        return (tables[0]?.columns ?? []).map(column => column.name);
      };
      const titleIndex = `CREATE INDEX ${q("idx_notes_title")} ON ${q("dc_notes")} (${q("title")})`;
      const twoColumns = `CREATE INDEX ${q("idx_notes_two")} ON ${q("dc_notes")} (${q("title")}, ${q("id")})`;

      await adapter.executeQuery(twoColumns);
      expect(await refusalBeforeSchemaChanges(adapter, SITE)).toMatchObject({
        code: "NEXTLY_UPGRADE_COLUMN_HELD",
        publicMessage: expect.stringContaining("idx_notes_two"),
      });
      await expect(upgrade()).rejects.toMatchObject({
        code: "NEXTLY_UPGRADE_COLUMN_HELD",
      });
      expect(await columnsOf("dc_notes")).toContain("title");

      await adapter.executeQuery(
        dialect === "mysql"
          ? `DROP INDEX ${q("idx_notes_two")} ON ${q("dc_notes")}`
          : `DROP INDEX ${q("idx_notes_two")}`
      );
      await adapter.executeQuery(titleIndex);
      await upgrade();
      expect(await columnsOf("dc_notes")).not.toContain("title");
    });

    // An index on an expression over a moved column, or one whose condition names it, keeps that
    // column out of the catalog's column list: only its definition names it. Either is refused up
    // front by name, like any other index a drop would break. Broken, PostgreSQL and MySQL drop it
    // with the column in silence, and SQLite stops part-way with its own error rather than the
    // up-front refusal. MySQL has no index with a condition.
    it.each(
      (
        [
          ["an expression over", "idx_notes_lower_title"],
          ["a condition naming", "idx_notes_titled"],
        ] as const
      ).filter(([, name]) => dialect !== "mysql" || name !== "idx_notes_titled")
    )(
      "refuses an index on %s a moved column, naming it",
      async (_label, indexName) => {
        await legacySite();
        const adapter = database!.adapter;
        const q = (name: string) =>
          dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
        const { tables } = await introspectLiveColumns(
          adapter.getDrizzle(),
          adapter.dialect,
          ["dc_notes"]
        );
        // MySQL writes a functional key part in its own parentheses.
        const keyed =
          indexName === "idx_notes_titled"
            ? `(${q("id")}) WHERE ${q("title")} IS NOT NULL`
            : dialect === "mysql"
              ? `((lower(${q("title")})))`
              : `(lower(${q("title")}))`;
        await adapter.executeQuery(
          `CREATE INDEX ${q(indexName)} ON ${q("dc_notes")} ${keyed}`
        );

        expect(await refusalBeforeSchemaChanges(adapter, SITE)).toMatchObject({
          code: "NEXTLY_UPGRADE_COLUMN_HELD",
          publicMessage: expect.stringContaining(indexName),
        });
        await expect(upgrade()).rejects.toMatchObject({
          code: "NEXTLY_UPGRADE_COLUMN_HELD",
        });
        const after = await introspectLiveColumns(
          adapter.getDrizzle(),
          adapter.dialect,
          ["dc_notes"]
        );
        expect(after.tables[0]?.columns.map(column => column.name)).toEqual(
          tables[0]?.columns.map(column => column.name)
        );
      }
    );

    // What an index reads is its key and its condition, not its own name or its table's: an
    // expression index named for the moved column, over another, does not hold it, and the
    // upgrade moves the column. Broken (the whole catalog DDL read), the index's name is taken for
    // the column it reads and the upgrade is refused.
    it("moves a column an unrelated index is only named after", async () => {
      await legacySite();
      const adapter = database!.adapter;
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const columnsOf = async (table: string) => {
        const { tables } = await introspectLiveColumns(
          adapter.getDrizzle(),
          adapter.dialect,
          [table]
        );
        return (tables[0]?.columns ?? []).map(column => column.name);
      };
      // MySQL writes a functional key part in its own parentheses.
      const keyed =
        dialect === "mysql" ? `((lower(${q("id")})))` : `(lower(${q("id")}))`;
      await adapter.executeQuery(
        `CREATE INDEX ${q("title")} ON ${q("dc_notes")} ${keyed}`
      );

      expect(await refusalBeforeSchemaChanges(adapter, SITE)).toBeUndefined();
      await upgrade();
      expect(await columnsOf("dc_notes")).not.toContain("title");
    });

    // A field group declared in code had its columns built by the pipeline, whose rule bounds a
    // text field that states no width (255 characters on MySQL and PostgreSQL); the Schema
    // Builder's field-group creator leaves it unbounded. A moved column keeps the capacity its
    // value was stored under, so the upgrade builds it by the rule that built the original.
    it("moves a code-declared field group's values into columns built as the originals were", async () => {
      const site = {
        ...SITE,
        fieldGroups: [
          defineFieldGroup({
            slug: "byline",
            fields: [text({ name: "label" })],
          }),
        ],
      };
      database = await openUpgradeDatabase(dialect);
      await bootSite(database, "legacy", site);
      const [byline] = (
        await declaredLaidOutEntitiesAsStored(database.adapter, site)
      ).filter(entity => entity.kind === "component");
      const typeOf = async (table: string) => {
        const { tables } = await introspectLiveColumns(
          database!.adapter.getDrizzle(),
          database!.adapter.dialect,
          [table]
        );
        return tables[0]?.columns.find(column => column.name === "label")?.type;
      };
      const original = await typeOf(byline!.tableName);
      expect(original).toBeDefined();

      await migrateData(database.adapter as never, site);

      expect(await typeOf(byline!.tableName)).toBeUndefined();
      expect(await typeOf(`${byline!.tableName}_locales`)).toBe(original);
    });
  }
);
