/**
 * What an activity row says CHANGED, read from the trail as it was written.
 *
 * An update row carries the names of the fields it changed in
 * `metadata.changedFields`, computed by value (`computeChangedFields`), so a
 * name is there only when that field's value differed. The trail has no
 * publish action of its own: a publish is an update whose changed fields hold
 * `status`. Everything here reads that one record through one parser, so two
 * readers cannot come to disagree about what a row changed.
 *
 * A Single's row carries no changed fields, so for it every question here
 * answers "nothing changed" until its saves record them.
 *
 * @module services/dashboard/activity-changes
 */

import { SYSTEM_COLUMNS } from "../../lib/system-columns";

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
 * The fields the status lifecycle stamps on its own: `updatedAt`, which every
 * write stamps, and every system column that exists only with Draft/Published,
 * by the name a document carries it under. Taken from the declarations rather
 * than listed, so a lifecycle column added there is one here too.
 */
const LIFECYCLE_FIELDS: ReadonlySet<string> = new Set([
  "updatedAt",
  ...SYSTEM_COLUMNS.filter(
    column => column.presence === "withStatusLifecycle"
  ).map(column => column.camelName),
]);

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
