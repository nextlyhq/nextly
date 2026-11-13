/**
 * The entities whose registry rows the applied migrations still owe, which a
 * development run brings to the newest applied snapshot.
 *
 * A development run otherwise only adds the rows the registry lacks, because a
 * live sync keeps the rows in step with the code as it is edited, ahead of any
 * migration, and a run must not put an edit the sync made back to the snapshot.
 * An entity an applied migration changed is another matter: its table has what
 * the migration made, so its row must say so too.
 *
 * Which migrations still owe their rows is read from what the database stores,
 * never from what one run did: the stored schema version names the newest app
 * migration whose rows are written (`schema-version.ts`), so every applied
 * migration newer than it owes them. A run that applied a migration and then
 * failed to write a row, or stopped before it could, leaves the version where
 * it was, and the next run writes the row.
 *
 * What a migration changed is read from its snapshot against the newest
 * snapshot before it (`settingsChangesBetween`), the delta `migrate:create`
 * wrote it for. Every snapshot records every entity, so the record alone does
 * not say which ones a migration changed.
 *
 * @module domains/schema/migrate/applied-entity-changes
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  settingsChangesBetween,
  type SettingsEntityKind,
} from "../migrate-create/entity-settings";
import {
  carriesRegistryMetadata,
  parseSnapshotFile,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";

import {
  compareMigrationBaseNames,
  compareMigrationRecency,
} from "./migration-order";
import { ledgerNameOfSnapshot, type IsAppliedFn } from "./snapshot-source";

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

const SNAPSHOT_SUFFIX = ".snapshot.json";

/**
 * What the applied migrations newer than `writtenThrough` changed, the
 * migration the stored schema version names: the rows they still owe. Every
 * applied migration owes them where it is null (no version stored, or one
 * naming no migration). The snapshots are walked in run order, each applied
 * one against the newest applied one before it, whatever its age, so a
 * migration's change is read against the point it was written from.
 *
 * A snapshot that cannot be read, or one in a template's older shape, records
 * no entities: it adds nothing, and the one after it is read as the first to
 * record them.
 */
export async function outstandingEntityChanges(args: {
  migrationsDir: string;
  isApplied: IsAppliedFn;
  writtenThrough: string | null;
}): Promise<AppliedEntityChanges> {
  const changes = noAppliedEntityChanges();
  const metaDir = resolve(args.migrationsDir, "meta");
  let names: string[];
  try {
    names = await readdir(metaDir);
  } catch (error) {
    // No `meta` folder is a project with no snapshot, which owes nothing.
    if ((error as { code?: string }).code === "ENOENT") return changes;
    throw error;
  }
  const inRunOrder = names
    .filter(name => name.endsWith(SNAPSHOT_SUFFIX))
    .map(name => name.slice(0, -SNAPSHOT_SUFFIX.length))
    .sort(compareMigrationBaseNames);
  let before: Pick<SnapshotFile, "entities"> | null = null;
  for (const base of inRunOrder) {
    const file = `${base}${SNAPSHOT_SUFFIX}`;
    if (!(await args.isApplied(ledgerNameOfSnapshot(file)))) continue;
    const snapshot = await recordOf(join(metaDir, file), file);
    const owed =
      args.writtenThrough === null ||
      compareMigrationRecency(base, args.writtenThrough) > 0;
    if (owed) addAppliedEntityChanges(changes, { snapshot, before });
    before = snapshot;
  }
  return changes;
}

/** A snapshot's entity record, or none where it cannot be read as one. */
async function recordOf(
  path: string,
  file: string
): Promise<Pick<SnapshotFile, "entities">> {
  try {
    return parseSnapshotFile(await readFile(path, "utf-8"), file);
  } catch {
    return {};
  }
}
