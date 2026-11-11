"use client";

/**
 * How many submissions a saved form has, for the count in the editor's bar.
 *
 * @module admin/components/editor/useSubmissionCount
 */
import { useQuery } from "@tanstack/react-query";

/**
 * The entries query that counts one form's submissions. Spam is left out, as
 * the Submissions list leaves it out of "All": the count is what people sent.
 * One row is asked for, since only the total is read.
 */
function submissionCountQuery(formId: string): string {
  return new URLSearchParams({
    limit: "1",
    where: JSON.stringify({
      form: { equals: formId },
      status: { not_equals: "spam" },
    }),
  }).toString();
}

/** The total an entries list answered, or `undefined` for none. */
function totalOf(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null || !("meta" in body)) {
    return undefined;
  }
  const meta = body.meta;
  if (typeof meta !== "object" || meta === null || !("total" in meta)) {
    return undefined;
  }
  return typeof meta.total === "number" ? meta.total : undefined;
}

/**
 * Where every form's submission count is cached. A change to a submission
 * (a delete, a status) invalidates it, so the count read beside the list is
 * the list's own answer, not one taken once as the editor opened.
 */
export const SUBMISSION_COUNT_KEY = [
  "plugin-form-builder",
  "submission-count",
] as const;

/** Reads one form's count; a failed read is an error, so none is shown. */
async function readCount(
  submissionsSlug: string,
  formId: string
): Promise<number | null> {
  const response = await fetch(
    `/admin/api/collections/${encodeURIComponent(submissionsSlug)}/entries?${submissionCountQuery(formId)}`,
    { credentials: "include" }
  );
  if (!response.ok) throw new Error(`count ${response.status}`);
  return totalOf(await response.json()) ?? null;
}

/**
 * The number of submissions `formId` has in `submissionsSlug`, or `undefined`
 * while it is unknown: not saved yet, still loading, or the read failed. The
 * bar then draws no count rather than a wrong one.
 */
export function useSubmissionCount(
  formId: string | undefined,
  submissionsSlug: string | undefined
): number | undefined {
  const { data } = useQuery({
    queryKey: [...SUBMISSION_COUNT_KEY, submissionsSlug, formId],
    enabled: formId !== undefined && submissionsSlug !== undefined,
    queryFn: () => readCount(submissionsSlug ?? "", formId ?? ""),
    // The count is a convenience: a failed read shows none, without retries.
    retry: false,
  });
  return data ?? undefined;
}
