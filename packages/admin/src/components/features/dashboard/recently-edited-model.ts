/**
 * What the Recently edited card draws, read from its answer: one row per
 * document, at its latest save, and what to say when there are none.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * the title an untitled document gets, where each row links, who saved it, its
 * status label, and the empty text the answer's window allows.
 *
 * Who saved a row is named by `describeActivityActor`, the helper the Recent
 * activity feed names its rows with, so the two cards name one deleted account
 * or API key the same way.
 */

import type { WidgetResult } from "nextly/widget-result";

import { buildRoute, ROUTES } from "@admin/constants/routes";
import { describeActivityActor } from "@admin/lib/dashboard";

/** The list answer, the one shape this card's source gives. */
type ListResult = Extract<WidgetResult, { op: "list" }>;

/** One document on the card, at its latest save. */
export interface RecentEditRow {
  /** The save's id: one per row, since the source answers one save per document. */
  key: string;
  /** The document's title, or "Untitled" when it has none. */
  title: string;
  /** Whether `title` is the "Untitled" stand-in rather than the document's own. */
  untitled: boolean;
  /** The collection it belongs to; absent for a Single, which is its own heading. */
  collection?: string;
  /** The document's edit page, in the language it was saved in. */
  href: string;
  /**
   * Who saved it, as the activity feed names them; absent for a live account
   * with no name to show, which the feed draws as an empty label.
   */
  savedBy?: string;
  /** When, as the instant the source sent. */
  savedAt: string;
  /** Its status now, when the document has one the reader may see. */
  status?: string;
}

/** The title a document without one is listed under: never its id. */
export const UNTITLED = "Untitled";

/**
 * Each status a document can be in, as the card labels it. A status not here
 * is shown as the source spelled it rather than dropped, so a lifecycle added
 * later still says something true.
 */
const STATUS_LABELS: Record<string, string> = {
  published: "Published",
  draft: "Draft",
};

/** A held working draft on a published document, which the source flags apart from its status. */
export const CHANGES_NOT_PUBLISHED = "Changes not published";

/** `value` when it is a non-empty string, so a number, null or "" reads as absent. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The status label a row shows: a held draft first, since it is what the reader has to act on. */
function statusLabel(row: Record<string, unknown>): string | undefined {
  if (row.pendingChanges === true) return CHANGES_NOT_PUBLISHED;
  const status = text(row.status);
  return status === undefined ? undefined : (STATUS_LABELS[status] ?? status);
}

/**
 * Where a row links: a collection's entry, or a Single, which has one page.
 * The language it was saved in rides along as `?locale=`, the parameter the
 * edit page reads, so the link opens the version that was saved.
 */
function editHref(
  kind: "collection" | "single",
  slug: string,
  entryId: string,
  locale: string | undefined
): string {
  const path =
    kind === "single"
      ? buildRoute(ROUTES.SINGLE_EDIT, { slug })
      : buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, { slug, id: entryId });
  return locale === undefined
    ? path
    : `${path}?${new URLSearchParams({ locale }).toString()}`;
}

/**
 * One row of the answer as the card draws it, or `undefined` for a row this
 * build cannot read: one without a save, a document, a collection or a time.
 * Read field by field, because a widget answer is JSON and its type says
 * nothing at runtime.
 */
export function recentEditFromRow(
  row: Record<string, unknown>
): RecentEditRow | undefined {
  const key = text(row.id);
  const entryId = text(row.entryId);
  const slug = text(row.collection);
  const savedAt = text(row.createdAt);
  const userId = text(row.userId);
  if (!key || !entryId || !slug || !savedAt || !userId) return undefined;
  const kind = row.subjectKind === "single" ? "single" : "collection";
  const title = text(row.entryTitle);
  const status = statusLabel(row);
  const savedBy = describeActivityActor({
    userId,
    userName: text(row.userName) ?? null,
    userEmail: null,
    identityErasedAt: text(row.identityErasedAt) ?? null,
    actorType: text(row.actorType) ?? null,
  }).name;
  return {
    key,
    title: title ?? UNTITLED,
    untitled: title === undefined,
    ...(kind === "collection" ? { collection: slug } : {}),
    href: editHref(kind, slug, entryId, text(row.locale)),
    ...(savedBy === "" ? {} : { savedBy }),
    savedAt,
    ...(status === undefined ? {} : { status }),
  };
}

/** The rows of a list answer this build can read, in the order the source sent them. */
export function recentEditRows(result: ListResult): RecentEditRow[] {
  return result.items.flatMap(row => {
    const edit = recentEditFromRow(row);
    return edit ? [edit] : [];
  });
}

/**
 * What the card says when there is nothing to list. With a window, the answer
 * covered only that span, so it says so: "none in the last 90 days" is true
 * where "none yet" would not be for a document saved before it.
 */
export function noEditsText(result: ListResult): string {
  const days = result.window?.days;
  if (days === undefined) return "No edits yet";
  return days === 1
    ? "No edits in the last day"
    : `No edits in the last ${days} days`;
}
