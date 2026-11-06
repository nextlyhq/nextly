/**
 * Webhook domain — the request schemas the webhook routes validate with.
 *
 * Derived from the published `CreateWebhookSchema` and `UpdateWebhookSchema`
 * (`nextly/schemas`), which stay as they were: core's event types alone. These
 * differ only in the subscription list, which also accepts the types plugins
 * declare, judged against the event-type registry. Kept out of the published
 * entry so that adding plugin types changes no existing export.
 *
 * @module domains/webhooks/request-schemas
 */
import { z } from "zod";

import {
  CreateWebhookSchema,
  UpdateWebhookSchema,
} from "../../schemas/_zod/webhooks";

import { isSubscribableEventType } from "./event-type-registry";
import { subscriptionList } from "./subscription-list";
import { WEBHOOK_EVENT_WILDCARD } from "./types";

/**
 * One subscription entry: an event type an endpoint may subscribe to now, or
 * the wildcard for all-and-future.
 *
 * Judged against the one list of event types, core's and every enabled
 * plugin's, read when the request is checked rather than fixed when this
 * module loads: plugins declare theirs at startup, after it. A type nobody
 * declares, or whose plugin is disabled, is refused and named, rather than
 * stored as a subscription nothing may ever send.
 */
const SubscribableEventSchema = z.union([
  z.literal(WEBHOOK_EVENT_WILDCARD),
  z.string().superRefine((type, ctx) => {
    if (!isSubscribableEventType(type)) {
      ctx.addIssue({
        code: "custom",
        message: `"${type}" is not an event type an endpoint can subscribe to.`,
      });
    }
  }),
]);

const SubscribableEventsSchema = subscriptionList(SubscribableEventSchema);

/** An endpoint registration, as the route accepts it. */
export const CreateWebhookRequestSchema = CreateWebhookSchema.extend({
  eventTypes: SubscribableEventsSchema,
});

/**
 * An endpoint change, as the route accepts it. The published schema carries a
 * refinement, which zod will not let `.extend` keep, so its shape is taken and
 * the same rule applied: a patch must name at least one field.
 */
export const UpdateWebhookRequestSchema = z
  .object({
    ...UpdateWebhookSchema.shape,
    eventTypes: SubscribableEventsSchema.optional(),
  })
  .refine(patch => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update.",
  });

export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequestSchema>;
