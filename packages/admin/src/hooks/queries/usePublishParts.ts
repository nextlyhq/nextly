/**
 * usePublishParts: publish or unpublish the languages and the shared fields a person chose, of an
 * entry or a Single, and say first what that would do.
 *
 * The description is the server's own answer to the same request with `describe: true`, so what
 * the dialog says each part will do is what the publish then does. The move is sent with the
 * version of every language, from a read of every language just before, as publishing every
 * language is: a part that changed since the editor read it is refused rather than put live
 * unseen.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module hooks/queries/usePublishParts
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { recordingsSettled } from "@admin/hooks/useSnapshotAutosave";
import {
  EVERY_LANGUAGE,
  refusedAsChangedSince,
  versionToPublishEveryLanguage,
  type ShownCopy,
} from "@admin/lib/document-version";
import { entryApi, entryKeys } from "@admin/services/entryApi";
import type {
  PublishPartsChoice,
  PublishPartsDirection,
  PublishPartsResult,
} from "@admin/services/publishParts";
import { singleApi } from "@admin/services/singleApi";

import { refreshRemovedFromCodeSchema } from "./removed-from-code-refusal";
import { singleDocumentKeys } from "./useSingles";

/** The document whose parts move: an entry of a collection, or a Single. */
export type PartsTarget =
  | { kind: "collection"; slug: string; id: string }
  | { kind: "single"; slug: string };

/** The parts asked about or moved, without the version, which the hook reads itself. */
export type PartsRequest = Omit<PublishPartsChoice, "version" | "describe">;

/** The request, sent to the target's route. */
function send(
  target: PartsTarget,
  direction: PublishPartsDirection,
  choice: PublishPartsChoice
): Promise<PublishPartsResult> {
  return target.kind === "collection"
    ? entryApi.publishParts(target.slug, target.id, direction, choice)
    : singleApi.publishParts(target.slug, direction, choice);
}

/** A read of the target in `locale`, as the version check reads it. */
function readIn(
  target: PartsTarget,
  options: { locale?: string; draft?: boolean }
): Promise<unknown> {
  return target.kind === "collection"
    ? entryApi.findByID(target.slug, target.id, options)
    : singleApi.getDocument(target.slug, options);
}

/** The target's detail queries, every language-keyed variant of them. */
function detailKey(target: PartsTarget): readonly unknown[] {
  return target.kind === "collection"
    ? entryKeys.detail(target.slug, target.id)
    : singleDocumentKeys.detail(target.slug);
}

/**
 * What the chosen parts would do, asked of the server without changing anything. Not asked while
 * `enabled` is false or nothing is chosen.
 */
export function usePublishPartsDescription(args: {
  target: PartsTarget;
  direction: PublishPartsDirection;
  request: PartsRequest;
  enabled: boolean;
}): UseQueryResult<PublishPartsResult, Error> {
  const { target, direction, request, enabled } = args;
  const chosen =
    request.locales === "all" ||
    request.locales.length > 0 ||
    request.shared === true;
  return useQuery({
    queryKey: [
      ...detailKey(target),
      "parts-description",
      direction,
      request.locales,
      request.shared ?? false,
    ],
    // A description writes nothing, and carries no version: it describes the
    // document as it stands.
    queryFn: () =>
      send(target, direction, {
        ...request,
        describe: true,
        version: undefined,
      }),
    enabled: enabled && chosen,
    // Always read afresh when asked: what a part would do changes with every save.
    staleTime: 0,
    retry: false,
  });
}

export interface UsePublishPartsOptions {
  target: PartsTarget;
  direction: PublishPartsDirection;
  /** The editor's copy, where there is one; see `versionToPublishEveryLanguage`. */
  shown?: () => ShownCopy | undefined;
}

/** Publish or unpublish the chosen parts. The caller tells the person how it went. */
export function usePublishParts({
  target,
  direction,
  shown,
}: UsePublishPartsOptions): UseMutationResult<
  PublishPartsResult,
  Error,
  PartsRequest,
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: PartsRequest) => {
      const copy = shown?.();
      // A recording of the editor's work already sent must land before the publish: one landing
      // after it would be offered as current work made from the document before it went live.
      // Pending throughout, so the action shows busy while it waits.
      await recordingsSettled(copy?.recordings ?? null);
      return send(target, direction, {
        ...request,
        version: await versionToPublishEveryLanguage(
          () => readIn(target, { locale: EVERY_LANGUAGE }),
          copy,
          shownCopy =>
            readIn(target, { locale: shownCopy.locale, draft: shownCopy.draft })
        ),
      });
    },
    onSuccess: () => {
      // Every language-keyed variant changed status, and the lists show it.
      void queryClient.invalidateQueries({ queryKey: detailKey(target) });
      if (target.kind === "collection") {
        void queryClient.invalidateQueries({ queryKey: entryKeys.lists() });
      }
    },
    onError: error => {
      refreshRemovedFromCodeSchema(queryClient, error);
      // Changed since the editor read it: read again, so a second try is made from what is
      // there now.
      if (refusedAsChangedSince(error)) {
        void queryClient.invalidateQueries({ queryKey: detailKey(target) });
      }
    },
  });
}
