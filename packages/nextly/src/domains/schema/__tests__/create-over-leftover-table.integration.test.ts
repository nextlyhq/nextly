/**
 * A create is recorded applied only over a table that has the shape it asked for.
 *
 * A table standing under the create's name that nothing registered describes is never built over:
 * an empty one is replaced, so the table that ends up there holds exactly the requested columns;
 * one holding rows is refused, naming the table and how many rows it holds, and left as it was.
 * Two creates of one name at once leave one of them standing and refuse the other, naming it.
 * A collection's leftover takes in its translations table and its junction tables too, and rows
 * in the shared field-group tables naming it.
 *
 * Each leftover table is made by the creating SQL a Builder create renders, for other fields than
 * the create asks for, so it is the wreckage an interrupted earlier attempt would leave.
 *
 * Every create runs as a development server does, where a Builder save applies its migration at
 * once; anywhere else it writes the migration and applies nothing, so no table is built at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionService } from "../../collections/services/collection-service";
import {
  builderKeyTables,
  type CollectionTables,
} from "../../dynamic-collections/services/collection-tables";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../field-groups/services/field-group-schema-service";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import { junctionTablesOf } from "../services/field-column-descriptor";
import { applyMigrationStatements } from "../services/apply-migration-statements";

let t: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await t?.destroy();
  t = undefined;
});

/** What a create raised, or undefined when it went through. */
async function refusalOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
    return undefined;
  } catch (error) {
    return error;
  }
}

const STALE = [{ name: "stale", type: "number" }];
const REQUESTED = [
  { name: "title", type: "text" },
  { name: "score", type: "number" },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`a create over a leftover table — ${dialect}`, () => {
    beforeEach(async () => {
      // Development, where a Builder create applies its table at once.
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({ dialect });
    });

    const app = () => t as TestNextly;

    async function liveColumns(table: string): Promise<string[]> {
      const snapshot = await introspectLiveColumns(
        app().adapter.getDrizzle(),
        dialect,
        [table]
      );
      return (snapshot.tables[0]?.columns ?? []).map(column => column.name);
    }

    async function rowCount(table: string): Promise<number> {
      const q = dialect === "mysql" ? "`" : '"';
      const [row] = await app().adapter.executeQuery<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM ${q}${table}${q}`
      );
      return Number(row?.n ?? 0);
    }

    /** A value a column of `type` accepts, for a row that only has to exist. */
    function valueFor(type: string): string {
      const t = type.toLowerCase();
      if (/bool/.test(t)) return dialect === "postgresql" ? "true" : "1";
      if (/int|numeric|decimal|real|double|float|serial/.test(t)) return "0";
      if (/timestamp|date|time/.test(t)) return "'2026-01-01 00:00:00'";
      if (/json/.test(t)) return "'[]'";
      return "'x'";
    }

    /**
     * Put `count` rows in a table, each giving every column it requires a value; `given` sets
     * some columns to values of its own (a component row's parent, say).
     */
    async function holdRows(
      table: string,
      count: number,
      given: Record<string, string> = {}
    ): Promise<void> {
      const q = dialect === "mysql" ? "`" : '"';
      const columns =
        (
          await introspectLiveColumns(app().adapter.getDrizzle(), dialect, [
            table,
          ])
        ).tables[0]?.columns ?? [];
      const required = columns.filter(
        column =>
          column.name === "id" ||
          (!column.nullable && column.default === undefined)
      );
      for (let i = 0; i < count; i++) {
        const values = required.map(column =>
          column.name === "id"
            ? `'leftover-${i}'`
            : column.name in given
              ? `'${given[column.name]}'`
              : valueFor(column.type)
        );
        await app().adapter.executeQuery(
          `INSERT INTO ${q}${table}${q} (${required.map(c => `${q}${c.name}${q}`).join(", ")}) VALUES (${values.join(", ")})`
        );
      }
    }

    /** The table a field-group create for other fields leaves behind. */
    async function leftoverFieldGroupTable(table: string): Promise<void> {
      await applyMigrationStatements(
        app().adapter,
        new FieldGroupSchemaService(dialect).generateMigrationSQL(
          table,
          STALE as never
        )
      );
    }

    /** The table a Single create for other fields leaves behind. */
    async function leftoverSingleTable(table: string): Promise<void> {
      await applyMigrationStatements(
        app().adapter,
        new DynamicCollectionSchemaService(
          undefined,
          dialect
        ).generateMigrationSQL(table, STALE as never, { hasStatus: false })
      );
    }

    /**
     * The tables a collection create for `fields` leaves behind: its main table, with any junction
     * its fields make, and, `localized`, its translations table for the translatable ones.
     */
    async function leftoverCollectionTables(
      table: string,
      fields: readonly Record<string, unknown>[] = STALE,
      options: { localized?: boolean; targetTables?: CollectionTables } = {}
    ): Promise<void> {
      await applyMigrationStatements(
        app().adapter,
        new DynamicCollectionSchemaService(
          undefined,
          dialect
        ).generateMigrationSQL(table, fields as never, {
          hasStatus: false,
          localized: options.localized === true,
          ...(options.targetTables
            ? { targetTables: options.targetTables }
            : {}),
        })
      );
      if (!options.localized) return;
      const spec = deriveCompanionSpec({
        slug: table,
        fields: fields as never,
        dialect,
        defaultLocale: "en",
        collectionLocalized: true,
        builtBy: "collection",
      });
      if (spec) {
        await applyMigrationStatements(
          app().adapter,
          buildCompanionCreateOnlySql(spec)
        );
      }
    }

    /** The app booted again with two languages, as a translated collection needs. */
    async function translatedApp(): Promise<void> {
      await app().destroy();
      t = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    }

    const createCollection = (
      slug: string,
      fields: readonly Record<string, unknown>[] = REQUESTED,
      localized = false
    ) =>
      app()
        .getService("collectionService")
        .createCollection(
          {
            name: slug,
            label: slug,
            localized,
            fields,
          } as unknown as Parameters<CollectionService["createCollection"]>[0],
          {}
        );

    /** How the registry records the collection's create, or null with no row. */
    async function collectionStatus(slug: string): Promise<string | null> {
      const [row] = await app().adapter.executeQuery<{ status: unknown }>(
        `SELECT migration_status AS status FROM dynamic_collections WHERE slug = '${slug}'`
      );
      return row ? String(row.status) : null;
    }

    const createFieldGroup = (slug: string) =>
      dispatchComponents(
        "createComponent",
        {},
        { slug, label: slug, fields: REQUESTED }
      );
    const createSingle = (slug: string) =>
      dispatchSingles(
        "createSingle",
        {},
        { slug, label: slug, fields: REQUESTED }
      );

    it("replaces an empty leftover field-group table with the requested columns", async () => {
      await leftoverFieldGroupTable("comp_lfempty");

      await createFieldGroup("lfempty");

      const columns = await liveColumns("comp_lfempty");
      expect(columns).toEqual(expect.arrayContaining(["title", "score"]));
      expect(columns).not.toContain("stale");
      const stored = await app()
        .getService("fieldGroupRegistryService")
        .getComponentBySlug("lfempty");
      expect(stored?.migrationStatus).toBe("applied");
    });

    it("refuses a field-group create over a leftover holding rows, naming it and its row count", async () => {
      await leftoverFieldGroupTable("comp_lfheld");
      await holdRows("comp_lfheld", 2);

      const refused = await refusalOf(createFieldGroup("lfheld"));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining('"comp_lfheld" (2 rows)'),
      });
      expect(await rowCount("comp_lfheld")).toBe(2);
      expect(await liveColumns("comp_lfheld")).toContain("stale");
      expect(
        await app()
          .getService("fieldGroupRegistryService")
          .getComponentBySlug("lfheld")
      ).toBeNull();
    });

    it("replaces an empty leftover Single table with the requested columns", async () => {
      await leftoverSingleTable("single_lsempty");

      await createSingle("lsempty");

      const columns = await liveColumns("single_lsempty");
      expect(columns).toEqual(expect.arrayContaining(["title", "score"]));
      expect(columns).not.toContain("stale");
    });

    it("refuses a Single create over a leftover holding rows, naming it and its row count", async () => {
      await leftoverSingleTable("single_lsheld");
      await holdRows("single_lsheld", 1);

      const refused = await refusalOf(createSingle("lsheld"));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining('"single_lsheld" (1 row)'),
      });
      expect(await rowCount("single_lsheld")).toBe(1);
    });

    // Two creates of one name at once: the schema lock lets one in and refuses the other until it
    // is done, and a create of a name already taken is refused by name, lock or no lock.
    // A Single's field-group rows live in the shared field-group tables, naming its table as their
    // parent: a leftover whose content is there is not wreckage, however empty its own table.
    it("refuses a Single create over an empty leftover whose field-group rows name it, deleting nothing", async () => {
      await leftoverSingleTable("single_lsfg");
      await createFieldGroup("lsfgchip");
      await holdRows("comp_lsfgchip", 1, { _parent_table: "single_lsfg" });

      const refused = await refusalOf(createSingle("lsfg"));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining('"comp_lsfgchip" (1 row)'),
      });
      expect(await rowCount("comp_lsfgchip")).toBe(1);
      expect(await liveColumns("single_lsfg")).toContain("stale");
    });

    it("replaces an empty leftover collection table with the requested columns, recorded applied", async () => {
      await leftoverCollectionTables("dc_lcempty");

      await createCollection("lcempty");

      const columns = await liveColumns("dc_lcempty");
      expect(columns).toEqual(expect.arrayContaining(["title", "score"]));
      expect(columns).not.toContain("stale");
      expect(await collectionStatus("lcempty")).toBe("applied");
    });

    it("refuses a collection create over a leftover holding rows, naming it and its row count", async () => {
      await leftoverCollectionTables("dc_lcheld");
      // One row: a collection's table keeps `slug` unique.
      await holdRows("dc_lcheld", 1);

      const refused = await refusalOf(createCollection("lcheld"));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining('"dc_lcheld" (1 row)'),
      });
      expect(await rowCount("dc_lcheld")).toBe(1);
      expect(await liveColumns("dc_lcheld")).toContain("stale");
      expect(await collectionStatus("lcheld")).toBeNull();
    });

    it("replaces a translated collection's empty leftover tables, its translations table with them", async () => {
      await translatedApp();
      const STALE_TRANSLATED = [
        { name: "stale", type: "text", localized: true },
      ];
      await leftoverCollectionTables("dc_lcloc", STALE_TRANSLATED, {
        localized: true,
      });
      expect(await liveColumns("dc_lcloc_locales")).toContain("stale");

      const TRANSLATED = [
        { name: "title", type: "text", localized: true },
        { name: "score", type: "number" },
      ];
      await createCollection("lcloc", TRANSLATED, true);
      // The same collection created where nothing was left over: what the create itself makes.
      await createCollection("lclocfresh", TRANSLATED, true);

      // The whole family ends as a create over no leftover leaves it: the main table and the
      // translations table each as the fresh create's, so neither a stale column nor a table the
      // create would have made but did not can pass.
      expect(await liveColumns("dc_lcloc")).toEqual(
        await liveColumns("dc_lclocfresh")
      );
      expect(await liveColumns("dc_lcloc_locales")).toEqual(
        await liveColumns("dc_lclocfresh_locales")
      );
      expect(await collectionStatus("lcloc")).toBe("applied");
    });

    // A collection registered before the `-locales` address was reserved, or whose row keeps a
    // table name of its own, can store in `dc_<slug>_locales`: empty, it is still that
    // collection's table, never this create's leftover translations table.
    it("refuses a collection create whose translations table another collection stores in, dropping nothing", async () => {
      await createCollection("lcowner");
      const q = dialect === "mysql" ? "`" : '"';
      await app().adapter.executeQuery(
        `ALTER TABLE ${q}dc_lcowner${q} RENAME TO ${q}dc_lcown_locales${q}`
      );
      await app().adapter.executeQuery(
        `UPDATE dynamic_collections SET table_name = 'dc_lcown_locales' WHERE slug = 'lcowner'`
      );

      const refused = await refusalOf(createCollection("lcown"));

      expect(refused).toMatchObject({ code: "DUPLICATE" });
      expect(await liveColumns("dc_lcown_locales")).toEqual(
        expect.arrayContaining(["title", "score"])
      );
      expect(await collectionStatus("lcown")).toBeNull();
    });

    it("refuses a translated collection's create over a leftover translations table holding rows", async () => {
      await translatedApp();
      const STALE_TRANSLATED = [
        { name: "stale", type: "text", localized: true },
      ];
      await leftoverCollectionTables("dc_lclocheld", STALE_TRANSLATED, {
        localized: true,
      });
      await holdRows("dc_lclocheld", 1);
      await holdRows("dc_lclocheld_locales", 1, {
        _parent: "leftover-0",
        _locale: "en",
      });

      const refused = await refusalOf(
        createCollection(
          "lclocheld",
          [{ name: "title", type: "text", localized: true }],
          true
        )
      );

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining(
          '"dc_lclocheld_locales" (1 row)'
        ),
      });
      expect(await rowCount("dc_lclocheld_locales")).toBe(1);
    });

    it("refuses a collection create over an empty leftover whose field-group rows name it, deleting nothing", async () => {
      await leftoverCollectionTables("dc_lcfg");
      await createFieldGroup("lcfgchip");
      await holdRows("comp_lcfgchip", 1, { _parent_table: "dc_lcfg" });

      const refused = await refusalOf(createCollection("lcfg"));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining('"comp_lcfgchip" (1 row)'),
      });
      expect(await rowCount("comp_lcfgchip")).toBe(1);
      expect(await liveColumns("dc_lcfg")).toContain("stale");
    });

    // An index of the leftover's own under a name the create's index takes is the leftover's, and
    // goes with it: the create is not refused as though the name were held elsewhere.
    it("replaces an empty leftover holding an index under a name the create's index takes", async () => {
      await leftoverCollectionTables("dc_lcidx", [
        { name: "code", type: "text", unique: true },
      ]);

      await createCollection("lcidx", [
        { name: "code", type: "text", index: true },
      ]);

      expect(await collectionStatus("lcidx")).toBe("applied");
      expect(await liveColumns("dc_lcidx")).toContain("code");
    });

    // A many-to-many keeps its links in a junction table the create makes beside its main table;
    // one left standing by an earlier attempt is part of the leftover.
    it("refuses a collection create whose leftover junction holds links, naming it", async () => {
      await createCollection("lctarget");
      const targetTables = builderKeyTables([["lctarget", "dc_lctarget"]]);
      const LINKED = [
        {
          name: "tags",
          type: "relationship",
          options: { relationType: "manyToMany", target: "lctarget" },
        },
      ];
      await leftoverCollectionTables("dc_lcjunc", LINKED, { targetTables });
      // By the name the create gives it, as the production rule names it.
      const [junction] = junctionTablesOf("dc_lcjunc", LINKED as never);
      expect(
        junction !== undefined && (await app().adapter.tableExists(junction)),
        `the leftover's junction table ${junction} stands`
      ).toBe(true);
      // A link names a row at each end, so both ends hold one; the refusal names the junction
      // among the leftover's tables holding rows.
      await holdRows("dc_lcjunc", 1);
      await holdRows("dc_lctarget", 1);
      const keys = (
        (
          await introspectLiveColumns(app().adapter.getDrizzle(), dialect, [
            junction as string,
          ])
        ).tables[0]?.columns ?? []
      )
        .map(column => column.name)
        .filter(name => name !== "id" && name.endsWith("_id"));
      await holdRows(
        junction as string,
        1,
        Object.fromEntries(keys.map(key => [key, "leftover-0"]))
      );

      const refused = await refusalOf(createCollection("lcjunc", LINKED));

      expect(refused).toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining(`"${junction}" (1 row)`),
      });
      expect(await rowCount(junction as string)).toBe(1);
    });

    it("lets one of two field-group creates of one name at once stand, and refuses the other", async () => {
      const outcomes = await Promise.allSettled([
        createFieldGroup("lftwice"),
        createFieldGroup("lftwice"),
      ]);

      expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(o => o.status === "rejected")).toHaveLength(1);
      const columns = await liveColumns("comp_lftwice");
      expect(columns).toEqual(expect.arrayContaining(["title", "score"]));
    });

    it("refuses a field-group create of a name already created, naming it", async () => {
      await createFieldGroup("lfagain");

      const refused = await refusalOf(createFieldGroup("lfagain"));

      expect(refused).toMatchObject({
        publicMessage: expect.stringContaining('"lfagain"'),
      });
    });
  });
}
