/**
 * What renaming or deleting a release records in the activity log.
 *
 * Through the settings seam (`recordSettingsActivity`) rather than a trail of
 * its own: a release is not a collection document, it has no write
 * transaction the content recorder could join, and the activity log's
 * `collection` column is a free string meant for exactly this. The seam owns
 * the rules every such entry follows: who is recorded, that an update which
 * changed nothing records nothing, and field NAMES rather than values.
 *
 * Recorded after the write commits, as every settings entry is, and the
 * caller never lets a failure here fail the write: the release has already
 * been renamed or deleted, and reporting that as a failure would invite a
 * retry of something that happened.
 *
 * @module domains/releases/release-activity
 */
import type { RequestActor } from "../../auth/request-actor";
import { recordSettingsActivity } from "../audit/record-settings-activity";

import { RELEASES_RESOURCE } from "./releases-resource";

/**
 * The activity-log `collection` release entries are filed under: the release
 * permissions' own resource, so the feed asks `read-content-releases` of a
 * reader before showing one.
 */
export const RELEASE_ACTIVITY_COLLECTION = RELEASES_RESOURCE;

/** One rename or deletion, as the release service knows it. */
export interface ReleaseActivityEntry {
  /** `update` for a rename or a new description, `delete` for a deletion. */
  action: "update" | "delete";
  /** The release as it reads after a rename, or as it read before a delete. */
  release: { id: string; title: string; state: string };
  /** For an update: which of the two fields changed. Names, never values. */
  changedFields?: ReadonlyArray<"title" | "description">;
  /** Who did it, or `null` for a caller the trail records nothing of. */
  actor: RequestActor | null;
}

/**
 * Record one rename or deletion. Rejects when the write to the log fails,
 * for the caller to report; see the module docblock.
 */
export async function recordReleaseActivity(
  entry: ReleaseActivityEntry
): Promise<void> {
  await recordSettingsActivity({
    action: entry.action,
    collection: RELEASE_ACTIVITY_COLLECTION,
    entityId: entry.release.id,
    entityTitle: entry.release.title,
    changedFields: entry.changedFields,
    // The state is not a secret and says which release this was: a deleted
    // draft and a deleted cancelled launch read differently later.
    metadata: { state: entry.release.state },
    actor: entry.actor,
  });
}
