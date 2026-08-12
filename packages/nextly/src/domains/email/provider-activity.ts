/**
 * What an email provider mutation records about itself.
 *
 * `email_providers` holds the credentials that send password-reset and
 * verification mail, so an actor who can edit a provider can point every
 * authentication email at a relay they control. Until now that action was
 * indistinguishable from no action after the fact: the activity log existed and
 * this domain never wrote to it.
 *
 * Two rules shape everything here.
 *
 * **Names, never values.** The entry says which fields a change touched. It
 * carries no part of `configuration`, encrypted or decrypted, and no value from
 * any other column either — an audit row is read by more people than the record
 * it describes, and a trail that leaks what it audits is worse than none.
 *
 * **Which fields are secret is read from the provider's own metadata**, not
 * guessed from key names. It happens not to matter for the diff, because no
 * value is written either way; it matters for the next person, who will reach
 * for a heuristic if this file demonstrates one.
 *
 * @module domains/email/provider-activity
 */

import type { RequestActor } from "../../auth/request-actor";
import type { ActivityLogAction } from "../../services/dashboard/activity-log-service";
import {
  changedTopLevelFields,
  recordSettingsActivity,
} from "../audit/record-settings-activity";

/**
 * The activity-log `collection` these entries are filed under.
 *
 * Not a content collection. The column is a free string and the feed groups by
 * it, so a settings resource gets a name of the same shape rather than a new
 * mechanism — the alternative is a second trail with its own reader.
 */
export const EMAIL_PROVIDER_ACTIVITY_COLLECTION = "email-providers";

/** One recorded provider mutation. */
export interface EmailProviderActivityInput {
  action: ActivityLogAction;
  /** The provider row's id. */
  providerId: string;
  /** The provider's name at the time of the action, for the feed heading. */
  providerName: string;
  /** The registered type, e.g. `smtp`. Not a secret and worth reading later. */
  providerType: string;
  /**
   * Field NAMES the action touched. Never values.
   *
   * Absent for a create and a delete: one reports every field it wrote and the
   * other every field it removed, neither of which distinguishes anything the
   * action itself has not already said.
   */
  changedFields?: ReadonlyArray<string>;
  actor?: RequestActor | null;
}

/**
 * Record one provider mutation.
 *
 * Delegates to the shared settings seam, which owns the actor gate, the
 * "an entry means something moved" rule, and the post-commit write. What stays
 * here is what is specific to a provider: the collection it files under and the
 * type it reports.
 */
export async function recordProviderActivity(
  input: EmailProviderActivityInput
): Promise<void> {
  await recordSettingsActivity({
    action: input.action,
    collection: EMAIL_PROVIDER_ACTIVITY_COLLECTION,
    entityId: input.providerId,
    entityTitle: input.providerName,
    changedFields: input.changedFields,
    metadata: { providerType: input.providerType },
    actor: input.actor,
  });
}

/**
 * The top-level provider fields a change touched, as names.
 *
 * `configuration` is reported as the single name `configuration` rather than by
 * its inner paths. Those paths are the provider's own field names, and naming
 * `auth.pass` in a row that many people can read says which credential changed
 * — which is a detail about the secret, in a place the secret is not supposed
 * to reach. That an update touched the configuration is the fact worth keeping.
 */
export function changedProviderFields(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>
): string[] {
  return changedTopLevelFields(previous, incoming);
}
