/**
 * On per-language storage, as every installation stores translatable fields, a field change still
 * never takes with it an index another owner built on the field's column. A text field's column
 * lives in the entity's per-language table there. Removing a translated one drops that column, so
 * the Builder save is refused, naming the field, the plugin, the index and that table, with nothing
 * changed. Removing an untranslated one keeps its per-language column with its values, so nothing
 * of the plugin's goes and the save applies. A number field's column is on the entity's own table
 * in either layout, and removing it is refused through the Builder save and the development push.
 *
 * On SQLite, PostgreSQL and MySQL. The rest of the cases run on the earlier layout in
 * `field-change-keeps-others-elements.integration.test.ts` and `push-keeps-others-elements.integration.test.ts`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { defineCollection, number, text } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
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
import { SchemaOwnersRepository } from "../schema-owners-repository";

perLanguageStorageSuite();

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const PLUGIN = "@t/plc-indexer";
const INDEX = "plc_code_idx";

/** The Builder's collection and the one declared in code. */
const BUILT = "plc_posts";
const BUILT_TABLE = `dc_${BUILT}`;
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
      for (const part of [`Removing "${field}"`, PLUGIN, INDEX, table]) {
        expect(message).toContain(part);
      }
    }

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

    it("applies a Builder save removing an untranslated text field, whose per-language column it keeps with the plugin's index", async () => {
      const t = await bootBuilt();
      const table = await tableHolding(t, BUILT_TABLE, "code");
      await buildIndex(t, table, "code", true);

      const saved = await save(t, without("code"), dropping("code"));

      expect(
        saved,
        NextlyError.is(saved)
          ? JSON.stringify({
              message: saved.logMessage,
              context: saved.logContext,
              cause: String(saved.cause),
            })
          : String(saved)
      ).toBeUndefined();
      const after = await shapeOf(t, table);
      expect(after.columns).toContain("code");
      expect(after.indexes).toContain(INDEX);
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
