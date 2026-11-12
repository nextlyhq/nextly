/**
 * The submissions list's date filter: a few presets and a range of days, each
 * turned into the moments it covers once, when it is chosen. The list filters
 * `submittedAt` by those moments on the server, so every dialect answers the
 * same rows.
 *
 * Days are the reader's own: "Today" starts at their midnight, not the
 * server's, and a range's last day runs to the start of the next.
 *
 * @module admin/components/submissions/date-filter
 */

/** A preset of the date filter. */
export type DatePreset = "any" | "today" | "last7" | "last30";

/** What the filter is set to: a preset, or a range of days (`YYYY-MM-DD`). */
export type DateChoice =
  | { kind: DatePreset }
  | { kind: "range"; firstDay?: string; lastDay?: string };

/** The moments a choice covers: sent at or after `from`, before `to`. */
export interface SentRange {
  from?: string;
  to?: string;
}

/** The presets in the order the filter offers them, with how each reads. */
export const DATE_PRESETS: ReadonlyArray<{ kind: DatePreset; label: string }> =
  [
    { kind: "any", label: "Any date" },
    { kind: "today", label: "Today" },
    { kind: "last7", label: "Last 7 days" },
    { kind: "last30", label: "Last 30 days" },
  ];

/** How many days before today each preset starts; none for any date. */
const DAYS_BACK: Readonly<Record<DatePreset, number | undefined>> = {
  any: undefined,
  today: 0,
  last7: 6,
  last30: 29,
};

/** The reader's midnight `days` days after `day`'s (before, when negative). */
function midnight(day: Date, days = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

/** A `YYYY-MM-DD` day as the reader's midnight that starts it; none if not one. */
function dayStart(day: string | undefined): Date | undefined {
  const match = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!match) return undefined;
  const [year, month, date] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const start = new Date(year, month - 1, date);
  return Number.isNaN(start.getTime()) ? undefined : start;
}

/**
 * The moments `choice` covers, as of `now`. A preset runs from the start of
 * its first day with no end, as nothing is sent in the future; a range from
 * the start of its first day to the start of the day after its last.
 */
export function sentRange(choice: DateChoice, now: Date): SentRange {
  if (choice.kind !== "range") {
    const back = DAYS_BACK[choice.kind];
    return back === undefined
      ? {}
      : { from: midnight(now, -back).toISOString() };
  }
  const first = dayStart(choice.firstDay);
  const last = dayStart(choice.lastDay);
  return {
    ...(first ? { from: first.toISOString() } : {}),
    ...(last ? { to: midnight(last, 1).toISOString() } : {}),
  };
}

/** A `YYYY-MM-DD` day as a person reads it, in their locale. */
function dayText(day: string | undefined): string | undefined {
  const start = dayStart(day);
  return start?.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** How the filter's button reads for `choice`. */
export function dateChoiceLabel(choice: DateChoice): string {
  if (choice.kind !== "range") {
    return DATE_PRESETS.find(each => each.kind === choice.kind)?.label ?? "";
  }
  const first = dayText(choice.firstDay);
  const last = dayText(choice.lastDay);
  if (first && last) return first === last ? first : `${first} – ${last}`;
  if (first) return `From ${first}`;
  return last ? `Until ${last}` : "Any date";
}
