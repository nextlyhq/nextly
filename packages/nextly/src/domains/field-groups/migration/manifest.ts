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

/**
 * The names an up migration moves storage from and to.
 *
 * There is no down variant on purpose: a rollback inverts what was applied
 * rather than deriving the reverse from these. See `invertManifest`.
 */
function vocabulary() {
  return {
    tableFrom: STORAGE_FORMAT.tablePrefix,
    tableTo: MIGRATION_TARGET.tablePrefix,
    registryFrom: STORAGE_FORMAT.registryTable,
    registryTo: MIGRATION_TARGET.registryTable,
    columnFrom: STORAGE_FORMAT.columns.type,
    columnTo: MIGRATION_TARGET.columnType,
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
  /**
   * This rename is already reflected in the database.
   *
   * Annotated rather than removed. The plan is indexed by position and
   * identified by hash, so dropping an entry would renumber every later step
   * and change the identity the marker recorded — making a resume refuse the
   * very plan it is resuming. Steps are idempotent, so a satisfied one costs a
   * verification and nothing more.
   */
  satisfied?: boolean;
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
export function retargetName(name: string): string | null {
  const { tableFrom, tableTo } = vocabulary();
  if (!name.startsWith(tableFrom)) return null;
  return `${tableTo}${name.slice(tableFrom.length)}`;
}

/**
 * Reverse a plan that was applied, for a rollback.
 *
 * A down plan is **inverted, never derived.** Deriving it from the prefix
 * cannot work: a field group whose author named its table `fg_hero` before any
 * migration existed is left untouched on the way up, and a prefix rule going
 * back down would rename it to `comp_hero` — destroying an author-chosen
 * identifier that this migration never created. Nothing in the database
 * distinguishes a name we made from a name that was always there; only the
 * record of what was applied does.
 *
 * Order is reversed as well as direction. The column rename therefore runs
 * while its table still carries the migrated name, which is why each column
 * entry keeps the table it already names.
 */
export function invertManifest(
  entries: readonly ManifestEntry[]
): MigrationManifest {
  const inverted = [...entries].reverse().map(entry => ({
    kind: entry.kind,
    from: entry.to,
    to: entry.from,
    ...(entry.table === undefined ? {} : { table: entry.table }),
  }));
  return { entries: inverted, hash: hashManifest(inverted) };
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
  const v = vocabulary();
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
    const target = retargetName(row.tableName);
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
  // Deliberately excludes `satisfied`: progress is not identity. A plan whose
  // steps have partly run is the same plan, and the marker must still recognise
  // it on resume.
  const canonical = entries
    .map(e => `${e.kind}:${e.table ?? ""}:${e.from}>${e.to}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Fold a name for *occupancy* comparisons only.
 *
 * SQLite matches table names case-insensitively and MySQL usually does, so a
 * `FG_HERO` sitting where `fg_hero` is headed would otherwise slip past and
 * fail the rename mid-run. Folding makes that check stricter than Postgres
 * needs, which is the safe direction for detecting a squatter.
 *
 * It is the unsafe direction for deciding whether something *exists*: on
 * Postgres a quoted `COMP_HERO` would make a genuinely missing `comp_hero` look
 * present, and the pre-flight refusal would be skipped for a rename that then
 * fails anyway. Presence is therefore matched exactly, and only occupancy is
 * folded.
 */
function fold(name: string): string {
  return name.toLowerCase();
}

/**
 * Annotate each rename with what the database says about it, or refuse.
 *
 * Presence is judged on exact names; a target being *occupied* is judged
 * loosely, since that is the comparison where being too strict is safe.
 *
 * | source | target | meaning |
 * |---|---|---|
 * | present | free     | outstanding work |
 * | absent  | present  | already applied — marked satisfied, never removed |
 * | present | occupied | something else owns the target; refuse |
 * | absent  | absent   | the registry names a table that is gone; refuse |
 *
 * Entries are annotated rather than filtered: the plan is positionally indexed
 * and hash-identified, so removing one renumbers later steps and changes the
 * identity the marker holds.
 */
function reconcileWithCatalog(
  entries: readonly ManifestEntry[],
  existingTables: readonly string[]
): ManifestEntry[] {
  const exact = new Set(existingTables);
  const loose = new Set(existingTables.map(fold));

  // A table this plan is about to create by renaming counts as present for the
  // column rename that follows it; the column's table names the post-rename
  // table, which is legitimately absent from a pre-migration catalog.
  const willExist = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "column") willExist.add(entry.to);
  }

  return entries.map(entry => {
    if (entry.kind === "column") {
      const table = entry.table;
      if (table === undefined) return entry;
      const present = exact.has(table) || willExist.has(table);
      // A column on a table that neither exists nor is about to is not work,
      // and cannot be verified either.
      return present ? entry : { ...entry, satisfied: true };
    }

    const sourcePresent = exact.has(entry.from);
    const targetPresent = exact.has(entry.to);
    const targetOccupied = loose.has(entry.to);

    if (sourcePresent && targetOccupied) {
      throw refuseRename(
        entry,
        "migration target name is already in use",
        `${entry.to} already exists while ${entry.from} still does`
      );
    }
    if (sourcePresent) return entry;
    if (targetPresent) return { ...entry, satisfied: true };
    throw refuseRename(
      entry,
      "migration source object is missing",
      `neither ${entry.from} nor ${entry.to} exists`
    );
  });
}

/**
 * No two entries may claim the same name, and none may claim a name a registry
 * row is keeping.
 *
 * Both are properties of the plan and its inputs, so this needs no catalog. A
 * row whose table is left alone still occupies its name, and `table_name` being
 * unique does not stop `comp_hero` and `fg_hero` coexisting.
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
