/**
 * What Continue where you left off draws, read from its answer: one row per
 * document, which tab it is on, and what to say when there are none.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * where each row links, who saved it, its status label, whether it is pinned,
 * and the empty text each tab and the answer's window allow.
 *
 * Who saved a row is named by `describeActivityActor`, the helper the Recent
 * activity feed names its rows with, so the two cards name one deleted account
 * or API key the same way.
 *
 * @module components/features/dashboard/continue-model
 */

import type { CoreListWidgetData } from "nextly/core-widget-data";

import type { StatusTone } from "@admin/components/features/widgets/frame/row-parts";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import type { PinTarget } from "@admin/hooks/queries/useDashboardPins";
import { describeActivityActor } from "@admin/lib/dashboard";

/** The rows the card's `load` read, the one shape this card is drawn from. */
type ListResult = CoreListWidgetData;

/** The card's two tabs: the reader's own work, or other people's. */
export type ContinueTab = "mine" | "team";

/** One document on the card. */
export interface ContinueRow {
  /** The row's id in the answer: a pin's or a save's, one per document. */
  key: string;
  /** The document's title, as the source read it for this reader. */
  title: string;
  /** The collection it belongs to; absent for a Single, which is its own heading. */
  collection?: string;
  /** The icon its collection or Single names, when it names one. */
  icon?: string;
  /** The document's edit page, in the language it was saved in. */
  href: string;
  /**
   * Who saved it, as the activity feed names them: on a save's row, not a
   * pin's, and absent for a live account with no name to show.
   */
  savedBy?: string;
  /** When it was last edited, as the instant the source sent. */
  editedAt?: string;
  /** Its status now, when the document has one the reader may see. */
  status?: string;
  /** Whether the reader has pinned it, which decides its menu's verb. */
  pinned: boolean;
  /** What a pin of it names. */
  target: PinTarget;
}

/**
 * Each status a document can be in, as the card labels it. A status not here
 * is shown as the source spelled it rather than dropped, so a lifecycle added
 * later still says something true.
 */
const STATUS_LABELS: Record<string, string> = {
  published: "Published",
  draft: "Draft",
  scheduled: "Scheduled",
};

/** A held working draft on a published document, which the source flags apart from its status. */
export const CHANGED = "Changed";

/**
 * What a row's status label means to the reader, as its pill's tone: a
 * published document is done, one holding changes not yet published is
 * waiting on someone, and any other status asks nothing of them.
 */
export function statusTone(label: string): StatusTone {
  if (label === CHANGED) return "warn";
  return label === STATUS_LABELS.published ? "good" : "neutral";
}

/** The tab a card's resolved settings name: Team only when they say so. */
export function continueTab(settings: Record<string, unknown>): ContinueTab {
  return settings.tab === "team" ? "team" : "mine";
}

/** `value` when it is a non-empty string, so a number, null or "" reads as absent. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The status label a row shows: a held draft first, since it is what the reader has to act on. */
function statusLabel(row: Record<string, unknown>): string | undefined {
  if (row.pendingChanges === true) return CHANGED;
  const status = text(row.status);
  return status === undefined ? undefined : (STATUS_LABELS[status] ?? status);
}

/**
 * Where a row links: a collection's entry, or a Single, which has one page.
 * The language it was saved in rides along as `?locale=`, the parameter the
 * edit page reads, so the link opens the version that was saved.
 */
function editHref(target: PinTarget, locale: string | undefined): string {
  const path =
    target.targetType === "single"
      ? buildRoute(ROUTES.SINGLE_EDIT, { slug: target.targetSlug })
      : buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
          slug: target.targetSlug,
          id: target.entryId,
        });
  return locale === undefined
    ? path
    : `${path}?${new URLSearchParams({ locale }).toString()}`;
}

/** The document a row names, or `undefined` when it names an entry without its id. */
function targetOf(row: Record<string, unknown>): PinTarget | undefined {
  const slug = text(row.collection);
  if (slug === undefined) return undefined;
  if (row.subjectKind === "single") {
    return { targetType: "single", targetSlug: slug };
  }
  const entryId = text(row.entryId);
  return entryId === undefined
    ? undefined
    : { targetType: "collection", targetSlug: slug, entryId };
}

/** Who saved a save's row, or `undefined` for a pin's row or one with no name to show. */
function saverOf(row: Record<string, unknown>): string | undefined {
  const userId = text(row.userId);
  if (userId === undefined) return undefined;
  const name = describeActivityActor({
    userId,
    userName: text(row.userName) ?? null,
    userEmail: null,
    identityErasedAt: text(row.identityErasedAt) ?? null,
    actorType: text(row.actorType) ?? null,
  }).name;
  return name === "" ? undefined : name;
}

/**
 * One row of the answer as the card draws it, or `undefined` for a row this
 * build cannot read: one without an id, a document or a title. Read field by
 * field, because a widget answer is JSON and its type says nothing at runtime.
 *
 * 🔴 A row with no title is left out, never drawn under its id: the source
 * titles every document the reader may read, so one without a title is not
 * one to show.
 */
export function continueRowFrom(
  row: Record<string, unknown>
): ContinueRow | undefined {
  const key = text(row.id);
  const title = text(row.entryTitle);
  const target = targetOf(row);
  if (!key || !title || !target) return undefined;
  const icon = text(row.icon);
  const savedBy = saverOf(row);
  const editedAt = text(row.editedAt);
  const status = statusLabel(row);
  return {
    key,
    title,
    ...(target.targetType === "collection"
      ? { collection: target.targetSlug }
      : {}),
    ...(icon === undefined ? {} : { icon }),
    href: editHref(target, text(row.locale)),
    ...(savedBy === undefined ? {} : { savedBy }),
    ...(editedAt === undefined ? {} : { editedAt }),
    ...(status === undefined ? {} : { status }),
    pinned: row.pinned === true,
    target,
  };
}

/** The rows of a list answer this build can read, in the order the source sent them. */
export function continueRows(result: ListResult): ContinueRow[] {
  return result.items.flatMap(row => {
    const read = continueRowFrom(row);
    return read ? [read] : [];
  });
}

/** How far back an answer looked, as its empty text ends. */
function spanText(days: number | undefined): string {
  if (days === undefined) return "yet";
  return days === 1 ? "in the last day" : `in the last ${days} days`;
}

/**
 * What the card says when a tab has nothing to list. Team's answer covers the
 * trail's window alone, so it says so: "none in the last 90 days" is true
 * where "none yet" would not be for a document saved before it.
 */
export function continueEmpty(
  tab: ContinueTab,
  result: ListResult
): { title: string; detail: string } {
  if (tab === "mine") {
    return {
      title: "Nothing to continue yet",
      detail: "Entries you pin or save show here.",
    };
  }
  return {
    title: `No edits by others ${spanText(result.window?.days)}`,
    detail: "Entries and Singles other people save show here.",
  };
}
