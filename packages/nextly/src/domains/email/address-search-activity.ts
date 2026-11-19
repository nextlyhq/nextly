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
import { recordSettingsActivity } from "../audit/record-settings-activity";

/** The activity-log `collection` a search by address is filed under. */
export const EMAIL_DELIVERY_ACTIVITY_COLLECTION = "email-deliveries";

/**
 * Record that `actor` searched the delivery log by address and found `found`
 * records. An actor that names nobody records nothing, as every settings
 * entry does (`recordSettingsActivity`).
 *
 * @throws when the activity log could not be written: the search is then not
 * answered, so no search goes unrecorded.
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
  });
}
