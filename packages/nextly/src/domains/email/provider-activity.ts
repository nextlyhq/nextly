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
import { container } from "../../di/container";
import type {
  ActivityLogAction,
  ActivityLogService,
} from "../../services/dashboard/activity-log-service";
import { SYSTEM_CONTEXT } from "../../shared/types";

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
 * Whether this actor produces an entry.
 *
 * Only a signed-in person. An API key and an internal write carry no account,
 * and the trail's actor column is a user reference whose erasure state is
 * answered against the accounts table — a key's own id finds no account there
 * and would be filed as an already-erased identity, which is a worse record
 * than none.
 */
function willRecord(
  actor?: RequestActor | null
): actor is RequestActor & { type: "user"; id: string } {
  if (actor?.type !== "user" || !actor.id) return false;
  // `SYSTEM_CONTEXT` carries the reserved user id `system`, so a seed or a
  // migration with no transport actor to override it resolves to a USER actor.
  // No account owns that id. Compared against the sentinel itself so the two
  // cannot drift apart.
  return actor.id !== SYSTEM_CONTEXT.user?.id;
}

/**
 * Whether this mutation moved anything worth an entry.
 *
 * An `update` that changed nothing still reaches here: the form submits every
 * field whether or not the operator touched it, and promoting a provider that
 * is already the default is an ordinary client retry. Both produce an entry the
 * feed renders as "updated Production SMTP", which is a claim that something
 * happened — and the whole value of this trail is that every entry means
 * something moved.
 *
 * Empty is only meaningful for an update. A create and a delete carry no field
 * list because the action already says what it did, so an absent list there is
 * a full description rather than an empty one.
 *
 * Decided here rather than at each call site, because there are two of them —
 * `updateProvider` and `setDefault` — and a comment in one claiming the other
 * already skipped is how they came to disagree.
 */
function worthRecording(input: EmailProviderActivityInput): boolean {
  if (input.action !== "update") return true;
  return (input.changedFields?.length ?? 0) > 0;
}

/**
 * Record one provider mutation.
 *
 * Called AFTER the write commits, so it uses the standalone `logActivity`,
 * which swallows its own failures. That is the right direction here: the
 * mutation has already happened, and turning a completed credential change into
 * a reported failure because the trail could not be written would leave the
 * caller believing the opposite of the truth. The service logs the failure, so
 * a trail that stops being written is visible in the logs rather than silent.
 *
 * Never throws. An audit write that took the surrounding request down would
 * make the trail a liability rather than a record.
 */
export async function recordProviderActivity(
  input: EmailProviderActivityInput
): Promise<void> {
  if (!willRecord(input.actor)) return;
  if (!worthRecording(input)) return;

  let service: ActivityLogService;
  try {
    service = container.get<ActivityLogService>("activityLogService");
  } catch {
    // Absent registration is a boot-time fact about how the host assembled its
    // container, not a write that failed.
    return;
  }

  await service.logActivity({
    userId: input.actor.id,
    action: input.action,
    collection: EMAIL_PROVIDER_ACTIVITY_COLLECTION,
    entryId: input.providerId,
    // Denormalized deliberately: the feed outlives the provider it names, and a
    // deleted provider's row would otherwise be unlabelled — the one entry
    // whose subject the reader can no longer recover any other way.
    entryTitle: input.providerName,
    metadata: {
      providerType: input.providerType,
      ...(input.changedFields && input.changedFields.length > 0
        ? { changedFields: [...input.changedFields] }
        : {}),
    },
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
  const changed: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    // Compared as JSON so a nested configuration object is judged by content
    // rather than by identity, which would report every update as a change.
    if (JSON.stringify(previous[key]) !== JSON.stringify(value)) {
      changed.push(key);
    }
  }
  return changed;
}
