/**
 * The two reserved filter keys that keep entries by where they stand in
 * publishing, rather than by a value they hold.
 *
 * - `_pendingChange: true` keeps entries whose draft holds changes not yet
 *   published.
 * - `_inRelease: { scheduledBefore }` keeps entries a scheduled release will
 *   publish after now and no later than `scheduledBefore`; `_inRelease: true`
 *   drops the upper bound.
 *
 * They are what the dashboard's counts are counted with, so a count and the
 * list it links to are one filter and cannot disagree. Like `_translated`, each
 * is a condition on another table, so each is read only at the TOP level of a
 * filter and refused anywhere else (`filter-shape`).
 *
 * This module decides what each key's value MEANS, once: the shape check
 * refuses what these readers cannot read, and the query reads the keys with the
 * same readers, so the two cannot come to accept different values.
 *
 * @module domains/collections/query/workflow-filter
 * @experimental The keys and their forms may change until the dashboard's
 *   Needs attention card is complete.
 */

import type { FilterProblem } from "./filter-shape";
import { IN_RELEASE_KEY, PENDING_CHANGE_KEY } from "./reserved-filter-keys";

// Declared with the other reserved keys, so the admin reads the same names.
export { IN_RELEASE_KEY, PENDING_CHANGE_KEY };

/**
 * Which scheduled releases an entry must be in to be kept.
 *
 * @experimental
 */
export interface InReleaseFilter {
  /**
   * The latest instant a release may be scheduled for, inclusive, or `null`
   * for no upper bound. The lower bound is always the read's own "now".
   */
  scheduledBefore: Date | null;
}

/**
 * The workflow conditions a filter carried at its top level.
 *
 * @experimental
 */
export interface WorkflowFilter {
  /** Keep only entries whose draft holds changes not yet published. */
  pendingChange: boolean;
  /** Keep only entries a scheduled release will publish, or `null` for no such condition. */
  inRelease: InReleaseFilter | null;
}

/**
 * An instant written with its zone: a date, a time and `Z` or an offset.
 *
 * The zone is required because the bound is an INSTANT. A bare date or a time
 * without a zone would be read in the server's own zone, so one link would
 * mean different moments on different servers.
 */
const ZONED_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** Whether `value` is an integer from `min` to `max`, both included. */
function within(value: string | undefined, min: number, max: number): boolean {
  if (value === undefined) return true;
  const n = Number(value);
  return n >= min && n <= max;
}

/**
 * Whether every part of a zoned instant names a real moment: a month of the
 * year, a day of that month, an hour, a minute and a second, and an offset.
 *
 * Checked part by part because `Date` does not refuse an impossible one: it
 * rolls `2026-02-30` over to March 2, and the filter would then answer for a
 * bound the caller never wrote.
 */
function realParts(match: RegExpExecArray): boolean {
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    match;
  if (!within(month, 1, 12)) return false;
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(
    Date.UTC(Number(year), Number(month), 0)
  ).getUTCDate();
  return (
    within(day, 1, daysInMonth) &&
    within(hour, 0, 23) &&
    within(minute, 0, 59) &&
    within(second, 0, 59) &&
    within(offsetHour, 0, 23) &&
    within(offsetMinute, 0, 59)
  );
}

/** A valid instant from a `Date` or a zoned ISO 8601 string, or `undefined`. */
function readInstant(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const match = ZONED_INSTANT.exec(value);
  if (match === null || !realParts(match)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

/**
 * `_pendingChange`'s value, read: `true` is its only form.
 *
 * `false` is refused rather than read as "no condition": a caller who wrote it
 * meant "entries WITHOUT pending changes", and answering every entry instead
 * would be a wider answer than the one asked.
 */
function readPendingChange(value: unknown): true | undefined {
  return value === true ? true : undefined;
}

/**
 * `_inRelease`'s value, read: `true`, or an object holding exactly one
 * `scheduledBefore` instant.
 *
 * An empty object is refused rather than read as the open form, because the
 * bracket form of a query string cannot carry an empty object and the two
 * spellings of one filter would then differ by transport.
 */
function readInRelease(value: unknown): InReleaseFilter | undefined {
  if (value === true) return { scheduledBefore: null };
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "scheduledBefore") return undefined;
  const scheduledBefore = readInstant(
    (value as Record<string, unknown>).scheduledBefore
  );
  return scheduledBefore === undefined ? undefined : { scheduledBefore };
}

/** Each workflow key, how it is read, and how it is written when refused. */
const WORKFLOW_KEYS = {
  [PENDING_CHANGE_KEY]: {
    read: readPendingChange,
    form: `true`,
  },
  [IN_RELEASE_KEY]: {
    read: readInRelease,
    form: `true, or { "scheduledBefore": "<date and time with a zone, such as 2026-10-28T09:00:00Z>" }`,
  },
} as const;

type WorkflowKey = keyof typeof WORKFLOW_KEYS;

/** Whether a filter key is one of the workflow keys. */
export function isWorkflowKey(key: string): key is WorkflowKey {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_KEYS, key);
}

/**
 * What is wrong with a workflow key's value at the top level of a filter, or
 * `undefined` when it can be read.
 */
export function workflowKeyProblem(
  key: WorkflowKey,
  value: unknown
): FilterProblem | undefined {
  if (WORKFLOW_KEYS[key].read(value) !== undefined) return undefined;
  return {
    path: `where.${key}`,
    code: "FILTER_INVALID_OPERAND",
    message: `"${key}" needs ${WORKFLOW_KEYS[key].form}.`,
  };
}

/** How a workflow key's refusal says what it does, when it is given below the top level. */
export const WORKFLOW_KEY_PURPOSE: Readonly<Record<WorkflowKey, string>> = {
  [PENDING_CHANGE_KEY]: "keeps entries with unpublished changes",
  [IN_RELEASE_KEY]: "keeps entries a scheduled release will publish",
};

/** How a workflow key is written, for the refusal of one given below the top level. */
export function workflowKeyForm(key: WorkflowKey): string {
  return `{ "${key}": ${WORKFLOW_KEYS[key].form} }`;
}

/**
 * Take the workflow keys out of a filter's top level.
 *
 * Returns the conditions they carried and the filter without them, which is
 * `undefined` when nothing else remains. A value these readers cannot read is
 * returned as a problem rather than dropped: dropping it would run the read
 * under a wider filter than the caller wrote.
 */
export function extractWorkflowFilter(where: unknown): {
  filter: WorkflowFilter | null;
  cleanedWhere: unknown;
  problems: FilterProblem[];
} {
  if (
    typeof where !== "object" ||
    where === null ||
    Array.isArray(where) ||
    !Object.keys(where).some(isWorkflowKey)
  ) {
    return { filter: null, cleanedWhere: where, problems: [] };
  }
  const rest: Record<string, unknown> = {};
  const problems: FilterProblem[] = [];
  const filter: WorkflowFilter = { pendingChange: false, inRelease: null };
  for (const [key, value] of Object.entries(where)) {
    if (isWorkflowKey(key)) {
      const problem = workflowKeyProblem(key, value);
      if (problem !== undefined) problems.push(problem);
      // Read by the same reader the problem was judged with, so a value is
      // never both accepted there and dropped here.
      else if (key === PENDING_CHANGE_KEY) filter.pendingChange = true;
      else filter.inRelease = readInRelease(value) ?? null;
    } else {
      // Defined, not assigned, so a `__proto__` key stays a key for the
      // condition builder to refuse.
      Object.defineProperty(rest, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return {
    filter,
    cleanedWhere: Object.keys(rest).length > 0 ? rest : undefined,
    problems,
  };
}
