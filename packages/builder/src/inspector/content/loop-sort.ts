/**
 * A collection loop's stored `sort`, as its single-key control reads and
 * writes it.
 *
 * The keys are the ENGINE's reading of the prop (`readListQuery`), and the
 * string written back is the engine's spelling of them (`listSortText`), so
 * this control, the list's own sort rows, the validator and the reader agree
 * on what a stored sort says. What is decided here is only what a control
 * editing the FIRST key does with the rest: every further key the chosen
 * collection can still sort by is kept, as stored. Those were written on
 * purpose (by code, the API or the sort rows) to break ties, and a field pick
 * or a direction change must not quietly drop them. A further key the
 * collection cannot sort by is dropped at the next write instead, because the
 * reader refuses a sort naming one and lists in id order, so keeping it would
 * undo the very order the author just chose.
 *
 * Pure, so each rule is tested without a panel.
 *
 * @module loop-sort
 */
import {
  listSortText,
  readListQuery,
  type ListSortKey,
} from "@nextlyhq/blocks-engine";

/** One sort key: the field it orders by, and which way. */
export type SortKey = ListSortKey;

/** A stored sort, split into the key the control edits and the ones it keeps. */
export interface StoredSort {
  /** The first key, or `undefined` when nothing is stored. */
  readonly first: SortKey | undefined;
  /** Every further key, in order. */
  readonly rest: readonly SortKey[];
}

/**
 * The stored value read as keys, as the engine reads it: anything but text
 * of field names reads as no sort, and empty keys (`a,,b`) are skipped.
 */
export function readSort(value: unknown): StoredSort {
  const [first, ...rest] = readListQuery({ sort: value }).query.sort;
  return { first, rest };
}

/**
 * What the control stores for `first` over what `stored` holds: the new
 * first key, then every further key whose field `sortable` accepts,
 * unchanged. `undefined` for no first key, which removes the sort, further
 * keys and all: "Default order" means the reader's own order, not a sort by
 * whatever tie-breakers were left.
 */
export function writeSort(
  stored: StoredSort,
  first: SortKey | undefined,
  sortable: (field: string) => boolean
): string | undefined {
  if (first === undefined) return undefined;
  return listSortText([
    first,
    ...stored.rest.filter(key => sortable(key.field)),
  ]);
}

/** The further keys, for the line that names them. */
export function restKeys(stored: StoredSort): readonly SortKey[] {
  return stored.rest;
}
