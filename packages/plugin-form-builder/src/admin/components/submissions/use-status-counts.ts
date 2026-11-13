"use client";

/**
 * How many submissions each status tab of a list holds, with the list's form
 * and dates, for the counts beside the tabs. Each count is the entries API's
 * total for the tab's own filter, built by `listWhere` as the list's rows are,
 * so a tab's count is what clicking it lists.
 *
 * @module admin/components/submissions/use-status-counts
 */
import { useQuery } from "@tanstack/react-query";

import { SUBMISSION_COUNT_KEY } from "../editor/useSubmissionCount";

import {
  listWhere,
  type StatusTab,
  type SubmissionListScope,
} from "./submission-list-scope";

/** The tabs counted, in the order they are drawn. */
const COUNTED: readonly StatusTab[] = [
  "all",
  "new",
  "read",
  "archived",
  "spam",
];

/** The total one tab's filter matches; a failed read is an error. */
async function countOf(
  slug: string,
  scope: SubmissionListScope
): Promise<number> {
  // One row is asked for, since only the total is read.
  const params = new URLSearchParams({
    limit: "1",
    where: JSON.stringify(listWhere(scope)),
  });
  const response = await fetch(
    `/admin/api/collections/${encodeURIComponent(slug)}/entries?${params}`,
    { credentials: "include" }
  );
  if (!response.ok) throw new Error(`count ${response.status}`);
  const body = (await response.json()) as { meta?: { total?: unknown } };
  const total = body.meta?.total;
  if (typeof total !== "number") throw new Error("count missing");
  return total;
}

/** Every tab's count for `scope`, read together. */
async function countAll(
  slug: string,
  scope: Omit<SubmissionListScope, "status">
): Promise<Record<StatusTab, number>> {
  const totals = await Promise.all(
    COUNTED.map(status => countOf(slug, { ...scope, status }))
  );
  return Object.fromEntries(
    COUNTED.map((status, index) => [status, totals[index]])
  ) as Record<StatusTab, number>;
}

/**
 * Each tab's count for the list's form and dates, or `undefined` while it is
 * unknown (loading, or a read failed): the tabs then show no number rather
 * than a wrong one. Kept under the submission counts' key, so every change
 * the list makes reads them again.
 */
export function useStatusCounts(
  slug: string | undefined,
  scope: Omit<SubmissionListScope, "status">
): Record<StatusTab, number> | undefined {
  const { data } = useQuery({
    queryKey: [...SUBMISSION_COUNT_KEY, "tabs", slug, scope],
    enabled: slug !== undefined,
    queryFn: () => countAll(slug ?? "", scope),
    retry: false,
  });
  return data;
}
