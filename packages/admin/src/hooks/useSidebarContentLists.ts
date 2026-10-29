/**
 * The collections and Singles the sidebar lists, in the order it lists them.
 *
 * One hook per kind, read by the list that draws it and by the Content panel,
 * which counts matches in the part that isn't showing. Computing those counts
 * separately would be a second answer to "what does the sidebar list for this
 * search", and the two would drift: a dot saying Singles has matches over a
 * Singles list showing none.
 *
 * @module hooks/useSidebarContentLists
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { NAV_COLLECTIONS_PARAMS, useCollections } from "@admin/hooks/queries";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { useSidebarPins } from "@admin/hooks/useSidebarPins";
import {
  getSidebarCollectionsForLanding,
  getSidebarSinglesForLanding,
} from "@admin/lib/sidebar-landing";
import { singleApi } from "@admin/services/singleApi";
import type { ApiCollection, ApiSingle } from "@admin/types/entities";

const PINNED_COLLECTIONS_STORAGE_KEY = "nextly:sidebar:pinned-collections";
const PINNED_SINGLES_STORAGE_KEY = "nextly:sidebar:pinned-singles";
const SIDEBAR_PAGE_SIZE = 100;

/** The collections the sidebar lists, before any search, with their pins. */
export function useSidebarCollectionList() {
  const { capabilities } = useCurrentUserPermissions();
  const branding = useBranding();
  const query = useCollections(NAV_COLLECTIONS_PARAMS, {
    staleTime: 5 * 60 * 1000,
  });
  const pins = useSidebarPins({ storageKey: PINNED_COLLECTIONS_STORAGE_KEY });

  // The same filter and sort as the /admin/collections redirect, so the
  // sidebar's first item and the landing target agree.
  const items: ApiCollection[] = getSidebarCollectionsForLanding(
    query.data?.items ?? [],
    { branding, capabilities, pinnedCollections: pins.pinned }
  );

  return {
    items,
    data: query.data,
    isLoading: query.isLoading,
    // The sidebar reads one page of collections; a search can only say
    // nothing matched when that page is all there is.
    isComplete: !query.isLoading && query.data?.meta?.hasNext !== true,
    error: query.error,
    isPinned: pins.isPinned,
    togglePin: pins.togglePin,
  };
}

/** The Singles the sidebar lists, before any search, with their pins. */
export function useSidebarSingleList({
  enabled = true,
}: {
  /**
   * Whether to walk the pages at all. A reader that only needs Singles once a
   * search asks for them leaves this off until then, so opening Collections
   * doesn't page through every Single.
   */
  enabled?: boolean;
} = {}) {
  // Walk the paginated singles endpoint until `meta.hasNext` is false so the
  // sidebar can render every single regardless of count.
  const {
    data: singlesPages,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "singles",
      "sidebar-all",
      { pageSize: SIDEBAR_PAGE_SIZE },
    ] as const,
    queryFn: ({ pageParam }) =>
      singleApi.fetchSingles({
        pagination: { page: pageParam, pageSize: SIDEBAR_PAGE_SIZE },
        sorting: [],
        filters: {},
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.meta.hasNext ? allPages.length : undefined,
    enabled,
  });

  // Guard against a persistent-error retry loop: when `fetchNextPage` fails,
  // React Query exhausts its retry policy and flips `isFetchingNextPage` back
  // to false, but `hasNextPage` stays true (it's computed from the last
  // successful page). Without the `isFetchNextPageError` check the effect
  // would immediately re-fire and hammer the endpoint forever.
  useEffect(() => {
    if (
      enabled &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError
    ) {
      // Joins a request already on its way rather than restarting it: the
      // Content panel and the Singles list each read this list, and both
      // effects can ask for the same next page in one commit.
      void fetchNextPage({ cancelRefetch: false });
    }
  }, [
    enabled,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  const allSingles: ApiSingle[] = useMemo(
    () => singlesPages?.pages.flatMap(p => p.items) ?? [],
    [singlesPages?.pages]
  );

  const { capabilities } = useCurrentUserPermissions();
  const pins = useSidebarPins({ storageKey: PINNED_SINGLES_STORAGE_KEY });

  // The same filter and sort as the /admin/singles redirect.
  const items = getSidebarSinglesForLanding(allSingles, {
    capabilities,
    pinnedSingles: pins.pinned,
  });

  return {
    items,
    isLoading,
    // Whether every page has arrived. The list draws from the first page on,
    // but a search that matched nothing may only say so once this is true: the
    // match may be on a page still on its way, or on one that failed.
    isComplete: enabled && !isLoading && !hasNextPage,
    isPinned: pins.isPinned,
    togglePin: pins.togglePin,
  };
}
