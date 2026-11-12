/**
 * Which submissions a list shows, carried from the list to a submission's
 * page so its previous and next move through the same list: the form it is
 * fixed to or filtered by, and the status tab. One place builds the list's
 * query from it, so the page cannot step through a different list than the
 * one it was opened from.
 *
 * @module admin/components/submissions/submission-list-scope
 */

/** A status tab of the submissions list. */
export type StatusTab = "all" | "new" | "read" | "archived" | "spam";

const STATUS_TABS: readonly StatusTab[] = [
  "all",
  "new",
  "read",
  "archived",
  "spam",
];

/** The list a submission was opened from. */
export interface SubmissionListScope {
  /** The form the list is fixed to or filtered by; every form when absent. */
  form?: string;
  status: StatusTab;
}

/** The list's filter as the entries API takes it. */
export function listWhere(scope: SubmissionListScope): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (scope.form) where.form = { equals: scope.form };
  // "All" means every human status; spam only shows when asked for, as the
  // export does.
  where.status =
    scope.status === "all" ? { not_equals: "spam" } : { equals: scope.status };
  return where;
}

/** The list's order: newest first. */
export const LIST_SORT = { sortBy: "submittedAt", sortOrder: "desc" } as const;

/** The scope as a submission page's address carries it. */
function scopeParam(scope: SubmissionListScope): string {
  const params = new URLSearchParams({ status: scope.status });
  if (scope.form) params.set("form", scope.form);
  return params.toString();
}

/**
 * The scope a page's address carries, read defensively: an unknown status
 * reads as "all", so a hand-edited address still lists something.
 */
export function scopeFromSearch(search: string): SubmissionListScope {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  const form = params.get("form");
  return {
    status: STATUS_TABS.includes(status as StatusTab)
      ? (status as StatusTab)
      : "all",
    ...(form ? { form } : {}),
  };
}

/** A submission's page, opened from the list `scope`. */
export function submissionPageAddress(
  submissionsSlug: string,
  id: string,
  scope: SubmissionListScope
): string {
  return `/admin/collections/${encodeURIComponent(submissionsSlug)}/${encodeURIComponent(id)}?${scopeParam(scope)}`;
}
