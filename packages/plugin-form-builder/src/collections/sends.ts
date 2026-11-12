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
 * Internal: never in the admin's navigation, records no webhook events, and
 * no caller reaches it; only this plugin, acting as itself, writes and reads
 * it.
 *
 * @module collections/sends
 */

import { text, type CollectionConfig } from "@nextlyhq/plugin-sdk";

/** The slug the sends are kept under. */
export const SUBMISSION_SENDS_SLUG = "form-submission-sends";

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
    ],
    indexes: [{ fields: ["submission"] }],
  };
}
