/**
 * How many server errors this process answered in the last 24 hours, for the
 * diagnostics report's "Errors in the last 24 h" line.
 *
 * Only the instant of each error is kept: no route, message, code or caller,
 * so nothing about an error can reach the report but that it happened.
 *
 * ## Per process, in memory
 *
 * As the storage layer's last failed write is (`storage/last-write-failure`):
 * no table and no migration, so recording costs nothing on the error path and
 * can never fail a request. Each server instance counts its own, and a restart
 * starts again from zero; the report's line says "this server process".
 *
 * ## Counted once per request
 *
 * A request can pass through more than one boundary that answers its error
 * (a handler wrapped in `withErrorHandler`, reached through the dynamic
 * router), so each request is counted at most once.
 *
 * ## Bounded
 *
 * At most {@link SERVER_ERRORS_KEPT} instants are kept; past it the oldest
 * goes and the count is reported as a floor ("or more").
 *
 * @module domains/health/server-errors
 */

import { processHeld } from "../widgets/process-held";

/** The server errors this process answered in the last 24 hours. */
export interface ServerErrorCount {
  count: number;
  /** More were answered than the tally keeps: the count is a floor. */
  capped: boolean;
}

/** The window the count covers. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** The most instants kept, which bounds the memory a flood of errors takes. */
export const SERVER_ERRORS_KEPT = 10_000;

/** The tally's one slot for the process. */
interface Tally {
  /** Each error's instant, in milliseconds, oldest first. */
  at: number[];
  /** The newest instant dropped to stay in bounds, while it is inside the window. */
  dropped: number | undefined;
  /** The requests already counted. */
  counted: WeakSet<object>;
}

function isTally(held: unknown): held is Tally {
  return (
    typeof held === "object" &&
    held !== null &&
    Array.isArray((held as { at?: unknown }).at) &&
    (held as { counted?: unknown }).counted instanceof WeakSet
  );
}

function tally(): Tally {
  return processHeld(
    "nextly.health.serverErrors",
    (): Tally => ({ at: [], dropped: undefined, counted: new WeakSet() }),
    isTally
  );
}

/** Drops the instants older than the window as of `now`. */
function prune(held: Tally, now: number): void {
  const since = now - WINDOW_MS;
  let first = 0;
  while (first < held.at.length && held.at[first] < since) first += 1;
  if (first > 0) held.at.splice(0, first);
  if (held.dropped !== undefined && held.dropped < since) {
    held.dropped = undefined;
  }
}

/**
 * Records that `request` was answered with a server error, once however many
 * boundaries report it.
 */
export function recordServerError(
  request: object | undefined,
  now: number = Date.now()
): void {
  const held = tally();
  if (request !== undefined) {
    if (held.counted.has(request)) return;
    held.counted.add(request);
  }
  prune(held, now);
  held.at.push(now);
  if (held.at.length > SERVER_ERRORS_KEPT) {
    held.dropped = held.at.shift();
  }
}

/** Records `request` as a server error when its answer's `status` is one (5xx). */
export function recordIfServerError(
  request: object,
  status: number,
  now: number = Date.now()
): void {
  if (status >= 500) recordServerError(request, now);
}

/** The server errors answered in the 24 hours before `now`. */
export function serverErrorsInLastDay(
  now: number = Date.now()
): ServerErrorCount {
  const held = tally();
  prune(held, now);
  return { count: held.at.length, capped: held.dropped !== undefined };
}

/** Forgets every recorded error; for tests. */
export function forgetServerErrors(): void {
  const held = tally();
  held.at.length = 0;
  held.dropped = undefined;
  held.counted = new WeakSet();
}
