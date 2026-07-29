/**
 * What the storage migration will rename, derived from the database.
 *
 * The plan is built from the registry rather than from configuration, because
 * only the registry knows what the objects are actually called. A field group
 * whose table was named through `dbName` carries whatever the author chose, and
 * a name cannot be recomputed from a slug once that has happened.
 *
 * @module domains/field-groups/migration/manifest
 */

import { createHash } from "node:crypto";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";

import type { MigrationDirection } from "./state";

/**
 * The names storage moves to.
 *
 * `dynamic_field_groups` is parallel to `dynamic_collections` and
 * `dynamic_singles`. `fg_` is deliberately shorter than the prefix it replaces,
 * so no name that fits an identifier limit today can overflow one by migrating.
 */
export const MIGRATION_TARGET = {
  registryTable: "dynamic_field_groups",
  tablePrefix: "fg_",
  columnType: "_field_group_type",
} as const;

/** The names this direction moves storage from and to. */
function vocabulary(direction: MigrationDirection) {
  const up = direction === "up";
  return {
    tableFrom: up ? STORAGE_FORMAT.tablePrefix : MIGRATION_TARGET.tablePrefix,
    tableTo: up ? MIGRATION_TARGET.tablePrefix : STORAGE_FORMAT.tablePrefix,
    registryFrom: up
      ? STORAGE_FORMAT.registryTable
      : MIGRATION_TARGET.registryTable,
    registryTo: up
      ? MIGRATION_TARGET.registryTable
      : STORAGE_FORMAT.registryTable,
    columnFrom: up ? STORAGE_FORMAT.columns.type : MIGRATION_TARGET.columnType,
    columnTo: up ? MIGRATION_TARGET.columnType : STORAGE_FORMAT.columns.type,
  };
}

/** A registry row, as far as the migration is concerned. */
export interface RegistryRow {
  slug: string;
  /** Read from `table_name`. Never recomputed from the slug. */
  tableName: string;
  /**
   * Whether a companion table is physically present.
   *
   * Deliberately not `localized`: a localized group with no translatable
   * fields has no companion, and the create path accepts exactly that. Reading
   * this from the catalog rather than inferring it keeps the plan from naming
   * a table that was never created.
   */
  hasCompanion: boolean;
  /** Dynamic zones carry the type discriminator column; fixed groups do not. */
  hasTypeColumn: boolean;
}

/** One thing the migration will rename. */
export interface ManifestEntry {
  kind: "registry" | "table" | "companion" | "column";
  from: string;
  to: string;
  /** Set for `column`, naming the table the column belongs to. */
  table?: string;
}

export interface MigrationManifest {
  entries: ManifestEntry[];
  /**
   * Identifies the object map this plan was built against. Recorded when a run
   * starts so a resume can refuse a plan that has since moved.
   */
  hash: string;
}

/**
 * Rename a legacy-prefixed name onto the new prefix, or leave it alone.
 *
 * A table only gets renamed when it actually carries the prefix this migration
 * is retiring. One named through `dbName` was never named after the concept —
 * `my_seo_block` contains no vocabulary to migrate — and rewriting it would
 * change a name its author chose, for no benefit. This is the second reason
 * `table_name` has to be read rather than derived: it decides not just what the
 * objects are called, but which of them are ours to rename at all.
 */
export function retargetName(
  name: string,
  direction: MigrationDirection = "up"
): string | null {
  const { tableFrom, tableTo } = vocabulary(direction);
  if (!name.startsWith(tableFrom)) return null;
  return `${tableTo}${name.slice(tableFrom.length)}`;
}

/**
 * Build the ordered rename plan.
 *
 * The registry is renamed **last**, so that for every step but the final one
 * the plan can still be rebuilt from the legacy registry on resume.
 *
 * That ordering is necessary but not sufficient. The final step has the same
 * commit-before-marker crash window as any other: once the registry rename
 * commits, a crash before the marker records it leaves a resume that must retry
 * a step whose source table no longer exists. So callers must read registry
 * rows from whichever registry is present — legacy first, then the migrated
 * name — and this function must produce an identical plan from either. It does,
 * because the rows are the only input and the entries are derived from them
 * alone; nothing here reads the registry's own name from the database.
 */
export function buildMigrationManifest(
  rows: readonly RegistryRow[],
  options: {
    direction?: MigrationDirection;
    /**
     * Every table in the database, not only the ones this migration expects.
     *
     * Partial input is worse than none: a source missing from an incomplete
     * list reads as a rename that already happened. Omit it entirely when the
     * catalog is not available, and only plan-level conflicts are checked.
     */
    existingTables?: readonly string[];
  } = {}
): MigrationManifest {
  const direction = options.direction ?? "up";
  const v = vocabulary(direction);
  const entries: ManifestEntry[] = [];

  // Sorted by the stored table name so the plan is stable across runs. Step
  // numbers index into this list, so an unstable order would make a resumed
  // step point at a different object.
  const ordered = [...rows].sort((a, b) =>
    a.tableName < b.tableName ? -1 : a.tableName > b.tableName ? 1 : 0
  );

  for (const row of ordered) {
    // Idempotent by construction: a row already carrying a migrated name
    // produces no rename, so a plan rebuilt after a partial run contains only
    // the work still outstanding.
    const target = retargetName(row.tableName, direction);
    if (target === null) {
      // Custom-named: nothing to retire. Its column may still need renaming,
      // which is why this continues rather than skipping the row entirely.
      if (row.hasTypeColumn) {
        entries.push({
          kind: "column",
          from: v.columnFrom,
          to: v.columnTo,
          table: row.tableName,
        });
      }
      continue;
    }

    entries.push({ kind: "table", from: row.tableName, to: target });

    if (row.hasCompanion) {
      // Derived from the table name that was read, not from the slug, so a
      // custom-named table's companion is still found.
      const suffix = STORAGE_FORMAT.companionSuffix;
      entries.push({
        kind: "companion",
        from: `${row.tableName}${suffix}`,
        to: `${target}${suffix}`,
      });
    }

    if (row.hasTypeColumn) {
      // Addressed by its post-rename table name: the column rename runs after
      // the table rename, so the old name no longer resolves.
      entries.push({
        kind: "column",
        from: v.columnFrom,
        to: v.columnTo,
        table: target,
      });
    }
  }

  entries.push({
    kind: "registry",
    from: v.registryFrom,
    to: v.registryTo,
  });

  const planned = options.existingTables
    ? reconcileWithCatalog(entries, options.existingTables)
    : entries;
  assertNoTargetConflict(planned, rows);

  return { entries: planned, hash: hashManifest(planned) };
}

/**
 * Hash the plan's object map.
 *
 * Covers what will be renamed and in what order, so a schema change between an
 * interrupted run and its resume is detected. It deliberately does not cover
 * the step list the running build produces; that is a separate hash, because a
 * Nextly upgrade can reorder steps while this map is untouched.
 */
export function hashManifest(entries: readonly ManifestEntry[]): string {
  const canonical = entries
    .map(e => `${e.kind}:${e.table ?? ""}:${e.from}>${e.to}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Compare identifiers the way the loosest supported database would.
 *
 * SQLite matches table names case-insensitively, and MySQL does too under the
 * usual `lower_case_table_names` settings. Comparing case-sensitively would let
 * an existing `FG_HERO` slip past a check for `fg_hero` and fail the rename
 * after the run had already started. Postgres can genuinely hold both, so this
 * is stricter than Postgres requires — deliberately, because a refusal before
 * the run costs an operator a rename while a failure during it leaves storage
 * half-migrated.
 */
function fold(name: string): string {
  return name.toLowerCase();
}

/**
 * Decide each rename against what the database actually contains.
 *
 * Four states, and only one of them is ordinary work:
 *
 * | source | target | meaning |
 * |---|---|---|
 * | present | absent  | the rename still has to happen |
 * | absent  | present | this migration already did it; drop the entry |
 * | present | present | something else owns the target; refuse |
 * | absent  | absent  | the registry names a table that is gone; refuse |
 *
 * The second row is what makes a resume work. A run that crashed after a rename
 * committed but before its marker write must be able to rebuild the plan and
 * find that step already satisfied, rather than reading its own finished work
 * as a conflict.
 */
function reconcileWithCatalog(
  entries: readonly ManifestEntry[],
  existingTables: readonly string[]
): ManifestEntry[] {
  const catalog = new Set(existingTables.map(fold));
  const kept: ManifestEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === "column") {
      // A column belongs to a table; if that table is not there, neither is it.
      if (entry.table === undefined || catalog.has(fold(entry.table))) {
        kept.push(entry);
      }
      continue;
    }

    const sourcePresent = catalog.has(fold(entry.from));
    const targetPresent = catalog.has(fold(entry.to));

    if (sourcePresent && targetPresent) {
      throw refuseRename(
        entry,
        "migration target name is already in use",
        `${entry.to} already exists while ${entry.from} still does`
      );
    }
    if (!sourcePresent && !targetPresent) {
      throw refuseRename(
        entry,
        "migration source object is missing",
        `neither ${entry.from} nor ${entry.to} exists`
      );
    }
    if (sourcePresent) kept.push(entry);
    // Otherwise the target is present and the source is gone: already renamed.
  }

  return kept;
}

/**
 * No two entries may claim the same name, and none may claim a name a registry
 * row is keeping.
 *
 * Checked without needing a catalog, because both facts are properties of the
 * plan and its inputs. A row whose table is left alone — one named through
 * `dbName` — still occupies its name, and `table_name` being unique does not
 * stop `comp_hero` and `fg_hero` coexisting.
 */
function assertNoTargetConflict(
  entries: readonly ManifestEntry[],
  rows: readonly RegistryRow[]
): void {
  const renamedAway = new Set(
    entries.filter(e => e.kind !== "column").map(e => fold(e.from))
  );
  const kept = new Set(
    rows.map(r => fold(r.tableName)).filter(name => !renamedAway.has(name))
  );

  const claimed = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "column") continue;
    const key = fold(entry.to);

    if (kept.has(key)) {
      throw refuseRename(
        entry,
        "migration target name is already in use",
        `${entry.to} belongs to a field group this plan leaves unchanged`
      );
    }
    const previous = claimed.get(key);
    if (previous !== undefined) {
      throw refuseRename(
        entry,
        "two objects would be renamed to the same name",
        `${previous} also renames to ${entry.to}`
      );
    }
    claimed.set(key, entry.from);
  }
}

function refuseRename(
  entry: ManifestEntry,
  reason: string,
  detail: string
): NextlyError {
  return NextlyError.serviceUnavailable({
    logMessage: `field-group migration cannot rename ${entry.from}: ${detail}`,
    logContext: { reason, from: entry.from, to: entry.to, detail },
  });
}
