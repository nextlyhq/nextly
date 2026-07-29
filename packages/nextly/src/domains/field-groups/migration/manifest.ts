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
  /** Localized groups keep translations in a companion table. */
  localized: boolean;
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
export function retargetName(name: string): string | null {
  if (!name.startsWith(STORAGE_FORMAT.tablePrefix)) return null;
  return `${MIGRATION_TARGET.tablePrefix}${name.slice(
    STORAGE_FORMAT.tablePrefix.length
  )}`;
}

/**
 * Build the ordered rename plan.
 *
 * The registry is renamed **last**. While it still answers to its old name a
 * resumed run can rebuild this plan from it; renaming it first would leave a
 * resume unable to find the plan it was meant to finish.
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
    const target = retargetName(row.tableName);
    if (target === null) {
      // Custom-named: nothing to retire. Its column may still need renaming,
      // which is why this continues rather than skipping the row entirely.
      if (row.hasTypeColumn) {
        entries.push({
          kind: "column",
          from: STORAGE_FORMAT.columns.type,
          to: MIGRATION_TARGET.columnType,
          table: row.tableName,
        });
      }
      continue;
    }

    entries.push({ kind: "table", from: row.tableName, to: target });

    if (row.localized) {
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
        from: STORAGE_FORMAT.columns.type,
        to: MIGRATION_TARGET.columnType,
        table: target,
      });
    }
  }

  entries.push({
    kind: "registry",
    from: STORAGE_FORMAT.registryTable,
    to: MIGRATION_TARGET.registryTable,
  });

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
  const canonical = entries
    .map(e => `${e.kind}:${e.table ?? ""}:${e.from}>${e.to}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}
