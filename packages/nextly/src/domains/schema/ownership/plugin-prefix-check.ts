/**
 * Refusing a plugin whose schema prefix moved after its tables were created.
 *
 * A plugin's tables are named `<prefix>__<table>`, and the prefix comes from
 * its declaration (or, when it declares none, from its name). Change it once
 * the tables exist and every table compiles under the new name: a push or a
 * migration creates empty tables beside the old ones, the plugin's code reads
 * the empty ones, and the old tables, with every row, sit under names nothing
 * declares. Renaming them would need a migration that keeps the rows, which
 * nothing offers, so the prefix is fixed once the tables exist. A boot, a
 * development reload, `nextly migrate` (and its dry run) and `nextly plugins
 * install` that find it changed refuse before anything is planned, naming
 * both prefixes.
 *
 * ## Where the recorded prefix is read from
 *
 * The plugin's table owner rows in `nextly_schema_owners`, written when its
 * migration modules create its tables, and kept after a later module drops
 * one. Each holds a table's full name, which the prefix rule built as
 * `<prefix>__<table>`. Read from those rows rather than stored beside them a
 * second time: the rows are what the drop guard and an uninstall already
 * trust about the plugin's tables, a second copy could disagree with them,
 * and every install that has owner rows is covered with no backfill. A
 * plugin with no rows yet (its tables were only pushed in development, or it
 * has none) has recorded nothing, and nothing is judged.
 *
 * A recorded table has not moved when the current prefix could have named
 * it: its name starts with `<prefix>__`. Asked that way round, not by
 * splitting the name, because a prefix may end in an underscore and an
 * authored table name may start with one, so `pa___ledger` is `pa_` +
 * `ledger` or `pa` + `_ledger`, and no split can tell which. The one case
 * this leaves unrefused is that ambiguity itself: a prefix that loses or
 * gains a trailing underscore over tables whose names could have been built
 * either way.
 *
 * Rows of an `uninstalled` plugin are not read: its tables were dropped, so
 * a reinstall under another prefix moves nothing. An `orphaned` plugin's
 * tables, kept by `--keep-data`, are still there and are read.
 *
 * @module domains/schema/ownership/plugin-prefix-check
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { PREFIX_SEPARATOR } from "../extension/naming";

import type { OwnerRecord } from "./owner-registry";
import {
  SchemaOwnersRepository,
  schemaOwnersTableExists,
} from "./schema-owners-repository";

/**
 * The plugin's recorded tables its current prefix could not have named:
 * table-level rows, of a plugin not uninstalled, whose names carry the
 * separator and do not start with `<prefix>__`.
 */
export function tablesOutsidePrefix(
  pluginName: string,
  prefix: string,
  owners: readonly OwnerRecord[]
): string[] {
  return owners
    .filter(
      row =>
        row.ownerKind === "plugin" &&
        row.ownerId === pluginName &&
        (row.elementKind ?? "table") === "table" &&
        row.state !== "uninstalled" &&
        // A name without the separator was not built by the prefix rule.
        row.tableName.indexOf(PREFIX_SEPARATOR) > 0 &&
        !row.tableName.startsWith(`${prefix}${PREFIX_SEPARATOR}`)
    )
    .map(row => row.tableName);
}

/**
 * The prefix a table's name most likely carries, for the refusal to name:
 * the text before its first run of underscores, and that run's underscores
 * but the last two (`pa___ledger` → `pa_`).
 */
function recordedPrefixOf(tableName: string): string {
  const at = tableName.indexOf(PREFIX_SEPARATOR);
  let end = at + PREFIX_SEPARATOR.length;
  while (tableName[end] === "_") end += 1;
  return tableName.slice(0, end - PREFIX_SEPARATOR.length);
}

/**
 * Refuse a plugin whose declared prefix could not have named its recorded
 * tables, naming both prefixes and the tables.
 *
 * `prefixes` holds each configured plugin's prefix as the compile resolved
 * it, disabled plugins' included: turning a plugin off keeps its tables, so
 * their names still have to match.
 */
export function assertPluginPrefixesKept(args: {
  prefixes: ReadonlyMap<string, string>;
  owners: readonly OwnerRecord[];
}): void {
  for (const [plugin, prefix] of args.prefixes) {
    const tables = tablesOutsidePrefix(plugin, prefix, args.owners);
    if (tables.length === 0) continue;
    const recorded = recordedPrefixOf(tables[0]);
    throw NextlyError.conflict({
      message:
        `The plugin "${plugin}" now has the schema prefix "${prefix}", but its tables were created under "${recorded}" (${tables.join(", ")}). ` +
        `A plugin's prefix is fixed once its tables exist, since the rows cannot move to new names. Declare contributes.schema.prefix: "${recorded}" to keep its tables.`,
      logContext: {
        reason: "plugin-schema-prefix-changed",
        plugin,
        prefix,
        recorded,
        tables,
      },
    });
  }
}

/**
 * The check as a boot, a reload or a command makes it: the owner rows read,
 * or none where the registry does not exist yet (nothing is recorded there),
 * and a read that fails on a registry that exists left to throw, so a fault
 * is never taken for "nothing recorded".
 */
export async function assertRecordedPluginPrefixesKept(args: {
  prefixes: ReadonlyMap<string, string> | undefined;
  readOwners: () => Promise<OwnerRecord[]>;
  registryExists: () => Promise<boolean>;
}): Promise<void> {
  if (args.prefixes === undefined || args.prefixes.size === 0) return;
  let owners: OwnerRecord[];
  try {
    owners = await args.readOwners();
  } catch (error) {
    if (await args.registryExists()) throw error;
    return;
  }
  assertPluginPrefixesKept({ prefixes: args.prefixes, owners });
}

/** The check over a database handle and its adapter, as each caller has them. */
export function assertPluginPrefixesKeptIn(args: {
  prefixes: ReadonlyMap<string, string> | undefined;
  db: unknown;
  dialect: SupportedDialect;
  adapter: unknown;
}): Promise<void> {
  return assertRecordedPluginPrefixesKept({
    prefixes: args.prefixes,
    readOwners: () => new SchemaOwnersRepository(args.db, args.dialect).read(),
    registryExists: () =>
      schemaOwnersTableExists(
        args.adapter as { listTables(): Promise<string[]> }
      ),
  });
}
