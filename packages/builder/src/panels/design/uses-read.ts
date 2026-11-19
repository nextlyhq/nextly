/**
 * A where-used list, read a page at a time from a host's route: the places a
 * shared style or a variable is used, for each tab that lists them.
 *
 * @module uses-read
 */
import * as React from "react";

/** How many places one where-used page names. */
export const USES_PAGE_SIZE = 20;

/** What one where-used page answers, whatever it lists. */
export interface UsesPage<I> {
  readonly items: readonly I[];
  /** Every place this author may open, across all pages. */
  readonly total: number;
  /** Places using it that this author may not open. */
  readonly hidden: number;
  /** Whether another page follows. */
  readonly hasNext: boolean;
  /** False while some pages are still being counted. */
  readonly complete: boolean;
}

/** The places one page of a where-used list names. */
type PlaceOf<P extends UsesPage<unknown>> = P["items"][number];

/** The where-used pages read so far, and how the last read went. */
export interface UsesRead<P extends UsesPage<unknown>> {
  readonly items: readonly PlaceOf<P>[];
  readonly last: P | undefined;
  readonly page: number;
  /** The last page that arrived; behind `page` while that one is coming. */
  readonly loaded: number;
  readonly failed: boolean;
}

/**
 * The places `id` is used, read a page at a time through `uses`, the host's
 * read; none while there is no read. `uses` is read by identity, so a host
 * hands the same function across renders.
 */
export function useUses<P extends UsesPage<unknown>>(
  uses:
    | ((id: string, page: number, signal: AbortSignal) => Promise<P>)
    | undefined,
  id: string
): { read: UsesRead<P>; more: () => void } {
  const [read, setRead] = React.useState<UsesRead<P>>({
    items: [],
    last: undefined,
    page: 1,
    loaded: 0,
    failed: false,
  });
  React.useEffect(() => {
    if (uses === undefined) return;
    const controller = new AbortController();
    uses(id, read.page, controller.signal).then(
      answer => {
        if (controller.signal.aborted) return;
        setRead(current => ({
          ...current,
          items: [...current.items, ...answer.items],
          last: answer,
          loaded: current.page,
        }));
      },
      () => {
        if (controller.signal.aborted) return;
        setRead(current => ({ ...current, failed: true }));
      }
    );
    return () => controller.abort();
  }, [uses, id, read.page]);
  // The next page follows the last one that arrived, and only once the one
  // asked for has: a second press while a page is coming would otherwise
  // abort it and append the page after it, losing a page of places.
  const more = React.useCallback(
    () =>
      setRead(current =>
        current.loaded < current.page
          ? current
          : { ...current, page: current.loaded + 1 }
      ),
    []
  );
  return { read, more };
}
