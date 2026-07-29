/**
 * What the storage migration will rename, derived from the registry.
 *
 * The plan is built from registry rows rather than from configuration, because
 * only the registry knows what the objects are actually called: a field group
 * whose table was named through `dbName` carries whatever the author chose, and
 * that name cannot be recomputed from a slug.
 *
 * This module decides the plan and nothing else — which objects, in what order,
 * under what identity. It deliberately does **not** look at the database. Names
 * that exist, whether a run is already recorded, and how a given dialect
 * compares identifiers are all facts the database layer holds, and reconciling
 * a plan against them belongs there, next to the catalog probe. Keeping that
 * out means this stays a pure function of its inputs and stays testable as one.
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

/** A registry row, as far as the migration is concerned. */
export interface RegistryRow {
  slug: string;
  /** Read from `table_name`. Never recomputed from the slug. */
  tableName: string;
  /**
   * Whether a companion table is physically present.
   *
   * Deliberately not `localized`: a localized group with no translatable fields
   * has no companion, and the create path accepts exactly that. Reading this
   * from the catalog rather than inferring it keeps the plan from naming a
   * table that was never created.
   */
  hasCompanion: boolean;
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
   * Set by catalog reconciliation, which lives with the probe rather than here.
   * Annotated rather than removed: the plan is indexed by position and
   * identified by hash, so dropping an entry would renumber every later step
   * and change the identity the marker recorded, making a resume refuse the
   * very plan it is resuming.
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
  if (!name.startsWith(STORAGE_FORMAT.tablePrefix)) return null;
  return `${MIGRATION_TARGET.tablePrefix}${name.slice(
    STORAGE_FORMAT.tablePrefix.length
  )}`;
}

/**
 * Reverse a plan that was applied, for a rollback.
 *
 * A down plan is **inverted, never derived.** Deriving it from the prefix
 * cannot work: a field group whose author named its table `fg_hero` before any
 * migration existed is left untouched on the way up, and a prefix rule going
 * back down would rename it to `comp_hero` — destroying an author-chosen
 * identifier this migration never created. Nothing in the database
 * distinguishes a name we made from one that was always there; only the record
 * of what was applied does.
 *
 * Order reverses along with direction, so each column reverts while its table
 * still carries the migrated name. That is why every column entry keeps the
 * table it already names.
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
 * a step whose source table no longer exists. So callers read registry rows
 * from whichever registry is present — legacy first, then the migrated name —
 * and this function produces an identical plan from either, because the rows
 * are its only input and nothing here reads the registry's own name from the
 * database.
 */
export function buildMigrationManifest(
  rows: readonly RegistryRow[]
): MigrationManifest {
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

    if (target !== null) {
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
    }

    // Every field-group data table carries the discriminator column: the schema
    // service emits it unconditionally, and so do all three runtime schemas.
    // A table left with the legacy column while the rest of its storage moved
    // would be read against the wrong name, so the column rename is
    // unconditional too. It is addressed by the table's post-rename name where
    // there is one, because the column rename runs after the table's.
    entries.push({
      kind: "column",
      from: STORAGE_FORMAT.columns.type,
      to: MIGRATION_TARGET.columnType,
      table: target ?? row.tableName,
    });
  }

  entries.push({
    kind: "registry",
    from: STORAGE_FORMAT.registryTable,
    to: MIGRATION_TARGET.registryTable,
  });

  assertNoTargetConflict(entries, rows);

  return { entries, hash: hashManifest(entries) };
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
  // JSON rather than delimiter-joined text. `table_name` is an unconstrained
  // varchar, so a name containing the delimiters would let two different plans
  // serialize identically -- one row called
  // `a:_component_type>_field_group_type\ncolumn:b` produced the same bytes as
  // two rows called `a` and `b`. A resume would then accept a plan whose step
  // positions address different operations.
  //
  // `satisfied` is deliberately excluded: progress is not identity. A plan whose
  // steps have partly run is the same plan, and the marker must still recognise
  // it on resume.
  const canonical = JSON.stringify(
    entries.map(e => [e.kind, e.table ?? null, e.from, e.to])
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Fold a name for occupancy comparisons.
 *
 * SQLite matches table names case-insensitively and MySQL usually does, so a
 * name differing only in case still occupies the target. Folding is the safe
 * direction for that question: it is stricter than Postgres requires, and a
 * refusal before the run costs an operator one rename while a missed conflict
 * fails after the marker is written.
 *
 * It is only sound because this asks whether a name is *taken*. Asking whether
 * a name *exists* needs the opposite bias, and that question is not asked here
 * — it belongs to catalog reconciliation, which has the dialect to answer it
 * properly.
 */
function fold(name: string): string {
  return name.toLowerCase();
}

/**
 * No two entries may claim the same name, and none may claim a name a registry
 * row is keeping.
 *
 * Both are properties of the plan and its inputs, which is why they are checked
 * here rather than against the database. A row whose table is left alone — one
 * named through `dbName` — still occupies its name, and `table_name` being
 * unique does not stop `comp_hero` and `fg_hero` coexisting.
 */
function assertNoTargetConflict(
  entries: readonly ManifestEntry[],
  rows: readonly RegistryRow[]
): void {
  const renamedAway = new Set(
    entries.filter(e => e.kind !== "column").map(e => fold(e.from))
  );
  // A row this plan leaves alone keeps its companion as well as its base table,
  // so both names stay occupied. Reserving only the base name let another row's
  // companion be renamed onto a companion that is still there.
  const kept = new Set<string>();
  for (const row of rows) {
    if (renamedAway.has(fold(row.tableName))) continue;
    kept.add(fold(row.tableName));
    if (row.hasCompanion) {
      kept.add(fold(`${row.tableName}${STORAGE_FORMAT.companionSuffix}`));
    }
  }

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
