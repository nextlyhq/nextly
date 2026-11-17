/**
 * The blocks an author adds most: one count per block name, kept on this
 * device through the editor's preference port, and the six the in-place
 * picker shows from them.
 *
 * Counted on every insert of a block, from any surface that adds through the
 * Add panel's offers (the panel, its drag, the picker, the editor's search).
 * Saved sections and components are not counted: they are the site's own
 * content and change, and they are one search away.
 *
 * @module insert-usage
 */

import * as React from "react";

import type { PreferenceStore } from "../../shell-state";

import type { BlockInsertEntry, InsertEntry } from "./inserter-types";

/**
 * The six an author with no history sees, in this order, and the order that
 * breaks a tie between equal counts.
 */
export const DEFAULT_MOST_USED: readonly string[] = [
  "core/heading",
  "core/text",
  "core/image",
  "core/button",
  "core/box",
  "core/columns",
];

/** How many blocks the picker shows at rest. */
export const MOST_USED_SIZE = 6;

/** How many times each block has been added, by block name. */
export type InsertCounts = Readonly<Record<string, number>>;

/** No inserts yet. */
const NO_COUNTS: InsertCounts = {};

/**
 * Where the author's insert counts are kept, provided by the host around the
 * editor. Absent, nothing is counted and the picker shows the default six.
 *
 * @experimental
 */
export const InsertUsageContext: React.Context<PreferenceStore | undefined> =
  React.createContext<PreferenceStore | undefined>(undefined);

/** The store the host provided for insert counts, if any. */
export function useInsertUsage(): PreferenceStore | undefined {
  return React.useContext(InsertUsageContext);
}

/**
 * The counts a store holds, or none when it holds nothing readable. A store
 * may fail to read (private browsing, a blocked storage), and the editor must
 * not care, so a failure is an empty history.
 */
export function readInsertCounts(
  store: PreferenceStore | undefined
): InsertCounts {
  if (store === undefined) return NO_COUNTS;
  let raw: string | null;
  try {
    raw = store.read();
  } catch {
    return NO_COUNTS;
  }
  return raw === null ? NO_COUNTS : parseCounts(raw);
}

/** The counts a stored text names, keeping only whole, positive numbers. */
function parseCounts(raw: string): InsertCounts {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return NO_COUNTS;
  }
  const counts =
    typeof value === "object" && value !== null
      ? (value as { counts?: unknown }).counts
      : undefined;
  if (typeof counts !== "object" || counts === null) return NO_COUNTS;
  const kept: Record<string, number> = {};
  for (const [name, count] of Object.entries(counts)) {
    if (Number.isSafeInteger(count) && (count as number) > 0) {
      kept[name] = count as number;
    }
  }
  return kept;
}

/**
 * Count one more insert of a block in the store. A store that cannot be
 * written keeps what it had; adding the block has already happened.
 */
export function recordInsert(
  store: PreferenceStore | undefined,
  blockName: string
): void {
  if (store === undefined) return;
  const counts = readInsertCounts(store);
  const next = { ...counts, [blockName]: (counts[blockName] ?? 0) + 1 };
  try {
    store.write(JSON.stringify({ counts: next }));
  } catch {
    // Nothing to do: the count is a convenience, never the author's work.
  }
}

/**
 * The blocks the picker shows at rest: the offered blocks, most added first.
 * A tie, and an author with no history, falls back to
 * {@link DEFAULT_MOST_USED}'s order, then to the order offered. A block the
 * place refuses is not in `offered`, so the next one takes its seat and the
 * grid stays full wherever enough blocks are offered.
 *
 * Only a block's own entry is shown, never one of its variations: the count
 * is per block name.
 *
 * @param offered - the entries the place accepts, in the palette's order
 * @param counts - how many times each block was added
 * @returns at most {@link MOST_USED_SIZE} block entries
 */
export function mostUsedEntries(
  offered: readonly InsertEntry[],
  counts: InsertCounts
): BlockInsertEntry[] {
  const blocks = offered.filter(
    (entry): entry is BlockInsertEntry =>
      entry.kind === "block" && entry.variationName === undefined
  );
  const rank = (name: string): number => {
    const index = DEFAULT_MOST_USED.indexOf(name);
    return index === -1 ? DEFAULT_MOST_USED.length : index;
  };
  const order = new Map(blocks.map((entry, index) => [entry.id, index]));
  return [...blocks]
    .sort(
      (a, b) =>
        (counts[b.blockName] ?? 0) - (counts[a.blockName] ?? 0) ||
        rank(a.blockName) - rank(b.blockName) ||
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    )
    .slice(0, MOST_USED_SIZE);
}
