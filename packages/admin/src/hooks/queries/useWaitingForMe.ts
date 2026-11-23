"use client";

/**
 * What waits for the reader's review, as the "Waiting for my review" view and the Content panel
 * read it: whether anything can ever wait for them (the panel shows its link on it), and a page of
 * what waits now, as rows the view draws.
 *
 * @module hooks/queries/useWaitingForMe
 * @experimental
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { waitingForWords } from "@admin/components/features/entries/review/review-words";
import { useEveryNavCollection } from "@admin/hooks/queries/useCollections";
import { useEverySingle } from "@admin/hooks/queries/useSingles";
import {
  useWorkflowEntities,
  workflowMayHold,
} from "@admin/hooks/useWorkflowEntities";
import { documentAddress } from "@admin/lib/navigation/document-address";
import {
  fetchWaitingForMe,
  fetchWaitingScope,
} from "@admin/services/workflowApi";
import type { WaitingItem } from "@admin/types/workflows";

/** The query keys of the waiting list and its scope, all under one root so a move can refresh both. */
export const waitingKeys = {
  all: () => ["workflow-waiting"] as const,
  scope: () => ["workflow-waiting", "scope"] as const,
  page: (page: number, limit: number) =>
    ["workflow-waiting", "page", page, limit] as const,
};

/** The scope of a reader no workflow can hold anything for, as the route would answer it. */
const NOTHING_WAITS: { reviews: boolean; stages: number } = {
  reviews: false,
  stages: 0,
};

/** Reads any scope held from before the last workflow was detached as nothing waiting. */
const asNothingWaits = (): { reviews: boolean; stages: number } =>
  NOTHING_WAITS;

/**
 * Whether anything can ever wait for the reader's review: how many stages' next step they may take.
 * Kept for five minutes, as the navigation lists are: it changes only with grants and workflows.
 * Not asked where the server's workspace answer says no workflow holds anything this reader may
 * read: nothing can wait for them then, and it is answered so, as the route would answer it, over
 * any scope held from before the last workflow was detached, so the panel and the list show no
 * review link or move.
 */
export function useWaitingScope(): UseQueryResult<
  { reviews: boolean; stages: number },
  Error
> {
  const entities = useWorkflowEntities();
  const asked = workflowMayHold(entities);
  // Known: the server said which entities a workflow holds, and there are none.
  const nothingHeld = !asked && typeof entities === "object";
  return useQuery({
    queryKey: waitingKeys.scope(),
    queryFn: fetchWaitingScope,
    staleTime: 5 * 60 * 1000,
    enabled: asked,
    ...(nothingHeld
      ? { placeholderData: NOTHING_WAITS, select: asNothingWaits }
      : {}),
  });
}

/** One row of the waiting view. */
export interface WaitingRow {
  key: string;
  title: string;
  href: string;
  /** The collection or Single it lives in, with its language for a part in one. */
  where: string;
  stage: string;
  waitingFor: string;
  submitted: string;
}

/** A waiting item as a row, its document named and linked, its place labelled. */
function waitingRow(
  item: WaitingItem,
  labels: ReadonlyMap<string, string>
): WaitingRow {
  const { scopeKind, scopeSlug, entryId } = item.document;
  const label = labels.get(`${scopeKind}:${scopeSlug}`) ?? scopeSlug;
  return {
    key: `${scopeKind}:${scopeSlug}:${entryId}:${item.part ?? "-"}`,
    title: item.title ?? "Untitled",
    // The shared rule for a document's address, in the part's own language, so the editor opens
    // the copy awaiting review rather than the default language's.
    href: documentAddress(
      scopeKind === "single"
        ? { kind: "single", slug: scopeSlug }
        : { kind: "collection", slug: scopeSlug, id: entryId },
      undefined,
      {
        canUpdate: false,
        ...(item.part === null ? {} : { locale: item.part }),
      },
      []
    ),
    where: item.part === null ? label : `${label} (${item.part})`,
    stage: item.stageLabel,
    waitingFor: waitingForWords(item.waitingFor) ?? "No one",
    submitted: item.enteredAt,
  };
}

/** A page of what waits for the reader now, as rows, with its total and whether that is a floor. */
export function useWaitingForMe({
  page,
  limit,
}: {
  page: number;
  limit: number;
}): {
  rows: WaitingRow[];
  total: number;
  totalCapped: boolean;
  /** Whether a next or an earlier page exists, as the list read says. */
  hasNext: boolean;
  hasPrev: boolean;
  isLoading: boolean;
  /** Why the list could not be read, once its retries are spent; null while it is read or was. */
  error: Error | null;
} {
  const query = useQuery({
    queryKey: waitingKeys.page(page, limit),
    queryFn: () => fetchWaitingForMe({ page, limit }),
  });
  const collections = useEveryNavCollection();
  const singles = useEverySingle();
  const labels = new Map<string, string>([
    // A collection by its name as the sidebar shows it: the plural label, which names the list.
    ...(collections.data ?? []).map(
      each =>
        [
          `collection:${each.name}`,
          each.labels?.plural || each.label || each.name,
        ] as [string, string]
    ),
    ...(singles.data ?? []).map(
      each => [`single:${each.slug}`, each.label] as [string, string]
    ),
  ]);
  return {
    rows: (query.data?.items ?? []).map(item => waitingRow(item, labels)),
    total: query.data?.meta.total ?? 0,
    totalCapped: query.data?.meta.totalCapped === true,
    hasNext: query.data?.meta.hasNext === true,
    hasPrev: query.data?.meta.hasPrev === true,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
