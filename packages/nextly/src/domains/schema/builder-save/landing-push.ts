/**
 * Whether a schema push may have changed the database, for a save that writes
 * its migration to tell a failure before anything changed from one after it.
 *
 * A failure before anything changed withdraws the save's files; one after it
 * keeps them, recorded applied nowhere, so the next `nextly migrate` names the
 * change the database already holds part of. Only PostgreSQL's push runs in
 * one transaction that a failure rolls back whole: MySQL commits each schema
 * statement as it runs, and SQLite's push keeps the statements that ran before
 * the one that failed, so on either a push that failed may have changed it.
 * Whether it did is read from the database: the tables the change reaches, as
 * they stood before the push and as they stand after it.
 *
 * @module domains/schema/builder-save/landing-push
 */
import { NextlyError } from "../../../errors/nextly-error";
import { busyTableLeftNothing } from "../busy-table/report";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

type Dialect = "postgresql" | "mysql" | "sqlite";

/** What a push answers: whether it succeeded, and the failure it stopped on. */
interface PushOutcome {
  success: boolean;
  error?: { details?: unknown };
}

/** What reads a table's shape from the database: the adapter a push runs on. */
export interface TableReader {
  getDrizzle(): unknown;
  getCapabilities(): { dialect: Dialect };
  tableExists(name: string): Promise<boolean>;
}

/**
 * `names` as the database holds them now: those that exist, read in one snapshot, and only those
 * (an introspection can return a table whose name a requested one starts with).
 */
export async function liveTablesOf(
  adapter: TableReader,
  names: readonly string[]
): Promise<NextlySchemaSnapshot> {
  const unique = [...new Set(names)];
  const present: string[] = [];
  for (const name of unique) {
    if (await adapter.tableExists(name)) present.push(name);
  }
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.getCapabilities().dialect,
    present
  );
  return {
    ...snapshot,
    tables: snapshot.tables.filter(t => unique.includes(t.name)),
  };
}

/**
 * `push`, noting once one of its runs may have changed the database: a run
 * that succeeded, and outside PostgreSQL a run that failed after changing
 * something. A failure counts as having changed nothing where a busy table's
 * stop says itself nothing ran (`leftNothing`), or where `reached`, the tables
 * the change can touch, read the same after the push as before it: a push the
 * pipeline refused before any statement ran (a question unanswered, a
 * precondition) withdraws its files, as a refusal on PostgreSQL does. Without
 * `reached`, any failure outside PostgreSQL counts as landed.
 *
 * Only what wraps the push itself is judged: a refusal raised before the push
 * runs is never counted as landed.
 */
export function landingPush<A extends unknown[], R extends PushOutcome>(
  push: (...args: A) => Promise<R>,
  dialect: Dialect,
  reached?: { adapter: TableReader; tables: readonly string[] }
): {
  push: (...args: A) => Promise<R>;
  landed: () => boolean;
} {
  let landed = false;
  // Read only where a failure can keep part of the push: PostgreSQL's leaves nothing.
  const read =
    reached === undefined || rollsBackWhole(dialect)
      ? undefined
      : () => liveTablesOf(reached.adapter, reached.tables);
  const failureLanded = async (
    stop: unknown,
    before: NextlySchemaSnapshot | undefined
  ): Promise<boolean> => {
    if (rollsBackWhole(dialect) || leftNothing(stop)) return false;
    return read === undefined || before === undefined
      ? true
      : changedSince(before, read);
  };
  return {
    push: async (...args: A) => {
      const before = await readOrUndefined(read);
      let result: R;
      try {
        result = await push(...args);
      } catch (error) {
        if (await failureLanded(error, before)) landed = true;
        throw error;
      }
      if (
        result.success ||
        (await failureLanded(result.error?.details, before))
      ) {
        landed = true;
      }
      return result;
    },
    landed: () => landed,
  };
}

/**
 * The tables before a push, or undefined where they could not be read: the push then runs as it
 * would have, and a failure of it counts as landed, as a change may stand.
 */
async function readOrUndefined(
  read: (() => Promise<NextlySchemaSnapshot>) | undefined
): Promise<NextlySchemaSnapshot | undefined> {
  try {
    return await read?.();
  } catch {
    return undefined;
  }
}

/**
 * Whether the tables differ from `before`, by the reconcile's own test (`snapshotsEquivalent`). A
 * read that fails says nothing either way, so it counts as changed: the files are kept.
 */
async function changedSince(
  before: NextlySchemaSnapshot,
  read: () => Promise<NextlySchemaSnapshot>
): Promise<boolean> {
  const { snapshotsEquivalent } = await import("../migrate/drift-reconcile");
  try {
    return !snapshotsEquivalent(before, await read());
  } catch {
    return true;
  }
}

/**
 * A push for a writer's `appliedBy` (`writeCollectionSave`) that says when it
 * failed after changing the database. `push` is handed `onLanded`, which it
 * calls once a push it ran may have changed the database (`landingPush`). A
 * failure before that is thrown as it is, so the writer withdraws its files;
 * one after it answers `"partly-applied"`, so the writer keeps them, and is
 * held until the caller, once the writer has returned the files it kept,
 * throws it with `throwIfFailed`.
 */
export function partWayPush(push: (onLanded: () => void) => Promise<void>): {
  appliedBy: () => Promise<void | "partly-applied">;
  throwIfFailed: (keptFiles: readonly string[]) => void;
} {
  // Held in an object, as the push sets it from inside the writer.
  const failed: { error?: unknown } = {};
  return {
    appliedBy: async () => {
      let landed = false;
      try {
        await push(() => {
          landed = true;
        });
        return undefined;
      } catch (error) {
        if (!landed) throw error;
        failed.error = error;
        return "partly-applied";
      }
    },
    throwIfFailed: keptFiles => {
      if ("error" in failed) throw partlyAppliedChange(failed.error, keptFiles);
    },
  };
}

/**
 * The failure of a push that changed the database before it stopped, as the
 * admin is told it: what stopped it, that the database now holds part of the
 * change, the files kept for it, and what to run next. Its code is the
 * failure's own, so a caller reading the code (a busy table's stop, say) reads
 * it unchanged; a failure that is not a `NextlyError` is told without its
 * text, which a driver can fill with identifiers and values.
 */
function partlyAppliedChange(
  error: unknown,
  keptFiles: readonly string[]
): NextlyError {
  const kept = keptFilesText(keptFiles);
  if (NextlyError.is(error)) return withKeptFiles(error, kept, keptFiles);
  return new NextlyError({
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    publicMessage: `The schema change failed part way. ${kept}`,
    logMessage: error instanceof Error ? error.message : String(error),
    logContext: { reason: "partially-applied", keptFiles: [...keptFiles] },
    ...(error instanceof Error ? { cause: error } : {}),
  });
}

/** That the database holds part of the change, the files kept for it, and what to run next. */
function keptFilesText(keptFiles: readonly string[]): string {
  if (keptFiles.length === 0)
    return "The database now holds part of this change.";
  const one = keptFiles.length === 1;
  return `The database now holds part of this change, so ${one ? "its migration file" : "its migration files"} ${keptFiles.join(", ")} ${one ? "was" : "were"} kept and not recorded as applied. ${nextSteps(keptFiles)}`;
}

/**
 * `error` told with `kept` after its own words: its code, status, public data and log message
 * unchanged, so a caller reading any of them reads what the failure said.
 */
function withKeptFiles(
  error: NextlyError,
  kept: string,
  keptFiles: readonly string[]
): NextlyError {
  const { publicData, logMessage } = error;
  return new NextlyError({
    code: error.code,
    statusCode: error.statusCode,
    publicMessage: `${error.publicMessage} ${kept}`,
    ...(publicData === undefined ? {} : { publicData }),
    ...(logMessage === undefined ? {} : { logMessage }),
    logContext: { ...error.logContext, keptFiles: [...keptFiles] },
    cause: error,
  });
}

/**
 * What to run once the database holds part of a change `keptFiles` describe, in run order. Each
 * file's snapshot is the database as that file leaves it, so with several only the last describes
 * the finished change: the earlier ones are recorded without the comparison, and the last is
 * compared with the database. Reversed, the files run again from the start.
 */
function nextSteps(keptFiles: readonly string[]): string {
  const last = keptFiles[keptFiles.length - 1];
  const finish =
    keptFiles.length === 1
      ? `Finish the change by hand and run \`nextly migrate:resolve --applied ${last}\``
      : `Finish the change by hand, then record the files in order: ${keptFiles
          .slice(0, -1)
          .map(
            file => `\`nextly migrate:resolve --applied ${file} --skip-verify\``
          )
          .join(
            ", "
          )}, then \`nextly migrate:resolve --applied ${last}\`, which checks the database against the last`;
  return `${finish}${keptFiles.length === 1 ? "," : ";"} or reverse what of it ran and run \`nextly migrate\`, which runs ${keptFiles.length === 1 ? "it" : "them"} from the start.`;
}

/**
 * Whether a push on `dialect` runs in one transaction that a failure rolls back
 * whole, leaving nothing of it: PostgreSQL's alone.
 */
function rollsBackWhole(dialect: Dialect): boolean {
  return dialect === "postgresql";
}

/**
 * Whether `error` is a busy table's stop that left nothing of the push and
 * applied nothing before it in the run, as the stop itself records it
 * (`busyTableLeftNothing`, and the stop's `appliedBefore`), never read from
 * its message.
 */
function leftNothing(error: unknown): boolean {
  if (!NextlyError.is(error) || !busyTableLeftNothing(error)) return false;
  const stop = (
    error.logContext as { stop?: { appliedBefore?: readonly string[] } }
  ).stop;
  return (stop?.appliedBefore ?? []).length === 0;
}
