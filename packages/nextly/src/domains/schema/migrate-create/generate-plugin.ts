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
import { leavesExistingRowsEmpty } from "../extension/extension-columns";
import {
  assertModuleKeysFit,
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
import {
  generateStatements,
  MysqlUnsupportedOperationError,
  SqliteUnsupportedOperationError,
} from "../pipeline/sql-templates/index";

import {
  foreignTableSides,
  NO_ELEMENTS,
  type ForeignTableSides,
} from "./app-stream";
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
  /**
   * The dialects whose change has no generated SQL, because the dialect
   * cannot make it in place (`renderDialect`). Their `up` and `down` are
   * empty for the author to write; the module carries both snapshot sides
   * either way. Empty when every dialect rendered.
   */
  handWritten: SupportedDialect[];
}

/**
 * Render one dialect's change against the previous module's snapshot through
 * the shared diff-and-render core — the same call sequence
 * `generateMigration` makes for the app, so the two paths cannot disagree
 * about what a `TableSpec` renders to.
 *
 * A change the dialect cannot make in place — a column's type or
 * nullability on SQLite, its nullability on MySQL — comes back with no
 * statements and `handWritten` set, rather than failing the whole module. The
 * module still records the change's two sides, so once the author writes its
 * SQL the next generation diffs from the changed shape and the stream moves
 * on. Failing instead wrote nothing, and a module written by `--blank`
 * carries the previous shape on both sides, so every later generation met
 * the same change and failed the same way.
 */
function renderDialect(
  previousTables: readonly TableSpec[],
  desiredTables: readonly TableSpec[],
  dialect: SupportedDialect
): {
  statements: DialectStatements;
  operations: Operation[];
  handWritten: boolean;
} {
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
  try {
    const up = generateStatements(operations, dialect, desired.tables);
    // Inverting the ops — not re-diffing — keeps a forward rename-shaped
    // change reversible in principle and always emits the exact inverse of
    // what ran.
    const down = generateStatements(
      withCyclicForeignKeysSplit(
        buildInverseOperations(operations, previous),
        dialect,
        desired.tables
      ),
      dialect,
      previous.tables
    );
    return { statements: { up, down }, operations, handWritten: false };
  } catch (error) {
    if (
      !(error instanceof SqliteUnsupportedOperationError) &&
      !(error instanceof MysqlUnsupportedOperationError)
    ) {
      throw error;
    }
    // Both directions are left to the author: half a generated pair would
    // read as a whole one.
    return {
      statements: { up: [], down: [] },
      operations,
      handWritten: true,
    };
  }
}

/**
 * Whether a module's UP on `dialect` is exactly what its own two sides render
 * to (`renderDialect`, the generator's own rendering): its statements then
 * make the schema change the sides record and nothing else, so a database
 * standing at its result proves the module ran.
 *
 * A statement the snapshot cannot see — row-level security, a table option,
 * a trigger, a data change — makes the two differ, and so does a module
 * written by hand, or one rendered by an older generator: each reads as not
 * proven, which is the safe answer. A rendering that fails reads the same.
 */
export function upRendersItsSides(
  migration: Pick<
    PluginMigration,
    "dialects" | "before" | "snapshot" | "contributed" | "contributedBefore"
  >,
  dialect: SupportedDialect
): boolean {
  const before = [
    ...(migration.before[dialect]?.tables ?? []),
    ...(migration.contributedBefore?.[dialect]?.tables ?? []),
  ];
  const target = [
    ...(migration.snapshot[dialect]?.tables ?? []),
    ...(migration.contributed?.[dialect]?.tables ?? []),
  ];
  let rendered: ReturnType<typeof renderDialect>;
  try {
    rendered = renderDialect(before, target, dialect);
  } catch {
    // Not proven: the module is judged as one whose statements may do more.
    return false;
  }
  if (rendered.handWritten) return false;
  const up = migration.dialects[dialect]?.up ?? [];
  const expected = rendered.statements.up;
  return (
    up.length === expected.length &&
    up.every((statement, at) => statement === expected[at])
  );
}

/**
 * The columns a list of operations adds that the rows already in their table
 * would have no value for: NOT NULL with no default
 * (`leavesExistingRowsEmpty`, the rule a contributed column is held to when
 * it is declared). As `table.column`.
 *
 * Every `add_column` here is on a table this plugin's earlier modules
 * created, or on a foreign table it contributes to, so the table may hold
 * rows wherever the module runs. A column the database assigns
 * (`autoIncrement`) gives each row its value.
 */
function columnsExistingRowsCannotHold(
  operations: readonly Operation[]
): string[] {
  return operations.flatMap(operation =>
    operation.type === "add_column" &&
    operation.column.autoIncrement !== true &&
    leavesExistingRowsEmpty(operation.column)
      ? [`${operation.tableName}.${operation.column.name}`]
      : []
  );
}

/**
 * Refuse a module that adds a NOT NULL column with no default to a table
 * that already exists.
 *
 * The dialects disagree about such a column: SQLite refuses it, PostgreSQL
 * refuses it once the table has rows, and MySQL fills the rows with 0 or ''
 * without saying so. Refused on every dialect at generation, so one module
 * means the same thing everywhere and the answer does not depend on whether
 * the database it was tried on was empty.
 */
function assertAddedColumnsFillExistingRows(
  pluginName: string,
  columns: ReadonlySet<string>
): void {
  if (columns.size === 0) return;
  const named = [...columns].sort();
  throw new NextlyError({
    code: "PLUGIN_MIGRATION_ADDS_UNFILLABLE_COLUMN",
    publicMessage:
      `This migration would add ${named.join(", ")} as NOT NULL with no default to a table plugin "${pluginName}" created earlier, and the rows already in it would have no value for ${named.length === 1 ? "it" : "them"}. ` +
      `Give ${named.length === 1 ? "the column" : "each column"} a default, or write the addition by hand — add the column nullable, fill the existing rows, then make it NOT NULL — in a module from \`nextly migrate:create --plugin <entry> --blank\`, which records this change for the SQL you write.`,
    logContext: { plugin: pluginName, columns: named },
  });
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
      `If ${one ? "it was" : "they were"} renamed, write the rename by hand; if the drop is deliberate, write the drop by hand — in a module from \`nextly migrate:create --plugin <entry> --blank\`, which records this change for the SQL you write.`,
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

/** The change from the previous module to the declared schema, per dialect. */
interface PluginMigrationPlan {
  previous: PluginMigration | undefined;
  /** Every part of the module's content but its name, version and run mode. */
  body: Omit<MigrationContent, "name" | "schemaVersion" | "transaction">;
  operationCounts: Record<SupportedDialect, number>;
  totalOperations: number;
  /** Tables and columns the change drops, across every dialect, by name. */
  drops: ReadonlySet<string>;
  /** Columns it adds that existing rows would hold no value for, likewise. */
  unfillable: ReadonlySet<string>;
  handWritten: SupportedDialect[];
}

/**
 * The foreign tables, both sides built on each one's CURRENT declaration and
 * differing only in this plugin's elements — so a column the dependency added
 * or removed on its own produces nothing here, and one this plugin withdrew
 * is dropped. The same derivation the app stream uses; see
 * `foreignTableSides`.
 */
function pluginForeignTableSides(
  args: BuildPluginMigrationArgs,
  previous: PluginMigration | undefined,
  dialect: SupportedDialect
): ForeignTableSides {
  return foreignTableSides({
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
}

/** One dialect's change: its four snapshot sides and what renders between. */
interface DialectPlan {
  rendered: ReturnType<typeof renderDialect>;
  previousTables: TableSpec[];
  desiredTables: TableSpec[];
  previousContributed: TableSpec[];
  desiredContributed: TableSpec[];
  contributions: ForeignTableSides["contributions"];
}

/**
 * Diff the declared schema against the previous module's on one dialect, own
 * tables and foreign ones together, and render the change.
 */
function planDialect(
  args: BuildPluginMigrationArgs,
  previous: PluginMigration | undefined,
  dialect: SupportedDialect
): DialectPlan {
  const previousTables = previous?.snapshot[dialect]?.tables ?? [];
  const desiredTables = args.tablesByDialect[dialect] ?? [];
  const sides = pluginForeignTableSides(args, previous, dialect);
  const previousContributed = [...sides.before.values()];
  const desiredContributed = [...sides.after.values()];
  // ONE diff over the union. A foreign table appears on both sides, so only
  // the elements this plugin added to it come out as operations; its own
  // columns are identical either side and produce nothing.
  const rendered = renderDialect(
    [...previousTables, ...previousContributed],
    [...desiredTables, ...desiredContributed],
    dialect
  );
  return {
    rendered,
    previousTables,
    desiredTables,
    previousContributed,
    desiredContributed,
    contributions: sides.contributions,
  };
}

/**
 * Diff the declared schema against the previous module's on every dialect
 * and render the change: the one derivation both a generated module and one
 * whose SQL the author writes (`buildBlankPluginMigration`) are built from,
 * so the two record the same sides for the same change.
 */
function planPluginMigration(
  args: BuildPluginMigrationArgs
): PluginMigrationPlan {
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
  // Columns added that existing rows would hold no value for, likewise.
  const unfillable = new Set<string>();
  const handWritten: SupportedDialect[] = [];
  const contributions: ContributionsByDialect = {};

  for (const dialect of ALL_DIALECTS) {
    const plan = planDialect(args, previous, dialect);
    const { operations } = plan.rendered;
    if (Object.keys(plan.contributions).length > 0) {
      contributions[dialect] = plan.contributions;
    }
    dialects[dialect] = plan.rendered.statements;
    if (plan.rendered.handWritten) handWritten.push(dialect);
    snapshot[dialect] = { tables: plan.desiredTables };
    before[dialect] = { tables: plan.previousTables };
    contributed[dialect] = { tables: plan.desiredContributed };
    contributedBefore[dialect] = { tables: plan.previousContributed };
    operationCounts[dialect] = operations.length;
    totalOperations += operations.length;
    for (const dropped of droppedTablesAndColumns(operations)) {
      drops.add(dropped);
    }
    for (const column of columnsExistingRowsCannotHold(operations)) {
      unfillable.add(column);
    }
  }

  return {
    previous,
    body: {
      dialects,
      snapshot,
      before,
      contributed,
      contributedBefore,
      // Present only when there are some, so a module that contributes
      // nothing stays byte-identical to one generated before contributions
      // were recorded.
      ...(Object.keys(contributions).length > 0 ? { contributions } : {}),
    },
    operationCounts,
    totalOperations,
    drops,
    unfillable,
    handWritten,
  };
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
  const plan = planPluginMigration(args);
  assertNothingCreatedIsDropped(args.pluginName, plan.drops);
  assertAddedColumnsFillExistingRows(args.pluginName, plan.unfillable);
  if (plan.totalOperations === 0) return null;
  // After the diff, so a plugin whose schema matches its last module reports
  // "no changes" whatever its schemaVersion: the version only has to move
  // when there is a module to give it to.
  assertSchemaVersionAdvanced(args, plan.previous);

  const now = args.now ?? new Date();
  const content: MigrationContent = {
    name: `${formatTimestamp(now)}_${slugify(args.name)}`,
    schemaVersion: args.schemaVersion,
    ...runMode(args.transaction),
    ...plan.body,
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
  return {
    module,
    operationCounts: plan.operationCounts,
    handWritten: plan.handWritten,
  };
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

export type BuildBlankPluginMigrationArgs = BuildPluginMigrationArgs;

/**
 * A module with no statements, for SQL the author writes by hand: a data
 * backfill, PostgreSQL's `VACUUM` or `REINDEX ... CONCURRENTLY`, or a schema
 * change the generator will not write — a rename, a deliberate drop, a NOT
 * NULL column filled in steps.
 *
 * Its sides are the generated module's (`planPluginMigration`): the previous
 * module's result before, the declared schema after. With nothing declared
 * changed the two are the same, so the reconcile runs it wherever the
 * database stands at that result and the next generated module diffs from
 * the same shape as if this one were not there. With a change declared it
 * records that change, so once its SQL makes it the next generation starts
 * from the changed shape. Carrying the previous result on both sides instead
 * left the change undone in the record, and every later generation met it
 * again.
 *
 * Its schema version is the plugin's declared one. With no change it may
 * equal the previous module's, but not fall behind it; with one it must move
 * past it, as a generated module's must.
 */
export function buildBlankPluginMigration(
  args: BuildBlankPluginMigrationArgs
): PluginMigration {
  const plan = planPluginMigration(args);
  const previous = plan.previous;
  if (plan.totalOperations > 0) {
    assertSchemaVersionAdvanced(args, previous);
  } else if (previous && args.schemaVersion < previous.schemaVersion) {
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
  const content: MigrationContent = {
    name: `${formatTimestamp(args.now ?? new Date())}_${slugify(args.name)}`,
    schemaVersion: args.schemaVersion,
    ...runMode(args.transaction),
    ...plan.body,
    dialects: {
      postgresql: { up: [], down: [] },
      mysql: { up: [], down: [] },
      sqlite: { up: [], down: [] },
    },
  };
  return { ...content, checksum: migrationChecksum(content) };
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
    "} satisfies PluginMigration as PluginMigration;",
    "",
  ].join("\n");
}

/**
 * The module file's content, generated — never hand-edited.
 *
 * Its value is checked against `PluginMigration` and declared as it
 * (`satisfies … as …`), here and in the hand-sealed module above: the module's
 * declaration is then the type, written without inference, rather than the
 * thousands-of-lines literal spelled out as one.
 */
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
    )} satisfies PluginMigration as PluginMigration;`,
    "",
  ].join("\n");
}

/** The identifier the barrel imports the module at `index` under. */
function moduleBinding(index: number): string {
  return `migration${String(index)}`;
}

/** The `index.ts` barrel, rewritten whole on every generation. */
export function formatPluginMigrationsIndex(
  modules: readonly PluginMigration[]
): string {
  const ordered = orderedMigrations(modules);
  // Each binding is named by its module's position, not its name: a name
  // maps onto an identifier only by folding characters together, and two
  // names folded alike (`001_a-b`, `001_a_b`) would import under one binding
  // and leave the plugin uncompiled. The path is a string literal, so any
  // name the file system holds is quoted as written.
  const imports = ordered
    .map(
      (m, index) =>
        `import ${moduleBinding(index)} from ${JSON.stringify(`./${m.name}`)};`
    )
    .join("\n");
  const list = ordered.map((_, index) => moduleBinding(index)).join(",\n  ");
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
  /** See `BuiltPluginMigration.handWritten`. */
  handWritten: SupportedDialect[];
}

/**
 * Build and write the module plus the rewritten barrel. Returns null when
 * there is nothing to migrate (the CLI exits 2 for that, as the app path
 * does). A module with a dialect left to the author (`handWritten`) is
 * written hand-sealed, so the SQL added to it keeps it intact.
 */
export async function generatePluginMigration(
  args: GeneratePluginMigrationArgs
): Promise<GeneratePluginMigrationResult | null> {
  const built = buildPluginMigration(args);
  if (!built) return null;
  const written = await writePluginMigration(
    args.pluginName,
    args.migrationsDir,
    built.module,
    args.existing,
    args.handSealed === true || built.handWritten.length > 0
  );
  return {
    ...written,
    operationCounts: built.operationCounts,
    handWritten: built.handWritten,
  };
}

/**
 * Write a blank module (`buildBlankPluginMigration`), hand-sealed because
 * its author is about to add its SQL, plus the rewritten barrel.
 */
export async function generateBlankPluginMigration(
  args: BuildBlankPluginMigrationArgs & { migrationsDir: string }
): Promise<
  Omit<GeneratePluginMigrationResult, "operationCounts" | "handWritten">
> {
  return writePluginMigration(
    args.pluginName,
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
  pluginName: string,
  migrationsDir: string,
  module: PluginMigration,
  existing: readonly PluginMigration[],
  handSealed: boolean
): Promise<
  Omit<GeneratePluginMigrationResult, "operationCounts" | "handWritten">
> {
  // Before anything is written: a module whose ledger key is too long would
  // be refused the next time the plugin loads, leaving it unloadable until
  // the file was removed by hand.
  assertModuleKeysFit(pluginName, [module]);
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
