/**
 * What a plugin built on the app's tables, left out of the comparison `nextly migrate` makes of the
 * database with a migration file's snapshots.
 *
 * The app's history never describes an element another owner added to one of its tables, so such an
 * element, standing where the file leaves it alone, reads as drift: "present in DB" against a history
 * that never had it. The owner record says whose it is. An element is left out of the database's side
 * only where all of these hold, and is compared as any other where one does not:
 *
 * - An owner row names it: its table, its kind and its name, spelled exactly as the database spells
 *   them, and the row is a plugin's. Nothing is told by a name that only looks alike, and an app row
 *   leaves it the app's.
 * - The file's snapshots describe no element of that kind and name on that table, before it or after.
 *   The app's own element of the same name is then compared as it stands.
 * - Both snapshots describe the table by its name, and the file does not rebuild it. SQLite changes
 *   most of a table by building it again from what the file's snapshot describes and dropping the old
 *   one with whatever the snapshot does not, and a table the file renames or drops takes its elements
 *   with it, where its rows no longer name them.
 * - No statement of the file names it: a file written by hand that drops or renames it is judged whole.
 *
 * @module domains/schema/ownership/recorded-drift
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { NextlySchemaSnapshot, TableSpec } from "../pipeline/diff/types";
import { rebuiltTableNames } from "../pipeline/filter-unsafe-statements";

import { rebuiltTables } from "./drop-guard";
import type { OwnerRecord } from "./owner-registry";
import { tableWithout } from "./removed-elements";
import { LIVE_DIMENSION } from "./retired-elements";

type ElementKind = keyof typeof LIVE_DIMENSION;

/** The named elements of one kind on a table, or none where the table does not track the kind. */
function elementsOf(
  table: TableSpec | undefined,
  kind: ElementKind
): readonly { name: string }[] {
  const found = table?.[LIVE_DIMENSION[kind]] as
    | readonly { name: string }[]
    | undefined;
  return found ?? [];
}

/** Names compared without case, where a wider match is the safe side: an element is then compared. */
const folded = (name: string) => name.toLowerCase();

/** Whether `statements` name `name`, as an identifier of their own. */
function namesIdentifier(statements: readonly string[], name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const whole = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "i");
  return statements.some(statement => whole.test(statement));
}

/** The kinds and names of the plugin elements the rows name on `table`, as the database spells it. */
function pluginElementsOn(
  table: string,
  rows: readonly OwnerRecord[]
): { kind: ElementKind; name: string }[] {
  return rows.flatMap(row => {
    const kind = row.elementKind ?? "table";
    return kind !== "table" &&
      row.ownerKind === "plugin" &&
      row.tableName === table &&
      row.elementName !== undefined &&
      row.elementName !== ""
      ? [{ kind, name: row.elementName }]
      : [];
  });
}

/** Whether a snapshot of the file describes an element of that kind and name on `table`. */
function describes(
  snapshot: NextlySchemaSnapshot,
  table: string,
  element: { kind: ElementKind; name: string }
): boolean {
  const found = snapshot.tables.find(
    each => folded(each.name) === folded(table)
  );
  return elementsOf(found, element.kind).some(
    each => folded(each.name) === folded(element.name)
  );
}

/**
 * `live` without the elements the owner record says a plugin built there and the file leaves alone
 * (see the module).
 */
export function withoutRecordedPluginElements(args: {
  live: NextlySchemaSnapshot;
  /** Every owner row; only a plugin's element rows are read. */
  rows: readonly OwnerRecord[];
  /** The file's snapshots, as the app's history describes the database before and after it. */
  before: NextlySchemaSnapshot;
  target: NextlySchemaSnapshot;
  /** The file's statements, one driver call each. */
  statements: readonly string[];
  dialect: SupportedDialect;
}): NextlySchemaSnapshot {
  const { live, rows, before, target, statements, dialect } = args;
  const rebuilt = new Set(
    [
      ...rebuiltTables(statements, dialect),
      ...rebuiltTableNames(statements),
    ].map(folded)
  );
  const both = (table: string) =>
    [before, target].every(side =>
      side.tables.some(each => folded(each.name) === folded(table))
    );
  return {
    ...live,
    tables: live.tables.map(table => {
      if (rebuilt.has(folded(table.name)) || !both(table.name)) return table;
      const recorded = pluginElementsOn(table.name, rows).filter(
        element =>
          ![before, target].some(side =>
            describes(side, table.name, element)
          ) && !namesIdentifier(statements, element.name)
      );
      if (recorded.length === 0) return table;
      return tableWithout(table, (kind, element) =>
        recorded.some(each => each.kind === kind && each.name === element.name)
      );
    }),
  };
}
