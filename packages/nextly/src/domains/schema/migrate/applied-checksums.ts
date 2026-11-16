/**
 * Which applied app migration files no longer match the checksum recorded for
 * them, and which have none recorded.
 *
 * A run records the SHA-256 of a file's whole text, its down section
 * included, on the row that records it applied (`nextly migrate`,
 * `migrate:baseline` and `migrate:resolve --applied` all do). A file edited
 * after it ran no longer matches, and the run stops on it before changing
 * anything: the database holds what the old text did, not what the new one
 * says. A row recorded without a checksum, by an earlier version, is taken
 * as matching, and the run records the file's checksum on it.
 *
 * Read from the migration's applied outcome (`migrationStanding`), never from
 * its newest record: an attempt or a cleared attempt after it carries the
 * checksum of a text that never became the outcome. A plugin's modules keep
 * their own checksum rule.
 *
 * @module domains/schema/migrate/applied-checksums
 */
import { isPluginLedgerRow } from "../events/ledger-scope";
import { migrationStanding } from "../events/migration-state";
import type { SchemaEventRow } from "../events/schema-events-repository";
import { computeMigrationHash } from "../migrate-create/snapshot-io";

/**
 * The checksum of a migration file's whole text, down section included: the
 * one value a run records on the applied row, `migrate:baseline` and
 * `migrate:resolve --applied` record, and every reader compares.
 */
export function checksumOf(content: string): string {
  // The hash the paired snapshot records as `migrationHash`: one hash of a
  // migration file's text, wherever it is recorded.
  return computeMigrationHash(content);
}

/** A SHA-256 in hex, as a run records it. */
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Whether a ledger value is a recorded checksum. A row an earlier version
 * wrote may carry none, or the text `null` an earlier ledger backfill copied
 * in its place; neither is one.
 */
export function isRecordedChecksum(value: string | null): value is string {
  return value !== null && SHA256.test(value);
}

type ChecksumRow = Pick<
  SchemaEventRow,
  | "id"
  | "eventType"
  | "status"
  | "startedAt"
  | "filename"
  | "supersededEventIds"
  | "sha256"
>;

export interface AppliedChecksums {
  /** Applied files whose text differs from their recorded checksum, in folder order. */
  changed: string[];
  /** Applied files with no checksum recorded, the row to record it on, and the file's checksum. */
  unrecorded: Array<{ filename: string; outcomeId: string; checksum: string }>;
}

/**
 * The applied app files in `files` (by ledger name, with the checksum of
 * their text now) that changed since they ran, and those whose applied row
 * records no checksum. Files not applied, and plugin modules, are not read.
 */
export function appliedChecksums(
  files: ReadonlyArray<{ filename: string; checksum: string }>,
  rows: readonly ChecksumRow[]
): AppliedChecksums {
  const byFilename = new Map<string, ChecksumRow[]>();
  for (const row of rows) {
    if (row.filename === null || isPluginLedgerRow(row.filename)) continue;
    const list = byFilename.get(row.filename);
    if (list) list.push(row);
    else byFilename.set(row.filename, [row]);
  }
  const result: AppliedChecksums = { changed: [], unrecorded: [] };
  for (const file of files) {
    const standing = migrationStanding(byFilename.get(file.filename) ?? []);
    if (standing.state !== "applied" || standing.outcome === undefined) {
      continue;
    }
    const recorded = standing.outcome.sha256;
    if (!isRecordedChecksum(recorded)) {
      result.unrecorded.push({
        filename: file.filename,
        outcomeId: standing.outcome.id,
        checksum: file.checksum,
      });
    } else if (recorded !== file.checksum) {
      result.changed.push(file.filename);
    }
  }
  return result;
}
