/**
 * A plugin module chain whose foreign keys reach a table before the chain
 * creates it, refused where the chain is decided.
 *
 * Apart from the module format (`plugin-migration.ts`) because a module's
 * keys include the ones it places on another owner's table, and which of
 * those are the plugin's own is read through `recordedContributions`, which
 * itself reads the module format.
 *
 * @module domains/schema/migrate/plugin/module-foreign-keys
 */
import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import type { TableSpec } from "../../pipeline/diff/types";

import type { PluginMigration } from "./plugin-migration";
import { recordedContributions } from "./recorded-contributions";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** A table whose keys a module creates, and the side of the module it is on. */
interface KeyedTable {
  side: "snapshot" | "contributed";
  table: TableSpec;
}

/**
 * The tables whose keys this module creates: its own tables, and the tables
 * of other owners it contributes to, carrying only the keys it contributed.
 *
 * A contributed table is stored whole, so its other keys are its owner's and
 * are not this chain's to order. Which keys are the plugin's is read as the
 * modules up to this one record them, replayed for a module generated before
 * they were recorded.
 */
function keyedTables(
  migrations: readonly PluginMigration[],
  at: number,
  dialect: SupportedDialect
): KeyedTable[] {
  const migration = migrations[at];
  const owned = recordedContributions(migrations.slice(0, at + 1), dialect);
  const contributed = (migration.contributed?.[dialect]?.tables ?? []).map(
    table => {
      const mine = new Set(owned[table.name]?.foreignKeys ?? []);
      return {
        side: "contributed" as const,
        table: {
          ...table,
          foreignKeys: (table.foreignKeys ?? []).filter(key =>
            mine.has(key.name)
          ),
        },
      };
    }
  );
  return [
    ...migration.snapshot[dialect].tables.map(table => ({
      side: "snapshot" as const,
      table,
    })),
    ...contributed,
  ];
}

/**
 * Refuse a module chain whose foreign keys reach a table none of the owner's
 * earlier modules creates.
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
 * dependency's, a table the database already held — which the declaration
 * compile judges for reach, and which no ordering question reaches here.
 */
export function assertModuleForeignKeysResolve(
  pluginName: string,
  migrations: readonly PluginMigration[]
): void {
  // Per dialect: a schema hook may add a table on one dialect only, so a
  // key's target may travel on the dialect it fails on.
  for (const dialect of DIALECTS) {
    resolveChainPerDialect(pluginName, migrations, dialect);
  }
}

/**
 * One dialect's walk, in run order, refusing the first key whose target is
 * owned by this chain and does not exist in the module's resulting snapshot.
 *
 * A target no module of this chain ever names in `snapshot` or `before` is
 * external (core, a dependency's, or adopted) and is judged for reach at the
 * declaration compile. Any target owned by this chain must exist in `after`:
 * if `previous` held it and `after` lacks it, this module drops the target
 * while retaining a key on it; if a later module creates it, the key arrived
 * early; otherwise an earlier module dropped it and no module restores it.
 */
function resolveChainPerDialect(
  pluginName: string,
  migrations: readonly PluginMigration[],
  dialect: SupportedDialect
): void {
  const everOwned = new Set<string>(
    migrations.flatMap(migration => [
      ...migration.snapshot[dialect].tables.map(table => table.name),
      ...migration.before[dialect].tables.map(table => table.name),
    ])
  );
  let previous = new Set<string>();
  for (const [at, migration] of migrations.entries()) {
    const after = new Set(
      migration.snapshot[dialect].tables.map(table => table.name)
    );
    refuseKeysMissingTargetAfter({
      pluginName,
      migrations,
      dialect,
      at,
      previous,
      after,
      everOwned,
      tables: keyedTables(migrations, at, dialect),
    });
    previous = after;
  }
}

/**
 * Refuse this module's keys whose target is missing from its `after` snapshot
 * whenever the target is owned by this plugin's migration chain.
 */
function refuseKeysMissingTargetAfter(args: {
  pluginName: string;
  migrations: readonly PluginMigration[];
  dialect: SupportedDialect;
  at: number;
  previous: ReadonlySet<string>;
  after: ReadonlySet<string>;
  everOwned: ReadonlySet<string>;
  tables: readonly KeyedTable[];
}): void {
  const { pluginName, migrations, dialect, at, previous, after, everOwned } =
    args;
  const migration = migrations[at];
  for (const { side, table } of args.tables) {
    for (const key of table.foreignKeys ?? []) {
      const target = key.referencesTable;
      if (after.has(target) || !everOwned.has(target)) continue;
      const path = `${migration.name}.${side}.${dialect}.${table.name}.foreignKeys.${key.name}`;
      if (previous.has(target)) {
        throw NextlyError.validation({
          errors: [
            {
              path,
              code: "INVALID",
              message: `Module "${migration.name}" declares foreign key "${key.name}" on "${table.name}" referencing "${target}", which this module drops ("${target}" is absent from its snapshot). Drop the foreign key before or alongside dropping its target.`,
            },
          ],
        });
      }
      // The first later module holding the target is its creator: one that
      // merely carried it would have received it from a module before that,
      // which this walk reached first.
      const later = migrations
        .slice(at + 1)
        .find(laterMigration =>
          laterMigration.snapshot[dialect].tables.some(
            laterTable => laterTable.name === target
          )
        );
      if (later !== undefined) {
        throw NextlyError.validation({
          errors: [
            {
              path,
              code: "INVALID",
              message: `Module "${migration.name}" declares foreign key "${key.name}" on "${table.name}" referencing "${target}", which no earlier module of plugin "${pluginName}" creates (module "${later.name}" creates it later). Reorder the modules, or let the key travel with the module that creates its target.`,
            },
          ],
        });
      }
      throw NextlyError.validation({
        errors: [
          {
            path,
            code: "INVALID",
            message: `Module "${migration.name}" declares foreign key "${key.name}" on "${table.name}" referencing "${target}", which an earlier module of plugin "${pluginName}" dropped and no module restores.`,
          },
        ],
      });
    }
  }
}
