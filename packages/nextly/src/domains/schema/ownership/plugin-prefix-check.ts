/**
 * Refusing a plugin whose schema prefix moved after its tables were created.
 *
 * A plugin's tables are named `<prefix>__<table>`, and the prefix comes from
 * its declaration (or, when it declares none, from its name). Change it once
 * the tables exist and every table compiles under the new name: a push or a
 * migration creates empty tables beside the old ones, the plugin's code reads
 * the empty ones, and the old tables, with every row, sit under names nothing
 * declares. Renaming them would need a migration that keeps the rows, which
 * nothing offers, so the prefix is fixed once the tables exist, and a boot,
 * `nextly migrate` or `nextly plugins install` that finds it changed refuses
 * before anything is planned, naming both prefixes.
 *
 * ## Where the recorded prefix is read from
 *
 * The plugin's table owner rows in `nextly_schema_owners`, written when its
 * migration modules create its tables. Each holds a table's full name, which
 * the prefix rule built as `<prefix>__<table>`. A prefix may not contain the
 * separator but may END in an underscore (`pa_` names `pa___ledger`), so the
 * prefix is the text before the first run of underscores, with all but the
 * last two of that run (`recordedPrefixOf`). A table the plugin still
 * declares by that name is its own whatever the split says, so an authored
 * name that starts with an underscore is never mistaken for a move. Read
 * from those rows rather than
 * stored beside them a second time: the rows are what the drop guard and an
 * uninstall already trust about the plugin's tables, a second copy could
 * disagree with them, and every install that has owner rows is covered with
 * no backfill. A plugin with no rows yet (its tables were only pushed in
 * development, or it has none) has recorded nothing, and nothing is judged.
 *
 * Rows of an `uninstalled` plugin are not read: its tables were dropped, so
 * a reinstall under another prefix moves nothing. An `orphaned` plugin's
 * tables, kept by `--keep-data`, are still there and are read.
 *
 * @module domains/schema/ownership/plugin-prefix-check
 */
import { NextlyError } from "../../../errors/nextly-error";
import { PREFIX_SEPARATOR } from "../extension/naming";
import type { SchemaOwner } from "../extension/types";

import type { OwnerRecord } from "./owner-registry";

/**
 * The prefixes a plugin's recorded tables were created under, from its
 * table-level owner rows, with the tables under each.
 */
export function recordedPrefixes(
  pluginName: string,
  owners: readonly OwnerRecord[]
): Map<string, string[]> {
  const byPrefix = new Map<string, string[]>();
  for (const row of owners) {
    if (row.ownerKind !== "plugin" || row.ownerId !== pluginName) continue;
    if ((row.elementKind ?? "table") !== "table") continue;
    if (row.state === "uninstalled") continue;
    const prefix = recordedPrefixOf(row.tableName);
    // A table without the separator was not named by the prefix rule, so it
    // says nothing about a prefix.
    if (prefix === undefined) continue;
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), row.tableName]);
  }
  return byPrefix;
}

/**
 * The prefix a plugin table's name was built with: the text before its first
 * run of two or more underscores, and that run's underscores but the last
 * two, which are the separator. `forms__a__b` → `forms`; `pa___ledger`, made
 * from the prefix `pa_`, → `pa_`. `undefined` for a name with no separator.
 */
function recordedPrefixOf(tableName: string): string | undefined {
  const at = tableName.indexOf(PREFIX_SEPARATOR);
  if (at <= 0) return undefined;
  let end = at + PREFIX_SEPARATOR.length;
  while (tableName[end] === "_") end += 1;
  return tableName.slice(0, end - PREFIX_SEPARATOR.length);
}

/**
 * Refuse a plugin whose declared prefix differs from the one its recorded
 * tables were created under, naming both and the tables.
 *
 * `prefixes` holds each configured plugin's prefix as the compile resolved
 * it, disabled plugins' included: turning a plugin off keeps its tables, so
 * their names still have to match.
 */
export function assertPluginPrefixesKept(args: {
  prefixes: ReadonlyMap<string, string>;
  owners: readonly OwnerRecord[];
  /**
   * The tables the compile declares, by owner: a recorded table its plugin
   * still declares under that very name has not moved.
   */
  declared?: ReadonlyMap<string, SchemaOwner> | undefined;
}): void {
  const stillDeclared = (plugin: string, row: OwnerRecord): boolean => {
    const owner = args.declared?.get(row.tableName);
    return owner?.kind === "plugin" && owner.id === plugin;
  };
  for (const [plugin, prefix] of args.prefixes) {
    const rows = args.owners.filter(row => !stillDeclared(plugin, row));
    const moved = [...recordedPrefixes(plugin, rows)].filter(
      ([recorded]) => recorded !== prefix
    );
    if (moved.length === 0) continue;
    const [recorded, tables] = moved[0];
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
 * The check as a boot or a command makes it: the owner rows read, or none
 * where the registry does not exist yet (nothing is recorded there), and a
 * read that fails on a registry that exists left to throw, so a fault is
 * never taken for "nothing recorded".
 */
export async function assertRecordedPluginPrefixesKept(args: {
  prefixes: ReadonlyMap<string, string> | undefined;
  declared?: ReadonlyMap<string, SchemaOwner> | undefined;
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
  assertPluginPrefixesKept({
    prefixes: args.prefixes,
    owners,
    declared: args.declared,
  });
}
