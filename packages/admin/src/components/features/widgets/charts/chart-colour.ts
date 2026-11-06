/**
 * Which of the five shared chart colours a chart's groups take, and the order a
 * chart of groups draws them in.
 *
 * A chart of statuses colours each bar by its status's pinned slot, so
 * Published is the same colour on every card and a status is recognised at a
 * glance. Slot 5 is red, the hue the theme uses for errors and destructive
 * actions, and is archived's alone. Any other chart of groups, an arbitrary
 * select or a column of text, draws every bar in slot 1: five colours cannot
 * name arbitrary values, and a card of them would be colour that says nothing.
 * So is a chart that mixes a status-like value with others, since the
 * status's colour would claim a meaning the field does not have. Either way
 * the name and count beside each bar are what identify it, never the colour
 * alone.
 *
 * @module components/features/widgets/charts/chart-colour
 */

import { chartColour, type ChartSlot } from "@nextlyhq/ui/format";

// The slots and their tokens are the theme's, so a server names them as the admin does.
export { chartColour, type ChartSlot };

/** The status values' fixed slots. */
const STATUS_SLOTS: Readonly<Record<string, ChartSlot>> = {
  scheduled: 1,
  draft: 2,
  published: 3,
  changes: 4,
  archived: 5,
};

/** A status's pinned slot, or `undefined` for a value that is no status. */
function statusSlot(value: string | null): ChartSlot | undefined {
  return value !== null &&
    Object.prototype.hasOwnProperty.call(STATUS_SLOTS, value)
    ? STATUS_SLOTS[value]
    : undefined;
}

/**
 * The slot of each of one chart's groups, by their stored values, in order:
 * every status's pinned slot where all of them are statuses, and slot 1 for
 * all of them otherwise. `null`, the group with no value, is no status.
 */
export function chartSlotsFor(values: readonly (string | null)[]): ChartSlot[] {
  const pinned = values.map(statusSlot);
  return pinned.every((slot): slot is ChartSlot => slot !== undefined)
    ? pinned
    : values.map((): ChartSlot => 1);
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
