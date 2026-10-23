/**
 * Reading an instant a caller wrote as ISO 8601, strictly.
 *
 * Parseability is NOT the contract. `new Date` accepts "1" as 2001-01-01,
 * normalises "2026-02-30" to March 2, and reads "09/01/2026" differently by
 * locale — each of which yields a perfectly valid Date at an instant the caller
 * never chose. So the shape is checked first, and the calendar day the string
 * states is checked again after parsing.
 *
 * One reading of the format for every caller: a release's schedule and a
 * filter on a date column both read instants here, so the two cannot disagree
 * about what a string means.
 *
 * @module shared/lib/iso-instant
 */

/**
 * ISO 8601 with an explicit offset or `Z`.
 *
 * A local-time string carries no zone, so the server would resolve it in its
 * own — the same request naming different instants on two deployments.
 *
 * Capture 1 is the offset: every inner group is deliberately non-capturing so
 * the index cannot drift as the shape gains optional parts. A NAMED group
 * would read better and is not available here — the playground compiles this
 * source under a target that predates them.
 */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** A calendar date alone, read as the start of that day in UTC. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why a string is not an instant, so each caller can say it in its own words. */
export type IsoInstantProblem =
  /** Not ISO 8601 in an accepted form. */
  | "shape"
  /** The right shape, and still no instant: an hour of 25, say. */
  | "invalid"
  /** A well-formed date that does not exist, such as February 30. */
  | "no-such-day";

export type IsoInstantReading =
  | { ok: true; at: Date }
  | { ok: false; problem: IsoInstantProblem };

/**
 * Whether the parsed instant still names the calendar day the caller wrote.
 *
 * Compared in the offset the STRING states, by shifting the instant by that
 * offset before reading its date parts. An impossible date normalises to a
 * different day and is caught; a real one at an offset boundary is not, because
 * its UTC rendering is irrelevant to what was written:
 * `2026-09-01T00:30:00+02:00` is August 31 in UTC and perfectly valid.
 *
 * `offset` is handed in from the match that validated the shape rather than
 * found again here, so there is one reading of where the offset sits.
 */
function statesTheSameDay(raw: string, at: Date, offset: string): boolean {
  // `Z` and `±HH:MM` are the only two forms the pattern admits.
  const minutes =
    offset === "Z"
      ? 0
      : (offset.startsWith("-") ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(at.getTime() + minutes * 60_000);
  return raw.startsWith(local.toISOString().slice(0, 10));
}

/** Parses a string whose shape has passed, with the offset its match found. */
function readShaped(
  raw: string,
  parsed: string,
  offset: string
): IsoInstantReading {
  const at = new Date(parsed);
  if (Number.isNaN(at.getTime())) return { ok: false, problem: "invalid" };
  if (!statesTheSameDay(raw, at, offset)) {
    return { ok: false, problem: "no-such-day" };
  }
  return { ok: true, at };
}

/**
 * An instant written with its offset, such as `2026-09-01T09:00:00Z`.
 *
 * For a moment that must be stated exactly, such as when a release publishes.
 */
export function readIsoInstant(raw: string): IsoInstantReading {
  const shape = ISO_INSTANT.exec(raw);
  if (shape === null) return { ok: false, problem: "shape" };
  return readShaped(raw, raw, shape[1] ?? "Z");
}

/**
 * An instant written with its offset, or a calendar date alone, read as the
 * start of that day in UTC (`2026-09-01` is `2026-09-01T00:00:00Z`).
 *
 * For a bound, such as a filter's "from 1 September", where a bare date is the
 * common way to write one and its start is the reading every dialect's own
 * comparison of a date with a timestamp already gives in UTC.
 */
export function readIsoDateOrInstant(raw: string): IsoInstantReading {
  if (ISO_DATE.test(raw)) return readShaped(raw, `${raw}T00:00:00.000Z`, "Z");
  return readIsoInstant(raw);
}
