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
  const operationCounts = {} as Record<SupportedDialect, number>;
  let totalOperations = 0;

  for (const dialect of ALL_DIALECTS) {
    const previousTables = previous?.snapshot[dialect]?.tables ?? [];
    const desiredTables = args.tablesByDialect[dialect] ?? [];
    const { statements, operations } = renderDialect(
      previousTables,
      desiredTables,
      dialect
    );
    dialects[dialect] = statements;
    snapshot[dialect] = { tables: desiredTables };
    before[dialect] = { tables: previousTables };
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
