/**
 * What the submissions list's selection bar does to the ticked rows, through
 * the entries API's bulk routes: one request for every ticked row, judged row
 * by row on the server under the person's own rights (update for a status,
 * delete for Delete), with each row's failure answered beside the others'
 * successes.
 *
 * @module admin/components/submissions/bulk-actions
 */

import type { SubmissionRow } from "./submission-row";

/** A change the bar makes to every ticked submission. */
export type BulkChange = "read" | "archived" | "spam" | "notSpam" | "delete";

/**
 * The patch each status change sends. Leaving Spam clears why it was
 * flagged, as the submission's own page does; Not spam returns it to New.
 */
const STATUS_PATCH: Readonly<
  Record<Exclude<BulkChange, "delete">, Record<string, unknown>>
> = {
  read: { status: "read", spamReason: null },
  archived: { status: "archived", spamReason: null },
  spam: { status: "spam" },
  notSpam: { status: "new", spamReason: null },
};

/** A request, as `fetch` takes it. */
export interface BulkRequest {
  url: string;
  init: RequestInit;
}

/** Each row's version as the list read it, so a change made since is refused. */
function versionsOf(rows: readonly SubmissionRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.flatMap(row =>
      typeof row._rev === "string" ? [[row.id, row._rev]] : []
    )
  );
}

/** The request that makes `change` to exactly `rows`. */
export function bulkRequest(
  slug: string,
  change: BulkChange,
  rows: readonly SubmissionRow[]
): BulkRequest {
  const base = `/admin/api/collections/${encodeURIComponent(slug)}/entries`;
  const ids = rows.map(row => row.id);
  const body =
    change === "delete"
      ? { ids }
      : { ids, data: STATUS_PATCH[change], revs: versionsOf(rows) };
  return {
    url: `${base}/${change === "delete" ? "bulk-delete" : "bulk-update"}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    },
  };
}

/** One row the server refused, as the bulk routes answer it. */
interface RowRefusal {
  id: string;
  code?: string;
}

/** What a bulk change did: the rows changed, and the rows refused. */
export interface BulkOutcome {
  done: string[];
  refused: RowRefusal[];
}

/** Sends `request` and reads which rows it changed; a refused request throws. */
export async function sendBulk(request: BulkRequest): Promise<BulkOutcome> {
  const response = await fetch(request.url, request.init);
  const body = (await response.json().catch(() => null)) as {
    items?: Array<{ id?: unknown }>;
    errors?: RowRefusal[];
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(
      body?.error?.message ?? `The change failed (${response.status}).`
    );
  }
  return {
    done: (body?.items ?? []).flatMap(item =>
      typeof item.id === "string" ? [item.id] : []
    ),
    refused: body?.errors ?? [],
  };
}

/** "1 submission" or "N submissions". */
function submissions(count: number): string {
  return count === 1 ? "1 submission" : `${count} submissions`;
}

/** What a change says it did, by the number of rows it changed. */
const DONE: Readonly<Record<BulkChange, (count: string) => string>> = {
  read: count => `Marked ${count} as read.`,
  archived: count => `Archived ${count}.`,
  spam: count => `Moved ${count} to Spam.`,
  notSpam: count => `Moved ${count} out of Spam.`,
  delete: count => `Deleted ${count}.`,
};

/** Why rows were refused, in words, by the server's code. */
function refusalReason(refused: readonly RowRefusal[]): string {
  if (refused.some(each => each.code === "STALE_VERSION")) {
    return "someone changed them since the list loaded. The list now shows their change";
  }
  if (refused.some(each => each.code === "FORBIDDEN")) {
    return "your role may not change them";
  }
  return "the server refused them";
}

/** What the bar tells the person once a change is answered. */
export function outcomeText(
  change: BulkChange,
  outcome: BulkOutcome
): { done?: string; refused?: string } {
  const count = outcome.refused.length;
  const verb = change === "delete" ? "deleted" : "changed";
  return {
    ...(outcome.done.length > 0
      ? { done: DONE[change](submissions(outcome.done.length)) }
      : {}),
    ...(count > 0
      ? {
          refused: `${submissions(count)} couldn't be ${verb}: ${refusalReason(outcome.refused)}.`,
        }
      : {}),
  };
}
