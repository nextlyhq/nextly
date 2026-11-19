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
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useEveryNavCollection } from "@admin/hooks/queries/useCollections";
import { useEverySingle } from "@admin/hooks/queries/useSingles";
import {
  fetchWaitingForMe,
  fetchWaitingScope,
} from "@admin/services/workflowApi";
import type { WaitingItem } from "@admin/types/workflows";

/** The query keys of the waiting list and its scope, all under one root so a move can refresh both. */
const waitingKeys = {
  all: () => ["workflow-waiting"] as const,
  scope: () => ["workflow-waiting", "scope"] as const,
  page: (page: number, limit: number) =>
    ["workflow-waiting", "page", page, limit] as const,
};

/**
 * Whether anything can ever wait for the reader's review: how many stages' next step they may take.
 * Kept for five minutes, as the navigation lists are: it changes only with grants and workflows.
 */
export function useWaitingScope(): UseQueryResult<
  { reviews: boolean; stages: number },
  Error
> {
  return useQuery({
    queryKey: waitingKeys.scope(),
    queryFn: fetchWaitingScope,
    staleTime: 5 * 60 * 1000,
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
    href:
      scopeKind === "single"
        ? buildRoute(ROUTES.SINGLE_EDIT, { slug: scopeSlug })
        : buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
            slug: scopeSlug,
            id: entryId,
          }),
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
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: waitingKeys.page(page, limit),
    queryFn: () => fetchWaitingForMe({ page, limit }),
  });
  const collections = useEveryNavCollection();
  const singles = useEverySingle();
  const labels = new Map<string, string>([
    ...(collections.data ?? []).map(
      each => [`collection:${each.name}`, each.label] as [string, string]
    ),
    ...(singles.data ?? []).map(
      each => [`single:${each.slug}`, each.label] as [string, string]
    ),
  ]);
  return {
    rows: (query.data?.items ?? []).map(item => waitingRow(item, labels)),
    total: query.data?.meta.total ?? 0,
    totalCapped: query.data?.meta.totalCapped === true,
    isLoading: query.isLoading,
  };
}
