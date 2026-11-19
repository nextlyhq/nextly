/**
 * What a search by address records about itself.
 *
 * Anyone who may read deliveries can test whether an address was emailed, so
 * each search is recorded in the activity log: who made it, when, and how many
 * records it found. Never the address, and never its digest: the trail is read
 * by more people than the delivery log, and a digest of an address is as good
 * as the address to anyone holding the secret.
 *
 * @module domains/email/address-search-activity
 */

import type { RequestActor } from "../../auth/request-actor";
import {
  recordableActor,
  recordSettingsActivity,
} from "../audit/record-settings-activity";

/** The activity-log `collection` a search by address is filed under. */
export const EMAIL_DELIVERY_ACTIVITY_COLLECTION = "email-deliveries";

/**
 * Whether a search by `actor` can be recorded: one that names a user or an
 * API key by id. Asked before the search reads anything, as a search no
 * entry can name is refused.
 */
export function searchRecordable(
  actor: RequestActor | null | undefined
): boolean {
  return recordableActor(actor) !== null;
}

/**
 * Record that `actor` searched the delivery log by address and found `found`
 * records.
 *
 * @throws when the entry could not be written, the actor named no one or
 * the activity log is not set up: the search is then not answered, so no
 * search goes unrecorded.
 */
export async function recordAddressSearch(input: {
  actor: RequestActor | null | undefined;
  found: number;
}): Promise<void> {
  await recordSettingsActivity({
    action: "read",
    collection: EMAIL_DELIVERY_ACTIVITY_COLLECTION,
    // A search is not a record: one fixed id, so the feed reads each as the
    // same kind of act.
    entityId: "search",
    entityTitle: "Search by address",
    metadata: { found: input.found },
    actor: input.actor,
    required: true,
  });
}
