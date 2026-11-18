/**
 * Whether a schema push may have changed the database, for a save that writes
 * its migration to tell a failure before anything changed from one after it.
 *
 * A failure before anything changed withdraws the save's files; one after it
 * keeps them, recorded applied nowhere, so the next `nextly migrate` names the
 * change the database already holds part of. Only PostgreSQL's push runs in
 * one transaction that a failure rolls back whole: MySQL commits each schema
 * statement as it runs, and SQLite's push keeps the statements that ran before
 * the one that failed, so on either any push that failed may have changed it.
 *
 * @module domains/schema/builder-save/landing-push
 */
import { NextlyError } from "../../../errors/nextly-error";
import { busyTableLeftNothing } from "../busy-table/report";

/** What a push answers: whether it succeeded, and the failure it stopped on. */
interface PushOutcome {
  success: boolean;
  error?: { details?: unknown };
}

/**
 * `push`, noting once one of its runs may have changed the database: a run
 * that succeeded, and outside PostgreSQL any run that failed, since a run
 * refused part way may have left some of its statements applied. The one
 * exception is a busy table's stop that says itself nothing ran
 * (`leftNothing`): its files are withdrawn, as a refusal on PostgreSQL's are.
 *
 * Only what wraps the push itself is judged: a refusal raised before the push
 * runs is never counted as landed.
 */
export function landingPush<A extends unknown[], R extends PushOutcome>(
  push: (...args: A) => Promise<R>,
  dialect: "postgresql" | "mysql" | "sqlite"
): {
  push: (...args: A) => Promise<R>;
  landed: () => boolean;
} {
  let landed = false;
  return {
    push: async (...args: A) => {
      try {
        const result = await push(...args);
        if (
          result.success ||
          (!rollsBackWhole(dialect) && !leftNothing(result.error?.details))
        ) {
          landed = true;
        }
        return result;
      } catch (error) {
        if (!rollsBackWhole(dialect) && !leftNothing(error)) landed = true;
        throw error;
      }
    },
    landed: () => landed,
  };
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
  const files = keptFiles.join(", ");
  const resolve =
    keptFiles.length === 1
      ? `\`nextly migrate:resolve --applied ${files}\``
      : `\`nextly migrate:resolve --applied <file>\` for each of them`;
  const kept =
    keptFiles.length === 0
      ? "The database now holds part of this change."
      : `The database now holds part of this change, so its migration ${keptFiles.length === 1 ? "file" : "files"} ${files} ${keptFiles.length === 1 ? "was" : "were"} kept and not recorded as applied. ` +
        `Finish the change by hand and run ${resolve}, or reverse what of it ran and run \`nextly migrate\`, which runs ${keptFiles.length === 1 ? "it" : "them"} from the start.`;
  if (NextlyError.is(error)) {
    return new NextlyError({
      code: error.code,
      statusCode: error.statusCode,
      publicMessage: `${error.publicMessage} ${kept}`,
      ...(error.publicData === undefined
        ? {}
        : { publicData: error.publicData }),
      ...(error.logMessage === undefined
        ? {}
        : { logMessage: error.logMessage }),
      logContext: { ...error.logContext, keptFiles: [...keptFiles] },
      cause: error,
    });
  }
  return new NextlyError({
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    publicMessage: `The schema change failed part way. ${kept}`,
    logMessage: error instanceof Error ? error.message : String(error),
    logContext: { reason: "partially-applied", keptFiles: [...keptFiles] },
    ...(error instanceof Error ? { cause: error } : {}),
  });
}

/**
 * Whether a push on `dialect` runs in one transaction that a failure rolls back
 * whole, leaving nothing of it: PostgreSQL's alone.
 */
function rollsBackWhole(dialect: "postgresql" | "mysql" | "sqlite"): boolean {
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
