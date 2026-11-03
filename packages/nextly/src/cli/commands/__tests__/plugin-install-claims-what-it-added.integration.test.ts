/**
 * `nextly plugins install` of a plugin that adds a column and an index to
 * the table of a plugin it depends on, and the ownership it records, on
 * every configured dialect, through the command's entry point.
 *
 * Its module runs outside a transaction, so its ledger row and its owner
 * rows are written one after the other. A process that stops between the
 * two leaves the module recorded applied and nothing claimed. Each run of
 * the install must leave the plugin owning its own table AND the elements
 * it added to the other plugin's table, the second time as much as the
 * first, since the run after a stop skips the module it recorded.
 *
 * Only the config is faked: the adapter is a real one over a throwaway
 * database, and both plugins' modules come from the real generator.
 */
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import type { SchemaHook } from "../../../domains/schema/extension/draft";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { contributedElementsOf } from "../../../domains/schema/migrate-create/app-stream";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import type { PluginMigration } from "../../../domains/schema/migrate/plugin/plugin-migration";
import type { OwnerRecord } from "../../../domains/schema/ownership/owner-registry";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import type { TableSpec } from "../../../domains/schema/pipeline/diff/types";
import { MYSQL_MIGRATE_LOCK_NAME } from "../../../domains/schema/pipeline/locks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CORE_TABLE_NAMES } from "../../../schemas/index";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runPluginInstall } from "../plugin-lifecycle-runner";

const ALL = ["postgresql", "mysql", "sqlite"] as const;
type Dialect = (typeof ALL)[number];

const run = vi.hoisted(() => ({
  dialect: "sqlite" as string,
  adapter: undefined as unknown,
  plugins: [] as unknown[],
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async () => {
    const config = {
      db: { migrationsDir: "./migrations" },
      plugins: run.plugins,
    };
    return { config, appConfig: config, pluginConsent: undefined };
  },
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: run.dialect,
    databaseUrl: "unused",
  }),
  // The test's adapter, kept connected after the command so the test can
  // read the database.
  createCliAdapter: async () =>
    Object.assign(Object.create(run.adapter as object) as object, {
      disconnect: async () => {},
    }),
}));

const context = {
  logger: createLogger({ quiet: true }),
} as unknown as CommandContext;

const HOST = "@acme/hs";
const ADDER = "@acme/ad";

const items = defineTable("items", {
  id: col.id(),
  label: col.shortText({ nullable: true }),
});
const marks = defineTable("marks", { id: col.id() });
/** What the second plugin adds to the first's table: a column, indexed. */
const addToItems: SchemaHook = ({ schema }) => {
  schema.extendTable("hs__items", {
    columns: { extra: col.shortText({ nullable: true }) },
    indexes: [{ columns: ["extra"] }],
  });
};

/** Both plugins' schema compiled for `dialect` by the real builder. */
function compile(dialect: Dialect, withAdder: boolean) {
  return buildExtensionSchema({
    dialect,
    coreTableNames: CORE_TABLE_NAMES,
    entities: [],
    pluginPrefixes: new Map([
      [HOST, "hs"],
      [ADDER, "ad"],
    ]),
    dependencies: new Map([[ADDER, new Set([HOST])]]),
    plugins: [
      { owner: { kind: "plugin", id: HOST }, tables: [items] },
      ...(withAdder
        ? [
            {
              owner: { kind: "plugin" as const, id: ADDER },
              tables: [marks],
              extend: [addToItems],
            },
          ]
        : []),
    ],
  });
}

type ByDialect<T> = Record<Dialect, T>;

/**
 * Each plugin's one module, as `migrate:create --plugin` builds it: the
 * second's carries its own table and what it adds to the first's, and runs
 * outside a transaction.
 */
async function generateModules(): Promise<{
  host: PluginMigration;
  adder: PluginMigration;
}> {
  const hostTables = {} as ByDialect<TableSpec[]>;
  const adderTables = {} as ByDialect<TableSpec[]>;
  const contributed = {} as ByDialect<TableSpec[]>;
  const baseline = {} as ByDialect<TableSpec[]>;
  const contributions = {} as NonNullable<
    Parameters<typeof buildPluginMigration>[0]["contributions"]
  >;
  for (const dialect of ALL) {
    const alone = await compile(dialect, false);
    const both = await compile(dialect, true);
    hostTables[dialect] = alone.specs.filter(spec => spec.name === "hs__items");
    baseline[dialect] = hostTables[dialect];
    adderTables[dialect] = both.specs.filter(spec => spec.name === "ad__marks");
    contributed[dialect] = both.specs.filter(spec => spec.name === "hs__items");
    contributions[dialect] = {
      hs__items: contributedElementsOf(
        (both.elementOwners.get("hs__items") ?? []).filter(
          element =>
            element.owner.kind === "plugin" && element.owner.id === ADDER
        )
      ),
    };
  }
  const host = buildPluginMigration({
    pluginName: HOST,
    schemaVersion: 1,
    name: "items",
    now: new Date(Date.UTC(2026, 10, 3, 9, 0, 0)),
    tablesByDialect: hostTables,
    existing: [],
  });
  const adder = buildPluginMigration({
    pluginName: ADDER,
    schemaVersion: 1,
    name: "marks",
    now: new Date(Date.UTC(2026, 10, 3, 10, 0, 0)),
    tablesByDialect: adderTables,
    contributedByDialect: contributed,
    contributedBaselineByDialect: baseline,
    contributions,
    existing: [],
    transaction: false,
  });
  if (!host || !adder) throw new Error("a module was not generated");
  return { host: host.module, adder: adder.module };
}

let modules: { host: PluginMigration; adder: PluginMigration } | undefined;

describe.each(getConfiguredTestDialects())(
  "the ownership a plugin install records (%s)",
  dialect => {
    let handle: TestNextly;
    const db = () => handle.adapter.getDrizzle();

    beforeEach(async () => {
      modules ??= await generateModules();
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await reconcileCore({
        db: db(),
        dialect,
        logger: { info: () => {}, warn: () => {} },
      });
      run.dialect = dialect;
      run.adapter = handle.adapter;
      run.plugins = [
        {
          name: HOST,
          version: "1.0.0",
          contributes: {
            schema: {
              prefix: "hs",
              tables: [items],
              migrations: [modules.host],
            },
          },
        },
        {
          name: ADDER,
          version: "1.0.0",
          dependsOn: { [HOST]: "^1.0.0" },
          contributes: {
            schema: {
              prefix: "ad",
              tables: [marks],
              extend: [addToItems],
              migrations: [modules.adder],
            },
          },
        },
      ];
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await handle?.destroy();
    });

    const install = (name: string) => runPluginInstall(name, {}, context);

    /** The owner rows naming `owner`, as `kind table.name` lines. */
    async function claimsOf(owner: string): Promise<string[]> {
      const rows = await new SchemaOwnersRepository(db(), dialect).read();
      return rows
        .filter(row => row.ownerId === owner)
        .map(
          row =>
            `${row.elementKind ?? "table"} ${row.tableName}${row.elementName ? `.${row.elementName}` : ""} v${String(row.schemaVersion)}`
        )
        .sort();
    }

    /** The newest ledger status of the adding plugin's module. */
    async function adderModuleStatus(): Promise<string[]> {
      const rows = await new SchemaEventsRepository(
        db(),
        dialect
      ).findFileApplies(`plugin:${ADDER}/${modules?.adder.name ?? ""}`);
      return rows.map(row => row.status);
    }

    /** The name the compiler gave the index the adding plugin declares. */
    async function addedIndexName(): Promise<string> {
      const built = await compile(dialect, true);
      const index = (built.elementOwners.get("hs__items") ?? []).find(
        element =>
          element.elementKind === "index" && element.owner.kind === "plugin"
      );
      if (!index) throw new Error("the added index was not compiled");
      return index.elementName;
    }

    /**
     * What a process that died leaves of its connections: none. MySQL's
     * migrate lock belongs to a connection, and a process that throws and
     * carries on, as this test's does, can leave it with an idle pooled
     * connection, so that connection is closed here as the dying process's
     * would be.
     */
    async function endStoppedProcess(): Promise<void> {
      if (dialect !== "mysql") return;
      const mysql = handle.adapter.getDrizzle<{
        execute: (q: unknown) => Promise<unknown>;
      }>();
      const result = await mysql.execute(
        sql`SELECT IS_USED_LOCK(${MYSQL_MIGRATE_LOCK_NAME}) AS holder`
      );
      // mysql2 answers [rows, fields].
      const [held] = (
        Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
      ) as Array<{ holder: number | null }>;
      if (held?.holder) {
        await handle.adapter.executeQuery(`KILL ${String(held.holder)}`);
      }
    }

    /**
     * Stands in for the process dying as it writes the adding plugin's owner
     * rows, after its module ran and was recorded applied: that write and
     * every later ledger write of the run fail, as a dead process writes
     * nothing more.
     */
    function stopAtTheAdderOwnerRows(): void {
      let stopped = false;
      const upsert = SchemaOwnersRepository.prototype.upsert;
      vi.spyOn(SchemaOwnersRepository.prototype, "upsert").mockImplementation(
        function (this: SchemaOwnersRepository, rows: readonly OwnerRecord[]) {
          if (stopped || rows.some(row => row.ownerId === ADDER)) {
            stopped = true;
            return Promise.reject(new Error("process stopped"));
          }
          return upsert.call(this, rows);
        }
      );
      const markFailed = SchemaEventsRepository.prototype.markFailed;
      vi.spyOn(
        SchemaEventsRepository.prototype,
        "markFailed"
      ).mockImplementation(function (
        this: SchemaEventsRepository,
        ...args: Parameters<SchemaEventsRepository["markFailed"]>
      ) {
        if (stopped) return Promise.reject(new Error("process stopped"));
        return markFailed.apply(this, args);
      });
    }

    it("claims its own table and what it added to the other plugin's table", async () => {
      await install(HOST);

      await install(ADDER);

      expect(await claimsOf(ADDER)).toEqual(
        [
          "table ad__marks v1",
          "column hs__items.extra v1",
          `index hs__items.${await addedIndexName()} v1`,
        ].sort()
      );
      // CONTROL: the other plugin's table stays its own.
      expect(await claimsOf(HOST)).toEqual(["table hs__items v1"]);
    });

    it("claims them all when installed again after a run that stopped before its owner rows", async () => {
      await install(HOST);
      stopAtTheAdderOwnerRows();

      await expect(install(ADDER)).rejects.toThrow("process stopped");
      vi.restoreAllMocks();
      await endStoppedProcess();

      // The state the stop left: its module ran and is recorded applied,
      // and nothing it made is claimed.
      expect(await adderModuleStatus()).toEqual(["applied"]);
      expect(await claimsOf(ADDER)).toEqual([]);

      await install(ADDER);

      // Not run a second time: still one attempt, applied.
      expect(await adderModuleStatus()).toEqual(["applied"]);
      expect(await claimsOf(ADDER)).toEqual(
        [
          "table ad__marks v1",
          "column hs__items.extra v1",
          `index hs__items.${await addedIndexName()} v1`,
        ].sort()
      );
      expect(await claimsOf(HOST)).toEqual(["table hs__items v1"]);
    });
  }
);
