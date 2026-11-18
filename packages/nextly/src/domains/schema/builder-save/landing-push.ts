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
