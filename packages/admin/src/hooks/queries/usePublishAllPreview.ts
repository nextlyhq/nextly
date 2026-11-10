/**
 * usePublishAllPreview: what publishing every language of a document would do,
 * language by language, read from the server while the "Publish all" dialog is
 * open.
 *
 * Read fresh every time the dialog opens, never from an earlier answer: a
 * language saved or published since then changes what the publish does, and
 * the dialog must say what pressing it does now.
 *
 * @module hooks/queries/usePublishAllPreview
 */

import { useQuery } from "@tanstack/react-query";

import type { PublishAllPreview } from "@admin/services/publishAllPreview";

/** Where the server's preview of the publish stands. */
export type PublishAllPreviewState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; preview: PublishAllPreview };

/** How a surface reads its document's preview, and the key it is kept under. */
export interface PublishAllPreviewSource {
  fetch: () => Promise<PublishAllPreview>;
  key: readonly unknown[];
}

export function usePublishAllPreview(
  source: PublishAllPreviewSource | undefined,
  enabled: boolean
): PublishAllPreviewState {
  const query = useQuery({
    queryKey: source?.key ?? ["publish-all-preview", "none"],
    queryFn: () => {
      // Only enabled with a source, so this never runs without one.
      if (!source) throw new Error("No publish-all preview to read.");
      return source.fetch();
    },
    enabled: enabled && source !== undefined,
    // Each opening asks again: see the module comment.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  // An answer kept from an earlier opening is not this opening's: until the
  // fresh read lands, the dialog waits, and offers no publish on it.
  if (query.isFetching) return { status: "loading" };
  if (query.isError) return { status: "failed" };
  if (query.data === undefined) return { status: "loading" };
  return { status: "ready", preview: query.data };
}
