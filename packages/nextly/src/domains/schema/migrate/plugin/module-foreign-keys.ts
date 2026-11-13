/**
 * A plugin's module chain refused when one of its foreign keys reaches a table
 * that does not exist yet when the module runs.
 *
 * A module's statements run against what the modules before it left, so a key
 * whose target arrives only in a LATER module fails at the earlier module's
 * run — against the database, which names neither the module nor the key.
 * Asked wherever the chain is decided: where a module is generated, over the
 * shipped chain plus the module about to join it, and before a run executes
 * any module, over the chain as shipped.
 *
 * Three targets pass. One an earlier module of the same owner created, by
 * snapshot. One the SAME module creates: the renderer emits a table's create
 * before a constraint that names it, and splits the one shape it cannot so
 * order — two tables keying each other — into creates followed by constraint
 * adds (`withCyclicForeignKeysSplit`), so a same-module target is ordered by
 * construction. And one no module of this owner ever names — a core table, a
 * dependency's, a table the database already held — which, when the run says
 * which tables are there (`availableTables`), must be one of them.
 *
 * Only the keys a module answers for are judged: those on its own tables, and
 * on another owner's table only those its modules record as contributed. The
 * module carries a frozen copy of that whole table, whose other keys are the
 * owner's, already judged in the owner's own chain.
 *
 * @module domains/schema/migrate/plugin/module-foreign-keys
 */
import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import type { ForeignKeySpec } from "../../pipeline/diff/types";

import type { PluginMigration } from "./plugin-migration";
import { recordedContributions } from "./recorded-contributions";

const DIALECTS: readonly SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

export interface AssertModuleForeignKeysResolveOptions {
  /** Dialects to check; defaults to every supported dialect. */
  dialect?: SupportedDialect;
  /**
   * Tables already there when the chain runs: core tables, earlier streams'
   * tables, and those the database holds. Absent at generation, where no run
   * is in view and only the chain's own order can be judged.
   */
  availableTables?: ReadonlySet<string>;
  /**
   * Whether a module is still to run. Only such a module's keys are judged
   * against `availableTables`: an applied module's key to another owner's
   * table is history, which a later module may have dropped before the owner
   * dropped its target. Absent, every module is judged. The chain's own order
   * is judged over every module either way.
   */
  pending?: (migration: PluginMigration) => boolean;
}

/** One key a module answers for, with the table it is declared on. */
interface JudgedKey {
  table: string;
  key: ForeignKeySpec;
}

/** Where a refusal points in the module, for its error path. */
function keyPath(
  migration: PluginMigration,
  dialect: SupportedDialect,
  judged: JudgedKey
): string {
  return `${migration.name}.snapshot.${dialect}.${judged.table}.foreignKeys.${judged.key.name}`;
}

function refuseKey(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

export function assertModuleForeignKeysResolve(
  pluginName: string,
  migrations: readonly PluginMigration[],
  options?: AssertModuleForeignKeysResolveOptions
): void {
  // Per dialect: a schema hook may add a table on one dialect only, so a
  // key's target may travel on the dialect it fails on.
  const dialects =
    options?.dialect !== undefined ? [options.dialect] : DIALECTS;
  for (const dialect of dialects) {
    resolveChainPerDialect(pluginName, migrations, dialect, {
      availableTables: options?.availableTables,
      pending: options?.pending ?? (() => true),
    });
  }
}

/** One dialect's walk over the chain in run order. */
function resolveChainPerDialect(
  pluginName: string,
  migrations: readonly PluginMigration[],
  dialect: SupportedDialect,
  external: {
    availableTables: ReadonlySet<string> | undefined;
    pending: (migration: PluginMigration) => boolean;
  }
): void {
  const everOwned = new Set<string>(
    migrations.flatMap(migration => [
      ...(migration.snapshot[dialect]?.tables.map(table => table.name) ?? []),
      ...(migration.before[dialect]?.tables.map(table => table.name) ?? []),
    ])
  );
  let previous = new Set<string>();
  for (const [at, migration] of migrations.entries()) {
    const after = new Set(
      migration.snapshot[dialect]?.tables.map(table => table.name) ?? []
    );
    for (const judged of keysAnsweredFor(migrations, at, dialect)) {
      const target = judged.key.referencesTable;
      if (after.has(target)) continue;
      const path = keyPath(migration, dialect, judged);
      if (everOwned.has(target)) {
        refuseOwnedTargetMissing({
          pluginName,
          migrations,
          dialect,
          at,
          previous,
          judged,
          path,
        });
      }
      if (external.pending(migration)) {
        refuseExternalTargetMissing(
          migration,
          judged,
          external.availableTables,
          path
        );
      }
    }
    previous = after;
  }
}

/**
 * The keys module `at` answers for: every key on its own tables, and on
 * another owner's table only the keys this plugin's modules record as its own.
 */
function keysAnsweredFor(
  migrations: readonly PluginMigration[],
  at: number,
  dialect: SupportedDialect
): JudgedKey[] {
  const migration = migrations[at];
  const own = (migration.snapshot[dialect]?.tables ?? []).flatMap(table =>
    (table.foreignKeys ?? []).map(key => ({ table: table.name, key }))
  );
  const contributed = migration.contributed?.[dialect]?.tables ?? [];
  if (contributed.length === 0) return own;
  const recorded = recordedContributions(migrations.slice(0, at + 1), dialect);
  return [
    ...own,
    ...contributed.flatMap(table => {
      const mine = new Set(recorded[table.name]?.foreignKeys ?? []);
      return (table.foreignKeys ?? [])
        .filter(key => mine.has(key.name))
        .map(key => ({ table: table.name, key }));
    }),
  ];
}

/**
 * A key to a table no module of this chain names: refused when the run says
 * which tables are there and this is not one of them.
 */
function refuseExternalTargetMissing(
  migration: PluginMigration,
  judged: JudgedKey,
  availableTables: ReadonlySet<string> | undefined,
  path: string
): void {
  const target = judged.key.referencesTable;
  if (availableTables === undefined || availableTables.has(target)) return;
  refuseKey(
    path,
    `Module "${migration.name}" declares foreign key "${judged.key.name}" on "${judged.table}" referencing "${target}", which neither exists before the run nor is created by an earlier migration stream. Plugin migrations run before the app's, so a key may only target a table the database already holds, a core table, a table an earlier plugin creates, or a table this plugin creates.`
  );
}

/**
 * A key to a table this chain owns that is missing after the module: the
 * module drops it, a later module creates it, or an earlier one dropped it.
 */
function refuseOwnedTargetMissing(args: {
  pluginName: string;
  migrations: readonly PluginMigration[];
  dialect: SupportedDialect;
  at: number;
  previous: ReadonlySet<string>;
  judged: JudgedKey;
  path: string;
}): never {
  const { migrations, dialect, at, judged, path } = args;
  const migration = migrations[at];
  const target = judged.key.referencesTable;
  const declares = `Module "${migration.name}" declares foreign key "${judged.key.name}" on "${judged.table}" referencing "${target}"`;
  if (args.previous.has(target)) {
    refuseKey(
      path,
      `${declares}, which this module drops ("${target}" is absent from its snapshot). Drop the foreign key before or alongside dropping its target.`
    );
  }
  // The first later module holding the target is its creator: one that merely
  // carried it would have received it from a module before that, which this
  // walk reached first.
  const later = migrations
    .slice(at + 1)
    .find(laterMigration =>
      (laterMigration.snapshot[dialect]?.tables ?? []).some(
        laterTable => laterTable.name === target
      )
    );
  if (later !== undefined) {
    refuseKey(
      path,
      `${declares}, which no earlier module of plugin "${args.pluginName}" creates (module "${later.name}" creates it later). Reorder the modules, or let the key travel with the module that creates its target.`
    );
  }
  refuseKey(
    path,
    `${declares}, which an earlier module of plugin "${args.pluginName}" dropped and no module restores.`
  );
}
