"use client";

/**
 * How many submissions a saved form has, for the count in the editor's bar.
 *
 * @module admin/components/editor/useSubmissionCount
 */
import { useEffect, useState } from "react";

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
 * The number of submissions `formId` has in `submissionsSlug`, or `undefined`
 * while it is unknown: not saved yet, still loading, or the read failed. The
 * bar then draws no count rather than a wrong one.
 */
export function useSubmissionCount(
  formId: string | undefined,
  submissionsSlug: string | undefined
): number | undefined {
  const [count, setCount] = useState<{ key: string; total: number }>();
  const key =
    formId === undefined || submissionsSlug === undefined
      ? undefined
      : `${submissionsSlug}/${formId}`;

  useEffect(() => {
    if (
      formId === undefined ||
      submissionsSlug === undefined ||
      key === undefined
    ) {
      return;
    }
    let cancelled = false;
    void fetch(
      `/admin/api/collections/${encodeURIComponent(submissionsSlug)}/entries?${submissionCountQuery(formId)}`,
      { credentials: "include" }
    )
      .then(response => (response.ok ? response.json() : undefined))
      .then((body: unknown) => {
        const total = totalOf(body);
        if (!cancelled && total !== undefined) setCount({ key, total });
      })
      .catch(() => {
        // The count is a convenience: without it the bar shows none.
      });
    return () => {
      cancelled = true;
    };
  }, [formId, submissionsSlug, key]);

  // Only the answer for the form on screen, never one left from another.
  return count !== undefined && count.key === key ? count.total : undefined;
}
