/**
 * Assembles the ordered steps one run executes, for either direction.
 *
 * A run is two kinds of work: rewriting the vocabulary stored inside rows, and
 * renaming the tables and columns those rows live in. They are built by separate
 * modules because they have different guarantees, and joined here because a
 * marker records progress as a single position and a position only means
 * something against one list.
 *
 * 🔴 **The data steps come first going up, and the whole list reverses going
 * down.** That ordering is load-bearing rather than cosmetic. The data steps
 * reach their tables through the adapter's typed CRUD, which refuses any name
 * the ORM does not declare — and the field-group registry is declared under its
 * *legacy* name. So those steps are only expressible while that name still
 * applies: before the renames going up, and after they have been undone going
 * down. Reversing the combined list puts them in exactly those positions in both
 * directions, which is why a rollback is this same function with the direction
 * flipped rather than a second implementation.
 *
 * @module domains/field-groups/migration/plan
 */

import type { MetaService } from "../../meta/services/meta-service";
import type { IdentifierCaseRules } from "../../schema/utils/resolve-catalog-name";

import {
  buildDataMigrationSteps,
  FIELD_GROUP_STORAGE_VOCABULARY,
  LEGACY_STORAGE_VOCABULARY,
} from "./data-steps";
import { invertManifest, type ManifestEntry } from "./manifest";
import type { MigrationStep } from "./runner";
import type { MigrationDirection } from "./state";
import { buildMigrationSteps, type StorageObserver } from "./steps";

export interface BuildPlanArgs {
  /** Which way this run travels. */
  direction: MigrationDirection;
  /**
   * The canonical plan: the work that takes storage from legacy to migrated.
   *
   * Always in that direction, whichever way the run is going. A `down` run
   * inverts it here rather than being handed something pre-inverted, so a
   * resume cannot invert twice and migrate forward while believing it is
   * rolling back.
   */
  entries: readonly ManifestEntry[];
  identifierCase: IdentifierCaseRules;
  observer: StorageObserver;
  meta: MetaService;
  migrationId: string;
}

/**
 * The full step list, in execution order.
 *
 * Deterministic in its inputs: a resume rebuilds the identical list from the
 * plan the marker persisted, which is what lets a recorded position address the
 * same work it did on the run that recorded it.
 */
export function buildMigrationPlan(args: BuildPlanArgs): MigrationStep[] {
  const { direction, entries, identifierCase, observer, meta, migrationId } =
    args;

  const renameSteps = (plan: readonly ManifestEntry[]): MigrationStep[] =>
    buildMigrationSteps({ entries: plan, identifierCase, observer });

  const dataSteps = (
    from: typeof LEGACY_STORAGE_VOCABULARY,
    to: typeof LEGACY_STORAGE_VOCABULARY
  ): MigrationStep[] =>
    buildDataMigrationSteps({ meta, migrationId, from, to });

  if (direction === "up") {
    return [
      ...dataSteps(LEGACY_STORAGE_VOCABULARY, FIELD_GROUP_STORAGE_VOCABULARY),
      ...renameSteps(entries),
    ];
  }

  // The exact reverse of the list above. `invertManifest` already reverses the
  // entries and swaps each from/to, so the renames arrive in reversed order;
  // the data steps are reversed here and travel the other way between the same
  // two vocabularies.
  return [
    ...renameSteps(invertManifest(entries).entries),
    ...dataSteps(
      FIELD_GROUP_STORAGE_VOCABULARY,
      LEGACY_STORAGE_VOCABULARY
    ).reverse(),
  ];
}
