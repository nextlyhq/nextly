/**
 * A collection loop's stored `sort`, as its controls read and write it.
 *
 * The block stores sort keys as one string, comma-separated, each a field
 * name with a leading `-` for descending: `-publishedAt,title`. The controls
 * edit the FIRST key, the one that decides the order an author sees, and keep
 * every further key exactly as stored. Those were written on purpose (by code
 * or the API) to break ties, and a field pick or a direction change must not
 * quietly drop them: the page would reorder in ways nobody asked for.
 *
 * Pure, so each rule is tested without a panel.
 *
 * @module loop-sort
 */

/** One sort key: the field it orders by, and which way. */
export interface SortKey {
  readonly field: string;
  readonly descending: boolean;
}

/** A stored sort, split into the key the controls edit and the ones they keep. */
export interface StoredSort {
  /** The first key, or `undefined` when nothing is stored. */
  readonly first: SortKey | undefined;
  /** Every further key, trimmed, in its stored spelling. */
  readonly rest: readonly string[];
}

/** One key's text as a key, or `undefined` for one that names no field. */
function keyOf(text: string): SortKey | undefined {
  const descending = text.startsWith("-");
  const field = (descending ? text.slice(1) : text).trim();
  return field === "" ? undefined : { field, descending };
}

/**
 * The stored value read as keys. Anything but a string reads as no sort, and
 * empty keys (`a,,b`) are skipped, as the reader that orders the rows skips
 * them.
 */
export function readSort(value: unknown): StoredSort {
  if (typeof value !== "string") return { first: undefined, rest: [] };
  const keys = value
    .split(",")
    .map(part => part.trim())
    .filter(part => keyOf(part) !== undefined);
  const [head, ...rest] = keys;
  return { first: head === undefined ? undefined : keyOf(head), rest };
}

/** One key as it is stored. */
function keyText(key: SortKey): string {
  return key.descending ? `-${key.field}` : key.field;
}

/**
 * What the controls store for `first` over what `stored` holds: the new
 * first key, then every further key unchanged. `undefined` for no first key,
 * which removes the sort, further keys and all: "Default order" means the
 * reader's own order, not a sort by whatever tie-breakers were left.
 */
export function writeSort(
  stored: StoredSort,
  first: SortKey | undefined
): string | undefined {
  if (first === undefined) return undefined;
  return [keyText(first), ...stored.rest].join(",");
}

/** A further key as its field and direction, for the line that names them. */
export function restKeys(stored: StoredSort): SortKey[] {
  return stored.rest.flatMap(part => {
    const key = keyOf(part);
    return key === undefined ? [] : [key];
  });
}
