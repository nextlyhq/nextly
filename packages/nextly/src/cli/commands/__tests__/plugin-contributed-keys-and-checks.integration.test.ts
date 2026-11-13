/**
 * A plugin adding a foreign key and a check to the table of a plugin it
 * depends on, through `nextly plugins install`, on every configured dialect.
 *
 * The key and the check travel in the contributor's own module and are
 * recorded as its elements, so:
 *
 * - the database enforces both once the contributor is installed;
 * - the table's owner applying a later module of its own leaves them in
 *   place, with their data;
 * - uninstalling the contributor without keeping its data removes exactly
 *   what it added (its column, key and check), and the owner's table and rows
 *   stay.
 *
 * Only the config is faked: the adapter is a real one over a throwaway
 * database, and both plugins' modules come from the real generator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildExtensionSchema } from "../../../domains/schema/extension/build-extension-schema";
import type { SchemaHook } from "../../../domains/schema/extension/draft";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { contributedElementsOf } from "../../../domains/schema/migrate-create/app-stream";
import { buildPluginMigration } from "../../../domains/schema/migrate-create/generate-plugin";
import { reconcileCore } from "../../../domains/schema/migrate/core-reconcile";
import { resolveDataLossConsent } from "../../../domains/schema/migrate/data-loss-consent";
import type { PluginMigration } from "../../../domains/schema/migrate/plugin/plugin-migration";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import type { TableSpec } from "../../../domains/schema/pipeline/diff/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CORE_TABLE_NAMES } from "../../../schemas/index";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import {
  runPluginInstall,
  runPluginUninstall,
} from "../plugin-lifecycle-runner";

const ALL = ["postgresql", "mysql", "sqlite"] as const;
type Dialect = (typeof ALL)[number];
type ByDialect<T> = Record<Dialect, T>;

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

const EVERY_DELETION = resolveDataLossConsent({ flag: true, env: {} });

const HOST = "@acme/kh";
const ADDER = "@acme/ka";

const items = defineTable("items", {
  id: col.id(),
  label: col.shortText({ nullable: true }),
});
/** The host's table once its later module adds a column of its own. */
const itemsWithNote = defineTable("items", {
  id: col.id(),
  label: col.shortText({ nullable: true }),
  note: col.shortText({ nullable: true }),
});
const marks = defineTable("marks", { id: col.id() });

/**
 * What the adder adds to the host's table: a column keyed to its own table,
 * and a check on the host's own column.
 */
const addToItems: SchemaHook = ({ schema }) => {
  schema.extendTable("kh__items", {
    columns: { markId: col.varchar(36, { nullable: true }) },
    foreignKeys: [
      {
        columns: ["markId"],
        references: { table: "ka__marks", columns: ["id"] },
        onDelete: "set null",
      },
    ],
    checks: [{ name: "label_short", sql: "length(label) < 20" }],
  });
};

function compile(
  dialect: Dialect,
  host: ReturnType<typeof defineTable>,
  withAdder: boolean
) {
  return buildExtensionSchema({
    dialect,
    coreTableNames: CORE_TABLE_NAMES,
    entities: [],
    pluginPrefixes: new Map([
      [HOST, "kh"],
      [ADDER, "ka"],
    ]),
    dependencies: new Map([[ADDER, new Set([HOST])]]),
    plugins: [
      { owner: { kind: "plugin", id: HOST }, tables: [host] },
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

/** Each plugin's modules, as `migrate:create --plugin` builds them. */
async function generateModules(): Promise<{
  host: PluginMigration;
  hostNote: PluginMigration;
  adder: PluginMigration;
}> {
  const hostTables = {} as ByDialect<TableSpec[]>;
  const hostNoteTables = {} as ByDialect<TableSpec[]>;
  const adderTables = {} as ByDialect<TableSpec[]>;
  const contributed = {} as ByDialect<TableSpec[]>;
  const baseline = {} as ByDialect<TableSpec[]>;
  const contributions = {} as NonNullable<
    Parameters<typeof buildPluginMigration>[0]["contributions"]
  >;
  for (const dialect of ALL) {
    const alone = await compile(dialect, items, false);
    const both = await compile(dialect, items, true);
    const later = await compile(dialect, itemsWithNote, false);
    hostTables[dialect] = alone.specs.filter(spec => spec.name === "kh__items");
    hostNoteTables[dialect] = later.specs.filter(
      spec => spec.name === "kh__items"
    );
    baseline[dialect] = hostTables[dialect];
    adderTables[dialect] = both.specs.filter(spec => spec.name === "ka__marks");
    contributed[dialect] = both.specs.filter(spec => spec.name === "kh__items");
    contributions[dialect] = {
      kh__items: contributedElementsOf(
        (both.elementOwners.get("kh__items") ?? []).filter(
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
    now: new Date(Date.UTC(2026, 10, 13, 9, 0, 0)),
    tablesByDialect: hostTables,
    existing: [],
  });
  if (!host) throw new Error("the host's module was not generated");
  const hostNote = buildPluginMigration({
    pluginName: HOST,
    schemaVersion: 2,
    name: "note",
    now: new Date(Date.UTC(2026, 10, 13, 11, 0, 0)),
    tablesByDialect: hostNoteTables,
    existing: [host.module],
  });
  const adder = buildPluginMigration({
    pluginName: ADDER,
    schemaVersion: 1,
    name: "marks",
    now: new Date(Date.UTC(2026, 10, 13, 10, 0, 0)),
    tablesByDialect: adderTables,
    contributedByDialect: contributed,
    contributedBaselineByDialect: baseline,
    contributions,
    existing: [],
  });
  if (!hostNote || !adder) throw new Error("a module was not generated");
  return { host: host.module, hostNote: hostNote.module, adder: adder.module };
}

let modules: Awaited<ReturnType<typeof generateModules>> | undefined;

const MARK = "00000000-0000-7000-8000-000000000001";
const ITEM = (n: number) =>
  `00000000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;
const MISSING = "00000000-0000-7000-8000-00000000ffff";

describe.each(getConfiguredTestDialects())(
  "keys and checks a plugin adds to a dependency's table (%s)",
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
      configure([modules.host], items);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await handle?.destroy();
    });

    function configure(
      hostMigrations: PluginMigration[],
      hostTable: ReturnType<typeof defineTable>
    ): void {
      if (!modules) throw new Error("modules were not generated");
      run.plugins = [
        {
          name: HOST,
          version: "1.0.0",
          contributes: {
            schema: {
              prefix: "kh",
              tables: [hostTable],
              migrations: hostMigrations,
            },
          },
        },
        {
          name: ADDER,
          version: "1.0.0",
          dependsOn: { [HOST]: "^1.0.0" },
          contributes: {
            schema: {
              prefix: "ka",
              tables: [marks],
              extend: [addToItems],
              migrations: [modules.adder],
            },
          },
        },
      ];
    }

    const exec = (statement: string) => handle.adapter.executeQuery(statement);
    const install = (name: string) => runPluginInstall(name, {}, context);

    async function insertItem(
      n: number,
      label: string,
      markId?: string
    ): Promise<void> {
      await exec(
        markId === undefined
          ? `INSERT INTO kh__items (id, label) VALUES ('${ITEM(n)}', '${label}')`
          : `INSERT INTO kh__items (id, label, mark_id) VALUES ('${ITEM(n)}', '${label}', '${markId}')`
      );
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = (await exec(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'${dialect === "mysql" ? " AND table_schema = DATABASE()" : " AND table_schema = current_schema()"}`
      )) as Array<Record<string, unknown>>;
      return rows.map(row => String(row.name ?? row.NAME)).sort();
    }

    /** The adder's owner rows, as `kind table.element` lines. */
    async function adderClaims(): Promise<string[]> {
      const rows = await new SchemaOwnersRepository(db(), dialect).read();
      return rows
        .filter(row => row.ownerId === ADDER)
        .map(row => `${row.elementKind ?? "table"} ${row.tableName}`)
        .sort();
    }

    async function installBoth(): Promise<void> {
      await install(HOST);
      await install(ADDER);
      await exec(`INSERT INTO ka__marks (id) VALUES ('${MARK}')`);
    }

    it("records the key and the check as the adder's elements", async () => {
      await installBoth();
      expect(await adderClaims()).toEqual(
        [
          "check kh__items",
          "column kh__items",
          "fk kh__items",
          "table ka__marks",
        ].sort()
      );
    });

    it("enforces both on the host's table", async () => {
      await installBoth();
      await insertItem(1, "short", MARK);
      await expect(insertItem(2, "short", MISSING)).rejects.toThrow();
      await expect(
        insertItem(3, "a label far longer than the check allows")
      ).rejects.toThrow();
    });

    it("keeps both, and the rows, when the host applies a later module", async () => {
      await installBoth();
      await insertItem(1, "short", MARK);
      if (!modules) throw new Error("modules were not generated");
      configure([modules.host, modules.hostNote], itemsWithNote);
      await install(HOST);
      expect(await columnsOf("kh__items")).toContain("note");
      expect(await columnsOf("kh__items")).toContain("mark_id");
      await expect(insertItem(2, "short", MISSING)).rejects.toThrow();
      await expect(
        insertItem(3, "a label far longer than the check allows")
      ).rejects.toThrow();
      const rows = (await exec(
        `SELECT mark_id FROM kh__items WHERE id = '${ITEM(1)}'`
      )) as Array<Record<string, unknown>>;
      expect(String(rows[0]?.mark_id ?? rows[0]?.MARK_ID)).toBe(MARK);
    });

    it("removes exactly what the adder added when it is uninstalled", async () => {
      await installBoth();
      await insertItem(1, "short", MARK);
      await runPluginUninstall(
        ADDER,
        { keepData: false, yes: false, consent: EVERY_DELETION },
        context
      );
      expect(await columnsOf("kh__items")).toEqual(["id", "label"]);
      // The check went with its contributor; the host's row stayed.
      await insertItem(2, "a label far longer than the check allows");
      const rows = (await exec(`SELECT id FROM kh__items`)) as unknown[];
      expect(rows).toHaveLength(2);
      expect(await adderClaims()).toEqual([]);
    });
  }
);
