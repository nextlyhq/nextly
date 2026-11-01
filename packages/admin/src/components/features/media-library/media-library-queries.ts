/**
 * The media library's own queries and writes: the sidebar's counts, where an
 * item is used, a delete that can be undone, and Replace. Every write
 * refreshes what the media lists, folders and counts show, so an item leaves
 * or returns everywhere at once.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { Media } from "@admin/types/media";

import {
  deleteMediaLater,
  fetchMediaLibraryCounts,
  fetchMediaUsage,
  replaceMediaFile,
  undoMediaDelete,
  type MediaLibraryCounts,
  type MediaUsage,
  type PendingMediaDelete,
  type UndoneMediaDelete,
} from "./media-library-api";

/** The counts' key, under `media` so every media write refreshes them. */
const COUNTS_KEY = ["media", "library-counts"] as const;

/** An item's usage key, under `media` for the same reason. */
const usageKey = (mediaId: string) => ["media", "usage", mediaId] as const;

/** Refresh every list, folder, count and usage the library shows. */
function refreshMediaLists(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["media"] }),
    queryClient.invalidateQueries({ queryKey: ["media-infinite"] }),
    queryClient.invalidateQueries({ queryKey: ["folders"] }),
  ]);
}

/**
 * The counts beside the folders: every folder's, and each view's. Asked only
 * while `enabled`.
 */
export function useMediaLibraryCounts(
  enabled = true
): UseQueryResult<MediaLibraryCounts, Error> {
  return useQuery<MediaLibraryCounts, Error>({
    queryKey: COUNTS_KEY,
    queryFn: fetchMediaLibraryCounts,
    enabled,
  });
}

/** Reading the next page of an item's uses. */
export interface MediaUsageMore {
  load: () => void;
  loading: boolean;
}

/** Where an item is used, as far as it has been read. */
export interface MediaUsageRead {
  data?: MediaUsage;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** Reading the next page, while one follows; `null` when none does. */
  more: MediaUsageMore | null;
}

/** The pages read so far, as one answer. */
function pagesRead(pages: readonly MediaUsage[]): MediaUsage {
  const last = pages[pages.length - 1];
  return {
    items: pages.flatMap(page => page.items),
    hidden: pages.reduce((sum, page) => sum + page.hidden, 0),
    total: last.total,
    hasNext: last.hasNext,
    heldByAddress: pages[0].heldByAddress,
    usageRecorded: pages.every(page => page.usageRecorded),
  };
}

/**
 * Where an item is used, a page of documents at a time, the next asked for
 * with `more`; nothing is asked while `mediaId` is null.
 */
export function useMediaUsage(mediaId: string | null): MediaUsageRead {
  const query = useInfiniteQuery({
    queryKey: usageKey(mediaId ?? ""),
    queryFn: ({ pageParam }) =>
      fetchMediaUsage(mediaId ?? "", { page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last: MediaUsage, all: MediaUsage[]) =>
      last.hasNext ? all.length + 1 : undefined,
    enabled: mediaId !== null,
  });
  const { fetchNextPage } = query;
  return {
    data:
      query.data && query.data.pages.length > 0
        ? pagesRead(query.data.pages)
        : undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
    more: query.hasNextPage
      ? {
          load: () => void fetchNextPage(),
          loading: query.isFetchingNextPage,
        }
      : null,
  };
}

/** Delete items so the delete can be undone; the lists refresh at once. */
export function useDeleteMediaLater(): UseMutationResult<
  PendingMediaDelete,
  Error,
  readonly string[]
> {
  const queryClient = useQueryClient();
  return useMutation<PendingMediaDelete, Error, readonly string[]>({
    mutationFn: ids => deleteMediaLater(ids),
    onSuccess: () => refreshMediaLists(queryClient),
  });
}

/** Bring back items deleted inside the window. */
export function useUndoMediaDelete(): UseMutationResult<
  UndoneMediaDelete,
  Error,
  readonly string[]
> {
  const queryClient = useQueryClient();
  return useMutation<UndoneMediaDelete, Error, readonly string[]>({
    mutationFn: ids => undoMediaDelete(ids),
    onSettled: () => refreshMediaLists(queryClient),
  });
}

/** Replace an item's file, keeping the item. */
export function useReplaceMediaFile(): UseMutationResult<
  Media,
  Error,
  { mediaId: string; file: File }
> {
  const queryClient = useQueryClient();
  return useMutation<Media, Error, { mediaId: string; file: File }>({
    mutationFn: ({ mediaId, file }) => replaceMediaFile(mediaId, file),
    onSuccess: () => refreshMediaLists(queryClient),
  });
}
