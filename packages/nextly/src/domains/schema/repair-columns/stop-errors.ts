/**
 * What `nextly repair-columns` stops on: a record of what the database last had applied that it
 * cannot read, each refusal naming the record and what to do about it.
 *
 * Every error is a `CONFIGURATION_ERROR` whose public message stays generic, as the server's is.
 * Its three parts go in its context, where the CLI reads them, and its log message is the parts
 * together.
 *
 * @module domains/schema/repair-columns/stop-errors
 */
import { NextlyError } from "../../../errors";
import { shellQuote } from "../migrate/drift-error";
import { BLANK_FILE_LINE } from "../migrate/history-line-names";
import { describeHolder, type SchemaLockHolder } from "../pipeline/schema-lock";

import {
  APPLIED_MIGRATION_FILE_MISSING_REASON,
  APPLIED_SNAPSHOT_INVALID_REASON,
  APPLIED_SNAPSHOT_MISSING_REASON,
  APPLIED_SNAPSHOTS_LOST_REASON,
  MIGRATION_SNAPSHOTS_UNREADABLE_REASON,
  REGISTRY_ROW_DIVERGED_REASON,
  REGISTRY_ROW_WITHOUT_TABLE_REASON,
  SNAPSHOT_WITHOUT_ENTITIES_REASON,
} from "./stop-reasons";

/** The kinds of entity a registry holds. */
type RegistryKind = "collection" | "single" | "fieldGroup";

/** A registry row that stops the run. */
export interface StoppingRow {
  kind: RegistryKind;
  slug: string;
  /** The registry table the row is in. */
  registryTable: string;
  /** Whether code owns the entity (`isCodeOwned`), so the code sync repairs its row. */
  codeOwned: boolean;
}

const RUN_AGAIN = "then run `nextly repair-columns` again.";
const UNKNOWN_APPLIED =
  "so what the database last had applied cannot be known.";

/** Each kind as a message about its registry rows names it, one row and several. */
const KIND_LABELS: Record<RegistryKind, readonly [string, string]> = {
  collection: ["collection", "collections"],
  single: ["Single", "Singles"],
  fieldGroup: ["field group", "field groups"],
};

/** A list as a sentence holds it: `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The rows' slugs, each quoted. */
const slugs = (rows: readonly StoppingRow[]) =>
  listed(rows.map(row => `"${row.slug}"`));

/** The rows by kind, in the order given: `the collections "a" and "b" and the Single "c"`. */
function namedRows(rows: readonly StoppingRow[]): string {
  const kinds = [...new Set(rows.map(row => row.kind))];
  return listed(
    kinds.map(kind => {
      const own = rows.filter(row => row.kind === kind);
      return `the ${KIND_LABELS[kind][own.length === 1 ? 0 : 1]} ${slugs(own)}`;
    })
  );
}

/**
 * The error of one refusal: its parts for the CLI, and together as the log's line, with the failure
 * under it, which `--verbose` shows.
 */
function stopError(
  reason: string,
  parts: { what: string; why: string; next: string },
  context: Record<string, unknown>,
  cause?: unknown
): NextlyError {
  return NextlyError.configuration({
    logMessage: `${parts.what} ${parts.why} ${parts.next}`,
    logContext: { ...context, reason, parts },
    ...(cause instanceof Error ? { cause } : {}),
  });
}

/** The rows that name no table, where their columns are cannot be known. */
export function rowsWithoutTableError(
  rows: readonly StoppingRow[]
): NextlyError {
  const tables = listed([
    ...new Set(rows.map(row => `\`${row.registryTable}\``)),
  ]);
  const [first] = rows;
  const parts =
    rows.length === 1
      ? {
          what: `The registry row of ${namedRows(rows)} names no table.`,
          why: `Its \`table_name\` in ${tables} is empty, so where the ${KIND_LABELS[first.kind][0]}'s columns are cannot be known.`,
          next: `Set the row's \`table_name\` to the ${KIND_LABELS[first.kind][0]}'s table, ${RUN_AGAIN}`,
        }
      : {
          what: `The registry rows of ${namedRows(rows)} name no table.`,
          why: `Their \`table_name\` in ${tables} is empty, so where their columns are cannot be known.`,
          next: `Set each row's \`table_name\` to its table, ${RUN_AGAIN}`,
        };
  return stopError(REGISTRY_ROW_WITHOUT_TABLE_REASON, parts, { rows });
}

/**
 * What clears a diverged row's mark. A field group the admin owns has the admin's repair, on the
 * Schema Builder's pages, which production does not show. For one code owns, the code-first sync
 * makes the repair, as the admin's would be refused or overwritten; only a development start and
 * `nextly db:sync` run it (`nextly migrate` and a production start leave the mark). Nextly marks no
 * collection or Single, so neither has a repair.
 */
function divergedNext(rows: readonly StoppingRow[]): string {
  const groups = rows.filter(row => row.kind === "fieldGroup");
  const own = groups.filter(row => !row.codeOwned);
  const fromCode = groups.filter(row => row.codeOwned);
  const others = rows.filter(row => row.kind !== "fieldGroup");
  const steps = [
    ...(own.length > 0
      ? [
          `In development, open Field Groups in the admin and choose "Repair definition" on ${slugs(own)}.`,
        ]
      : []),
    ...(fromCode.length > 0
      ? [
          `In development, run \`nextly db:sync\` or start the app, which repairs ${slugs(fromCode)} where the configuration declares ${fromCode.length === 1 ? "it" : "them"}.`,
        ]
      : []),
    ...(others.length > 0
      ? [
          others.length === 1
            ? `Make the stored definition of ${namedRows(others)} match its tables and set its \`migration_status\` to \`synced\`.`
            : `Make the stored definitions of ${namedRows(others)} match their tables and set their \`migration_status\` to \`synced\`.`,
        ]
      : []),
  ];
  return `${steps.join(" ")} Then run \`nextly repair-columns\` again.`;
}

/** The rows marked as diverged: neither they nor an older record say what the database holds. */
export function rowsDivergedError(rows: readonly StoppingRow[]): NextlyError {
  const one = rows.length === 1;
  return stopError(
    REGISTRY_ROW_DIVERGED_REASON,
    {
      what: `The registry ${one ? "row" : "rows"} of ${namedRows(rows)} ${one ? "is" : "are"} marked as diverged.`,
      why: one
        ? `Its tables were changed and its stored definition still describes the previous shape, ${UNKNOWN_APPLIED}`
        : `Their tables were changed and their stored definitions still describe the previous shape, ${UNKNOWN_APPLIED}`,
      next: divergedNext(rows),
    },
    { rows }
  );
}

/** An applied migration's snapshot holding something that is not one; `why` is a sentence. */
export function appliedSnapshotInvalidError(
  file: string,
  why: string,
  cause?: unknown
): NextlyError {
  return stopError(
    APPLIED_SNAPSHOT_INVALID_REASON,
    {
      what: `The snapshot file \`meta/${file}\` is invalid.`,
      why: `${why} Its migration is applied, ${UNKNOWN_APPLIED}`,
      next: "Restore it from version control; if a newer version of Nextly wrote it, upgrade `nextly` to that version. Then run `nextly repair-columns` again.",
    },
    { file },
    cause
  );
}

/**
 * An applied migration's snapshot with no migration file beside it. Named by the migration, since
 * its file may have been a dialect's variant alone.
 */
export function appliedMigrationFileMissingError(
  file: string,
  migration: string
): NextlyError {
  return stopError(
    APPLIED_MIGRATION_FILE_MISSING_REASON,
    {
      what: `The snapshot \`${file}\` exists but no migration file of \`${migration}\` does.`,
      why: `The migration is applied, and a snapshot is read only with its migration file beside it, ${UNKNOWN_APPLIED}`,
      next: `Restore the migration's .sql file from version control, or, if it was removed on purpose, record that with \`nextly migrate:resolve --removed <file>\`, ${RUN_AGAIN}`,
    },
    { file, migration }
  );
}

/**
 * Applied migrations newer than `newest`, the newest whose snapshot is there, that have none: their
 * snapshots are what the database last had applied, and `newest`'s would convert columns back.
 */
export function appliedSnapshotsMissingError(
  migrations: readonly string[],
  newest: string
): NextlyError {
  const one = migrations.length === 1;
  const snapshots = listed(
    migrations.map(name => `\`meta/${name}.snapshot.json\``)
  );
  return stopError(
    APPLIED_SNAPSHOT_MISSING_REASON,
    {
      what: `The applied ${one ? "migration" : "migrations"} ${listed(migrations.map(name => `\`${name}\``))} ${one ? "has" : "have"} no snapshot in \`meta/\`.`,
      why: `${one ? "It is" : "They are"} newer than \`${newest}\`, whose snapshot is the newest applied one there is, ${UNKNOWN_APPLIED}`,
      next: `Restore ${snapshots} from version control. For SQL you wrote yourself, which has none, put its file back if it was removed and add the line \`${BLANK_FILE_LINE}\` to its header, above \`-- UP\`, then accept the edit with \`nextly migrate:resolve --applied ${one ? shellQuote(migrations[0]) : "<migration>"} --skip-verify\`. Then run \`nextly repair-columns\` again.`,
    },
    { migrations, newest }
  );
}

/**
 * Applied migrations `migrate:create` wrote that have no snapshot, where the database records that
 * snapshots were written for them (its registry record) and none that records entities is left: an
 * older record, or a registry row a start may have rewritten, would stand in for what was applied.
 */
export function appliedSnapshotsLostError(
  migrations: readonly string[]
): NextlyError {
  const one = migrations.length === 1;
  return stopError(
    APPLIED_SNAPSHOTS_LOST_REASON,
    {
      what: `The applied ${one ? "migration" : "migrations"} ${listed(migrations.map(name => `\`${name}\``))} ${one ? "has" : "have"} no snapshot in \`meta/\`.`,
      why: `The database records that snapshots were written for ${one ? "it" : "them"}, so what it last had applied cannot be known, and the registry rows may have been rewritten since.`,
      next: "Restore `meta/` from version control, then run `nextly repair-columns` again. If they were never committed, then with the configuration as it was at the last `nextly migrate`, run `nextly migrate:create`, then `nextly migrate`, which records the entities as they are; then run `nextly repair-columns` again.",
    },
    { migrations }
  );
}

/**
 * The newest applied snapshot, `newer`'s, records no entities and the older `older`'s does: an
 * earlier release's `migrate:create` wrote it, and judging by `older` would undo what it applied.
 */
export function snapshotWithoutEntitiesError(
  newer: string,
  older: string
): NextlyError {
  return stopError(
    SNAPSHOT_WITHOUT_ENTITIES_REASON,
    {
      what: `The applied migration \`${newer}\` has a snapshot that records no entities, and the older \`${older}\` has one that does.`,
      why: `An earlier release's \`migrate:create\` wrote it. Its migration changed the tables after \`${older}\`, so judging the columns by \`${older}\` would convert them back.`,
      next: 'Run `nextly migrate:create --name="<migration-name>"`, then `nextly migrate`: the migration it writes records the entities as they are. Then run `nextly repair-columns` again.',
    },
    { newer, older }
  );
}

/** The system's own words for a read that failed. */
const readFailure = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** Whether the system refused a read for want of permission. */
const isPermission = (cause: unknown) =>
  ["EACCES", "EPERM"].includes(String((cause as { code?: unknown })?.code));

/** What to do about a read of `thing` that failed: a permission is granted, anything else put right. */
const readRemedy = (thing: string, cause: unknown) =>
  isPermission(cause)
    ? `Make ${thing} readable by the user running the command, ${RUN_AGAIN}`
    : `Put right what that error names, ${RUN_AGAIN}`;

/**
 * The snapshots folder cannot be read, or (`folder`) the migrations folder that says which of its
 * snapshots count, which the next step then names.
 */
export function snapshotFolderUnreadableError(
  metaDir: string,
  cause: unknown,
  folder: string = metaDir
): NextlyError {
  const named = folder === metaDir ? "the folder" : `the folder \`${folder}\``;
  return stopError(
    MIGRATION_SNAPSHOTS_UNREADABLE_REASON,
    {
      what: `The migration snapshots in \`${metaDir}\` could not be read.`,
      why: readFailure(cause),
      next: readRemedy(named, cause),
    },
    { metaDir, folder },
    cause
  );
}

/** An applied migration's snapshot that was listed and cannot be opened, or is gone since. */
export function snapshotFileUnreadableError(
  file: string,
  cause: unknown
): NextlyError {
  const gone = (cause as { code?: unknown })?.code === "ENOENT";
  return stopError(
    MIGRATION_SNAPSHOTS_UNREADABLE_REASON,
    {
      what: `The migration snapshot \`meta/${file}\` could not be read.`,
      why: gone
        ? "It was there when the command listed the folder, and gone when it was read."
        : readFailure(cause),
      next: gone
        ? `Restore the snapshot from version control, ${RUN_AGAIN}`
        : readRemedy("the file", cause),
    },
    { file },
    cause
  );
}

/** An applied migration's snapshot that could not be read when the run read it, and now can be. */
export function snapshotReadFailedOnceError(file: string): NextlyError {
  return stopError(
    MIGRATION_SNAPSHOTS_UNREADABLE_REASON,
    {
      what: `The migration snapshot \`meta/${file}\` could not be read.`,
      why: "Reading it failed once, and then worked: it may have been written to meanwhile.",
      next: "Run `nextly repair-columns` again.",
    },
    { file }
  );
}

/**
 * A run that holds the schema lock keeps this one, which takes none, from reading what it leaves:
 * the refusal `command` gets from the lock itself, in its words.
 */
export function schemaLockHeldError(
  command: string,
  holder: SchemaLockHolder
): NextlyError {
  const named = describeHolder(holder);
  return new NextlyError({
    code: "NEXTLY_MIGRATE_LOCK_BUSY",
    publicMessage: `\`${command}\` did not start, and changed nothing: the schema lock is still held. ${named.charAt(0).toUpperCase()}${named.slice(1)} Run it again once that finishes.`,
    logContext: { reason: "schema lock held", command, holder },
  });
}
