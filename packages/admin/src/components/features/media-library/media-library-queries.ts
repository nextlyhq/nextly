/**
 * The media library's own queries and writes: the sidebar's counts, where an
 * item is used, a delete that can be undone, and Replace. Every write
 * refreshes what the media lists, folders and counts show, so an item leaves
 * or returns everywhere at once.
 */

import {
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

/** Where an item is used; nothing is asked while `mediaId` is null. */
export function useMediaUsage(
  mediaId: string | null
): UseQueryResult<MediaUsage, Error> {
  return useQuery<MediaUsage, Error>({
    queryKey: usageKey(mediaId ?? ""),
    queryFn: () => fetchMediaUsage(mediaId ?? ""),
    enabled: mediaId !== null,
  });
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
