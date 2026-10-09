/**
 * The development boot's migrate step, end to end on every configured
 * dialect: the real `migrateCore`, handed what the boot hands it — the
 * application's own adapter and the configured plugins — against a database
 * development push already gave a plugin's table, with one app migration file
 * pending.
 *
 * Both halves have to hold at once. The app file runs only when the run is
 * told the plugin ships migrations, and it runs only through an adapter with
 * the whole surface `migrateCore` reads (listing tables, the transaction a
 * file runs in).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateCore } from "../../cli/commands/migrate";
import { createLogger } from "../../cli/utils/logger";
import { buildExtensionSchema } from "../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../domains/schema/extension/dsl";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { buildPluginMigration } from "../../domains/schema/migrate-create/generate-plugin";
import {
  pluginModuleStatements,
  type PluginMigration,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import type { PluginDefinition } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { CORE_TABLE_NAMES } from "../../schemas/index";
import { migrateAtDevBoot } from "../boot-apply";

const ALL = ["postgresql", "mysql", "sqlite"] as const;
const PLUGIN = "bootmig";
const APP_TABLE = "bm_app_notes";
const notes = defineTable("notes", { id: col.id(), label: col.shortText() });

/** The plugin's one module, generated for every dialect by the real generator. */
async function pluginModule(): Promise<PluginMigration> {
  const tablesByDialect = {} as Parameters<
    typeof buildPluginMigration
  >[0]["tablesByDialect"];
  for (const dialect of ALL) {
    tablesByDialect[dialect] = (await schemaFor(dialect)).specs;
  }
  const built = buildPluginMigration({
    pluginName: PLUGIN,
    schemaVersion: 1,
    name: "v1",
    now: new Date(Date.UTC(2026, 9, 1, 10, 0, 0)),
    tablesByDialect,
    existing: [],
  });
  if (!built) throw new Error("no module generated");
  return built.module;
}

function schemaFor(dialect: (typeof ALL)[number]) {
  return buildExtensionSchema({
    dialect,
    coreTableNames: CORE_TABLE_NAMES,
    entities: [],
    pluginPrefixes: new Map([[PLUGIN, PLUGIN]]),
    plugins: [{ owner: { kind: "plugin", id: PLUGIN }, tables: [notes] }],
  });
}

describe.each(getConfiguredTestDialects())(
  "the development boot's migrate step (%s)",
  dialect => {
    let handle: TestNextly;
    let migrationsDir: string;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      migrationsDir = mkdtempSync(join(tmpdir(), "nx-dev-boot-"));
    });

    afterEach(async () => {
      rmSync(migrationsDir, { recursive: true, force: true });
      for (const table of [APP_TABLE, `${PLUGIN}__notes`]) {
        await handle?.adapter.executeQuery(`DROP TABLE IF EXISTS ${table}`);
      }
      await handle?.destroy();
    });

    it("applies a pending app file beside a plugin's pushed table, recording the plugin's module", async () => {
      const module = await pluginModule();
      // Development push created the plugin's table from its declaration.
      for (const statement of pluginModuleStatements(module, dialect, "up")) {
        await handle.adapter.executeQuery(statement);
      }
      writeFileSync(
        join(migrationsDir, "20260101_000000_app_notes.sql"),
        `CREATE TABLE ${APP_TABLE} (id varchar(36) PRIMARY KEY);\n`
      );
      const plugin = {
        name: PLUGIN,
        version: "1.0.0",
        contributes: { schema: { migrations: [module] } },
      } as PluginDefinition;

      const result = await migrateAtDevBoot({
        migrateCore,
        adapter: handle.adapter,
        extensionSchema: await schemaFor(dialect),
        plugins: [plugin],
        migrationsDir,
        logger: createLogger({ quiet: true }),
        label: "[test]",
      });

      expect([result.applied, result.pluginModulesApplied]).toEqual([1, 1]);
      expect(await handle.adapter.tableExists(APP_TABLE)).toBe(true);
      // The plugin's module was recorded without running: its table was there.
      const rows = await new SchemaEventsRepository(
        handle.adapter.getDrizzle(),
        dialect
      ).listFileApplies();
      const pluginRows = rows.filter(row =>
        (row.filename ?? "").startsWith(`plugin:${PLUGIN}/`)
      );
      expect(
        pluginRows.map(row => [row.status, row.statementsExecuted ?? 0])
      ).toEqual([["applied", 0]]);
    });
  }
);
