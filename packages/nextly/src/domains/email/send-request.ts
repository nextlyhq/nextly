/**
 * The fields both REST send routes read the same way: the recipients, the
 * envelope, the provider, the attachments and the idempotency key.
 *
 * Declared once, so the raw and the template route cannot come to disagree on
 * what a sendable address or a usable key is. Each route adds its own content
 * fields around them, in the order its body has always been read.
 *
 * @module domains/email/send-request
 */

import { z } from "zod";

import { MAX_IDEMPOTENCY_KEY_LENGTH } from "./send-claims";
import {
  isSendableAddress,
  isSendableAddressList,
} from "./services/recipients";

// One address, or a comma-joined list of them, as the service reads a `to`
// entry: both routes accept exactly what every other way of sending does.
const recipientSchema = z
  .string()
  .refine(isSendableAddressList, "A valid recipient email is required");

const attachmentInputSchema = z.object({
  mediaId: z.string().min(1, "mediaId is required"),
  filename: z.string().min(1).optional(),
});

/**
 * One address, as before, or several: every one receives the email. Checked
 * as the service checks it, so the route and the service agree on what a
 * sendable address is (`dev@localhost`, `Name <user@example.com>`).
 */
const sendToField = z.union([
  recipientSchema,
  z.array(recipientSchema).min(1, "At least one recipient is required"),
]);

/** Everything after a route's own content fields. */
const sendEnvelopeFields = {
  // The send's own sender and Reply-To. Either may carry a display name
  // (`Name <user@example.com>`), so the mailbox inside it is what is checked.
  from: z
    .string()
    .trim()
    .refine(isSendableAddress, "from must be an email address")
    .optional(),
  replyTo: z
    .string()
    .trim()
    .refine(isSendableAddress, "replyTo must be an email address")
    .optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  providerId: z.string().optional(),
  attachments: z.array(attachmentInputSchema).optional(),
  // Sends this message once for the key; checked again by the service.
  idempotencyKey: z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH).optional(),
};

/**
 * A send route's body: `to`, then the route's own content fields, then the
 * envelope, in the order the routes have always read them.
 */
export function sendRequestSchema<Content extends z.ZodRawShape>(
  content: Content
) {
  return z.object({ to: sendToField, ...content, ...sendEnvelopeFields });
}
