/**
 * What a reload has decided about each field group, in one place.
 *
 * A reload makes several decisions per group — where it is stored, whether its
 * storage could be established at all, and therefore whether this pass may
 * touch it — and every later stage needs the same answer. Held apart from the
 * reload itself because they were previously re-derived at each stage, and a
 * decision applied at one stage and not the next is the defect that shape
 * produces: skipping a group's DDL while still persisting its new field list
 * leaves the registry describing columns the table does not have.
 *
 * The rule the whole module exists to enforce:
 *
 * > A derived name is a guess about physical storage, and guessing is what
 * > creates an empty table beside the populated one the reload meant to edit.
 *
 * @module init/field-group-reload-plan
 */

import {
  readStoredFieldGroupTables,
  storedOrNewTableName,
  type RegistryReadAdapter,
} from "../domains/field-groups/services/field-group-stored-tables";

/** A field group as the config declares it, reduced to what a reload reads. */
export interface FieldGroupDef {
  slug?: string;
  fields?: unknown[];
  localized?: boolean;
}

/** A field's shape as the schema diff consumes it. */
export interface MinimalField {
  name: string;
  type: string;
  required?: boolean;
}

/** One field group this reload will address, with its stored physical name. */
export interface FieldGroupReloadTarget {
  slug: string;
  tableName: string;
  fields: MinimalField[];
  localized?: boolean;
}

/** Every decision this reload has made about its field groups. */
export interface FieldGroupReloadPlan {
  /** The groups this pass may touch. */
  targets: FieldGroupReloadTarget[];
  /**
   * Slugs left out because their storage could not be established.
   *
   * 🔴 Every stage that acts on a field group has to consult this, not only the
   * one that emits DDL. Skipping a group's schema change while still persisting
   * its new `fields` is worse than doing neither: the registry would describe
   * columns the table does not have, and the next start would build a runtime
   * schema from that description and fail every read and write for it.
   */
  skipped: Set<string>;
  /** Whether the stored names could be read at all. */
  usable: boolean;
  /** Why they could not, when they could not. */
  reason?: string;
}

/**
 * Decide, once, what this reload will do with each field group.
 *
 * Best effort by design on the read: a registry that cannot be read leaves
 * every name derived, which is exactly the behaviour of a database that has no
 * registry yet — and a registry that is present but unreadable leaves every
 * group SKIPPED, because there a derived name would address storage that is
 * not there.
 */
export async function planFieldGroupReload(
  adapter: RegistryReadAdapter,
  fieldGroups: readonly FieldGroupDef[]
): Promise<FieldGroupReloadPlan> {
  const stored = await readStoredFieldGroupTables(adapter);
  const targets: FieldGroupReloadTarget[] = [];
  const skipped = new Set<string>();

  for (const group of fieldGroups) {
    if (!group.slug) continue;
    if (!stored.usable) {
      skipped.add(group.slug);
      continue;
    }
    targets.push({
      slug: group.slug,
      tableName: storedOrNewTableName(stored, group.slug),
      fields: (group.fields ?? []) as MinimalField[],
      // Carried so the diff omits translatable columns from the group's main
      // table and registers its companion.
      localized: group.localized === true,
    });
  }

  return { targets, skipped, usable: stored.usable, reason: stored.reason };
}
