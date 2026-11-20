/**
 * What a person's retry or cancel of a queued email records about itself.
 *
 * Filed under the delivery log's own activity namespace
 * (`EMAIL_DELIVERY_ACTIVITY_COLLECTION`), as the search by address is, with
 * the queued email's id and what was done to it. No part of the message, and
 * no address, is ever in the entry.
 *
 * @module domains/email/queued-email-activity
 */

import type { RequestActor } from "../../auth/request-actor";
import { recordSettingsActivity } from "../audit/record-settings-activity";

import { EMAIL_DELIVERY_ACTIVITY_COLLECTION } from "./address-search-activity";

/**
 * What a person did to a queued email: a retry, a cancel, or a cancel that
 * reached an attempt in flight and is a request until that attempt ends.
 */
export type QueuedEmailOperation = "retry" | "cancel" | "cancel-request";

/**
 * Record that `actor` retried or cancelled queued email `queuedId`. An actor
 * that names no one records nothing, as every settings entry does.
 *
 * @throws when the entry could not be written; the action has already been
 * taken, so callers log the failure rather than undo it.
 */
export async function recordQueuedEmailActivity(input: {
  operation: QueuedEmailOperation;
  queuedId: string;
  /** What the action changed, by name, never by value. */
  changedFields: readonly string[];
  actor: RequestActor | null | undefined;
}): Promise<void> {
  await recordSettingsActivity({
    action: "update",
    collection: EMAIL_DELIVERY_ACTIVITY_COLLECTION,
    entityId: input.queuedId,
    entityTitle: "Queued email",
    changedFields: input.changedFields,
    metadata: { operation: input.operation },
    actor: input.actor,
  });
}
