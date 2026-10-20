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

import type { BatchScope } from "../domains/widgets/batch-scope";
import type { ExecutableSource } from "../domains/widgets/executable-source";
import { executeWidgetQuery } from "../domains/widgets/execute";
import type { WidgetQuery } from "../domains/widgets/query";
import type { ManySourceResolver } from "../domains/widgets/resolved-sources";
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
  onTimeout: () => never
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol("widget-slot-timeout");
  const controller = new AbortController();
  const work = start(controller.signal);
  try {
    // Attached to `work` itself, not to the race's result: the race settles on
    // whichever arm wins, so on a timeout nothing would ever observe `work`.
    void work.catch(() => undefined);

    const deadline = new Promise<typeof timedOut>(resolve => {
      timer = setTimeout(() => resolve(timedOut), SLOT_TIMEOUT_MS);
      timer.unref?.();
    });

    const outcome = await Promise.race([work, deadline]);
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
  }
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
  source: string
): WidgetResult {
  try {
    return JSON.parse(JSON.stringify(result)) as WidgetResult;
  } catch (error) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "This widget returned something that could not be sent",
      logMessage: `widget source "${source}" returned an unserialisable result`,
      logContext: {
        reason: "widget-result-unserialisable",
        source,
        err: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** A query that passed its own read check and validation, at its place in the batch. */
export interface ReadyQuery {
  index: number;
  query: WidgetQuery;
  executable: ExecutableSource;
}

/** The failure a slot that ran out of time becomes, naming its source for the operator. */
function slotTimedOut(source: string): never {
  // A `NextlyError`, so `failedSlot` puts THIS sentence on the wire rather than
  // the generic one: a card that timed out is worth telling its reader about,
  // and the source id is already known to them -- they placed the card. The
  // slug travels in `logContext` for the operator, who needs to know WHICH
  // source is hanging.
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "This widget took too long to answer",
    logMessage: `widget source "${source}" exceeded ${SLOT_TIMEOUT_MS}ms`,
    logContext: {
      reason: "widget-slot-timeout",
      source,
      timeoutMs: SLOT_TIMEOUT_MS,
    },
  });
}

/** One query answered on its own, under its own budget. */
async function answerOne(
  ready: ReadyQuery,
  caller: ReadCaller,
  scope: BatchScope
): Promise<QuerySlot> {
  const source = ready.query.source;
  try {
    const result = await withinSlotBudget(
      signal =>
        executeWidgetQuery(ready.query, caller, {
          signal,
          scope: scope.forSource(source),
        }),
      () => slotTimedOut(source)
    );
    return { ok: true, result: serialisable(result, source) };
  } catch (error) {
    return failedSlot(error);
  }
}

/**
 * Several of one source's queries answered by its many-query resolver, under one
 * budget and one abort signal.
 *
 * Each answer goes back to its query by position. An `Error` at a position fails
 * that query alone; a time-out, or an answer whose length is not the number of
 * queries asked, fails the whole group, since its answers could not be told
 * apart from each other's.
 */
async function answerMany(
  group: readonly ReadyQuery[],
  resolveMany: ManySourceResolver,
  caller: ReadCaller,
  scope: BatchScope
): Promise<QuerySlot[]> {
  const source = group[0]?.query.source ?? "";
  const queries = group.map(ready => ready.query);
  let answers: ReadonlyArray<WidgetResult | Error>;
  try {
    answers = await withinSlotBudget(
      signal =>
        resolveMany(queries, caller, {
          signal,
          scope: scope.forSource(source),
        }),
      () => slotTimedOut(source)
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
    const failed = failedSlot(error);
    return group.map(() => failed);
  }
  return answers.map(answer => {
    if (answer instanceof Error) return failedSlot(answer);
    try {
      return { ok: true, result: serialisable(answer, source) };
    } catch (error) {
      return failedSlot(error);
    }
  });
}

/**
 * Every ready query answered, as slots keyed by their place in the batch.
 *
 * Grouped by source; a source asked more than once is logged once, saying
 * whether its many-query resolver answered the group, so an operator can see
 * which sources share their work and which do it per query.
 */
export async function answerReadyQueries(
  ready: readonly ReadyQuery[],
  caller: ReadCaller,
  scope: BatchScope
): Promise<Map<number, QuerySlot>> {
  const bySource = new Map<string, ReadyQuery[]>();
  for (const entry of ready) {
    const list = bySource.get(entry.query.source);
    if (list) list.push(entry);
    else bySource.set(entry.query.source, [entry]);
  }

  const answered = new Map<number, QuerySlot>();
  await Promise.all(
    [...bySource.entries()].map(async ([source, group]) => {
      const first = group[0];
      // Only a resolver-answered source can have one; a collection or a single is
      // read through the Direct API, one query at a time.
      const executable = first?.executable;
      const resolveMany =
        executable?.kind === "system" || executable?.kind === "plugin"
          ? executable.resolveMany
          : undefined;
      const grouped = resolveMany !== undefined && group.length > 1;
      if (group.length > 1) logAskedSeveral(source, group.length, grouped);
      const slots = grouped
        ? await answerMany(group, resolveMany, caller, scope)
        : await Promise.all(
            group.map(entry => answerOne(entry, caller, scope))
          );
      group.forEach((entry, position) => {
        const slot = slots[position];
        if (slot) answered.set(entry.index, slot);
      });
    })
  );
  return answered;
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
