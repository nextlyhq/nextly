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
 * Whether a failure changed nothing is known only where the push stopped at
 * its first question, which the pipeline asks before any statement runs
 * (`stoppedBeforeAnyStatement`), or where a busy table's stop says so.
 *
 * @module domains/schema/builder-save/landing-push
 */
import { NextlyError } from "../../../errors/nextly-error";
import { busyTableLeftNothing } from "../busy-table/report";
import type { PromptDispatcher } from "../pipeline/pushschema-pipeline-interfaces";

type Dialect = "postgresql" | "mysql" | "sqlite";

/** What a push answers: whether it succeeded, and the failure it stopped on. */
interface PushOutcome {
  success: boolean;
  error?: { details?: unknown };
}

/**
 * `push`, noting once one of its runs may have changed the database: a run
 * that succeeded, and outside PostgreSQL every run that failed but one known
 * to have changed nothing. That is a busy table's stop that says nothing ran
 * (`leftNothing`), or a run that `stoppedBeforeAnyStatement` answers for: one
 * refused at its first question (a rename declined, a question unanswered),
 * which the pipeline asks before it runs any statement. Any other failure
 * counts as landed, data-only statements included, so its files are kept: a
 * push that asks no question, or one refused by a check of its own before any
 * statement, keeps them too.
 *
 * Only what wraps the push itself is judged: a refusal raised before the push
 * runs is never counted as landed.
 */
export function landingPush<A extends unknown[], R extends PushOutcome>(
  push: (...args: A) => Promise<R>,
  dialect: Dialect,
  stoppedBeforeAnyStatement?: {
    /** Called as each run starts, so the answer is about that run alone. */
    starting: () => void;
    stopped: () => boolean;
  }
): {
  push: (...args: A) => Promise<R>;
  landed: () => boolean;
} {
  let landed = false;
  const failureLanded = (stop: unknown): boolean =>
    !rollsBackWhole(dialect) &&
    !leftNothing(stop) &&
    stoppedBeforeAnyStatement?.stopped() !== true;
  return {
    push: async (...args: A) => {
      stoppedBeforeAnyStatement?.starting();
      let result: R;
      try {
        result = await push(...args);
      } catch (error) {
        if (failureLanded(error)) landed = true;
        throw error;
      }
      if (result.success || failureLanded(result.error?.details)) {
        landed = true;
      }
      return result;
    },
    landed: () => landed,
  };
}

/**
 * Whether a push stopped at its first question, for `landingPush`'s `stoppedBeforeAnyStatement`:
 * the pipeline asks it in planning, before the push runs any statement, and a later try of the
 * same push asks only questions not asked yet, so a refusal there (an answer not to proceed, or a
 * throw) means nothing of the push ran. A refusal at a later question may follow statements an
 * earlier try kept, so it is never answered for. The push's prompt dispatcher is handed to the
 * pipeline through `watching`; `starting` begins each push afresh.
 */
export class FirstQuestionWatch {
  private asked = 0;
  private refusedFirst = false;

  starting(): void {
    this.asked = 0;
    this.refusedFirst = false;
  }

  stopped(): boolean {
    return this.refusedFirst;
  }

  /** `inner`, noting a refusal at the first question it is asked. */
  watching(inner: PromptDispatcher): PromptDispatcher {
    return {
      dispatch: async args => {
        const first = this.asked === 0;
        this.asked += 1;
        try {
          const result = await inner.dispatch(args);
          if (first && !result.proceed) this.refusedFirst = true;
          return result;
        } catch (error) {
          if (first) this.refusedFirst = true;
          throw error;
        }
      },
    };
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
 * compared with the database. Recording them changes no registry row, and the save stopped before
 * writing its own, so `nextly migrate` follows: it brings the registry in step with the newest
 * applied snapshot on every run, with no file left to apply. Reversed, the files run again from
 * the start, by the same command.
 */
function nextSteps(keptFiles: readonly string[]): string {
  const last = keptFiles[keptFiles.length - 1];
  const record =
    keptFiles.length === 1
      ? `Finish the change by hand, run \`nextly migrate:resolve --applied ${last}\``
      : `Finish the change by hand, record the files in order: ${keptFiles
          .slice(0, -1)
          .map(
            file => `\`nextly migrate:resolve --applied ${file} --skip-verify\``
          )
          .join(
            ", "
          )}, then \`nextly migrate:resolve --applied ${last}\`, which checks the database against the last`;
  return `${record}; then run \`nextly migrate\`, which brings the registry in step with the recorded ${keptFiles.length === 1 ? "file" : "files"}. Or reverse what of it ran and run \`nextly migrate\`, which runs ${keptFiles.length === 1 ? "it" : "them"} from the start.`;
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
