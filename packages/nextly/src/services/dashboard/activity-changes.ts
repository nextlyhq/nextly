/**
 * What an activity row says CHANGED, read from the trail as it was written.
 *
 * An update row carries the names of the fields it changed in
 * `metadata.changedFields`, computed by value (`computeChangedFields`), so a
 * name is there only when that field's value differed. The trail has no
 * publish action of its own: a publish is an update whose changed fields hold
 * `status`. A publish that leaves the status published, a promotion of
 * pending edits onto a live document, says so with `metadata.published`,
 * written by every path that can publish. Everything here reads that one
 * record through one parser, so two readers cannot come to disagree about what
 * a row changed.
 *
 * A Single's rows record the same fields and the same mark. Rows written before
 * they did carry neither, so for them every question here answers "nothing
 * changed".
 *
 * @module services/dashboard/activity-changes
 */

import { LIFECYCLE_FIELDS } from "../../domains/audit/lifecycle-fields";
import { SETTINGS_ACTIVITY_NAMESPACES } from "../../domains/audit/settings-activity-namespaces";
import type { ActivityEvent } from "../../domains/widgets/result";

/**
 * A row's metadata as an object, from either form a driver hands back: the
 * stored JSON text, or the object a JSON column already decoded. Anything
 * else, unparseable text included, is no metadata.
 */
export function activityMetadataOf(
  value: unknown
): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The fields an update row changed, or `undefined` when the row does not say:
 * a create or a delete, a Single's save, or a row written before the names were
 * recorded.
 */
export function changedFieldsOf(metadata: unknown): string[] | undefined {
  const changed = activityMetadataOf(metadata)?.changedFields;
  if (!Array.isArray(changed)) return undefined;
  return changed.filter((name): name is string => typeof name === "string");
}

/** Whether the row changed the document's status: a publish or an unpublish, alone or with an edit. */
export function changesStatus(metadata: unknown): boolean {
  return changedFieldsOf(metadata)?.includes("status") === true;
}

/**
 * Whether the row was written by a publish: one that put the document live, or
 * promoted its pending edits onto the live document. Kept apart from
 * {@link changesStatus}, which stays literal: a promotion publishes and leaves
 * the status as it was.
 */
export function publishes(metadata: unknown): boolean {
  return activityMetadataOf(metadata)?.published === true;
}

/**
 * Whether the row is a publish whose request also carried content of its own,
 * written over the pending edits it promoted: a save as well as a publish.
 */
export function publishesWithEdits(metadata: unknown): boolean {
  return activityMetadataOf(metadata)?.publishedWithEdits === true;
}

/**
 * Whether the row changed the document's status and nothing a person edits: a
 * publish or an unpublish on its own. A first publish also stamps
 * `firstPublishedAt`, which is the lifecycle's, so it still counts.
 */
export function isStatusOnlyChange(metadata: unknown): boolean {
  const changed = changedFieldsOf(metadata);
  return (
    changed !== undefined &&
    changed.includes("status") &&
    changed.every(name => LIFECYCLE_FIELDS.has(name))
  );
}

/**
 * Whether the row is a save of the document's content by whoever wrote it, the
 * row Continue where you left off names as the document's latest save, rather
 * than only a change to whether it is live.
 *
 * - A create is a save.
 * - A publish or an unpublish on its own is not, so it never takes the row of
 *   the person who made the edits it puts live.
 * - A publish that left the status as it was is not either. It promoted pending
 *   edits, or put other languages live, and the edits were each recorded when
 *   they were saved. Unless its request carried content of its own, which no
 *   earlier save recorded: that publish is a save too.
 * - An update that does not say what it changed is read as a save: it was
 *   written before the fields were recorded, or by a save that changed
 *   nothing, and either way a person saved the document.
 */
export function isContentSave(action: unknown, metadata: unknown): boolean {
  if (action === "create") return true;
  if (action !== "update") return false;
  if (
    publishes(metadata) &&
    !changesStatus(metadata) &&
    !publishesWithEdits(metadata)
  ) {
    return false;
  }
  const changed = changedFieldsOf(metadata);
  if (changed === undefined) return true;
  return changed.some(name => !LIFECYCLE_FIELDS.has(name));
}

/** Whether `slug` is a namespace install-level settings changes are filed under. */
export function isSettingsNamespace(slug: string): boolean {
  return (SETTINGS_ACTIVITY_NAMESPACES as readonly string[]).includes(slug);
}

/** What a trail row says about its subject, for the questions below. */
interface ActivitySubjectFacts {
  subjectKind?: unknown;
  collection?: unknown;
  metadata?: unknown;
}

/**
 * Whether a row is an install-level settings change rather than a document's:
 * it says so, or it predates the kind being recorded and is filed under a
 * settings namespace.
 */
export function isSettingsChange(row: ActivitySubjectFacts): boolean {
  if (row.subjectKind === "settings") return true;
  return (
    (row.subjectKind ?? null) === null &&
    typeof row.collection === "string" &&
    isSettingsNamespace(row.collection)
  );
}

/**
 * Whether an update's record leaves open what it did: an entry's update that
 * names no changed fields and carries no publish mark, written before the
 * fields were recorded or by a save that changed nothing. It cannot show it was
 * not a publish or an unpublish, so neither the feed's runs (`runKeyOf`) nor
 * its events (`activityEventOf`) read it as a save. A Single's rows written
 * before they recorded either are read as saves, as they always have been.
 */
export function updateLeavesOperationOpen(row: ActivitySubjectFacts): boolean {
  return (
    row.subjectKind !== "single" &&
    !publishes(row.metadata) &&
    changedFieldsOf(row.metadata) === undefined
  );
}

/**
 * What a feed row says happened, as a reader is told it: the published wire
 * type (`nextly/widget-result`), which every event named here is checked
 * against, so the producer cannot name one a consumer's switch does not cover.
 */
export type { ActivityEvent };

/**
 * The event a trail row records, read from its action and the same marks the
 * questions above read, so a row the feed calls a publish is the row
 * Continue where you left off declines to call a save.
 *
 * - A settings change names none: an event is what happened to an entry or a
 *   Single, and an install-level change is neither.
 * - A create and a delete say so by their action.
 * - An update marked as a publish published, whether or not it also carried
 *   edits: putting the document live is what a reader needs to hear.
 * - An update that changed the status without that mark took the document out
 *   of live, because every path that publishes writes the mark.
 * - An update whose record leaves open what it did names none
 *   (`updateLeavesOperationOpen`), the rule the feed's runs read it by.
 * - Any other update is a save.
 *
 * `undefined` for each of those and for an action the trail does not write,
 * so a reader says what the row's action says rather than an event it cannot
 * stand behind.
 */
export function activityEventOf(
  row: ActivitySubjectFacts & { action: unknown }
): ActivityEvent | undefined {
  if (isSettingsChange(row)) return undefined;
  if (row.action === "create") return "created";
  if (row.action === "delete") return "deleted";
  if (row.action !== "update") return undefined;
  if (publishes(row.metadata)) return "published";
  if (changesStatus(row.metadata)) return "unpublished";
  if (updateLeavesOperationOpen(row)) return undefined;
  return "saved";
}
