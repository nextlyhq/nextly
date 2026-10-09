/**
 * What the plugin migration phase records and refuses about ownership, on
 * every configured dialect.
 *
 * Each case runs the phase as `migrateCore` does and reads the outcome back
 * from the database — the ledger, the owner registry and the tables
 * themselves — rather than from what the phase returned:
 *
 * - a plugin module dropping a table no owner row claims is refused, and the
 *   table is still there;
 * - a module dropping a column another stream's element row records is
 *   refused, and the column is still there;
 * - a plugin whose table name is recorded as another plugin's is refused
 *   before its module is run or adopted, and the row still names the first;
 * - a plugin whose modules own no table passes the boot gate once they apply.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  buildBlankPluginMigration,
  buildPluginMigration,
} from "../../../domains/schema/migrate-create/generate-plugin";
import {
  compareModuleNames,
  migrationChecksum,
  type PluginMigration,
} from "../../../domains/schema/migrate/plugin/plugin-migration";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import { assertPluginSchemaVersionsUsable } from "../../../domains/schema/ownership/schema-version-check";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CORE_TABLE_NAMES } from "../../../schemas/index";
import { createLogger } from "../../utils/logger";
import { runPluginPhase } from "../migrate";

const ALL = ["postgresql", "mysql", "sqlite"] as const;

/** A table with a column another stream can hold. */
const items = defineTable("items", {
  id: col.id(),
  label: col.shortText({ nullable: true }),
});

/**
 * One module for `plugin`, its tables named with `prefix`, generated for
 * every dialect by the real generator — with `extraUp` appended by hand and
 * the module sealed again, as an author edits one.
 */
async function generate(
  plugin: string,
  prefix: string,
  table: ReturnType<typeof defineTable>,
  extraUp: (dialect: (typeof ALL)[number]) => string[] = () => []
): Promise<PluginMigration> {
  const tablesByDialect = {} as Parameters<
    typeof buildPluginMigration
  >[0]["tablesByDialect"];
  for (const dialect of ALL) {
    const built = await buildExtensionSchema({
      dialect,
      coreTableNames: CORE_TABLE_NAMES,
      entities: [],
      pluginPrefixes: new Map([[plugin, prefix]]),
      plugins: [{ owner: { kind: "plugin", id: plugin }, tables: [table] }],
    });
    tablesByDialect[dialect] = built.specs;
  }
  const built = buildPluginMigration({
    pluginName: plugin,
    schemaVersion: 1,
    name: "v1",
    now: new Date(Date.UTC(2026, 9, 8, 10, 0, 0)),
    tablesByDialect,
    existing: [],
  });
  if (!built) throw new Error(`no module generated for ${plugin}`);
  return reseal(built.module, extraUp);
}

/** A module with statements appended to each dialect's UP, sealed again. */
function reseal(
  module: PluginMigration,
  extraUp: (dialect: (typeof ALL)[number]) => string[],
  over: Partial<PluginMigration> = {}
): PluginMigration {
  const { checksum: _sealed, ...content } = { ...module, ...over };
  for (const dialect of ALL) {
    content.dialects = {
      ...content.dialects,
      [dialect]: {
        ...content.dialects[dialect],
        up: [...content.dialects[dialect].up, ...extraUp(dialect)],
      },
    };
  }
  return { ...content, checksum: migrationChecksum(content) };
}

/** `name` quoted as `dialect` quotes a name. */
function quoted(dialect: (typeof ALL)[number], name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describe.each(getConfiguredTestDialects())(
  "plugin migration ownership (%s)",
  dialect => {
    let handle: TestNextly;

    beforeAll(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (!(await handle.adapter.tableExists("nextly_schema_events"))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await handle.adapter.executeQuery(statement);
        }
      }
    });

    afterAll(async () => {
      await handle?.destroy();
    });

    function runPhase(plugin: string, migrations: PluginMigration[]) {
      return runPluginPhase({
        extensionSchema: undefined,
        dialect,
        db: handle.adapter.getDrizzle(),
        adapter: handle.adapter as unknown as Parameters<
          typeof runPluginPhase
        >[0]["adapter"],
        migrationsDir: "unused",
        logger: createLogger({ quiet: true }),
        pluginMigrationSets: [
          { pluginName: plugin, pluginVersion: "1.0.0", migrations },
        ],
      });
    }

    function owners() {
      return new SchemaOwnersRepository(handle.adapter.getDrizzle(), dialect);
    }

    // In the plugin's run order: the ledger is read unordered, and rows of
    // one run can share a start time at the server's timestamp precision.
    async function ledgerFor(plugin: string) {
      const prefix = `plugin:${plugin}/`;
      return (
        await new SchemaEventsRepository(
          handle.adapter.getDrizzle(),
          dialect
        ).listFileApplies()
      )
        .filter(row => (row.filename ?? "").startsWith(prefix))
        .sort((a, b) =>
          compareModuleNames(
            (a.filename ?? "").slice(prefix.length),
            (b.filename ?? "").slice(prefix.length)
          )
        );
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = (await handle.adapter.executeQuery(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'${dialect === "mysql" ? " AND table_schema = DATABASE()" : ""}`
      )) as Array<Record<string, unknown>>;
      return rows.map(row => String(row.name ?? row.NAME)).sort();
    }

    it("refuses a plugin module dropping a table no owner row claims", async () => {
      // A table from before the registry, as a collection's is: no row.
      await handle.adapter.executeQuery(
        `CREATE TABLE ${quoted(dialect, "dc_ledger")} (id varchar(36) PRIMARY KEY)`
      );
      const dropper = await generate("dropx", "dropx", items, d => [
        `DROP TABLE ${quoted(d, "dc_ledger")}`,
      ]);

      await expect(runPhase("dropx", [dropper])).rejects.toMatchObject({
        code: "DROP_OF_FOREIGN_TABLE",
      });
      expect(await handle.adapter.tableExists("dc_ledger")).toBe(true);
      expect(await ledgerFor("dropx")).toEqual([]);
    });

    it("refuses a module dropping a column another stream's element row records", async () => {
      const v1 = await generate("hostc", "hostc", items);
      await runPhase("hostc", [v1]);
      // The app's claim on the column, as `syncElementOwners` records an
      // element the app contributes to a plugin's table.
      await owners().upsert([
        {
          tableName: "hostc__items",
          elementKind: "column",
          elementName: "label",
          ownerKind: "app",
          ownerId: "app",
          migratedBy: "app",
          ownerVersion: null,
          schemaVersion: null,
          state: "active",
        },
      ]);
      // Its own statements only: v1's CREATE in the same list would make the
      // table one the list itself created.
      const v2 = reseal(
        v1,
        d => [
          `ALTER TABLE ${quoted(d, "hostc__items")} DROP COLUMN ${quoted(d, "label")}`,
        ],
        {
          name: "v2",
          schemaVersion: 2,
          before: v1.snapshot,
          dialects: {
            postgresql: { up: [], down: [] },
            mysql: { up: [], down: [] },
            sqlite: { up: [], down: [] },
          },
        }
      );

      await expect(runPhase("hostc", [v1, v2])).rejects.toMatchObject({
        code: "DROP_OF_FOREIGN_TABLE",
      });
      expect(await columnsOf("hostc__items")).toContain("label");
      expect((await ledgerFor("hostc")).map(row => row.filename)).toEqual([
        `plugin:hostc/${v1.name}`,
      ]);
    });

    it("refuses a module that creates an existing table's name before dropping it", async () => {
      // The CREATE cannot have made `hostk__items`, which is already there:
      // the drop after it would take the table another plugin holds.
      await runPhase("hostk", [await generate("hostk", "hostk", items)]);
      const sneak = await generate("sneak", "sneak", items, d => [
        `CREATE TABLE ${quoted(d, "hostk__items")} (id INT)`,
        `DROP TABLE ${quoted(d, "hostk__items")}`,
      ]);

      await expect(runPhase("sneak", [sneak])).rejects.toMatchObject({
        code: "DROP_OF_FOREIGN_TABLE",
        logContext: { table: "hostk__items", belongsTo: "plugin:hostk" },
      });
      expect(await handle.adapter.tableExists("hostk__items")).toBe(true);
      expect(await ledgerFor("sneak")).toEqual([]);
    });

    it("runs a fresh install's modules in one run: a scratch table, then a drop of an earlier module's table", async () => {
      const v1 = await generate("scrt", "scrt", items, d => [
        `CREATE TABLE ${quoted(d, "scrt__scratch")} (id INT)`,
        `DROP TABLE ${quoted(d, "scrt__scratch")}`,
      ]);
      // The later module drops the table the earlier one created, which the
      // earlier module's owner row makes this plugin's by then.
      const empty = { tables: [] };
      const v2 = reseal(v1, d => [`DROP TABLE ${quoted(d, "scrt__items")}`], {
        name: "v2",
        schemaVersion: 2,
        before: v1.snapshot,
        snapshot: { postgresql: empty, mysql: empty, sqlite: empty },
        dialects: {
          postgresql: { up: [], down: [] },
          mysql: { up: [], down: [] },
          sqlite: { up: [], down: [] },
        },
      });

      await runPhase("scrt", [v1, v2]);
      expect((await ledgerFor("scrt")).map(row => row.filename)).toEqual([
        `plugin:scrt/${v1.name}`,
        `plugin:scrt/${v2.name}`,
      ]);
      expect(await handle.adapter.tableExists("scrt__scratch")).toBe(false);
      expect(await handle.adapter.tableExists("scrt__items")).toBe(false);
    });

    it("refuses a plugin taking over a table recorded as another plugin's", async () => {
      // Two plugins whose tables share a prefix: the second's module finds a
      // table already in its target shape, which the reconcile would adopt.
      const first = await generate("olda", "shared", items);
      await runPhase("olda", [first]);
      const second = await generate("newb", "shared", items);

      await expect(runPhase("newb", [second])).rejects.toMatchObject({
        code: "CONFLICT",
      });
      const row = (await owners().read(["shared__items"])).find(
        record => (record.elementKind ?? "table") === "table"
      );
      expect(row?.ownerId).toBe("olda");
      expect(await ledgerFor("newb")).toEqual([]);
    });

    it("passes the boot gate for a plugin whose modules own no table", async () => {
      // A data-only plugin: one blank module, as `migrate:create --plugin
      // --blank` writes it, and no table for an owner row to name.
      const blank = buildBlankPluginMigration({
        pluginName: "datab",
        schemaVersion: 1,
        name: "backfill",
        now: new Date(Date.UTC(2026, 9, 8, 11, 0, 0)),
        existing: [],
      });
      await runPhase("datab", [blank]);

      expect(
        (await owners().read()).filter(row => row.ownerId === "datab")
      ).toEqual([]);
      await expect(
        assertPluginSchemaVersionsUsable({
          plugins: [{ name: "datab", schemaVersion: 1, migrations: [blank] }],
          readLedger: () =>
            new SchemaEventsRepository(
              handle.adapter.getDrizzle(),
              dialect
            ).listFileApplies(),
          ledgerExists: () =>
            handle.adapter.tableExists("nextly_schema_events"),
          production: true,
          warn: () => {},
        })
      ).resolves.toBeUndefined();
    });
  }
);
