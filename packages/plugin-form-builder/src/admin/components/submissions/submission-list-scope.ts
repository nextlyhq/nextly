/**
 * Which submissions a list shows, carried from the list to a submission's
 * page so its previous and next move through the same list, and to the
 * export so it exports what the list shows: the form it is fixed to or
 * filtered by, the status tab, and the dates it was sent between. One place
 * builds the list's query from it, so the page cannot step through a
 * different list than the one it was opened from, and the export cannot
 * read a different one.
 *
 * Pure, with no browser or React import: the export route on the server
 * reads a request's scope with these same functions.
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
  /** Sent at or after this moment (an ISO date and time); no bound when absent. */
  from?: string;
  /** Sent before this moment, which it leaves out; no bound when absent. */
  to?: string;
}

/**
 * The scope's dates as a filter of `submittedAt`, or none for any date. The
 * upper bound is exclusive, so a range ending at the start of a day leaves
 * that day out, whatever the precision a dialect stores the time with.
 */
function sentBetween(
  scope: SubmissionListScope
): Record<string, string> | undefined {
  if (!scope.from && !scope.to) return undefined;
  return {
    ...(scope.from ? { greater_than_equal: scope.from } : {}),
    ...(scope.to ? { less_than: scope.to } : {}),
  };
}

/** The list's filter as the entries API takes it. */
export function listWhere(scope: SubmissionListScope): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (scope.form) where.form = { equals: scope.form };
  // "All" means every human status; spam only shows when asked for, as the
  // export does.
  where.status =
    scope.status === "all" ? { not_equals: "spam" } : { equals: scope.status };
  const sent = sentBetween(scope);
  if (sent) where.submittedAt = sent;
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

/** The scope as an address carries it: a submission page's, or the export's. */
function scopeParams(scope: SubmissionListScope): URLSearchParams {
  const params = new URLSearchParams({ status: scope.status });
  if (scope.form) params.set("form", scope.form);
  if (scope.from) params.set("from", scope.from);
  if (scope.to) params.set("to", scope.to);
  return params;
}

/** A moment an address names, as an ISO date and time; none for anything else. */
function momentOf(text: string | null): string | undefined {
  if (!text) return undefined;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

/**
 * The scope an address carries, read defensively: an unknown status reads as
 * "all" and a date that is not one as no bound, so a hand-edited address
 * still lists something.
 */
export function scopeFromSearch(search: string): SubmissionListScope {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  const form = params.get("form");
  const from = momentOf(params.get("from"));
  const to = momentOf(params.get("to"));
  return {
    status: STATUS_TABS.includes(status as StatusTab)
      ? (status as StatusTab)
      : "all",
    ...(form ? { form } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

/** A submission's page, opened from the list `scope`. */
export function submissionPageAddress(
  submissionsSlug: string,
  id: string,
  scope: SubmissionListScope
): string {
  return `/admin/collections/${encodeURIComponent(submissionsSlug)}/${encodeURIComponent(id)}?${scopeParams(scope).toString()}`;
}

/** The export route, as the admin's API serves it. */
const EXPORT_ROUTE =
  "/admin/api/plugins/@nextlyhq/plugin-form-builder/submissions/export";

/**
 * The export of what a list shows, in `format`: every submission its scope
 * matches, or, given `ids`, exactly those (the rows ticked in it).
 */
export function exportAddress(
  scope: SubmissionListScope,
  format: "csv" | "json",
  ids?: readonly string[]
): string {
  const params = scopeParams(scope);
  params.set("format", format);
  if (ids !== undefined) params.set("ids", ids.join(","));
  return `${EXPORT_ROUTE}?${params.toString()}`;
}
