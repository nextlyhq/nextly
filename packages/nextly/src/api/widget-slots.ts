/**
 * How a widget batch's queries are run, once each has passed its own checks: the
 * per-slot budget, the encoding guard, the failure each becomes, and the grouping
 * by source.
 *
 * ONE path for every query. A source whose author wrote a many-query resolver
 * and has more than one query in the batch is asked once, for all of them, under
 * one budget; every other query is answered on its own, under its own. Either
 * way the budget, the abort signal, the encoding guard and the failure mapping
 * are the ones below, so the two ways of answering cannot drift apart.
 *
 * Its own module so the endpoint's tests can mock the executor without losing
 * this, as `domains/widgets/executable-source.ts` was extracted for.
 *
 * @module api/widget-slots
 */

import { answerAsAsked } from "../domains/widgets/answer-as-asked";
import type { BatchScope } from "../domains/widgets/batch-scope";
import {
  resolveExecutableSource,
  type ExecutableSource,
} from "../domains/widgets/executable-source";
import { executeWidgetQuery } from "../domains/widgets/execute";
import type { WidgetQuery } from "../domains/widgets/query";
import type {
  ManySourceResolver,
  WidgetScope,
} from "../domains/widgets/resolved-sources";
import type { WidgetResult, WidgetSlot } from "../domains/widgets/result";
import {
  isUnavailableSourceRefusal,
  UNAVAILABLE_SOURCE_MESSAGE,
} from "../domains/widgets/sources";
import { NextlyError } from "../errors/nextly-error";
import { getNextlyLogger } from "../observability/logger";
import type { ReadCaller } from "../services/dashboard/readable-resources";

type QuerySlot = WidgetSlot;

/**
 * What a slot says when the failure is not a `NextlyError`.
 *
 * The same sentence `NextlyError.internal` carries, deliberately: a driver or
 * `DbError` message names columns, tables and SQL fragments, and this endpoint
 * is reachable by any authenticated session or API key.
 */
const GENERIC_SLOT_ERROR = "An unexpected error occurred.";

/**
 * What a failure becomes: logged where an operator can read it, redacted where
 * the caller can.
 *
 * Two things this must do that the original catch did neither of.
 *
 * It must not put `error.message` on the wire. Every other boundary in this
 * package maps a non-`NextlyError` to `NextlyError.internal`, whose
 * `publicMessage` is generic, and only `toResponseJSON` reaches a caller. Here
 * a `DbError` or a raw driver error was serialized verbatim under HTTP 200 --
 * reproducible with
 * `{"source":"collection:posts","op":"list","where":{"createdAt":{"greater_than":"not-a-date"}}}`.
 * A `NextlyError`'s `publicMessage` IS public by construction, so it passes
 * through; anything else is replaced.
 *
 * And it must not swallow the failure. Isolating a widget's error into its own
 * slot is the point of the batch shape, but the batch still answers 200, so
 * `withErrorHandler` never sees it and neither did the logger. A dashboard
 * whose widgets all fail left no trace anywhere.
 */
// Narrowed to the failure arm so a caller can read the slot's `code` without a guard.
export function failedSlot(error: unknown): Extract<QuerySlot, { ok: false }> {
  // Guarded the way `withErrorHandler` guards its own logging call: a
  // thrower's `logContext` is arbitrary, and a cycle or a BigInt in it would
  // throw from inside this catch and fail the whole batch over one slot.
  try {
    getNextlyLogger().error({
      kind: "widget-query-failed",
      ...(NextlyError.is(error)
        ? error.toLogJSON("widget-query")
        : { err: error instanceof Error ? error.stack : String(error) }),
    });
  } catch {
    // Deliberately swallowed; see above.
  }

  // The shared refusal, from any of its call sites -- unknown, not executable, not readable by
  // this caller, or unable to answer the op -- answers with the typed code, so the card shows
  // "not available" without matching the sentence. A FORBIDDEN raised while the query ran is not
  // one of them: the gate above has already refused a source the caller may not read, so that
  // one comes from a field-level rule on a source they can, and names the guard that refused.
  if (isUnavailableSourceRefusal(error)) {
    return {
      ok: false,
      error: UNAVAILABLE_SOURCE_MESSAGE,
      code: "unavailable",
    };
  }
  return {
    ok: false,
    error: NextlyError.is(error) ? error.publicMessage : GENERIC_SLOT_ERROR,
  };
}

/**
 * How long one slot may take before the batch stops waiting for it.
 *
 * 🔴 The batch aggregates with `Promise.all`, so it is only as fast as its
 * SLOWEST slot: one query that never settles holds every other card on the
 * dashboard behind it, and the reader sees nothing at all rather than the
 * seven cards that answered. That is the failure this bound exists for, and it
 * is not hypothetical for a source answered by a resolver -- a resolver may
 * make a network call, and a dead outbound connection does not reject, it
 * hangs for whatever the socket's own timeout is.
 *
 * Thirty seconds, following Grafana's `[dataproxy] timeout` default for the
 * same kind of call. Generous on purpose: the bound is here to stop a hang
 * becoming an outage, not to police a slow-but-working query, and cutting off
 * a large but legitimate aggregate would be a worse card than a slow one.
 */
export const SLOT_TIMEOUT_MS = 30_000;

/**
 * Starts `work` with a cancellation signal and gives up on it after
 * {@link SLOT_TIMEOUT_MS}.
 *
 * 🔴 A race ABANDONS rather than cancels, and it cannot do otherwise: a
 * promise has no cancellation, so giving up on the race does not stop the work.
 * Abandoned work keeps its connection, its memory and its database handle, and
 * the endpoint's cap is on the queries ONE request may ask for -- so a resolver
 * that hangs stays running while the next request starts up to thirty more.
 *
 * The signal is how that is bounded. It is handed to `work` when it starts and
 * aborted the moment the budget expires, so a resolver that passes it on --
 * `fetch` takes one directly -- stops rather than merely stops being awaited.
 * Cooperative, necessarily: a resolver that ignores it is uninterruptible, as
 * every resolver was before, and this bounds what the host can offer rather
 * than what it can guarantee.
 *
 * `start` is a FUNCTION rather than a promise so the signal exists before the
 * work does. Handed an already-running promise, there is nothing to give a
 * signal to.
 *
 * Two further consequences are handled here rather than left to surprise
 * someone. The abandoned promise may reject later with nobody awaiting it -- an
 * unhandled rejection, which crashes the process under Node's default policy --
 * so a no-op handler is attached to the ORIGINAL promise, which marks it
 * handled without changing what the race sees. And the timer must not hold the
 * event loop open: a slot that answered in a millisecond would otherwise keep
 * the process alive for the remaining thirty seconds, which in a test run means
 * a suite that will not exit.
 */
export async function withinSlotBudget<T>(
  start: (signal: AbortSignal) => Promise<T>,
  onTimeout: () => never,
  batch?: AbortSignal
): Promise<T> {
  // A batch nobody is waiting for any more starts no new work: a slot reached
  // after the reader left is refused before its resolver is called at all.
  if (batch?.aborted) slotCancelled();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol("widget-slot-timeout");
  const cancelled = Symbol("widget-batch-cancelled");
  const controller = new AbortController();
  // The slot's one signal is aborted by EITHER end: its own budget running out,
  // or the batch it belongs to being given up (the reader closed the stream).
  // A resolver honours one signal whichever of the two fired.
  let onBatchAbort: (() => void) | undefined;
  const batchGone = new Promise<typeof cancelled>(resolve => {
    onBatchAbort = () => {
      controller.abort();
      resolve(cancelled);
    };
    batch?.addEventListener("abort", onBatchAbort, { once: true });
  });
  const work = start(controller.signal);
  try {
    // Attached to `work` itself, not to the race's result: the race settles on
    // whichever arm wins, so on a timeout nothing would ever observe `work`.
    void work.catch(() => undefined);

    const deadline = new Promise<typeof timedOut>(resolve => {
      timer = setTimeout(() => resolve(timedOut), SLOT_TIMEOUT_MS);
      timer.unref?.();
    });

    const outcome = await Promise.race([work, deadline, batchGone]);
    if (outcome === cancelled) slotCancelled();
    // `onTimeout` returns `never`, so the compiler narrows `outcome` to `T`
    // past this line without an assertion.
    if (outcome === timedOut) {
      // Before the throw, because `onTimeout` never returns -- and the point of
      // the signal is that the abandoned work is told, not merely dropped.
      controller.abort();
      onTimeout();
    }
    return outcome;
  } finally {
    if (timer) clearTimeout(timer);
    if (onBatchAbort) batch?.removeEventListener("abort", onBatchAbort);
  }
}

/**
 * The failure of a slot whose batch was given up. Nobody reads it -- the
 * reader that asked has gone -- so it exists to end the slot's work and leave a
 * line for the operator, not to explain anything.
 */
function slotCancelled(): never {
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "This widget's request was cancelled",
    logMessage: "widget batch cancelled before this slot answered",
    logContext: { reason: "widget-batch-cancelled" },
  });
}

/**
 * The result, proven to survive the response encoder, inside the slot's own
 * boundary.
 *
 * 🔴 `respondData` calls `JSON.stringify` over the WHOLE results array, after
 * `Promise.all` has assembled it and outside every slot's `catch`. So a value
 * the encoder refuses does not fail its own slot -- it throws at the response,
 * and the endpoint answers 500 with every sibling's rows discarded. One
 * plugin's bad row blanks the dashboard, which is the precise outcome the
 * per-slot shape exists to prevent.
 *
 * `WidgetResult`'s rows are `Record<string, unknown>`, so a `bigint`, a cycle
 * or a throwing `toJSON` all satisfy the type. A resolver is third-party code;
 * it is not the host's business to trust that it returned something encodable,
 * and the type system cannot say so.
 *
 * Encoded HERE, where a failure is caught and becomes this slot's error. The
 * cost is one serialization of a payload that is about to be serialized
 * anyway, and the parse back is what keeps the encoder from doing it twice on
 * a value it has already refused once.
 */
export function serialisable(
  result: WidgetResult,
  subject: SlotSubject
): WidgetResult {
  try {
    return JSON.parse(JSON.stringify(result)) as WidgetResult;
  } catch (error) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "This widget returned something that could not be sent",
      logMessage: `${named(subject)} returned an unserialisable result`,
      logContext: {
        reason: "widget-result-unserialisable",
        ...subject,
        err: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** A query that passed its own read check and validation, at its place in the batch. */
export interface ReadyQuery {
  kind?: "query";
  index: number;
  query: WidgetQuery;
  executable: ExecutableSource;
}

/**
 * A declared card's own data, at its place in the batch: what core runs for a
 * declared widget's card, as the person asking, under the card's own budget.
 */
export interface ReadyCardData {
  kind: "data";
  index: number;
  /** The declared widget, named for the operator when its card fails or runs out of time. */
  widgetId: string;
  /** Who declared it, whose view of the batch's scope its data computes through. */
  owner: string;
  /**
   * The card's answer as a slot carries it, and whether its empty test holds.
   * Handed the card's own signal, aborted at its budget or when the batch is
   * given up, and its owner's view of the batch's scope.
   */
  answer(input: {
    signal: AbortSignal;
    scope: WidgetScope;
    /** The batch's instant, the card's own copy. */
    now: Date;
  }): Promise<CardAnswer>;
}

/**
 * What a declared card answers: its data and whether its empty test holds, or
 * the slot it settles as without data, decided before its `load` ran (it asks
 * for a setting, is not shown, or is not available to this person). None of
 * those is a failure, so none is logged as one.
 */
export type CardAnswer =
  | { result: WidgetResult; empty: boolean }
  | { settled: Extract<QuerySlot, { ok: false }> };

/** Anything a batch answers at its place: a ready query, or a declared card's own data. */
export type ReadyEntry = ReadyQuery | ReadyCardData;

/**
 * What a failed or late slot names for the operator: the source asked, or the
 * declared widget and the owner that declared it.
 */
type SlotSubject = { source: string } | { widget: string; owner?: string };

/** A slot's subject as the log names it. */
function named(subject: SlotSubject): string {
  return "source" in subject
    ? `widget source "${subject.source}"`
    : `declared widget "${subject.widget}"`;
}

/** The failure a slot that ran out of time becomes, naming its subject for the operator. */
function slotTimedOut(subject: SlotSubject): never {
  // A `NextlyError`, so `failedSlot` puts THIS sentence on the wire rather than
  // the generic one: a card that timed out is worth telling its reader about,
  // and the source id is already known to them -- they placed the card. The
  // slug travels in `logContext` for the operator, who needs to know WHICH
  // source is hanging.
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "This widget took too long to answer",
    logMessage: `${named(subject)} exceeded ${SLOT_TIMEOUT_MS}ms`,
    logContext: {
      reason: "widget-slot-timeout",
      ...subject,
      timeoutMs: SLOT_TIMEOUT_MS,
    },
  });
}

/** A query's place in the batch with the slot it settled as. */
export interface SettledSlot {
  index: number;
  slot: QuerySlot;
}

/**
 * Everything one batch's answering shares: who asks, the work they share, the
 * signal that gives the batch up, and where each settled slot goes.
 */
interface SlotRun {
  caller: ReadCaller;
  scope: BatchScope;
  /** The batch's one instant, taken once where the run is built. */
  now: Date;
  signal: AbortSignal | undefined;
  settle(entries: readonly ReadyEntry[], slots: readonly QuerySlot[]): void;
}

/**
 * Whether a failure is the batch being given up, in which case no slot is
 * settled: nobody is waiting for it, and logging every card a departing reader
 * left behind as a failure would bury the real ones.
 */
function batchGivenUp(run: SlotRun): boolean {
  return run.signal?.aborted === true;
}

/** One query answered on its own, under its own budget, and settled when it ends. */
async function answerOne(ready: ReadyQuery, run: SlotRun): Promise<void> {
  const source = ready.query.source;
  let slot: QuerySlot;
  try {
    const result = await withinSlotBudget(
      signal =>
        executeWidgetQuery(ready.query, run.caller, {
          signal,
          scope: run.scope.forSource(source),
          // Facts about the caller, kept once for every source in the batch.
          callerScope: run.scope.forCaller(),
          // The batch's one instant, this query's own copy, so every card
          // asking for a window measures it from the same moment.
          now: new Date(run.now),
        }),
      () => slotTimedOut({ source }),
      run.signal
    );
    slot = { ok: true, result: serialisable(result, { source }) };
  } catch (error) {
    if (batchGivenUp(run)) return;
    slot = failedSlot(error);
  }
  run.settle([ready], [slot]);
}

/**
 * A declared card's own data, answered on its own exactly as one query is: under
 * its own budget, made sendable by the same check, failed by the same mapping,
 * and settled when it ends. Its owner's view of the scope is what it shares work
 * through, so its keys never meet a source's.
 */
async function answerCardData(
  card: ReadyCardData,
  run: SlotRun
): Promise<void> {
  const widget = card.widgetId;
  let slot: QuerySlot;
  try {
    const answer = await withinSlotBudget(
      signal =>
        card.answer({
          signal,
          scope: run.scope.forOwner(card.owner),
          // A copy: a Date is mutable, and a data function that moved its own
          // would move every later card's.
          now: new Date(run.now),
        }),
      () => slotTimedOut({ widget, owner: card.owner }),
      run.signal
    );
    if ("settled" in answer) {
      slot = answer.settled;
    } else {
      const sendable = serialisable(answer.result, { widget });
      slot = answer.empty
        ? { ok: true, result: sendable, empty: true }
        : { ok: true, result: sendable };
    }
  } catch (error) {
    if (batchGivenUp(run)) return;
    slot = failedSlot(error);
  }
  run.settle([card], [slot]);
}

/**
 * Several of one source's queries answered by its many-query resolver, under one
 * budget and one abort signal, and settled together when that call ends: they
 * share one scan, so no part of the answer is ready before the scan is.
 *
 * Each answer goes back to its query by position. An `Error` at a position fails
 * that query alone; a time-out, or an answer whose length is not the number of
 * queries asked, fails the whole group, since its answers could not be told
 * apart from each other's.
 */
async function answerMany(
  group: readonly ReadyQuery[],
  resolveMany: ManySourceResolver,
  run: SlotRun
): Promise<void> {
  const source = group[0]?.query.source ?? "";
  const queries = group.map(ready => ready.query);
  let answers: ReadonlyArray<WidgetResult | Error>;
  try {
    answers = await withinSlotBudget(
      signal =>
        resolveMany(queries, run.caller, {
          signal,
          scope: run.scope.forSource(source),
          // The batch's one instant, as each query on its own gets it.
          now: new Date(run.now),
        }),
      () => slotTimedOut({ source }),
      run.signal
    );
    if (!Array.isArray(answers) || answers.length !== queries.length) {
      // A developer's mistake rather than a reader's, named in the log with the
      // source; the reader sees the generic sentence, as for any internal fault.
      throw NextlyError.internal({
        logContext: {
          reason: "widget-resolve-many-length",
          source,
          asked: queries.length,
          answered: Array.isArray(answers) ? answers.length : "not an array",
        },
      });
    }
  } catch (error) {
    if (batchGivenUp(run)) return;
    const failed = failedSlot(error);
    run.settle(
      group,
      group.map(() => failed)
    );
    return;
  }
  run.settle(
    group,
    queries.map((query, position) => {
      const answer = answers[position];
      if (answer instanceof Error) return failedSlot(answer);
      try {
        // Each answer judged against the query at its own position, as one
        // query's resolver answer is.
        const asked = answerAsAsked(query, answer);
        return { ok: true, result: serialisable(asked, { source }) };
      } catch (error) {
        return failedSlot(error);
      }
    })
  );
}

/**
 * A source's many-query resolver as the live registry holds it now, or
 * `undefined` when the source no longer answers several queries at once.
 *
 * 🔴 Looked up at execution, as `executeWidgetQuery` looks up a single query's
 * source, rather than taken from the copy captured while the batch was being
 * prepared. Between the two the batch awaits read decisions and query checks,
 * and a source removed or replaced meanwhile must be refused, or answered by
 * its replacement, exactly as one query to it would be. Throws, as that lookup
 * does, when the source is gone.
 */
function liveResolveMany(source: string): ManySourceResolver | undefined {
  const live = resolveExecutableSource(source);
  return live.kind === "system" || live.kind === "plugin"
    ? live.resolveMany
    : undefined;
}

/**
 * Several of one source's queries, answered by whatever answers that source
 * now: its live many-query resolver, or each query on its own when the live
 * source has none. A source that no longer answers at all fails every query in
 * the group, with the reason one query to it would be given.
 */
async function answerGroup(
  group: readonly ReadyQuery[],
  run: SlotRun
): Promise<void> {
  const source = group[0]?.query.source ?? "";
  let resolveMany: ManySourceResolver | undefined;
  try {
    resolveMany = liveResolveMany(source);
  } catch (error) {
    logAskedSeveral(source, group.length, false);
    run.settle(
      group,
      group.map(() => failedSlot(error))
    );
    return;
  }
  // Logged from the live decision, so the line says what actually answered.
  logAskedSeveral(source, group.length, resolveMany !== undefined);
  if (resolveMany === undefined) {
    await Promise.all(group.map(entry => answerOne(entry, run)));
  } else {
    await answerMany(group, resolveMany, run);
  }
}

/** How a batch's ready queries are answered, beyond who asks. */
export interface AnswerOptions {
  /**
   * Gives the batch up: every slot still running is told through its own
   * signal, and none not yet started is started. Absent, the batch runs to the
   * end, as a whole JSON answer does.
   */
  signal?: AbortSignal;
  /**
   * Handed each settled slot as it settles: one at a time for a query answered
   * on its own, together for queries one many-query call answered.
   */
  onSettled?: (settled: readonly SettledSlot[]) => void;
}

/**
 * Every ready query answered, as slots keyed by their place in the batch.
 *
 * Grouped by source; a source asked more than once is logged once, saying
 * whether its many-query resolver answered the group, so an operator can see
 * which sources share their work and which do it per query.
 *
 * Each slot is ALSO handed to `onSettled` the moment it settles, which is how a
 * streamed answer writes it: the map and the stream are filled by the same
 * call, so the two encodings of a batch cannot disagree about any slot.
 */
export async function answerReadyQueries(
  ready: readonly ReadyEntry[],
  caller: ReadCaller,
  scope: BatchScope,
  options: AnswerOptions = {}
): Promise<Map<number, QuerySlot>> {
  // A declared card's data is answered on its own; queries are grouped by the
  // source they ask, so one source's can share a scan.
  const cards: ReadyCardData[] = [];
  const bySource = new Map<string, ReadyQuery[]>();
  for (const entry of ready) {
    if (entry.kind === "data") {
      cards.push(entry);
      continue;
    }
    const list = bySource.get(entry.query.source);
    if (list) list.push(entry);
    else bySource.set(entry.query.source, [entry]);
  }

  const answered = new Map<number, QuerySlot>();
  const run: SlotRun = {
    caller,
    scope,
    signal: options.signal,
    // Taken once, so every card and cell in the batch measures "the last 30
    // days" from the same moment.
    now: new Date(),
    settle(entries, slots) {
      const settled: SettledSlot[] = [];
      entries.forEach((entry, position) => {
        const slot = slots[position];
        if (!slot) return;
        answered.set(entry.index, slot);
        settled.push({ index: entry.index, slot });
      });
      if (settled.length > 0) options.onSettled?.(settled);
    },
  };
  await Promise.all([
    ...[...bySource.entries()].map(([source, group]) =>
      answerSource(source, group, run)
    ),
    ...cards.map(card => answerCardData(card, run)),
  ]);
  return answered;
}

/** Whether a prepared group offered a many-query resolver when the batch began. */
function preparedToGroup(group: readonly ReadyQuery[]): boolean {
  // Only a resolver-answered source can have one; a collection or a single is
  // read through the Direct API, one query at a time.
  const executable = group[0]?.executable;
  const offered =
    executable?.kind === "system" || executable?.kind === "plugin"
      ? executable.resolveMany !== undefined
      : false;
  return offered && group.length > 1;
}

/** One source's queries in the batch, answered together or one at a time. */
async function answerSource(
  source: string,
  group: readonly ReadyQuery[],
  run: SlotRun
): Promise<void> {
  // Whether to group is read from the prepared copy, which says what the
  // source offered when the batch began; what answers it is asked again when
  // it runs, and `answerGroup` logs that live decision.
  if (preparedToGroup(group)) return answerGroup(group, run);
  if (group.length > 1) logAskedSeveral(source, group.length, false);
  await Promise.all(group.map(entry => answerOne(entry, run)));
}

/** One line for a source asked more than once in a batch, guarded as `failedSlot`'s is. */
function logAskedSeveral(source: string, queries: number, grouped: boolean) {
  try {
    getNextlyLogger().info({
      kind: "widget-source-asked-several",
      source,
      queries,
      grouped,
    });
  } catch {
    // Deliberately swallowed: a log line never fails the batch.
  }
}
