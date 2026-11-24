/**
 * On per-language storage, as every installation stores translatable fields, a field change still
 * never takes with it an index another owner built on the field's column. A text field's column
 * lives in the entity's per-language table there. Removing a translated one drops that column, so
 * the Builder save is refused, naming the field, the plugin, the index and that table, with nothing
 * changed. So is removing an untranslated one, whose per-language column the save's companion
 * reconcile drops after the entity's own table changes: the reconcile's plan is judged before any
 * statement. A number field's column is on the entity's own table in either layout, and removing
 * it is refused through the Builder save and the development push. A Single's own schema save
 * (`updateSingleSchema`) is refused before its migration file is written or run: the file changes
 * the Single's own table first, and its reconcile would drop the index only after.
 *
 * What the plugin built elsewhere on those tables stops no change and is kept: its own column, index
 * and values, on the collection's table, its per-language table and the field group's shared table,
 * through a field removed (a text one and a number one), a number field moved into a group,
 * translation turned on, and a field group's field removed. A text field's move into a group is not
 * among them: it is refused on this layout, as its values cannot be carried yet.
 *
 * On SQLite, PostgreSQL and MySQL. The rest of the cases run on the earlier layout in
 * `field-change-keeps-others-elements.integration.test.ts` and `push-keeps-others-elements.integration.test.ts`.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { defineCollection, number, text } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  createTestNextly,
  type CreateTestNextlyOptions,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { companionTableOf } from "../../../i18n/migration/derive-companion-spec";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { applyDesiredSchema } from "../../pipeline/index";
import { resolveComponentTableName } from "../../utils/resolve-table-name";
import { SchemaOwnersRepository } from "../schema-owners-repository";

perLanguageStorageSuite();

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const PLUGIN = "@t/plc-indexer";
const INDEX = "plc_code_idx";

/** The Builder's collection and the one declared in code. */
const BUILT = "plc_posts";
const BUILT_TABLE = `dc_${BUILT}`;
/** A collection and a field group nothing of the plugin's stands on a field column of. */
const KEPT = "plc_kept";
const KEPT_TABLE = `dc_${KEPT}`;
const CARDS = "plc_cards";
const CARDS_TABLE = resolveComponentTableName(CARDS);
const MARKER = "marker";
const HOME = "plc_home";
const HOME_TABLE = `single_${HOME}`;
const CODED = "plc_coded";
const CODED_TABLE = `dc_${CODED}`;

type Field = Record<string, unknown>;
const FIELDS: Field[] = [
  { name: "code", type: "text" },
  { name: "note", type: "text" },
  { name: "rank", type: "number" },
];

let instance: TestNextly | undefined;
let basePath: string;
let dropDatabase: (() => Promise<void>) | undefined;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-plc-"));
  // The schema dialog applies its change, and writes its migration, in development only.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  try {
    await instance?.destroy();
    await dropDatabase?.();
  } finally {
    instance = undefined;
    dropDatabase = undefined;
    vi.unstubAllEnvs();
    _resetEnvCache();
    await rm(basePath, { recursive: true, force: true });
  }
});

describe.each(getConfiguredTestDialects())(
  "a field change keeps what another owner built on per-language storage (%s)",
  (dialect: TestDialect) => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** The app on a database both its starts reach, with `collections` declared in code. */
    async function start(
      collections: CreateTestNextlyOptions["collections"] = []
    ): Promise<TestNextly> {
      let url = `file:${join(basePath, "app.db")}`;
      if (dialect !== "sqlite") {
        const scratch = await createScratchDatabase(dialect, "plc");
        dropDatabase = scratch.drop;
        url = scratch.url;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      const adapter = await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]);
      instance = await createTestNextly({
        adapter: adapter as never,
        basePath,
        db: DB,
        localization: LOCALIZATION,
        collections,
      });
      return instance;
    }

    /** The table of `candidates` that holds `column`, as the database has it. */
    async function tableHolding(
      t: TestNextly,
      main: string,
      column: string
    ): Promise<string> {
      const snapshot = await introspectLiveSnapshot(
        t.adapter.getDrizzle(),
        dialect,
        [main, companionTableOf(main)]
      );
      const table = snapshot.tables.find(each =>
        each.columns.some(c => c.name === column)
      );
      if (table === undefined) throw new Error(`no table holds ${column}`);
      return table.name;
    }

    /** The index names and columns of `table`. */
    async function shapeOf(t: TestNextly, table: string) {
      const snapshot = await introspectLiveSnapshot(
        t.adapter.getDrizzle(),
        dialect,
        [table]
      );
      const found = snapshot.tables.find(each => each.name === table);
      return {
        columns: (found?.columns ?? []).map(c => c.name).sort(),
        indexes: (found?.indexes ?? []).map(index => index.name).sort(),
      };
    }

    /**
     * Builds the index on `column` of `table` as the plugin's migration does, and records it as that
     * run records it. MySQL indexes a text column only by a prefix, which a plugin writes.
     */
    async function buildIndex(
      t: TestNextly,
      table: string,
      column: string,
      text: boolean
    ): Promise<void> {
      const prefix = dialect === "mysql" && text ? "(64)" : "";
      await t.adapter.executeQuery(
        `CREATE INDEX ${q(INDEX)} ON ${q(table)} (${q(column)}${prefix})`
      );
      await new SchemaOwnersRepository(
        (t.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect
      ).upsert([
        {
          tableName: table,
          elementKind: "index",
          elementName: INDEX,
          ownerKind: "plugin",
          ownerId: PLUGIN,
          migratedBy: `plugin:${PLUGIN}`,
          ownerVersion: "1.0.0",
          schemaVersion: null,
          state: "active",
        },
      ]);
    }

    /** The schema dialog's save of the Builder's collection; what it refused with. */
    async function save(
      t: TestNextly,
      fields: Field[],
      extra: Record<string, unknown> = {}
    ) {
      const [row] = await t.adapter.executeQuery<{ v: number | string | null }>(
        `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${BUILT}'`
      );
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: BUILT },
        {
          fields,
          confirmed: true,
          schemaVersion: Number(row?.v ?? 1),
          ...extra,
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
    }

    const without = (name: string) =>
      FIELDS.filter(field => field.name !== name);
    const dropping = (name: string) => ({
      resolutions: { [name]: { action: "confirm_drop" } },
    });

    async function bootBuilt(): Promise<TestNextly> {
      const t = await start();
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: BUILT, label: BUILT, fields: FIELDS }
      );
      clearRegistryRowCache();
      return t;
    }

    /** The refusal names the field, the plugin, the index and its table. */
    function expectNamesTheIndex(
      refused: unknown,
      field: string,
      table: string
    ) {
      expect(NextlyError.is(refused), String(refused)).toBe(true);
      const message = (refused as NextlyError).publicMessage;
      for (const part of [
        `Removing "${field}"`,
        PLUGIN,
        INDEX,
        table,
        "Its owner removes it first",
      ]) {
        expect(message).toContain(part);
      }
    }

    const KEPT_FIELDS: Field[] = [
      ...FIELDS,
      {
        name: "meta",
        type: "group",
        fields: [{ name: "summary", type: "text" }],
      },
    ];

    async function versionOf(t: TestNextly, registry: string, slug: string) {
      const [row] = await t.adapter.executeQuery<{ v: number | string | null }>(
        `SELECT schema_version AS v FROM ${registry} WHERE slug = '${slug}'`
      );
      return Number(row?.v ?? 1);
    }

    const answered = (save: Promise<unknown>) =>
      save.then(
        () => undefined,
        (error: unknown) => error
      );

    async function saveKept(
      t: TestNextly,
      fields: Field[],
      extra: Record<string, unknown> = {}
    ) {
      return answered(
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: KEPT },
          {
            fields,
            confirmed: true,
            schemaVersion: await versionOf(t, "dynamic_collections", KEPT),
            ...extra,
          }
        )
      );
    }

    async function saveCards(
      t: TestNextly,
      fields: Field[],
      extra: Record<string, unknown> = {}
    ) {
      return answered(
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: CARDS },
          {
            fields,
            confirmed: true,
            schemaVersion: await versionOf(t, "dynamic_components", CARDS),
            ...extra,
          }
        )
      );
    }

    /** The tables the plugin's own columns are on: each entity's, and their per-language tables. */
    const markedTables = [
      KEPT_TABLE,
      companionTableOf(KEPT_TABLE),
      CARDS_TABLE,
    ];
    const markerIndex = (table: string) => `plc_${table}_marker_idx`;

    /** KEPT and CARDS with a row each, and the plugin's own column, index and value on their tables. */
    async function bootKept(): Promise<TestNextly> {
      const t = await start();
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: KEPT, label: KEPT, fields: KEPT_FIELDS }
      );
      await dispatchComponents(
        "createComponent",
        {},
        { slug: CARDS, label: "Card", fields: FIELDS }
      );
      clearRegistryRowCache();
      await t.nextly.create({
        collection: KEPT,
        data: { code: "c", note: "n", rank: 1 },
      } as never);
      await t.adapter.executeQuery(
        `INSERT INTO ${q(CARDS_TABLE)} (${["id", "_parent_id", "_parent_table", "_parent_field", "rank"].map(q).join(", ")}) VALUES ('card-1', 'entry-1', '${KEPT_TABLE}', 'card', 1)`
      );
      for (const table of markedTables) {
        await t.adapter.executeQuery(
          `ALTER TABLE ${q(table)} ADD COLUMN ${q(MARKER)} ${dialect === "mysql" ? "varchar(64)" : "text"}`
        );
        await t.adapter.executeQuery(
          `CREATE INDEX ${q(markerIndex(table))} ON ${q(table)} (${q(MARKER)})`
        );
        await t.adapter.executeQuery(
          `UPDATE ${q(table)} SET ${q(MARKER)} = 'kept by the plugin'`
        );
      }
      await new SchemaOwnersRepository(
        (t.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect
      ).upsert(
        markedTables.flatMap(tableName =>
          (
            [
              ["column", MARKER],
              ["index", markerIndex(tableName)],
            ] as const
          ).map(([elementKind, elementName]) => ({
            tableName,
            elementKind,
            elementName,
            ownerKind: "plugin" as const,
            ownerId: PLUGIN,
            migratedBy: `plugin:${PLUGIN}`,
            ownerVersion: "1.0.0",
            schemaVersion: null,
            state: "active" as const,
          }))
        )
      );
      return t;
    }

    /** The plugin's index and its column's values on each table, as the database has them. */
    async function markersOf(t: TestNextly) {
      const found = [];
      for (const table of markedTables) {
        found.push({
          table,
          indexes: (await shapeOf(t, table)).indexes.filter(
            name => name === markerIndex(table)
          ),
          values: (
            await t.adapter.executeQuery<{ v: unknown }>(
              `SELECT ${q(MARKER)} AS v FROM ${q(table)}`
            )
          ).map(row => row.v),
        });
      }
      return found;
    }

    const keptWithout = (name: string) =>
      KEPT_FIELDS.filter(field => field.name !== name);

    // Nothing of the plugin's is built on a column any of these removes. Turning translation on
    // removes no column on this layout: a text field's is the per-language table's already.
    it.each([
      {
        change: "removing a text field, whose column is per language",
        gone: [companionTableOf(KEPT_TABLE), "note"],
        save: (t: TestNextly) =>
          saveKept(t, keptWithout("note"), dropping("note")),
      },
      {
        change: "removing a number field",
        gone: [KEPT_TABLE, "rank"],
        save: (t: TestNextly) =>
          saveKept(t, keptWithout("rank"), dropping("rank")),
      },
      {
        change: "moving a number field into a group",
        gone: [KEPT_TABLE, "rank"],
        save: (t: TestNextly) =>
          saveKept(
            t,
            keptWithout("rank").map(field =>
              field.name === "meta"
                ? {
                    ...field,
                    fields: [
                      ...(field.fields as Field[]),
                      { name: "rank", type: "number" },
                    ],
                  }
                : field
            ),
            { hints: { moves: [{ from: ["rank"], to: ["meta", "rank"] }] } }
          ),
      },
      {
        change: "turning translation on",
        gone: undefined,
        save: (t: TestNextly) => saveKept(t, KEPT_FIELDS, { localized: true }),
      },
      {
        change: "removing a field group's number field",
        gone: [CARDS_TABLE, "rank"],
        save: (t: TestNextly) =>
          saveCards(
            t,
            FIELDS.filter(field => field.name !== "rank"),
            dropping("rank")
          ),
      },
    ])(
      "applies $change where the plugin's column and index are elsewhere on the table, keeping them and their values",
      async ({ save: change, gone }) => {
        const t = await bootKept();
        const before = await markersOf(t);
        for (const each of before) {
          expect(each.indexes, each.table).toHaveLength(1);
          expect(each.values.length, each.table).toBeGreaterThan(0);
          expect(new Set(each.values), each.table).toEqual(
            new Set(["kept by the plugin"])
          );
        }
        if (gone !== undefined) {
          expect((await shapeOf(t, gone[0]!)).columns).toContain(gone[1]);
        }

        expect(await change(t)).toBeUndefined();

        if (gone !== undefined) {
          expect((await shapeOf(t, gone[0]!)).columns).not.toContain(gone[1]);
        }
        expect(await markersOf(t)).toEqual(before);
      }
    );

    it("refuses a Builder save removing a translated field whose per-language column a plugin's index is built on, changing nothing", async () => {
      const t = await bootBuilt();
      expect(await save(t, FIELDS, { localized: true })).toBeUndefined();
      const table = await tableHolding(t, BUILT_TABLE, "code");
      expect(table).toBe(companionTableOf(BUILT_TABLE));
      await buildIndex(t, table, "code", true);
      const before = await shapeOf(t, table);

      const refused = await save(t, without("code"), {
        localized: true,
        ...dropping("code"),
      });

      expectNamesTheIndex(refused, "code", table);
      expect(await shapeOf(t, table)).toEqual(before);
    });

    it("refuses a Builder save removing a number field whose column a plugin's index is built on, changing nothing", async () => {
      const t = await bootBuilt();
      const table = await tableHolding(t, BUILT_TABLE, "rank");
      await buildIndex(t, table, "rank", false);
      const before = await shapeOf(t, table);

      const refused = await save(t, without("rank"), dropping("rank"));

      expectNamesTheIndex(refused, "rank", table);
      expect(await shapeOf(t, table)).toEqual(before);
    });

    it("refuses a Builder save removing an untranslated text field whose per-language column a plugin's index is built on, changing nothing", async () => {
      const t = await bootBuilt();
      const table = await tableHolding(t, BUILT_TABLE, "code");
      expect(table).toBe(companionTableOf(BUILT_TABLE));
      await buildIndex(t, table, "code", true);
      const before = await shapeOf(t, table);

      const refused = await save(t, without("code"), dropping("code"));

      expectNamesTheIndex(refused, "code", table);
      expect(await shapeOf(t, table)).toEqual(before);
    });

    it("refuses a Single's schema save that removes a text field whose per-language column a plugin's index is built on, before its migration file is written or run", async () => {
      const t = await start();
      await dispatchSingles(
        "createSingle",
        {},
        { slug: HOME, label: "Home", fields: FIELDS }
      );
      const table = await tableHolding(t, HOME_TABLE, "code");
      expect(table).toBe(companionTableOf(HOME_TABLE));
      await buildIndex(t, table, "code", true);
      const written = async () =>
        (
          await readdir(join(basePath, "migrations"), { recursive: true })
        ).sort();
      const before = {
        companion: await shapeOf(t, table),
        main: await shapeOf(t, HOME_TABLE),
        files: await written(),
      };

      const refused = await dispatchSingles(
        "updateSingleSchema",
        { slug: HOME },
        {
          fields: FIELDS.filter(
            field => !["code", "rank"].includes(String(field.name))
          ),
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expectNamesTheIndex(refused, "code", table);
      expect({
        companion: await shapeOf(t, table),
        main: await shapeOf(t, HOME_TABLE),
        files: await written(),
      }).toEqual(before);
    });

    it("refuses a development push removing a number field whose column a plugin's index is built on, changing nothing", async () => {
      const coded = (withRank: boolean) =>
        defineCollection({
          slug: CODED,
          fields: [
            text({ name: "note" }),
            ...(withRank ? [number({ name: "rank" })] : []),
          ],
        });
      const t = await start([coded(true)]);
      const table = await tableHolding(t, CODED_TABLE, "rank");
      await buildIndex(t, table, "rank", false);
      const before = await shapeOf(t, table);
      vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `${table}.rank`);

      const pushed = await applyDesiredSchema(
        {
          collections: {
            [CODED]: {
              slug: CODED,
              tableName: CODED_TABLE,
              fields: coded(false).fields,
            },
          },
          singles: {},
          components: {},
        },
        "code",
        { promptChannel: "terminal" }
      );

      expect(pushed.success, JSON.stringify(pushed)).toBe(false);
      const message = pushed.success ? "" : pushed.error.message;
      for (const part of ["rank", PLUGIN, INDEX, table]) {
        expect(message).toContain(part);
      }
      expect(await shapeOf(t, table)).toEqual(before);
    });
  }
);
