/**
 * What the admin's caches do once an entry has been written: one answer for
 * every path that writes one, so a list, a count or a dashboard card cannot
 * keep showing a document one path refreshed and another did not.
 *
 * The update and delete hooks call these on success, and so does the editor
 * when a plugin's own surface reports it changed or removed the document.
 *
 * @module hooks/queries/entry-cache
 */
import type { QueryClient } from "@tanstack/react-query";

import { entryKeys } from "@admin/services/entryApi";

/**
 * An entry was changed: its lists, its own read and the dashboard refetch.
 * Resolves once they have, for a caller that must know when the entry's new
 * copy has arrived; one that need not leaves it unawaited.
 */
export async function refreshAfterEntryChange(
  queryClient: QueryClient,
  collectionSlug: string,
  entryId: string
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: entryKeys.listsByCollection(collectionSlug),
    }),
    queryClient.invalidateQueries({
      queryKey: entryKeys.detail(collectionSlug, entryId),
    }),
    // So recent-entries cards refresh at once.
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}

/**
 * An entry was deleted: its lists and the counts refetch, its own read is
 * dropped rather than refetched (there is nothing left to read), and the
 * dashboard refetches.
 */
export function refreshAfterEntryDelete(
  queryClient: QueryClient,
  collectionSlug: string,
  entryId: string
): void {
  void queryClient.invalidateQueries({
    queryKey: entryKeys.listsByCollection(collectionSlug),
  });
  void queryClient.invalidateQueries({ queryKey: entryKeys.counts() });
  queryClient.removeQueries({
    queryKey: entryKeys.detail(collectionSlug, entryId),
  });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}
