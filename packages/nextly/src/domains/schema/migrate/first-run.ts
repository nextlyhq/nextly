/**
 * Which first run of `nextly migrate` a run is, decided from the ledger, the
 * migrations folder and the registry record as the run finds them, never
 * from what an earlier run did: a run that stopped part-way is finished by
 * the next one, which decides afresh (`registry-record.ts`).
 *
 * - The record exists: an ordinary run, whose registry rows come from the
 *   registry source alone, never again from the configuration.
 * - An applied app migration's snapshot carries registry metadata (a release
 *   without the record applied one this release wrote): before anything
 *   applies, the rows from the newest applied snapshot, the permissions and
 *   grants, and the record at the newest applied point, in one transaction.
 * - A pending one carries it and none applied does: the record, with the
 *   registry and the live permissions as they stand as its baseline, commits
 *   just before the first such migration applies; the rest of the run is an
 *   ordinary one.
 * - None carries it: once the pending migrations apply, the rows from the
 *   configuration, the permissions and grants, and the record with those
 *   rows as its baseline, in one transaction.
 *
 * A migration with no snapshot (hand-written, or a translations companion)
 * says nothing either way and is passed over, as the registry source passes
 * over it. One whose snapshot lacks the metadata is only ever applied before
 * every migration that carries it, and never once the record exists, so
 * after the record the newest applied point always has a registry source.
 *
 * @module domains/schema/migrate/first-run
 */
import { NextlyError } from "../../../errors/nextly-error";
import { toMinimalEntities } from "../migrate-create/config-entities";
import {
  settingsRecordOf,
  type EntitySettingsRecord,
} from "../migrate-create/entity-settings";
import {
  carriesRegistryMetadata,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";

import { DEFAULT_TABLE_NAME_RESOLVERS } from "./resolved-schema";

/** What an app migration's snapshot says of the registry. */
export type SnapshotMetadata =
  /** Its snapshot records every entity's declaration. */
  | "carries"
  /** Its snapshot predates recorded declarations. */
  | "lacks"
  /** It has no snapshot, so says nothing either way. */
  | "none";

/** One app migration, in run order, as the run finds it. */
export interface AppMigrationStanding {
  /** Its base name, as the ledger and the record name it. */
  name: string;
  applied: boolean;
  metadata: SnapshotMetadata;
}

/** Which run this is (see the module comment). */
export type FirstRun =
  | { kind: "recorded" }
  | { kind: "from-applied-snapshot" }
  | { kind: "before-migration"; migration: string }
  | { kind: "from-configuration" };

/** What a migration's snapshot, or its absence, says of the registry. */
export function snapshotMetadataOf(
  snapshot: Pick<SnapshotFile, "entities"> | null
): SnapshotMetadata {
  if (snapshot === null) return "none";
  return carriesRegistryMetadata(snapshot) ? "carries" : "lacks";
}

/** Which run this is, from whether the record exists and the migrations as found. */
export function firstRunOf(
  recorded: boolean,
  migrations: readonly AppMigrationStanding[]
): FirstRun {
  if (recorded) return { kind: "recorded" };
  if (migrations.some(m => m.applied && m.metadata === "carries")) {
    return { kind: "from-applied-snapshot" };
  }
  const first = migrations.find(m => !m.applied && m.metadata === "carries");
  return first === undefined
    ? { kind: "from-configuration" }
    : { kind: "before-migration", migration: first.name };
}

/**
 * Refuse, before anything applies, each pending migration whose snapshot
 * lacks the registry metadata where the record exists or a migration ordered
 * before it carries the metadata: nothing would record the registry after
 * it. Every such migration is named, with the fix.
 */
export function refuseMigrationsWithoutMetadata(
  recorded: boolean,
  migrations: readonly AppMigrationStanding[]
): void {
  const refused: string[] = [];
  let carriedBefore = false;
  for (const m of migrations) {
    if (!m.applied && m.metadata === "lacks" && (recorded || carriedBefore)) {
      refused.push(`${m.name}.sql`);
    }
    if (m.metadata === "carries") carriedBefore = true;
  }
  if (refused.length === 0) return;
  const named = refused.map(file => `\`${file}\``).join(", ");
  const after = recorded
    ? "the point the database's registry record was taken at"
    : "a migration that carries it";
  throw NextlyError.invalidInput({
    message:
      `${named} ${refused.length === 1 ? "has a snapshot" : "have snapshots"} ` +
      `without registry metadata, written by an earlier release's \`nextly migrate:create\`, ` +
      `and would apply after ${after}, so nothing would record the registry after ` +
      `${refused.length === 1 ? "it" : "them"}. Nothing was applied. Replace ` +
      `${refused.length === 1 ? "it" : "each"} with a migration written by this ` +
      `release's \`nextly migrate:create\`.`,
    logContext: { reason: "migration-without-registry-metadata", refused },
  });
}

/**
 * Whether the registry metadata is recorded at `point`: by the newest
 * migration at or before it that has a snapshot. The point before any app
 * migration (`null`) has none.
 */
export function pointCarriesMetadata(
  migrations: readonly AppMigrationStanding[],
  point: string | null
): boolean {
  if (point === null) return false;
  const at = migrations.findIndex(m => m.name === point);
  for (let i = at; i >= 0; i -= 1) {
    if (migrations[i].metadata !== "none") {
      return migrations[i].metadata === "carries";
    }
  }
  return false;
}

/** `count` registry rows, in words. */
function rowsInWords(count: number): string {
  return `${count} registry row${count === 1 ? "" : "s"}`;
}

/**
 * What a first run says when it writes the registry rows from the
 * configuration: how many it wrote, of how many the configuration declares,
 * and that they are kept as the registry baseline.
 */
export function configurationRowsMessage(
  written: number,
  declared: number
): string {
  return (
    `First run on this release: ${rowsInWords(written)} written from the configuration ` +
    `(${declared} declared, the rest already matched), and kept with the database's ` +
    `registry record as its baseline. From now on the registry rows come from the migrations.`
  );
}

/** The parts of a configuration its registry rows are declared in. */
export interface ConfigurationEntities {
  collections: unknown[];
  singles?: unknown[];
  fieldGroups?: unknown[];
}

/**
 * The registry rows the configuration declares: each code-first collection,
 * Single and field group (a plugin's contributions included), recorded as
 * `migrate:create` records it in a snapshot (`toMinimalEntities`,
 * `settingsRecordOf`), so the rows are written from it by the writer a
 * snapshot's are written by, and match what a start writes for the same
 * entries. Schema Builder entities are not the configuration's: their rows
 * come from the migrations the Builder writes.
 */
export function configurationRegistryRows(
  config: ConfigurationEntities
): EntitySettingsRecord {
  const { collection, single, component } = DEFAULT_TABLE_NAME_RESOLVERS;
  return (
    settingsRecordOf({
      collections: toMinimalEntities(config.collections, collection),
      singles: toMinimalEntities(config.singles ?? [], single),
      components: toMinimalEntities(config.fieldGroups ?? [], component),
    }) ?? { collections: {}, singles: {}, fieldGroups: {} }
  );
}

/** How many rows `record` declares, every kind together. */
export function declaredRowCount(record: EntitySettingsRecord): number {
  return (
    Object.keys(record.collections).length +
    Object.keys(record.singles).length +
    Object.keys(record.fieldGroups).length
  );
}
