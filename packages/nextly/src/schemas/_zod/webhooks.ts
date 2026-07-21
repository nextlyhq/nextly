/**
 * Request shapes for the webhook endpoint surface.
 *
 * Field names follow what the webhook ecosystem has converged on — `url`,
 * `enabled`, an explicit event-type list, a human `description` — so an
 * integration written against Stripe or Svix reads the same here.
 *
 * Subscription is an explicit list rather than a wildcard. Both models exist in
 * the market, but they fail in opposite directions: adding a new event type to
 * Nextly would immediately change what a wildcard endpoint receives, which
 * breaks a consumer doing exhaustive matching on the type. Explicit costs the
 * consumer an update when they want the new type, and that is the safe
 * direction. Wildcards can be added later without breaking anyone; removing
 * them could not.
 *
 * @module schemas/_zod/webhooks
 */

import { z } from "zod";

import { WEBHOOK_EVENT_TYPES } from "../../domains/webhooks/types";

/**
 * The event types an endpoint may subscribe to.
 *
 * Bound to the same constant the fan-out matches against, so a type that
 * cannot be delivered cannot be subscribed to either — a silently-never-firing
 * subscription is worse than a rejected one.
 */
export const WebhookEventTypeSchema = z.enum(
  WEBHOOK_EVENT_TYPES as unknown as [string, ...string[]]
);

/** Header names a caller may not set, because delivery owns them. */
const RESERVED_HEADER_PREFIXES = ["webhook-", "content-type", "user-agent"];

const HeadersSchema = z
  .record(z.string(), z.string())
  .refine(
    headers =>
      Object.keys(headers).every(
        name =>
          !RESERVED_HEADER_PREFIXES.some(reserved =>
            name.toLowerCase().startsWith(reserved)
          )
      ),
    {
      // Silently dropping them would look like the header was accepted; letting
      // them through would let a caller overwrite the signature headers a
      // receiver verifies against.
      message:
        "Headers named webhook-*, content-type or user-agent are set by delivery and cannot be overridden.",
    }
  );

/**
 * `url` is checked for shape here and for reachability in the service, which
 * resolves the host and rejects private or metadata addresses. Both are needed:
 * this gives an immediate, field-level error, and the service check is the one
 * that cannot be fooled by a hostname that resolves somewhere unexpected.
 */
const UrlSchema = z
  .string()
  .url("Must be a valid URL.")
  .max(2048, "URL must be 2048 characters or fewer.");

export const CreateWebhookSchema = z.object({
  name: z.string().min(1, "Name is required.").max(255),
  url: UrlSchema,
  eventTypes: z
    .array(WebhookEventTypeSchema)
    .min(1, "Subscribe to at least one event type.")
    // A duplicate would not change delivery, but it would make the stored
    // subscription disagree with what the user typed.
    .refine(types => new Set(types).size === types.length, {
      message: "Event types must be unique.",
    }),
  enabled: z.boolean().optional(),
  headers: HeadersSchema.nullable().optional(),
});

/**
 * Every field optional: a PATCH updates what it names. `null` on a nullable
 * field means "clear this", `undefined` means "leave it alone" — the
 * distinction the update path relies on to tell an omitted field from a
 * deliberate reset.
 */
export const UpdateWebhookSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    url: UrlSchema.optional(),
    eventTypes: z
      .array(WebhookEventTypeSchema)
      .min(1, "Subscribe to at least one event type.")
      .refine(types => new Set(types).size === types.length, {
        message: "Event types must be unique.",
      })
      .optional(),
    enabled: z.boolean().optional(),
    headers: HeadersSchema.nullable().optional(),
  })
  .refine(patch => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update.",
  });

export type CreateWebhookInput = z.infer<typeof CreateWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookSchema>;
