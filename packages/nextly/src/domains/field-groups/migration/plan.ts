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

/**
 * The rename entries as the given direction will execute them.
 *
 * Going up that is the canonical plan unchanged; going down it is the inverse,
 * reversed. Exposed rather than kept inside the plan builder because the caller
 * has to reconcile these against the catalog *before* executing them, and
 * reconciling the canonical plan for a rollback asks the database the wrong
 * question entirely: it would find every target name legitimately present and
 * refuse a run whose whole purpose is to undo them.
 */
export function directedRenameEntries(
  direction: MigrationDirection,
  entries: readonly ManifestEntry[]
): ManifestEntry[] {
  return direction === "up" ? [...entries] : invertManifest(entries).entries;
}

/**
 * How many steps precede the renames in a plan of this direction.
 *
 * A marker records one position against the whole executable list, but
 * reconciliation scores rename entries numbered from one. Going up the data
 * steps occupy the first positions, so a recorded position has to be shifted
 * down by however many there are; going down they come last and the renames
 * already start at one.
 */
export function renamePositionOffset(
  direction: MigrationDirection,
  dataStepCount: number
): number {
  return direction === "up" ? dataStepCount : 0;
}

/**
 * How much rename progress a recorded position represents, if any.
 *
 * A marker counts positions across the whole executable list; reconciliation
 * scores rename entries numbered from one. Going up the data steps hold the
 * leading positions, so a run interrupted among them has attempted no rename at
 * all — the first one cannot start until the whole-plan position clears them.
 *
 * 🔴 Reporting that as `{ recorded: true, step: 0 }` would be wrong rather than
 * merely imprecise: reconciliation treats position `step + 1` as the supported
 * commit-before-marker window, so a zeroed position still vouches for rename
 * position 1 — and an unrelated object carrying a target name could be adopted
 * as this plan's completed work. Until a rename has actually begun, the run is
 * reported as unrecorded.
 */
export function renameRunRecord(args: {
  status: "settled" | "migrating";
  direction: MigrationDirection;
  step: number;
  offset: number;
}):
  | { recorded: false }
  | { recorded: true; direction: MigrationDirection; step: number } {
  if (args.status !== "migrating") return { recorded: false };
  const progressed = args.step - args.offset;
  if (progressed <= 0) return { recorded: false };
  return { recorded: true, direction: args.direction, step: progressed };
}

export interface BuildPlanArgs {
  /** Which way this run travels. */
  direction: MigrationDirection;
  /**
   * The rename entries **as this direction executes them**, already reconciled.
   *
   * Directed by `directedRenameEntries` rather than inverted here, so the plan
   * that runs is the same object the caller reconciled against the catalog. A
   * builder that inverted internally would execute something the reconciliation
   * never examined.
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

  // The exact reverse of the list above. `entries` already arrives inverted and
  // reversed; the data steps are reversed here and travel the other way between
  // the same two vocabularies.
  return [
    ...renameSteps(entries),
    ...dataSteps(
      FIELD_GROUP_STORAGE_VOCABULARY,
      LEGACY_STORAGE_VOCABULARY
    ).reverse(),
  ];
}

/** How many data steps a plan carries, for translating a recorded position. */
export function dataStepCount(args: {
  meta: MetaService;
  migrationId: string;
}): number {
  return buildDataMigrationSteps({
    meta: args.meta,
    migrationId: args.migrationId,
    from: LEGACY_STORAGE_VOCABULARY,
    to: FIELD_GROUP_STORAGE_VOCABULARY,
  }).length;
}
