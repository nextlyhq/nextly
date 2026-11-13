/**
 * The tries a schema change makes for a busy table: run the change as one bounded try; where the
 * try ended waiting for a lock, pause and try again, as the schedule and the total bound allow;
 * stop with a report once they run out, or at once where what the try ran may not run again.
 *
 * The loop is dialect-free: how one try is bounded and run is the caller's `attempt`, which says
 * how the try ended. Before every try after the first the run shows it still holds the schema lock
 * (`assertHeld`), so a run that lost it during a pause sends no further try.
 *
 * @module domains/schema/busy-table/tries
 */
import type { BusyTableBounds } from "./bounds";
import type { StatementJudgement } from "./judge";
import { mayStartTry, pauseAfterTry, plannedTryStarts } from "./schedule";
import type { BusyTableOutcome, BusyTableStop, EndedTry } from "./types";

/** How one try ended. */
export type TryResult<T> =
  /** The change got its locks and ran: the tries are over. */
  | { readonly kind: "done"; readonly value: T }
  /** It ended waiting for a lock. */
  | {
      readonly kind: "ended";
      readonly ended: EndedTry;
      /**
       * The first statement of what the next try would run again that may not be sent again, with
       * its judgement; undefined where everything the next try would run may run again.
       */
      readonly lasting?: {
        /** Its position in the change (1 for the first); never its text. */
        readonly statementNumber: number;
        readonly judgement: Extract<StatementJudgement, { kind: "no-retry" }>;
      };
      /** Whether the rest of the change was undone with its transaction. */
      readonly undone: boolean;
      /**
       * The positions (1 for the first) of the statements this try made durable before the wait;
       * none in a transaction.
       */
      readonly committed: readonly number[];
    };

export interface BusyTableTriesOptions {
  readonly bounds: BusyTableBounds;
  /** The change, as the operator knows it: a migration file, a down section. */
  readonly change: string;
  /** The changes this run applied before this one. */
  readonly appliedBefore: readonly string[];
  /** Prints one line on standard error at each try after the first. */
  readonly notify: (line: string) => void;
  /** The notice for a try after the first (`report.ts`'s `tryNotice`). */
  readonly notice: (input: {
    change: string;
    table: string | null;
    holder: EndedTry["holder"];
    tryNumber: number;
    plannedTries: number;
  }) => string;
  /** Refuses a run that can no longer show it holds the schema lock. */
  readonly assertHeld: () => Promise<void>;
  /** The error a stopped change throws (`report.ts`'s `tableBusyError`). */
  readonly stopped: (stop: BusyTableStop) => Error;
  /**
   * The last moment a try may still end by, beyond the total bound, where the run cannot renew
   * its schema lock while it waits (SQLite, whose holder holds the whole database); undefined
   * where it can.
   */
  readonly leaseDeadline?: () => number | undefined;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * One try's own bound at `now`: the configured one, cut where a lease bounds the tries to what is
 * left of it, so every try, the first included, ends by it (never below a millisecond, so the try
 * still asks once).
 */
function tryBoundAt(options: BusyTableTriesOptions, now: number): number {
  const lease = options.leaseDeadline?.();
  return lease === undefined
    ? options.bounds.tryMs
    : Math.max(1, Math.min(options.bounds.tryMs, lease - now));
}

/**
 * Why no try starts at `nextAt` after `result`, or undefined where one may: a statement that may
 * not be sent again ran or waited; no whole try fits before the total; or none fits before the
 * lease.
 */
function whyNoNextTry(
  options: BusyTableTriesOptions,
  result: Extract<TryResult<unknown>, { kind: "ended" }>,
  firstStartedAt: number,
  nextAt: number
): "no-retry" | "total" | "lease" | undefined {
  if (result.lasting !== undefined) return "no-retry";
  if (!mayStartTry(options.bounds, firstStartedAt, nextAt)) return "total";
  const lease = options.leaseDeadline?.();
  return lease !== undefined && nextAt + options.bounds.tryMs > lease
    ? "lease"
    : undefined;
}

/** The outcome a try that ended leaves the change in, by what it ran and what committed. */
function outcomeOf(
  result: Extract<TryResult<unknown>, { kind: "ended" }>
): BusyTableOutcome {
  if (result.lasting !== undefined) {
    return {
      kind: "no-retry",
      statementNumber: result.lasting.statementNumber,
      reason: result.lasting.judgement.reason,
      restUndone: result.undone,
    };
  }
  return result.committed.length === 0
    ? { kind: "nothing-changed" }
    : { kind: "part-way", committed: result.committed };
}

/**
 * Runs `attempt` as tries until one gets its locks, and returns what that try returned. Throws
 * `options.stopped(…)` once the tries run out, at once where a try ran a statement that may not
 * run again, and lets every other error of a try through as it is.
 */
export async function withBusyTableTries<T>(
  options: BusyTableTriesOptions,
  attempt: (tryNumber: number, tryMs: number) => Promise<TryResult<T>>
): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const plannedTries = plannedTryStarts(options.bounds).length;
  const firstStartedAt = now();
  let committed: readonly number[] = [];
  for (let tryNumber = 1; ; tryNumber++) {
    if (tryNumber > 1) await options.assertHeld();
    const result = await attempt(tryNumber, tryBoundAt(options, now()));
    if (result.kind === "done") return result.value;
    // What earlier tries made durable stays durable, and is reported with this try's.
    committed = [...committed, ...result.committed];
    const ended = { ...result, committed };
    const stop = (endedAtLease: boolean): Error =>
      options.stopped({
        change: options.change,
        ended: result.ended,
        tries: tryNumber,
        elapsedMs: now() - firstStartedAt,
        appliedBefore: options.appliedBefore,
        outcome: outcomeOf(ended),
        cause: "table-busy",
        endedAtLease,
      });
    const nextAt = now() + pauseAfterTry(tryNumber - 1);
    const ending = whyNoNextTry(options, result, firstStartedAt, nextAt);
    if (ending !== undefined) throw stop(ending === "lease");
    await sleep(nextAt - now());
    options.notify(
      options.notice({
        change: options.change,
        table: result.ended.table,
        holder: result.ended.holder,
        tryNumber: tryNumber + 1,
        // Tries that end early start sooner than planned, so more can fit: never "8 of up to 7".
        plannedTries: Math.max(plannedTries, tryNumber + 1),
      })
    );
  }
}
