/**
 * Form Submission Sends collection
 *
 * The notifications each submission queued: the queued email's id and the
 * idempotency key it was sent with. Kept so every path that deletes a
 * submission can forget what it sent (`ctx.services.email.forgetSends`) in
 * the same transaction, cancelling a notification not yet sent and erasing
 * the delivery records of one that was. A notification's key is made from
 * the notification as it was when it was sent, so it cannot be worked out
 * again at deletion: it is recorded here.
 *
 * Each also keeps what became of the send, for as long as its submission
 * exists: where it stands, how many attempts it took, when it last changed,
 * why it was cancelled, and each recipient it went to (by a masked hint and
 * the plugin's keyed digest, never the address) with what became of it.
 * These are written in the transaction of each change of the queued email
 * (`handlers/send-history`), so they cannot fall behind the send, and they
 * outlive the delivery log, which core prunes. Written as each change
 * happens, they do not change when the submission's answers or the
 * notification are edited later. A send made by Resend names who asked.
 *
 * Internal: never in the admin's navigation, records no webhook events, and
 * no caller reaches it; only this plugin, acting as itself, writes and reads
 * it.
 *
 * @module collections/sends
 */

import {
  date,
  text,
  type CollectionConfig,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";
// The SDK offers no `json` or `number` factory yet; the core's own are the
// ones it would re-export.
import { json, number } from "nextly";

/** The slug the sends are kept under. */
export const SUBMISSION_SENDS_SLUG = "form-submission-sends";

/** The slug Resend's requests are kept under. */
const SUBMISSION_RESENDS_SLUG = "form-submission-resends";

/**
 * The sends collection's slug as this install has it: a host may rename a
 * collection the plugin contributes, and the services know only the name it
 * was given.
 */
export function sendsSlugOf(ctx: Pick<PluginContext, "self">): string {
  return ctx.self.collections[SUBMISSION_SENDS_SLUG] ?? SUBMISSION_SENDS_SLUG;
}

/** The resends collection's slug as this install has it, as above. */
export function resendsSlugOf(ctx: Pick<PluginContext, "self">): string {
  return (
    ctx.self.collections[SUBMISSION_RESENDS_SLUG] ?? SUBMISSION_RESENDS_SLUG
  );
}

/** Nobody but the plugin itself, which acts as the system and skips this. */
const nobody = () => false;

export function submissionSendsCollection(): CollectionConfig {
  return {
    slug: SUBMISSION_SENDS_SLUG,
    labels: { singular: "Submission send", plural: "Submission sends" },
    internal: true,
    // A queued email's id and its key name no person, but a delivery
    // subscriber has no use for them either.
    webhooks: false,
    access: {
      read: nobody,
      create: nobody,
      update: nobody,
      delete: nobody,
    },
    fields: [
      // The submission's id, as stored: the one deletions look up by.
      text({ name: "submission", required: true }),
      text({ name: "queuedId", required: true }),
      text({ name: "sendKey", required: true }),
      // Which form and notification sent it, by id, and the notification's
      // name as it was then, so a renamed or deleted one still reads.
      // Empty on a send recorded before these were kept.
      text({ name: "form" }),
      text({ name: "notification" }),
      text({ name: "notificationName" }),
      // Where it stands: waiting, retrying, sending, sent, failed or
      // cancelled; and how many attempts it has taken.
      text({ name: "state" }),
      number({ name: "attempts" }),
      // How many attempts failed in a way a retry could help, as recorded.
      number({ name: "retries" }),
      date({ name: "changedAt" }),
      // Why it was cancelled, and a cancel asked while an attempt was with
      // the provider, as `{ by, userId? }`.
      json({ name: "cancel" }),
      json({ name: "cancelRequested" }),
      // A failed send retired by Resend: it keeps its failure, and nothing
      // sends it again.
      text({ name: "retiredBy" }),
      // The recipients it was configured for, and the ones it went to, each
      // as `{ digest, hint, kind, source }` (and `outcome` once known).
      json({ name: "configured" }),
      json({ name: "recipients" }),
      // A send made by Resend: who asked, and the request.
      text({ name: "requestedBy" }),
      text({ name: "resend" }),
    ],
    indexes: [
      { fields: ["submission"] },
      { fields: ["queuedId"] },
      { fields: ["form", "notification"] },
    ],
  };
}

/**
 * Resend's requests: who asked to send a notification of a submission
 * again, and which recipients they ticked. A request is stored with the
 * send it makes, in one transaction (`handlers/resend`), so a request that
 * could not be sent leaves no trace, and is deleted with its submission.
 * Internal, as the sends are.
 */
export function submissionResendsCollection(): CollectionConfig {
  return {
    slug: SUBMISSION_RESENDS_SLUG,
    labels: { singular: "Submission resend", plural: "Submission resends" },
    internal: true,
    webhooks: false,
    access: {
      read: nobody,
      create: nobody,
      update: nobody,
      delete: nobody,
    },
    fields: [
      text({ name: "submission", required: true }),
      text({ name: "notification", required: true }),
      text({ name: "requestedBy" }),
      // The digests of the recipients ticked to send again, those left out
      // as already reached, and the failed sends this one retires.
      json({ name: "ticked" }),
      json({ name: "exclude" }),
      json({ name: "retire" }),
      // The earlier sends it found settled, by core's own state.
      json({ name: "settled" }),
    ],
    indexes: [{ fields: ["submission"] }],
  };
}
