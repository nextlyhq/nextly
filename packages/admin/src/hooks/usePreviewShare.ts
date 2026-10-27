"use client";

/**
 * Sharing one document's preview: creating a link for a chosen time, the
 * document's live links, and revoking one of them or all of them.
 *
 * One hook rather than four, because the four answer one question: what links
 * to this document exist right now. Creating or revoking one changes that
 * answer, and each refreshes the list itself, so the popover never shows a link
 * that was just revoked or misses one that was just made.
 *
 * @module hooks/usePreviewShare
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { usePreviewLink } from "@admin/hooks/usePreviewLink";
import {
  previewLinkApi,
  type PreviewLinkDocument,
  type PreviewLinkListItem,
} from "@admin/services/previewLinkApi";

/** The lifetimes an editor can choose from, shortest first. */
export const PREVIEW_LINK_LIFETIMES: readonly [
  {
    readonly id: "1h";
    readonly label: "1 hour";
    readonly seconds: number;
  },
  {
    readonly id: "1d";
    readonly label: "1 day";
    readonly seconds: number;
  },
  {
    readonly id: "3d";
    readonly label: "3 days";
    readonly seconds: number;
  },
  {
    readonly id: "7d";
    readonly label: "7 days";
    readonly seconds: number;
  },
] = [
  { id: "1h", label: "1 hour", seconds: 60 * 60 },
  { id: "1d", label: "1 day", seconds: 24 * 60 * 60 },
  { id: "3d", label: "3 days", seconds: 3 * 24 * 60 * 60 },
  { id: "7d", label: "7 days", seconds: 7 * 24 * 60 * 60 },
] as const;

export type PreviewLinkLifetime = (typeof PREVIEW_LINK_LIFETIMES)[number]["id"];

/** What a new link lasts unless the editor chooses otherwise. */
export const DEFAULT_PREVIEW_LINK_LIFETIME: PreviewLinkLifetime = "1d";

/** The list's cache key: one per document, its locale included. */
export function previewLinksKey(document: PreviewLinkDocument): QueryKey {
  return ["preview-links", document];
}

/** The thrown message, else a fallback that names the action. */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

/** What {@link usePreviewShare} returns. */
type PreviewShare = {
  links: UseQueryResult<
    {
      items: PreviewLinkListItem[];
      total: number;
    },
    Error
  >;
  create: UseMutationResult<
    {
      url: string;
      copied: boolean;
      expiresAt: string;
    },
    unknown,
    void | {
      ttlSeconds: number;
    },
    unknown
  >;
  revoke: UseMutationResult<
    {
      id: string;
      revokedAt: string;
    },
    unknown,
    string,
    unknown
  >;
  revokeAll: UseMutationResult<
    {
      revoked: number;
    },
    unknown,
    void,
    unknown
  >;
};

export function usePreviewShare(
  document: PreviewLinkDocument,
  {
    /** Whether to read the list: only while the popover is open. */
    enabled,
  }: { enabled: boolean }
): PreviewShare {
  const queryClient = useQueryClient();
  const key = previewLinksKey(document);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const links = useQuery({
    queryKey: key,
    queryFn: () => previewLinkApi.list(document),
    enabled,
    // A list of live credentials: read fresh each time it is opened rather
    // than shown from a cache that may still hold a revoked one.
    staleTime: 0,
  });

  const create = usePreviewLink(document, { onCreated: refresh });

  const revoke = useMutation({
    mutationFn: (id: string) => previewLinkApi.revoke(id, document),
    onSuccess: () => toast.success("Link revoked. It no longer opens."),
    onError: (error: unknown) =>
      toast.error(messageOf(error, "Couldn't revoke that link.")),
    onSettled: refresh,
  });

  const revokeAll = useMutation({
    mutationFn: () => previewLinkApi.revokeDocument(document),
    onSuccess: () =>
      toast.success("All links to this page are revoked. None of them opens."),
    onError: (error: unknown) =>
      toast.error(messageOf(error, "Couldn't revoke the links.")),
    onSettled: refresh,
  });

  return { links, create, revoke, revokeAll };
}
