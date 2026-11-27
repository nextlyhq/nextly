"use client";

/**
 * The relationship picker's search: what it shows, for which search, and
 * whether that search is still out, has failed, or has more to load.
 *
 * Results are kept with the search they answer and stay on screen until the
 * next search answers, so typing never blanks the list. Pages accumulate for
 * one search and are forgotten when it is left.
 *
 * @module components/entries/fields/relational/useRelationshipSearch
 */

import { useCallback, useEffect, useState } from "react";

import { UI } from "@admin/constants/ui";
import { useEntries } from "@admin/hooks/queries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";

/** A result item from the search. */
export interface SearchResultItem {
  id: string;
  title?: string;
  name?: string;
  label?: string;
  email?: string;
  description?: string;
  [key: string]: unknown;
}

/** What the picker draws from its search. */
export interface RelationshipSearchState {
  /** The term as sent, once the debounce has passed it on. */
  debouncedSearch: string;
  /** This collection's results for the latest answered search. */
  shownHere: SearchResultItem[];
  /** Whether the shown results answer what is typed. */
  answered: boolean;
  /** Whether the request for what is typed failed, with nothing in flight. */
  failed: boolean;
  /** Whether the answer for what is typed is still to come. */
  searching: boolean;
  hasMore: boolean;
  totalDocs: number;
  isFetching: boolean;
  loadMore: () => void;
  retry: () => void;
}

/** Results kept with the search they answer. */
interface ShownResults {
  key: string;
  items: SearchResultItem[];
}

/**
 * What is shown once page `page` of the search `key` answers `items`: its
 * first page replaces what is shown, a later page adds the entries not
 * already shown.
 */
function withAnswer(
  previous: ShownResults,
  key: string,
  page: number,
  items: SearchResultItem[]
): ShownResults {
  if (page === 1 || previous.key !== key) return { key, items };
  const existingIds = new Set(previous.items.map(item => item.id));
  return {
    key,
    items: [
      ...previous.items,
      ...items.filter(item => !existingIds.has(item.id)),
    ],
  };
}

/**
 * Whether the search for what is typed failed or is still out. It failed
 * once its request settled in error, retries and all, with nothing in
 * flight; until then, an unsent term or an unanswered search is still out.
 */
function searchStatus(state: {
  sent: boolean;
  answered: boolean;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
}): { failed: boolean; searching: boolean } {
  const failed = state.isError && !state.isFetching && state.sent;
  if (failed) return { failed, searching: false };
  return {
    failed,
    searching: !state.sent || !state.answered || state.isLoading,
  };
}

/** The search for `search` in `collection`, `limit` entries a page. */
export function useRelationshipSearch(
  collection: string,
  search: string,
  limit: number
): RelationshipSearchState {
  const debouncedSearch = useDebouncedValue(search, UI.SEARCH_DEBOUNCE_MS);
  // Which search the results belong to: a collection and the term sent.
  const searchKey = `${collection}\u0000${debouncedSearch}`;
  // Not `usePagination`, because this list does not paginate: it ACCUMULATES.
  // The page number only ever increments to fetch more, results append to what
  // is already shown, and there is no page size selector and no way back to a
  // previous page. The hook models navigation between pages of a fixed set,
  // which is a different thing that happens to count with the same word.
  // The page is kept with the search it was counted for, so a new term reads
  // its first page, and never another term's page number, with no reset to
  // run first.
  const [paging, setPaging] = useState({ key: searchKey, page: 1 });
  const currentPage = paging.key === searchKey ? paging.page : 1;
  // Leaving a search forgets its pages: coming back to it reads its first
  // page again, since the results shown by then are another search's, and a
  // later page alone would leave out the matches before it.
  useEffect(() => {
    setPaging(previous =>
      previous.key === searchKey ? previous : { key: searchKey, page: 1 }
    );
  }, [searchKey]);
  // The results shown, with the search they answer. They stay on screen
  // until the next search answers, so typing never blanks the list. Nothing
  // has answered yet at first, which no search's key matches.
  const [shown, setShown] = useState<ShownResults>({ key: "", items: [] });

  const { data, isLoading, isFetching, isPlaceholderData, isError, refetch } =
    useEntries({
      collectionSlug: collection,
      params: {
        search: debouncedSearch,
        limit,
        page: currentPage,
        // Editors relate to draft content too, so the picker must not be limited
        // to the REST published-only default — request all statuses.
        status: "all",
      },
      enabled: !!collection,
    });

  // An answer for this search: its first page replaces what is shown, a later
  // page adds the entries not already shown. A placeholder is the previous
  // search's answer, held while this one loads, so it changes nothing.
  useEffect(() => {
    if (data?.items === undefined || isPlaceholderData) return;
    const items = data.items as SearchResultItem[];
    setShown(previous => withAnswer(previous, searchKey, currentPage, items));
  }, [data, isPlaceholderData, currentPage, searchKey]);

  // Another collection's results are never offered: picking one would relate
  // an entry of that collection under this one's slug.
  const shownHere = shown.key.startsWith(`${collection}\u0000`)
    ? shown.items
    : [];

  // Whether the answer for what is typed is still to come: the term is
  // waiting out the debounce, or its first page is not in yet. Until it
  // comes, no empty result is said, since none has been answered. A later
  // page loading is said on its own button instead.
  const answered = shown.key === searchKey;
  // A request for what is typed that failed, retries and all: settled, with
  // nothing in flight, so it is said with a way to ask again rather than
  // left reading as a search still out.
  const { failed, searching } = searchStatus({
    sent: search === debouncedSearch,
    answered,
    isError,
    isFetching,
    isLoading,
  });

  // Check if there are more pages to load (canonical meta per spec §5.1).
  // While a later page loads, the data held is the page before it, whose
  // answer still stands.
  const hasMore = answered && (data?.meta.hasNext ?? false);
  const totalDocs = data?.meta.total ?? 0;

  const loadMore = useCallback(() => {
    setPaging({ key: searchKey, page: currentPage + 1 });
  }, [searchKey, currentPage]);
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    debouncedSearch,
    shownHere,
    answered,
    failed,
    searching,
    hasMore,
    totalDocs,
    isFetching,
    loadMore,
    retry,
  };
}
