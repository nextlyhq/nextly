/**
 * Ids asked about in bounded batches, for every read that names many rows.
 *
 * A collection query is CLAMPED to `PAGINATION_DEFAULTS.maxLimit` (500) and
 * returns a subset silently, so a read naming more ids than that answers for
 * the first page only, and every row missing from it reads as absent. Asking
 * in batches under the clamp makes each answer the whole answer.
 *
 * @module id-batches
 */

/**
 * How many ids one query names. Under the 500-row clamp, and the size the
 * published route reads component definitions in, so the editor asks the way
 * the page it previews does.
 */
export const ID_BATCH_SIZE = 128;

/** Successive slices of at most `size`. */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
