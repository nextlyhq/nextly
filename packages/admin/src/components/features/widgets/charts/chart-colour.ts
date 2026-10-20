/**
 * Which of the five shared chart colours a category takes, and the order a
 * chart of groups draws them in.
 *
 * By the category's STORED value, never its position in a result or its
 * label: the same value is the same colour on every card, whatever order the
 * groups arrive in and whatever language their labels are in. Status values
 * sit on fixed slots, so Published looks the same everywhere; any other value
 * takes a slot by a stable hash, over slots 1 to 4 only. Slot 5 is red, the
 * hue the theme uses for errors and destructive actions, so a value that
 * means nothing alarming never lands on it; it stays for archived. Four
 * colours cannot name fifty groups, so colours repeat, and the name beside
 * each bar is what identifies it.
 *
 * The hash is part of the contract: changing it would recolour every
 * category on every site, so a test pins it.
 *
 * @module components/features/widgets/charts/chart-colour
 */

/** One of the five shared chart colours, `--nx-chart-1` to `--nx-chart-5`. */
export type ChartSlot = 1 | 2 | 3 | 4 | 5;

/** How many slots a hashed value may take: 1 to 4, never the alarm-red 5. */
const HASHED_SLOTS = 4;

/** The status values' fixed slots. */
const STATUS_SLOTS: Readonly<Record<string, ChartSlot>> = {
  scheduled: 1,
  draft: 2,
  published: 3,
  changes: 4,
  archived: 5,
};

/**
 * A 32-bit FNV-1a hash of the value's code points: deterministic on every
 * engine, cheap, and spread well enough over five slots.
 */
function hashOf(value: string): number {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The slot a stored value takes. `null`, the group with no value, hashes as "". */
export function chartSlotFor(value: string | null): ChartSlot {
  const key = value ?? "";
  if (Object.prototype.hasOwnProperty.call(STATUS_SLOTS, key)) {
    return STATUS_SLOTS[key];
  }
  return ((hashOf(key) % HASHED_SLOTS) + 1) as ChartSlot;
}

/** The token a slot is drawn in. A chart never sets a colour of its own. */
export function chartColour(slot: ChartSlot): string {
  return `var(--nx-chart-${slot})`;
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
