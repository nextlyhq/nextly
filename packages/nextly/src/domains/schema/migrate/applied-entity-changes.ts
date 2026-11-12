/**
 * The entities the migrations a run applied changed, which a development run
 * brings the registry rows of to the newest applied snapshot.
 *
 * A development run otherwise only adds the rows the registry lacks, because a
 * live sync keeps the rows in step with the code as it is edited, ahead of any
 * migration, and a run must not put an edit the sync made back to the snapshot.
 * An entity a migration just changed is another matter: its table now has what
 * the migration made, so its row must say so too.
 *
 * Read from each applied migration's snapshot against the newest snapshot
 * before it (`settingsChangesBetween`), the delta `migrate:create` wrote it for.
 * Every snapshot records every entity, so the record alone does not say which
 * ones a migration changed.
 *
 * @module domains/schema/migrate/applied-entity-changes
 */
import {
  settingsChangesBetween,
  type SettingsEntityKind,
} from "../migrate-create/entity-settings";
import {
  carriesRegistryMetadata,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";

/** The slugs of each kind the migrations applied so far changed. */
export type AppliedEntityChanges = Record<SettingsEntityKind, Set<string>>;

/** None yet: a run that has applied nothing. */
export function noAppliedEntityChanges(): AppliedEntityChanges {
  return { collection: new Set(), single: new Set(), fieldGroup: new Set() };
}

/**
 * Adds what one applied migration changed: each entity its snapshot records
 * whose settings differ from the newest snapshot before it, or that it records
 * first. A snapshot without the record says nothing, so it adds nothing.
 */
export function addAppliedEntityChanges(
  changes: AppliedEntityChanges,
  applied: {
    snapshot: Pick<SnapshotFile, "entities">;
    before: Pick<SnapshotFile, "entities"> | null;
  }
): void {
  if (!carriesRegistryMetadata(applied.snapshot)) return;
  const previous = applied.before === null ? null : applied.before.entities;
  for (const change of settingsChangesBetween(
    previous,
    applied.snapshot.entities
  )) {
    changes[change.kind].add(change.slug);
  }
}
