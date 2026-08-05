import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../../field-groups/migration/manifest";
// Identifies which tables Nextly manages. Used as the tablesFilter
// argument to drizzle-kit's pushSchema so we never touch user tables
// or non-managed nextly_* tables.
//
// Adding a prefix here is a SemVer change — downstream tools may
// rely on this prefix list. Coordinate with plugin field types
// (Gap 8 in the finalized plan) when extending.

// 🔴 Both field-group generations. This regex is drizzle-kit's `tablesFilter`,
// so a prefix missing from it is a table drizzle-kit never INTROSPECTS — and a
// desired table it did not find in the live database is one it creates. After
// the storage migration a generated field-group table carries `fg_`, so leaving
// it out means every apply proposes creating a table that is already there.
//
// Widening this is a SemVer-visible change, and it is made BEFORE any database
// can hold the migrated prefix rather than after: a filter that learns about a
// table only once the table exists has already mis-diffed it once.
/** The prefixes themselves, for callers that match by `startsWith`. */
export const MANAGED_TABLE_PREFIXES: readonly string[] = [
  "dc_",
  "single_",
  STORAGE_FORMAT.tablePrefix,
  MIGRATION_TARGET.tablePrefix,
];

export const MANAGED_TABLE_PREFIXES_REGEX = new RegExp(
  `^(dc_|single_|${STORAGE_FORMAT.tablePrefix}|${MIGRATION_TARGET.tablePrefix})`
);

export function isManagedTable(name: string): boolean {
  return MANAGED_TABLE_PREFIXES_REGEX.test(name);
}

// Localized companion tables (`dc_<slug>_locales` / `single_<slug>_locales` /
// `comp_<slug>_locales`) are owned by the localization migration layer (M1) — created/dropped
// only by generated migrations (or the in-process companion reconcile on the UI apply path).
// They match the managed prefix above, so the diff/pushSchema pipeline MUST additionally
// exclude them via `isCompanionTable`, or it would introspect/diff them against a desired state
// that never declares them and spuriously add/drop the table.
//
// 🔴 The field-group prefix is matched under BOTH storage generations, which is
// wider than `isManagedTable` above deliberately. A companion is recognised so
// that callers can EXCLUDE it, and a caller that reaches a field-group table by
// walking the catalog rather than through the managed filter — the orphan sweep
// does exactly that — sees the migrated companion whether or not the pipeline
// considers the prefix managed. Failing to recognise it there means probing a
// companion as though it were an instance table, for a column it does not have.
const COMPANION_TABLE_REGEX = new RegExp(
  `^(dc_|single_|${STORAGE_FORMAT.tablePrefix}|${MIGRATION_TARGET.tablePrefix}).+${STORAGE_FORMAT.companionSuffix}$`
);

export function isCompanionTable(name: string): boolean {
  return COMPANION_TABLE_REGEX.test(name);
}

/**
 * Whether a live table belongs in a snapshot paired against a migration's own.
 *
 * 🔴 One predicate because the two callers had written it twice and drifted:
 * `nextly migrate`'s drift check excluded localized companions, `migrate:resolve
 * --applied` did not, so the recovery command reported drift on any database
 * with a localized entity and refused to run. Companions are migration-owned
 * and never appear in a `migrate:create` snapshot, so a snapshot that contains
 * one can never match the file it is compared against.
 */
export function isSnapshotComparableTable(name: string): boolean {
  return isManagedTable(name) && !isCompanionTable(name);
}

/**
 * The managed tables that exist because of a relationship, not because the
 * config declares them.
 *
 * A many-to-many field creates `<mainA>_<mainB>_<field>` with the two main
 * names sorted, and every one of those carries a managed prefix — so nothing
 * above tells them apart from a collection's own table. They have to be
 * excluded in TWO places for the same reason a companion is: the desired
 * snapshot never declares one, so a snapshot that records it makes the next
 * diff want to drop it, and a live snapshot that includes it makes the apply
 * path report drift against a snapshot that never could have held it.
 *
 * Derived from the live list alone rather than from config, so both callers
 * can reach it: `migrate`'s drift check has no config to consult.
 */
export function junctionTablesAmong(
  liveTables: readonly string[]
): Set<string> {
  const mains = liveTables
    .filter(name => isManagedTable(name) && !isCompanionTable(name))
    .sort();
  const junctions = new Set<string>();
  for (const table of liveTables) {
    for (const a of mains) {
      if (table === a) continue;
      for (const b of mains) {
        // Generation sorts the pair, so only that order can appear.
        if (a > b) continue;
        if (table.startsWith(`${a}_${b}_`)) junctions.add(table);
      }
    }
  }
  return junctions;
}

/**
 * Whether a live table belongs in a snapshot the apply path compares against.
 *
 * `isSnapshotComparableTable` answers it for one name; this needs the whole
 * list, because whether a table is a junction depends on which other tables
 * are standing beside it.
 */
export function snapshotComparableTables(
  liveTables: readonly string[]
): string[] {
  const junctions = junctionTablesAmong(liveTables);
  return liveTables.filter(
    name => isSnapshotComparableTable(name) && !junctions.has(name)
  );
}
