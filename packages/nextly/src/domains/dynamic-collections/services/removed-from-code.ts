/**
 * Whether a registry row describes a collection or Single removed from code.
 *
 * An entity is removed from code when its registry row's source is the app's
 * code and the running configuration no longer declares its slug. So is a
 * Single whose plugin, its source, left the configuration: its access rules,
 * hooks and validation left with it. Its tables and its row are left exactly
 * as they are by every start and configuration reload: only a migration
 * retires them. Recreating a table here would undo an applied drop with an
 * empty table, and changing one would rewrite storage the configuration no
 * longer describes.
 *
 * Keyed on `source` alone. A Schema Builder entity is never in the
 * configuration, so its absence from it says nothing. A plugin's collection
 * keeps its existing behaviour.
 *
 * Not what `nextly db:sync --remove-orphaned` deletes, which is the app's own
 * alone (`dev-build`): an entity a plugin contributed is never the app's to
 * delete.
 *
 * The one place this question is answered, so the boot, the reload, the
 * development push and `db:sync` cannot come to disagree about which entities
 * they leave alone.
 *
 * @module domains/dynamic-collections/services/removed-from-code
 */

import { isConfigOwnedSource } from "../../webhooks/recording-provenance";

/** Which registry an entity's row lives in. */
export type RemovableEntityKind = "collection" | "single";

/** The parts of a registry row the rule reads. */
export interface RegistryRowIdentity {
  slug?: string | null;
  source?: string | null;
}

export function isRemovedFromCode(
  kind: RemovableEntityKind,
  row: RegistryRowIdentity,
  declaredSlugs: ReadonlySet<string>
): boolean {
  const declaredInConfig =
    kind === "single" ? isConfigOwnedSource(row.source) : row.source === "code";
  return (
    declaredInConfig &&
    typeof row.slug === "string" &&
    !declaredSlugs.has(row.slug)
  );
}

/**
 * `rows` without those removed from code: the registry rows a schema apply may
 * carry into its desired schema beside the configuration's own entities.
 *
 * The reload and `db:sync` both preserve registry-only entities so that a
 * Schema Builder table is not read as an orphan, and both leave a removed
 * entity out of that set through this one filter.
 */
export function withoutRemovedFromCode<T extends RegistryRowIdentity>(
  kind: RemovableEntityKind,
  rows: readonly T[],
  declaredSlugs: ReadonlySet<string>
): T[] {
  return rows.filter(row => !isRemovedFromCode(kind, row, declaredSlugs));
}

/**
 * The slugs a list of configured entities declares, skipping any entry that
 * names none.
 */
export function declaredSlugsOf(
  entities: ReadonlyArray<{ slug?: string | null }> | undefined
): Set<string> {
  const slugs = new Set<string>();
  for (const entity of entities ?? []) {
    if (typeof entity.slug === "string" && entity.slug.length > 0) {
      slugs.add(entity.slug);
    }
  }
  return slugs;
}
