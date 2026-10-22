/**
 * A plugin module that adds a column to a collection's table, run against a
 * database where development push already made that column, on every
 * configured dialect.
 *
 * The column is made by the real push: booting with the plugin's schema hook
 * creates the collection's table through `applyDesiredSchema`, which applies
 * the hook's contribution to the entity's desired spec. The module is then
 * generated from the same hook by the real generator and handed to the
 * development boot's migrate step. A column that matches the module is
 * adopted without running the module's ALTER; one that does not is refused
 * as drift, by name, and nothing is recorded.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  addedElements,
  withEntityContributions,
} from "../../../domains/schema/extension/entity-contributions";
import { col, type ColumnBuilder } from "../../../domains/schema/extension/dsl";
import { compileExtensionSchema } from "../../../domains/schema/extension/publish";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import type { PluginMigration } from "../../../domains/schema/migrate/plugin/plugin-migration";
import { pluginMigrationArgs } from "../../../domains/schema/migrate/plugin/run-plugin-migrations";
import type { TableSpec } from "../../../domains/schema/pipeline/diff/types";
import { desiredCollectionTable } from "../../../domains/schema/pipeline/desired-collection-table";
import { migrateAtDevBoot } from "../../../init/boot-apply";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";

const ALL = ["postgresql", "mysql", "sqlite"] as const;
const PLUGIN = "@test/pushcol-search";
/** The collection's slug; its table is named for this file alone. */
const SLUG = "pushcol_posts";
const TABLE = `dc_${SLUG}`;
const COLUMN = "search_vector";

const posts = defineCollection({
  slug: SLUG,
  fields: [text({ name: "title" })],
});

/** A plugin whose schema hook adds `searchVector` to the collection's table. */
function contributor(
  column: () => ColumnBuilder,
  migrations?: PluginMigration[]
): PluginDefinition {
  return definePlugin({
    name: PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      schema: {
        extend: [
          ({ schema }) => {
            schema.extendTable(TABLE, {
              columns: { searchVector: column() },
            });
          },
        ],
        ...(migrations ? { migrations } : {}),
      },
    },
  });
}

/** The extension schema the configured app compiles for one dialect. */
async function extensionSchemaFor(
  dialect: TestDialect,
  plugin: PluginDefinition
) {
  const schema = await compileExtensionSchema({
    dialect,
    plugins: [plugin],
    config: { collections: [posts] },
    logger: { warn: () => {} },
  });
  if (!schema) throw new Error("no extension schema compiled");
  return schema;
}

/**
 * The plugin's module for its contribution, generated for every dialect by
 * the real generator. The collection's table is a foreign table to the
 * plugin: its baseline is the collection's own desired table, and the
 * contributed side is that table with the plugin's contribution applied by
 * the helper dev push applies it with.
 */
async function moduleFor(
  column: () => ColumnBuilder
): Promise<PluginMigration> {
  const plugin = contributor(column);
  const none = { postgresql: [], mysql: [], sqlite: [] };
  const contributedByDialect = {} as Record<(typeof ALL)[number], TableSpec[]>;
  const contributedBaselineByDialect = {} as Record<
    (typeof ALL)[number],
    TableSpec[]
  >;
  const contributions: NonNullable<
    Parameters<typeof buildPluginMigration>[0]["contributions"]
  > = {};
  for (const dialect of ALL) {
    const bare = desiredCollectionTable(
      { slug: SLUG, tableName: TABLE, fields: posts.fields },
      dialect
    );
    const withColumn = withEntityContributions(
      bare,
      await extensionSchemaFor(dialect, plugin),
      bare,
      dialect
    );
    contributedByDialect[dialect] = [withColumn];
    contributedBaselineByDialect[dialect] = [bare];
    contributions[dialect] = { [TABLE]: addedElements(bare, withColumn) };
  }
  const built = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: 1,
    name: "v1",
    now: new Date(Date.UTC(2026, 9, 1, 10, 0, 0)),
    tablesByDialect: none,
    contributedByDialect,
    contributedBaselineByDialect,
    contributions,
    existing: [],
  });
  if (!built) throw new Error("no module generated");
  return built.module;
}

describe.each(getConfiguredTestDialects())(
  "a plugin module adding a column dev push already made to a collection (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
      await handle?.destroy();
      handle = undefined;
    });

    /** Boot with the plugin's hook, so the push creates the column. */
    async function bootPushing(column: () => ColumnBuilder) {
      const booted = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [posts],
        plugins: [contributor(column)],
      });
      handle = booted;
      return booted;
    }

    /** One stored post, with a value in the pushed column. */
    async function seedRow(booted: TestNextly, value: string | number) {
      const created = await booted.nextly.create({
        collection: SLUG,
        data: { title: "first" },
        overrideAccess: true,
      });
      const id = (created.item as { id: string }).id;
      await booted.adapter.update(
        TABLE,
        { [COLUMN]: value },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      return id;
    }

    /** The development boot's migrate step, with the plugin's module. */
    async function migrate(booted: TestNextly, module: PluginMigration) {
      const plugin = contributor(() => col.text({ nullable: true }), [module]);
      return migrateAtDevBoot({
        migrateCore,
        adapter: booted.adapter,
        extensionSchema: await extensionSchemaFor(dialect, plugin),
        pluginMigrations: await pluginMigrationArgs([plugin]),
        // No app migrations: an absent directory is read as none.
        migrationsDir: join(tmpdir(), `nx-pushcol-absent-${process.pid}`),
        logger: createLogger({ quiet: true }),
        label: "[test]",
      });
    }

    /** The ledger rows of the plugin's modules, as status and statement count. */
    async function pluginLedger(booted: TestNextly) {
      const rows = await new SchemaEventsRepository(
        booted.adapter.getDrizzle(),
        dialect
      ).listFileApplies();
      return rows
        .filter(row => (row.filename ?? "").startsWith(`plugin:${PLUGIN}/`))
        .map(row => [row.status, row.statementsExecuted ?? 0]);
    }

    it("adopts a matching pushed column without running the module, keeping its values", async () => {
      const module = await moduleFor(() => col.text({ nullable: true }));
      // The module does carry the ALTER, so a zero statement count below is
      // an adoption and not an empty module.
      expect(module.dialects[dialect].up.join("\n")).toContain(COLUMN);
      const booted = await bootPushing(() => col.text({ nullable: true }));
      const id = await seedRow(booted, "indexed");

      const result = await migrate(booted, module);

      expect(result.pluginModulesApplied).toBe(1);
      expect(await pluginLedger(booted)).toEqual([["applied", 0]]);
      const row = await booted.adapter.selectOne<Record<string, unknown>>(
        TABLE,
        { where: { and: [{ column: "id", op: "=", value: id }] } }
      );
      expect(row?.[COLUMN]).toBe("indexed");
    });

    it("refuses a pushed column whose type differs from the module's, naming the table and column", async () => {
      const module = await moduleFor(() => col.text({ nullable: true }));
      // Pushed as an integer: the module declares text.
      const booted = await bootPushing(() => col.integer({ nullable: true }));
      await seedRow(booted, 7);

      const refused = await migrate(booted, module).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toMatchObject({ code: "NEXTLY_MIGRATION_DRIFT" });
      // Named by the drift item itself, not only by the migration's name.
      const driftItems =
        (refused as { logContext?: { driftItems?: { detail: string }[] } })
          .logContext?.driftItems ?? [];
      expect(
        driftItems.some(item => item.detail.includes(`${TABLE}.${COLUMN}`))
      ).toBe(true);
      expect((refused as Error).message).toContain(`${TABLE}.${COLUMN}`);
      expect(
        (await pluginLedger(booted)).filter(([status]) => status === "applied")
      ).toEqual([]);
    });
  }
);
