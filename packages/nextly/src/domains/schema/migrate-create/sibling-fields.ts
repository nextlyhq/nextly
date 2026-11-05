/**
 * The sibling-field rule as the migrate commands apply it.
 *
 * `migrate:check` and `migrate:create` read the definitions and the latest
 * snapshot, never the database, so the snapshot is the definition each entity
 * last had: its record of entities holds each one's fields as declared. A pair
 * of sibling fields that record holds already exists and keeps working; any
 * other pair is new and refused. An entity the snapshot does not hold is new,
 * so every pair in it is new. A snapshot written before entities were recorded
 * names only tables, so an entity whose table it holds is taken as it is, with
 * every pair existing.
 *
 * @module domains/schema/migrate-create/sibling-fields
 */

import {
  type EntitySiblingClash,
  judgeSiblingFields,
  siblingClashesErrorFor,
  type SiblingEntityKind,
  siblingClashWarning,
  siblingClashMessage,
} from "../sibling-fields";

import { isNewAgainst, type LatestSnapshot, RECORD_KEY } from "./addresses";

type Entities = ReadonlyArray<{
  slug: string;
  tableName: string;
  fields: readonly unknown[];
  /** `code` for an entity configuration declares, through `define*`. */
  settings?: { source: string };
}>;

/** The merged entities, by kind, as both commands hold them. */
export interface MigrationEntities {
  collections: Entities;
  singles: Entities;
  components: Entities;
}

/**
 * The fields the latest snapshot records for an entity: `null` when the
 * entity is new against it, so every pair is new; `undefined` when the
 * snapshot holds the entity but not its fields (written before entities were
 * recorded), so every pair is taken as existing.
 */
function previousFields(
  latest: LatestSnapshot,
  kind: SiblingEntityKind,
  entity: { slug: string; tableName: string }
): readonly unknown[] | null | undefined {
  if (isNewAgainst(latest, kind, entity)) return null;
  const recorded = latest?.data.entities?.[RECORD_KEY[kind]][entity.slug];
  if (recorded === undefined) return undefined;
  const settings = (recorded as { settings?: { fields?: unknown } }).settings;
  return Array.isArray(settings?.fields) ? settings.fields : [];
}

/**
 * Judges every merged entity's sibling fields against the latest snapshot
 * (`null` when there is none): `refused` for each new pair, `existing` for
 * each pair the entity already had.
 */
export function judgeMigrationSiblingFields(
  merged: MigrationEntities,
  latest: LatestSnapshot
): { refused: EntitySiblingClash[]; existing: EntitySiblingClash[] } {
  const kinds: Array<[SiblingEntityKind, Entities]> = [
    ["collection", merged.collections],
    ["single", merged.singles],
    ["fieldGroup", merged.components],
  ];
  const refused: EntitySiblingClash[] = [];
  const existing: EntitySiblingClash[] = [];
  for (const [kind, list] of kinds) {
    for (const declared of list) {
      const entity = { kind, slug: declared.slug };
      const previous = previousFields(latest, kind, declared);
      // Held without its fields: every pair is taken as it is.
      const judged = judgeSiblingFields(
        declared.fields,
        previous === undefined ? declared.fields : previous,
        // Configuration's entities are `define*` output; the Builder's come from its manifest.
        {
          definedInCode:
            declared.settings?.source === "code" ? kind : undefined,
        }
      );
      for (const clash of judged.refused) refused.push({ entity, clash });
      for (const clash of judged.existing) existing.push({ entity, clash });
    }
  }
  return { refused, existing };
}

/**
 * `migrate:create`'s check: logs each new pair, naming the entity, the
 * container and both fields, and throws before anything is written, so the
 * migrations folder is unchanged by a refusal.
 */
export function assertMigrationSiblingFields(
  merged: MigrationEntities,
  latest: LatestSnapshot,
  logger: { error(message: string): void }
): void {
  const { refused } = judgeMigrationSiblingFields(merged, latest);
  if (refused.length === 0) return;
  for (const { entity, clash } of refused) {
    logger.error(siblingClashMessage(entity, clash));
  }
  throw siblingClashesErrorFor(refused);
}

/**
 * `migrate:check`'s check: warns once for each pair an entity already holds
 * (it keeps working) and logs each new one. Answers the new pairs, for the
 * command to end with `siblingClashesErrorFor`; none, with no entities to judge.
 */
export function reportMigrationSiblingFields(
  merged: MigrationEntities | undefined,
  latest: LatestSnapshot,
  logger: { warn(message: string): void; error(message: string): void }
): readonly EntitySiblingClash[] {
  if (merged === undefined) return [];
  const { refused, existing } = judgeMigrationSiblingFields(merged, latest);
  for (const { entity, clash } of existing) {
    logger.warn(siblingClashWarning(entity, clash));
  }
  for (const { entity, clash } of refused) {
    logger.error(siblingClashMessage(entity, clash));
  }
  return refused;
}
