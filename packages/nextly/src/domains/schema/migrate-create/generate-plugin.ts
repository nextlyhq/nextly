/**
 * `nextly migrate:create --plugin` — generate the migration MODULE a plugin
 * ships instead of loose `.sql` files.
 *
 * The diff-and-render work goes through exactly the primitives the app path
 * uses (`diffSnapshots` → `generateSQL` → `buildInverseOperations`): a plugin
 * migration that rendered through a second implementation could drift from the
 * app's for the same table shape, and the divergence would surface as a
 * dialect-specific failure in a plugin author's CI, far from its cause.
 *
 * Not shared with the app path: companion `_locales` planning and rename
 * prompts. A plugin's own tables are never localized (the DSL has no localized
 * columns), and a renamed plugin table is a drop plus an add until rename
 * detection grows an owner-aware mode — recorded rather than half-implemented.
 *
 * @module domains/schema/migrate-create/generate-plugin
 * @since 1.0.0
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import {
  migrationChecksum,
  orderedMigrations,
  type DialectStatements,
  type PluginMigration,
} from "../migrate/plugin/plugin-migration";
import { diffSnapshots } from "../pipeline/diff/diff";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";
import { generateSQL } from "../pipeline/sql-templates/index";

import { buildInverseOperations } from "./down-generator";
import { formatTimestamp, slugify } from "./format-file";

const ALL_DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

export interface BuildPluginMigrationArgs {
  pluginName: string;
  /** The plugin's declared schemaVersion as of this generation. */
  schemaVersion: number;
  /** Slug-cased migration name (CLI's --name). */
  name: string;
  /** Override the timestamp for tests. Production callers omit. */
  now?: Date;
  /** The plugin's own tables per dialect, compiled by `buildExtensionSchema`. */
  tablesByDialect: Record<SupportedDialect, TableSpec[]>;
  /**
   * Tables another owner declares, carrying elements THIS plugin contributed
   * — a column added to a declared dependency's table. Diffed alongside the
   * owned tables so the contributed element ships in this plugin's module,
   * and kept out of `snapshot` so the apply path never records this plugin as
   * the table's owner.
   */
  contributedByDialect?: Record<SupportedDialect, TableSpec[]>;
  /**
   * The same foreign tables WITHOUT this plugin's contributions — the shape
   * their own owner declares.
   *
   * The baseline for the FIRST module that contributes to them. Without it the
   * diff would see a table appearing from nothing and emit `CREATE TABLE` for
   * a table this plugin does not own; later modules take their baseline from
   * the previous module's `contributed` instead.
   */
  contributedBaselineByDialect?: Record<SupportedDialect, TableSpec[]>;
  /** Modules the plugin already ships. */
  existing: readonly PluginMigration[];
}

export interface BuiltPluginMigration {
  module: PluginMigration;
  operationCounts: Record<SupportedDialect, number>;
}

/**
 * Render one dialect's change against the previous module's snapshot through
 * the shared diff-and-render core — the same call sequence
 * `generateMigration` makes for the app, so the two paths cannot disagree
 * about what a `TableSpec` renders to.
 */
function renderDialect(
  previousTables: readonly TableSpec[],
  desiredTables: readonly TableSpec[],
  dialect: SupportedDialect
): { statements: DialectStatements; operations: Operation[] } {
  const previous: NextlySchemaSnapshot = { tables: [...previousTables] };
  const desired: NextlySchemaSnapshot = { tables: [...desiredTables] };
  const operations = diffSnapshots(previous, desired);
  const up = operations.map(op => generateSQL(op, dialect));
  // Inverting the ops — not re-diffing — keeps a forward rename-shaped change
  // reversible in principle and always emits the exact inverse of what ran.
  const down = buildInverseOperations(operations, previous).map(op =>
    generateSQL(op, dialect)
  );
  return { statements: { up, down }, operations };
}

/**
 * Build the next migration module for a plugin. Returns null when no dialect
 * has operations (the CLI's "no changes detected" exit-2 contract).
 *
 * Throws `PLUGIN_SCHEMA_VERSION_NOT_ADVANCED` when `schemaVersion` does not
 * move past the previous module's: module order is name-sorted and the runner
 * takes the version from the LAST module, so an un-bumped regeneration would
 * silently describe a schema the plugin's manifest no longer claims.
 */
/**
 * A dependency's CURRENT tables, re-carrying this plugin's earlier elements.
 *
 * "This plugin's" is decided structurally rather than from an owner field the
 * spec does not carry: anything present in the previous module's view of the
 * table and absent from the dependency's own current shape was put there by
 * this plugin, because nothing else writes into that stored view.
 */
function withPriorContributions(
  current: readonly TableSpec[],
  previous: readonly TableSpec[]
): TableSpec[] {
  const previousByName = new Map(previous.map(table => [table.name, table]));
  return current.map(table => {
    const before = previousByName.get(table.name);
    if (!before) return table;

    const currentColumns = new Set(table.columns.map(column => column.name));
    const mineColumns = before.columns.filter(
      column => !currentColumns.has(column.name)
    );
    const currentIndexes = new Set(
      (table.indexes ?? []).map(index => index.name)
    );
    const mineIndexes = (before.indexes ?? []).filter(
      index => !currentIndexes.has(index.name)
    );
    if (mineColumns.length === 0 && mineIndexes.length === 0) return table;

    return {
      ...table,
      columns: [...table.columns, ...mineColumns],
      indexes: [...(table.indexes ?? []), ...mineIndexes],
    };
  });
}

export function buildPluginMigration(
  args: BuildPluginMigrationArgs
): BuiltPluginMigration | null {
  const previous = lastModule(args.existing);
  if (previous && args.schemaVersion <= previous.schemaVersion) {
    throw new NextlyError({
      code: "PLUGIN_SCHEMA_VERSION_NOT_ADVANCED",
      publicMessage: `The plugin's schemaVersion must move past ${previous.schemaVersion} before new migrations can be generated (it is ${args.schemaVersion}).`,
      logContext: {
        plugin: args.pluginName,
        previousSchemaVersion: previous.schemaVersion,
        declared: args.schemaVersion,
      },
    });
  }

  const dialects = {} as Record<SupportedDialect, DialectStatements>;
  const snapshot = {} as Record<SupportedDialect, { tables: TableSpec[] }>;
  const before = {} as Record<SupportedDialect, { tables: TableSpec[] }>;
  const contributed = {} as Record<SupportedDialect, { tables: TableSpec[] }>;
  const contributedBefore = {} as Record<
    SupportedDialect,
    { tables: TableSpec[] }
  >;
  const operationCounts = {} as Record<SupportedDialect, number>;
  let totalOperations = 0;

  for (const dialect of ALL_DIALECTS) {
    const previousTables = previous?.snapshot[dialect]?.tables ?? [];
    const desiredTables = args.tablesByDialect[dialect] ?? [];
    const desiredContributed = args.contributedByDialect?.[dialect] ?? [];
    // The previous module's view of those foreign tables if there is one, and
    // their own owner's shape otherwise. Taking the previous module's view is
    // what makes a regeneration emit nothing when nothing changed: a fresh
    // baseline every time would re-emit the same ADD COLUMN forever.
    // The dependency as it is NOW, carrying only the elements THIS plugin
    // contributed in earlier modules.
    //
    // Taking the previous module's `contributed` wholesale was wrong: it is
    // the dependency's table as it looked THEN, so a column the dependency has
    // since added to its own table appeared only on the desired side and came
    // out as this plugin's addition. Worse, the stored before/after snapshots
    // then described a table that no longer matched the live one either side
    // of the dependency's own migration, and the upgrade stopped as drift.
    //
    // Rebasing keeps both properties: the dependency's own columns are
    // identical on both sides and produce nothing, while this plugin's earlier
    // contributions stay on the baseline so they are not proposed twice.
    const previousContributed = withPriorContributions(
      args.contributedBaselineByDialect?.[dialect] ?? [],
      previous?.contributed?.[dialect]?.tables ?? []
    );

    // ONE diff over the union. A foreign table appears on both sides, so only
    // the elements this plugin added to it come out as operations; its own
    // columns are identical either side and produce nothing.
    const { statements, operations } = renderDialect(
      [...previousTables, ...previousContributed],
      [...desiredTables, ...desiredContributed],
      dialect
    );
    dialects[dialect] = statements;
    snapshot[dialect] = { tables: desiredTables };
    before[dialect] = { tables: previousTables };
    contributed[dialect] = { tables: desiredContributed };
    contributedBefore[dialect] = { tables: previousContributed };
    operationCounts[dialect] = operations.length;
    totalOperations += operations.length;
  }

  if (totalOperations === 0) return null;

  const now = args.now ?? new Date();
  const module: PluginMigration = {
    name: `${formatTimestamp(now)}_${slugify(args.name)}`,
    schemaVersion: args.schemaVersion,
    checksum: migrationChecksum(dialects),
    dialects,
    snapshot,
    before,
    contributed,
    contributedBefore,
  };
  return { module, operationCounts };
}

function lastModule(
  existing: readonly PluginMigration[]
): PluginMigration | undefined {
  return orderedMigrations(existing).at(-1);
}

function moduleVariable(name: string): string {
  return `m${name.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/** The module file's content, generated — never hand-edited. */
export function formatPluginMigrationModule(module: PluginMigration): string {
  return [
    "/**",
    " * Generated by `nextly migrate:create --plugin`. Edit the plugin's",
    " * schema and regenerate — a hand edit fails the module's own checksum.",
    " */",
    'import type { PluginMigration } from "@nextlyhq/plugin-sdk/schema";',
    "",
    `export default ${JSON.stringify(
      module,
      null,
      2
    )} satisfies PluginMigration;`,
    "",
  ].join("\n");
}

/** The `index.ts` barrel, rewritten whole on every generation. */
export function formatPluginMigrationsIndex(
  modules: readonly PluginMigration[]
): string {
  const ordered = orderedMigrations(modules);
  const imports = ordered
    .map(m => `import ${moduleVariable(m.name)} from "./${m.name}";`)
    .join("\n");
  const list = ordered.map(m => moduleVariable(m.name)).join(",\n  ");
  return [
    "/**",
    " * Generated by `nextly migrate:create --plugin`. Rewritten on every",
    " * generation; the runner sorts by module name anyway, so a hand reorder",
    " * changes nothing.",
    " */",
    imports,
    "",
    "export const migrations = [",
    `  ${list},`,
    "];",
    "",
  ].join("\n");
}

export interface GeneratePluginMigrationArgs extends BuildPluginMigrationArgs {
  /** The plugin's `src/migrations` directory. */
  migrationsDir: string;
}

export interface GeneratePluginMigrationResult {
  modulePath: string;
  indexPath: string;
  moduleName: string;
  operationCounts: Record<SupportedDialect, number>;
}

/**
 * Build and write the module plus the rewritten barrel. Returns null when
 * there is nothing to migrate (the CLI exits 2 for that, as the app path
 * does).
 */
export async function generatePluginMigration(
  args: GeneratePluginMigrationArgs
): Promise<GeneratePluginMigrationResult | null> {
  const built = buildPluginMigration(args);
  if (!built) return null;

  await mkdir(args.migrationsDir, { recursive: true });
  const modulePath = resolve(args.migrationsDir, `${built.module.name}.ts`);
  await writeFile(
    modulePath,
    formatPluginMigrationModule(built.module),
    "utf-8"
  );

  const indexPath = resolve(args.migrationsDir, "index.ts");
  await writeFile(
    indexPath,
    formatPluginMigrationsIndex([...args.existing, built.module]),
    "utf-8"
  );

  return {
    modulePath,
    indexPath,
    moduleName: built.module.name,
    operationCounts: built.operationCounts,
  };
}
