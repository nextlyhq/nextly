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
 * are no more, or `onPage` answers `"stop"`.
 *
 * `describe` names the thing being walked, so a refusal says what it could not
 * finish rather than only that it could not finish.
 *
 * Resolves `true` when the walk reached the store's end and `false` when
 * `onPage` stopped it. A stop is the caller's own decision, such as a budget
 * spent, so it is answered rather than thrown, and the caller is the one that
 * knows where to resume.
 */
export async function walkPages(args: {
  fetchPage: (page: number) => Promise<StorePage>;
  /**
   * Handed each page's items and whether the store holds another page after
   * it, so a caller spending a budget can tell a walk that ends exactly on its
   * budget from one the budget cut short.
   */
  onPage: (
    items: readonly unknown[],
    page: { hasNext: boolean }
  ) => Promise<void | "stop"> | void | "stop";
  maxPages: number;
  describe: string;
}): Promise<boolean> {
  for (let page = 1; page <= args.maxPages; page++) {
    const result = await args.fetchPage(page);
    const hasNext = result.meta.hasNext;
    if ((await args.onPage(result.items, { hasNext })) === "stop") return false;
    if (!result.meta.hasNext) return true;
  }
  throw new Error(
    `Paged walk over ${args.describe} stopped after ${args.maxPages} pages ` +
      `with more reported; the rest were not read.`
  );
}

/** The id a page of rows ended on, which the next page starts after. */
export function lastIdOf(items: readonly unknown[]): string | undefined {
  const last = items.at(-1);
  const id =
    typeof last === "object" && last !== null
      ? (last as { id?: unknown }).id
      : undefined;
  return typeof id === "string" ? id : undefined;
}
