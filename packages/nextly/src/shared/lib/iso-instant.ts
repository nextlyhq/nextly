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
 * ISO 8601 as the exact reader takes it: a calendar date, then optionally a time, then optionally
 * an offset, with up to six digits of a second. The same separators and offset forms as
 * `ISO_INSTANT` (`T`, `Z`, `±HH:MM`); only the parts may be missing, and the fraction may be longer,
 * so a caller can tell a text naming no time or no offset from one that is no date at all.
 * Captures: year, month, day, hour, minute, second, fraction, offset.
 */
const ISO_EXACT =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Why a text is not an instant the exact reader can name. */
export type ExactIsoProblem =
  | IsoInstantProblem
  /** A calendar date with no time. */
  | "no-time"
  /** A date and a time with no offset from UTC. */
  | "no-offset";

/** An instant read exactly: whole seconds since 1970 UTC, and the digits of a second as written. */
export interface ExactIsoInstant {
  seconds: number;
  /** The digits after the point, exactly as written (`"250"` for `.250`), or `""` for none. */
  fraction: string;
}

export type ExactIsoReading =
  | { ok: true; instant: ExactIsoInstant }
  | { ok: false; problem: ExactIsoProblem };

/**
 * An instant read exactly, keeping every digit of its second up to microseconds, and saying why a
 * text is not one: not ISO 8601 in an accepted form, no instant, a day that does not exist, or a
 * date or time that names no time or no offset. The date a text names is checked even where it
 * names no time or no offset, so a February 30 is no date whatever else it lacks.
 *
 * The one reading of an instant's parts: `readIsoInstant` and `readIsoDateOrInstant` derive theirs
 * from it, keeping their narrower shapes.
 */
export function readExactIsoInstant(raw: string): ExactIsoReading {
  const parts = ISO_EXACT.exec(raw);
  if (parts === null) return { ok: false, problem: "shape" };
  const [, year, month, day, hour, minute, second, fraction, offset] = parts;
  const date = `${year}-${month}-${day}`;
  // Validity does not depend on the digits of a second, so the instant is checked without them.
  const time =
    hour === undefined ? "00:00:00" : `${hour}:${minute}:${second ?? "00"}`;
  const zone = offset ?? "Z";
  const whole = `${date}T${time}${zone}`;
  const at = new Date(whole);
  if (Number.isNaN(at.getTime())) return { ok: false, problem: "invalid" };
  if (!statesTheSameDay(whole, at, zone)) {
    return { ok: false, problem: "no-such-day" };
  }
  if (hour === undefined) return { ok: false, problem: "no-time" };
  if (offset === undefined) return { ok: false, problem: "no-offset" };
  return {
    ok: true,
    instant: { seconds: at.getTime() / 1000, fraction: fraction ?? "" },
  };
}

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

/**
 * An instant written with its offset, such as `2026-09-01T09:00:00Z`.
 *
 * For a moment that must be stated exactly, such as when a release publishes.
 */
export function readIsoInstant(raw: string): IsoInstantReading {
  // This reader's own, narrower shape: a time and an offset, and at most three digits of a second.
  if (!ISO_INSTANT.test(raw)) return { ok: false, problem: "shape" };
  const exact = readExactIsoInstant(raw);
  if (!exact.ok) {
    // The shape already holds a time and an offset, so only an instant's own problems remain.
    return {
      ok: false,
      problem: exact.problem === "no-such-day" ? "no-such-day" : "invalid",
    };
  }
  const { seconds, fraction } = exact.instant;
  return {
    ok: true,
    at: new Date(seconds * 1000 + Number(fraction.padEnd(3, "0"))),
  };
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
  if (ISO_DATE.test(raw)) return readIsoInstant(`${raw}T00:00:00.000Z`);
  return readIsoInstant(raw);
}
