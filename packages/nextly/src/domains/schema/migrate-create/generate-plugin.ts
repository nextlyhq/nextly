/**
 * `nextly migrate:create --plugin` — generate the migration MODULE a plugin
 * ships instead of loose `.sql` files.
 *
 * The diff-and-render work goes through exactly the primitives the app path
 * uses (`diffSnapshots` → `generateStatements` → `buildInverseOperations`): a plugin
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
  type ContributionsByDialect,
  type DialectStatements,
  type MigrationContent,
  type PluginMigration,
} from "../migrate/plugin/plugin-migration";
import { recordedContributions } from "../migrate/plugin/recorded-contributions";
import { diffSnapshots } from "../pipeline/diff/diff";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";
import { withForeignKeysLiftedForTypeChanges } from "../pipeline/foreign-key-lift";
import { generateStatements } from "../pipeline/sql-templates/index";

import { foreignTableSides, NO_ELEMENTS } from "./app-stream";
import { withCyclicForeignKeysSplit } from "./cyclic-foreign-keys";
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
   * Every table this plugin does not own, as its own owner declares it —
   * without this plugin's contributions.
   *
   * Both sides of the diff are built on it, so the owner's own changes are
   * identical either side and only this plugin's elements come out as
   * operations. Every foreign table rather than only the contributed ones,
   * because a table this plugin has STOPPED contributing to still needs a
   * baseline for its elements' removal to be emitted.
   */
  contributedBaselineByDialect?: Record<SupportedDialect, TableSpec[]>;
  /**
   * Which elements of `contributedByDialect`'s tables are this plugin's, per
   * dialect and by table. Recorded in the module for the next generation.
   */
  contributions?: ContributionsByDialect;
  /** Modules the plugin already ships. */
  existing: readonly PluginMigration[];
  /**
   * `false` writes a module that runs outside a transaction, statement by
   * statement (`PluginMigration.transaction`). Absent, the module runs in one
   * and carries no `transaction` field.
   */
  transaction?: boolean;
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
  // On MySQL, every existing foreign key a type change covers is lifted
  // around it — the transform `migrate:create` applies to the app's stream.
  const operations = withCyclicForeignKeysSplit(
    withForeignKeysLiftedForTypeChanges(
      diffSnapshots(previous, desired),
      previous.tables,
      dialect
    ),
    dialect,
    previous.tables
  );
  // Rendered as lists through `generateStatements`, as the app's file is: on
  // SQLite a check or foreign-key change is a rebuild of its table to the
  // schema each direction leads to, so a direction is not one statement per
  // operation there.
  const up = generateStatements(operations, dialect, desired.tables);
  // Inverting the ops — not re-diffing — keeps a forward rename-shaped change
  // reversible in principle and always emits the exact inverse of what ran.
  const down = generateStatements(
    withCyclicForeignKeysSplit(
      buildInverseOperations(operations, previous),
      dialect,
      desired.tables
    ),
    dialect,
    previous.tables
  );
  return { statements: { up, down }, operations };
}

/** The tables and columns a list of operations drops, by name. */
function droppedTablesAndColumns(operations: readonly Operation[]): string[] {
  return operations.flatMap(operation => {
    if (operation.type === "drop_table") return [operation.tableName];
    if (operation.type === "drop_column") {
      return [`${operation.tableName}.${operation.columnName}`];
    }
    return [];
  });
}

/**
 * Refuse a module that drops a table or column this plugin created.
 *
 * Every table and column the previous side holds was created by this
 * plugin's earlier modules: its own tables, and on a foreign table only the
 * elements it contributed, since both sides of that diff share the rest. The
 * diff cannot tell a rename from a drop and an add, so dropping one here
 * loses its rows in production without anyone having asked to. The developer
 * writes the rename, or the deliberate drop, by hand.
 */
function assertNothingCreatedIsDropped(
  pluginName: string,
  drops: ReadonlySet<string>
): void {
  if (drops.size === 0) return;
  const named = [...drops].sort();
  const one = named.length === 1;
  throw new NextlyError({
    code: "PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA",
    publicMessage:
      `This migration would drop ${named.join(", ")}, which an earlier migration of plugin "${pluginName}" created, and lose ${one ? "its" : "their"} rows. ` +
      `If ${one ? "it was" : "they were"} renamed, write the rename as a migration by hand; if the drop is deliberate, write the drop by hand.`,
    logContext: { plugin: pluginName, drops: named },
  });
}

/**
 * Refuse a module whose schemaVersion does not move past the previous one's:
 * module order is name-sorted and the runner takes the version from the LAST
 * module, so an un-bumped module would describe a schema the plugin's
 * manifest no longer claims.
 */
function assertSchemaVersionAdvanced(
  args: Pick<BuildPluginMigrationArgs, "pluginName" | "schemaVersion">,
  previous: PluginMigration | undefined
): void {
  if (!previous || args.schemaVersion > previous.schemaVersion) return;
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

/**
 * Build the next migration module for a plugin. Returns null when no dialect
 * has operations (the CLI's "no changes detected" exit-2 contract), whatever
 * the declared schemaVersion.
 *
 * Throws `PLUGIN_SCHEMA_VERSION_NOT_ADVANCED` when there are changes and
 * `schemaVersion` does not
 * move past the previous module's: module order is name-sorted and the runner
 * takes the version from the LAST module, so an un-bumped regeneration would
 * silently describe a schema the plugin's manifest no longer claims.
 */
export function buildPluginMigration(
  args: BuildPluginMigrationArgs
): BuiltPluginMigration | null {
  const previous = lastModule(args.existing);

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
  // Tables and columns the diff would drop, across every dialect, by name.
  const drops = new Set<string>();
  const contributions: ContributionsByDialect = {};

  for (const dialect of ALL_DIALECTS) {
    const previousTables = previous?.snapshot[dialect]?.tables ?? [];
    const desiredTables = args.tablesByDialect[dialect] ?? [];
    // The foreign tables, both sides built on each one's CURRENT declaration
    // and differing only in this plugin's elements — so a column the
    // dependency added or removed on its own produces nothing here, and one
    // this plugin withdrew is dropped. The same derivation the app stream
    // uses; see `foreignTableSides`.
    const sides = foreignTableSides({
      previousCopies: new Map(
        (previous?.contributed?.[dialect]?.tables ?? []).map(table => [
          table.name,
          table,
        ])
      ),
      previousContributions: recordedContributions(args.existing, dialect),
      contributed: new Map(
        (args.contributedByDialect?.[dialect] ?? []).map(spec => [
          spec.name,
          {
            spec,
            elements: args.contributions?.[dialect]?.[spec.name] ?? NO_ELEMENTS,
          },
        ])
      ),
      baselines: new Map(
        (args.contributedBaselineByDialect?.[dialect] ?? []).map(table => [
          table.name,
          table,
        ])
      ),
    });
    const previousContributed = [...sides.before.values()];
    const desiredContributed = [...sides.after.values()];
    if (Object.keys(sides.contributions).length > 0) {
      contributions[dialect] = sides.contributions;
    }

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
    for (const dropped of droppedTablesAndColumns(operations)) {
      drops.add(dropped);
    }
  }

  assertNothingCreatedIsDropped(args.pluginName, drops);
  if (totalOperations === 0) return null;
  // After the diff, so a plugin whose schema matches its last module reports
  // "no changes" whatever its schemaVersion: the version only has to move
  // when there is a module to give it to.
  assertSchemaVersionAdvanced(args, previous);

  const now = args.now ?? new Date();
  // Present only when there are some, so a module that contributes nothing
  // stays byte-identical to one generated before contributions were recorded.
  const recorded =
    Object.keys(contributions).length > 0 ? { contributions } : {};
  const content: MigrationContent = {
    name: `${formatTimestamp(now)}_${slugify(args.name)}`,
    schemaVersion: args.schemaVersion,
    ...runMode(args.transaction),
    dialects,
    snapshot,
    before,
    contributed,
    contributedBefore,
    ...recorded,
  };
  // Sealed over the whole content — name, schema version, SQL and every
  // snapshot side — because the runner acts on all of them: the name is the
  // ledger key, the version is recorded on the owner rows, and the snapshots
  // decide whether the module is adopted without its SQL running. Name and
  // version are listed first so the emitted module reads in that order.
  const { name, schemaVersion, ...body } = content;
  const module: PluginMigration = {
    name,
    schemaVersion,
    checksum: migrationChecksum(content),
    ...body,
  };
  return { module, operationCounts };
}

function lastModule(
  existing: readonly PluginMigration[]
): PluginMigration | undefined {
  return orderedMigrations(existing).at(-1);
}

/**
 * The `transaction` field a module carries: present only as `false`, so a
 * module that runs in a transaction stays byte-identical to one written
 * before the field existed, and hashes the same.
 */
function runMode(
  transaction: boolean | undefined
): Pick<MigrationContent, "transaction"> {
  return transaction === false ? { transaction: false } : {};
}

export type BuildBlankPluginMigrationArgs = Pick<
  BuildPluginMigrationArgs,
  "pluginName" | "schemaVersion" | "name" | "now" | "existing" | "transaction"
>;

/**
 * A module with no statements, for SQL the author writes by hand: a data
 * backfill, PostgreSQL's `VACUUM` or `REINDEX ... CONCURRENTLY`.
 *
 * It changes no table the plugin declares, so every snapshot side is the
 * previous module's result on both sides: the reconcile runs it wherever the
 * database stands at that result, and the next generated module diffs from
 * the same shape as if this one were not there. Its schema version is the
 * plugin's declared one, which may equal the previous module's — it moves no
 * schema — but not fall behind it.
 */
export function buildBlankPluginMigration(
  args: BuildBlankPluginMigrationArgs
): PluginMigration {
  const previous = lastModule(args.existing);
  if (previous && args.schemaVersion < previous.schemaVersion) {
    throw new NextlyError({
      code: "PLUGIN_SCHEMA_VERSION_NOT_ADVANCED",
      publicMessage: `The plugin's schemaVersion is ${args.schemaVersion}, behind ${previous.schemaVersion} on its last migration. A new migration cannot claim an older schema.`,
      logContext: {
        plugin: args.pluginName,
        previousSchemaVersion: previous.schemaVersion,
        declared: args.schemaVersion,
      },
    });
  }
  const carried = (
    side: "snapshot" | "contributed"
  ): Record<SupportedDialect, { tables: TableSpec[] }> => {
    const tables = (dialect: SupportedDialect) => ({
      tables: previous?.[side]?.[dialect]?.tables ?? [],
    });
    return {
      postgresql: tables("postgresql"),
      mysql: tables("mysql"),
      sqlite: tables("sqlite"),
    };
  };
  const contributed = carried("contributed");
  const content: MigrationContent = {
    name: `${formatTimestamp(args.now ?? new Date())}_${slugify(args.name)}`,
    schemaVersion: args.schemaVersion,
    ...runMode(args.transaction),
    dialects: {
      postgresql: { up: [], down: [] },
      mysql: { up: [], down: [] },
      sqlite: { up: [], down: [] },
    },
    snapshot: carried("snapshot"),
    before: carried("snapshot"),
    contributed,
    contributedBefore: contributed,
    ...(previous?.contributions === undefined
      ? {}
      : { contributions: previous.contributions }),
  };
  return { ...content, checksum: migrationChecksum(content) };
}

function moduleVariable(name: string): string {
  return `m${name.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * A module the author edits, sealed when it loads: its content is written
 * out, and its checksum is `migrationChecksum` over that content rather than
 * a literal, so an edit to its SQL keeps it intact. What it gives up is the
 * check that the SQL is the SQL that was generated, which a hand-written
 * module has no use for. The ledger still refuses it once it has been applied
 * and then changed (`assertAppliedUnchanged`).
 */
export function formatHandSealedPluginMigrationModule(
  module: PluginMigration
): string {
  const { checksum: _sealed, ...content } = module;
  return [
    "/**",
    " * Written by `nextly migrate:create --plugin`, to be edited: put this",
    " * module's SQL in each dialect's `up` and `down`, one statement per entry.",
    " * It is sealed with `migrationChecksum` when it loads, so an edit keeps it",
    " * intact. Once it has been applied, change it no further: the ledger",
    " * refuses a module that no longer matches what ran.",
    ...(module.transaction === false
      ? [
          " *",
          " * `transaction: false`: it runs outside a transaction, statement by",
          " * statement, and a statement that fails leaves the ones before it",
          " * applied.",
        ]
      : []),
    " */",
    "import {",
    "  migrationChecksum,",
    "  type PluginMigration,",
    '} from "@nextlyhq/plugin-sdk/schema";',
    "",
    `const content = ${JSON.stringify(content, null, 2)} satisfies Omit<PluginMigration, "checksum">;`,
    "",
    "export default {",
    "  ...content,",
    "  checksum: migrationChecksum(content),",
    "} satisfies PluginMigration;",
    "",
  ].join("\n");
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
  /**
   * Write the module sealed when it loads (`formatHandSealedPluginMigrationModule`),
   * for an author who will edit its SQL — the form a module that runs
   * outside a transaction is written in, so `CREATE INDEX` can become
   * `CREATE INDEX CONCURRENTLY`.
   */
  handSealed?: boolean;
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
  const written = await writePluginMigration(
    args.migrationsDir,
    built.module,
    args.existing,
    args.handSealed === true
  );
  return { ...written, operationCounts: built.operationCounts };
}

/**
 * Write a blank module (`buildBlankPluginMigration`), hand-sealed because
 * its author is about to add its SQL, plus the rewritten barrel.
 */
export async function generateBlankPluginMigration(
  args: BuildBlankPluginMigrationArgs & { migrationsDir: string }
): Promise<Omit<GeneratePluginMigrationResult, "operationCounts">> {
  return writePluginMigration(
    args.migrationsDir,
    buildBlankPluginMigration(args),
    args.existing,
    true
  );
}

/**
 * Create a module file, refusing one that already exists.
 *
 * A module is reviewed SQL and, once applied, history: two generations that
 * land on the same name — the same millisecond and slug from a script — must
 * not truncate the first. `wx` makes the create itself refuse, rather than a
 * check before it that a second writer could slip past.
 */
async function writeModuleExclusively(
  modulePath: string,
  content: string
): Promise<void> {
  try {
    await writeFile(modulePath, content, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
    throw NextlyError.conflict({
      reason: "state",
      message: `A migration module already exists at ${modulePath}, and it was left as it is. Run the command again for a module with a new name.`,
      cause: error as Error,
      logContext: { modulePath },
    });
  }
}

/** Write one module and the barrel listing it beside the existing ones. */
async function writePluginMigration(
  migrationsDir: string,
  module: PluginMigration,
  existing: readonly PluginMigration[],
  handSealed: boolean
): Promise<Omit<GeneratePluginMigrationResult, "operationCounts">> {
  await mkdir(migrationsDir, { recursive: true });
  const modulePath = resolve(migrationsDir, `${module.name}.ts`);
  await writeModuleExclusively(
    modulePath,
    handSealed
      ? formatHandSealedPluginMigrationModule(module)
      : formatPluginMigrationModule(module)
  );

  // Rewritten whole on purpose: the barrel is the tool's own listing of the
  // modules, regenerated from them every time. It is reached only once the
  // module above was created, so a refused module leaves it untouched.
  const indexPath = resolve(migrationsDir, "index.ts");
  await writeFile(
    indexPath,
    formatPluginMigrationsIndex([...existing, module]),
    "utf-8"
  );

  return { modulePath, indexPath, moduleName: module.name };
}
