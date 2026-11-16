/**
 * What colour a chart's groups take, and the order a chart of groups draws them in.
 *
 * A chart of statuses draws each bar in its status's own colour, the solid of
 * the admin's status tokens, so Published is the same green on every card and
 * beside every status chip: done in the success colour, scheduled in the info
 * colour, changes waiting to be published in the warning colour, and a draft or
 * an archived entry, which mark nothing to act on, in the muted ink. Any other
 * chart of groups, an arbitrary select or a column of text, draws every bar in
 * shared chart slot 1: five colours cannot name arbitrary values, and a card of
 * them would be colour that says nothing. So is a chart that mixes a
 * status-like value with others, since the status's colour would claim a
 * meaning the field does not have. Either way the name and count beside each
 * bar are what identify it, never the colour alone.
 *
 * @module components/features/widgets/charts/chart-colour
 */

import { chartColour, type ChartSlot } from "@nextlyhq/ui/format";

// The slots and their tokens are the theme's, so a server names them as the admin does.
export { chartColour, type ChartSlot };

/**
 * A status's mark: the solid of its status token, or `neutral`, the muted ink, for a status that
 * marks nothing to act on.
 */
export type StatusMark = "success" | "warning" | "info" | "neutral";

/** What a chart's mark is drawn in: a shared chart slot, or a status's own mark. */
export type ChartMark = ChartSlot | StatusMark;

/** The status values' marks. */
const STATUS_MARKS: Readonly<Record<string, StatusMark>> = {
  scheduled: "info",
  draft: "neutral",
  published: "success",
  changes: "warning",
  archived: "neutral",
};

/** A status's mark, or `undefined` for a value that is no status. */
function statusMark(value: string | null): StatusMark | undefined {
  return value !== null &&
    Object.prototype.hasOwnProperty.call(STATUS_MARKS, value)
    ? STATUS_MARKS[value]
    : undefined;
}

/**
 * The mark of each of one chart's groups, by their stored values, in order:
 * every status's own mark where all of them are statuses, and slot 1 for all
 * of them otherwise. `null`, the group with no value, is no status.
 */
export function chartMarksFor(values: readonly (string | null)[]): ChartMark[] {
  const marks = values.map(statusMark);
  return marks.every((mark): mark is StatusMark => mark !== undefined)
    ? marks
    : values.map((): ChartMark => 1);
}

/** The token a mark is drawn in: its slot's, its status's solid, or the muted ink. */
export function markColour(mark: ChartMark): string {
  if (typeof mark === "number") return chartColour(mark);
  return mark === "neutral"
    ? "var(--nx-muted-foreground)"
    : `var(--nx-${mark}-solid)`;
}

/** A group of a grouped result, as a chart of groups reads it. */
export interface ChartGroup {
  /** The stored value, which decides the colour; `null` for no value. */
  value: string | null;
  /** What the group is called beside its bar. */
  label: string;
  count: number;
}

/** One collator per locale, made once: building one is far dearer than comparing with it. */
const collators = new Map<string, Intl.Collator>();

function collatorFor(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (collator === undefined) {
    collator = new Intl.Collator(locale);
    collators.set(locale, collator);
  }
  return collator;
}

/**
 * `groups` in the order a chart of groups draws them: by count, highest
 * first, ties by label in `locale`. A copy: the result it came from keeps its
 * order.
 *
 * The locale is passed in, never the runtime's own: it is the one the card's
 * numbers are written in, so a tie orders the same way for every reader of
 * one setup, and as that setup's language sorts.
 */
export function orderGroups<G extends Pick<ChartGroup, "label" | "count">>(
  groups: readonly G[],
  locale: string
): G[] {
  const collator = collatorFor(locale);
  return [...groups].sort(
    (a, b) => b.count - a.count || collator.compare(a.label, b.label)
  );
}
