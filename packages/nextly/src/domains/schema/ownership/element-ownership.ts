/**
 * Ownership at the ELEMENT level: not just "whose table", but "whose column".
 *
 * Part B recorded one owner per table, which is right until two owners touch
 * one table. The app adding a column to `auth__identities` is the ordinary
 * case, and a table-level record cannot express it — so either the app's
 * column looks like the plugin's (and the plugin's uninstall drops it) or the
 * table looks like the app's (and the plugin's migrations stop owning it).
 *
 * ## What this buys, concretely
 *
 * A plugin's migration reconcile compares only the elements ITS stream owns.
 * Without that, an app-added column makes every later plugin migration report
 * drift — the live table has a column the module's snapshot does not, so it
 * matches neither `before` nor `snapshot`, and adoption is refused on a
 * database that is entirely correct.
 *
 * @module domains/schema/ownership/element-ownership
 * @since 1.0.0
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { TableSpec } from "../pipeline/diff/types";

export type ElementKind = "table" | "column" | "index" | "fk" | "check";

export interface ElementOwner {
  tableName: string;
  elementKind: ElementKind;
  /** The column, index, constraint name — or the table name for `table`. */
  elementName: string;
  /** Which stream carries it: `core`, `app`, or `plugin:<name>`. */
  migratedBy: string;
}

/** The key an element is recorded under. */
export function elementKey(
  tableName: string,
  kind: ElementKind,
  name: string
): string {
  return `${tableName}\u0000${kind}\u0000${name}`;
}

/**
 * The view of a table one migration stream should compare against.
 *
 * Elements owned by ANOTHER stream are removed, so a reconcile sees the table
 * as its own migrations describe it. This is what makes an app-added column
 * invisible to a plugin's drift check rather than fatal to it.
 *
 * Elements with no owner record are KEPT. Absence means nobody has claimed
 * them, and a column that predates the registry belongs to whoever is looking
 * — removing it would make every stream think the table was missing a column
 * it has.
 */
export function viewForStream(
  table: TableSpec,
  stream: string,
  owners: ReadonlyMap<string, ElementOwner>
): TableSpec {
  const ownedByOther = (kind: ElementKind, name: string): boolean => {
    const owner = owners.get(elementKey(table.name, kind, name));
    return owner !== undefined && owner.migratedBy !== stream;
  };

  return {
    ...table,
    columns: table.columns.filter(
      column => !ownedByOther("column", column.name)
    ),
    ...(table.indexes
      ? {
          indexes: table.indexes.filter(
            index => !ownedByOther("index", index.name)
          ),
        }
      : {}),
    ...(table.foreignKeys
      ? {
          foreignKeys: table.foreignKeys.filter(
            fk => !ownedByOther("fk", fk.name)
          ),
        }
      : {}),
    ...(table.checks
      ? {
          checks: table.checks.filter(
            check => !ownedByOther("check", check.name)
          ),
        }
      : {}),
  };
}

/**
 * Whether a contributor may add elements to a table another owner declared.
 *
 * `dependsOn` or `optionalDependsOn` on the owning plugin. Both give the
 * resolver an ordering; the difference is what happens when the owner is
 * ABSENT — a hard dependency fails, an optional one skips the extension with
 * a log, which is what lets a plugin enrich another plugin that may or may not
 * be installed.
 */
export function assertMayExtendForeignTable(args: {
  contributor: string;
  ownerPlugin: string;
  dependsOn: ReadonlySet<string>;
  optionalDependsOn: ReadonlySet<string>;
  tableName: string;
}): void {
  if (args.dependsOn.has(args.ownerPlugin)) return;
  if (args.optionalDependsOn.has(args.ownerPlugin)) return;

  throw NextlyError.validation({
    errors: [
      {
        path: `plugin.${args.contributor}.schema`,
        code: "INVALID",
        message: `Plugin "${args.contributor}" extends "${args.tableName}", owned by plugin "${args.ownerPlugin}", without declaring a dependency on it. Add it to dependsOn, or to optionalDependsOn if the extension should be skipped when that plugin is absent.`,
      },
    ],
  });
}

/**
 * Plugins that would be stranded by uninstalling this one.
 *
 * Extends B8's dependents rule to OPTIONAL dependents that actually extended
 * the table. An optional dependency that never used it is not stranded, and
 * refusing on the declaration alone would block uninstalls for a relationship
 * nobody exercised.
 */
export function extendersOf(
  ownerPlugin: string,
  ownedTables: readonly string[],
  elements: readonly ElementOwner[]
): string[] {
  const owned = new Set(ownedTables);
  const extenders = new Set<string>();

  for (const element of elements) {
    if (!owned.has(element.tableName)) continue;
    if (element.elementKind === "table") continue;
    if (!element.migratedBy.startsWith("plugin:")) continue;
    const plugin = element.migratedBy.slice("plugin:".length);
    if (plugin !== ownerPlugin) extenders.add(plugin);
  }
  return [...extenders].sort();
}

/** The elements one stream owns on a set of tables — what an uninstall drops. */
export function elementsOwnedBy(
  stream: string,
  tableNames: readonly string[],
  elements: readonly ElementOwner[]
): ElementOwner[] {
  const tables = new Set(tableNames);
  return elements.filter(
    element =>
      element.migratedBy === stream &&
      tables.has(element.tableName) &&
      element.elementKind !== "table"
  );
}
