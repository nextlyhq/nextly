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

/**
 * The list's order: newest first, and among submissions sent at the same
 * moment, by id. The id makes the order total, so a submission's newer and
 * older neighbours are always defined even when timestamps tie (imported
 * rows can share one). It is the tiebreak the entries API adds last anyway,
 * spelled out so the page's neighbour queries mirror it exactly.
 */
export const LIST_SORT = "-submittedAt,id";

/**
 * The list a submission's page counts it in: the list's filter, and the
 * submission itself. Opened from the New tab, the submission is marked Read
 * and leaves that filter; archiving or recovering it can too. Counted with
 * it, the page's "3 of 3" stays true to the list it was opened from rather
 * than reading "3 of 2", and its newer neighbours still count its place.
 */
export function listWithWhere(
  scope: SubmissionListScope,
  id: string
): Record<string, unknown> {
  return { or: [listWhere(scope), { id: { equals: id } }] };
}

/** A query for one end of the list around a submission. */
export interface NeighbourQuery {
  where: Record<string, unknown>;
  sort: string;
}

/**
 * The queries that find the submissions just newer and just older than the
 * one sent at `at` with id `id`, in LIST_SORT's order: each side is a strict
 * comparison on the timestamp, or the same timestamp and the id on that side.
 * The newer side is read in reverse, so its first row is the nearest one, and
 * its total is how many rows come before this submission in the list.
 */
export function neighbourQueries(
  scope: SubmissionListScope,
  at: string,
  id: string
): { newer: NeighbourQuery; older: NeighbourQuery } {
  const base = listWhere(scope);
  const side = (time: string, tie: string) => ({
    ...base,
    or: [
      { submittedAt: { [time]: at } },
      { and: [{ submittedAt: { equals: at } }, { id: { [tie]: id } }] },
    ],
  });
  return {
    newer: {
      where: side("greater_than", "less_than"),
      sort: "submittedAt,-id",
    },
    older: { where: side("less_than", "greater_than"), sort: LIST_SORT },
  };
}

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
