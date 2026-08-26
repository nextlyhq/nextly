/**
 * Walking a store's pages until it says there are no more.
 *
 * Both rebuilds ask the same question of a paginated store — keep requesting
 * pages until `hasNext` is false, and refuse if a guard runs out first — and
 * asked it in their own words until they disagreed about the answer. One
 * question has one implementation.
 *
 * The guard is counted in PAGES REQUESTED rather than in items collected. A
 * store answering `hasNext` forever with an empty page never grows an item
 * count, so an item-count bound would spin without end; termination has to
 * depend on a counter the store cannot hold still.
 *
 * Reaching it THROWS rather than returning what was read. A partial walk's
 * numbers are the same numbers a complete one produces, so a caller doing the
 * obvious thing with them would record a finished pass over a set it had only
 * partly read — and every rebuild here exists to say the records can now be
 * trusted.
 *
 * @module paged-walk
 */

/** One page of a paginated read. */
export interface StorePage {
  items: unknown[];
  meta: { hasNext: boolean };
}

/**
 * Request pages in order, handing each to `onPage`, until the store says there
 * are no more.
 *
 * `describe` names the thing being walked, so a refusal says what it could not
 * finish rather than only that it could not finish.
 */
export async function walkPages(args: {
  fetchPage: (page: number) => Promise<StorePage>;
  onPage: (items: readonly unknown[]) => Promise<void> | void;
  maxPages: number;
  describe: string;
}): Promise<void> {
  for (let page = 1; page <= args.maxPages; page++) {
    const result = await args.fetchPage(page);
    await args.onPage(result.items);
    if (!result.meta.hasNext) return;
  }
  throw new Error(
    `Paged walk over ${args.describe} stopped after ${args.maxPages} pages ` +
      `with more reported; the rest were not read.`
  );
}
