/**
 * Webhook domain — the rules every endpoint's subscription list is held to,
 * whatever its entries may be.
 *
 * One builder for both lists an endpoint is judged by: the published request
 * schemas' (core's types and the wildcard) and the route's (which also takes
 * the types plugins declare). The rules live once, so the two cannot come to
 * disagree about what a valid list is.
 *
 * @module domains/webhooks/subscription-list
 */
import { z } from "zod";

import { WEBHOOK_EVENT_WILDCARD } from "./types";

/**
 * A subscription list of `entry`: at least one entry, no duplicates, and the
 * wildcard cannot be combined with specific types (it already covers them, so
 * a mix is contradictory rather than additive).
 */
export function subscriptionList<T extends z.ZodType<string>>(
  entry: T
): z.ZodArray<T> {
  return (
    z
      .array(entry)
      .min(1, "Subscribe to at least one event type.")
      // A duplicate would not change delivery, but it would make the stored
      // subscription disagree with what the user typed.
      .refine(types => new Set(types).size === types.length, {
        message: "Event types must be unique.",
      })
      .refine(
        types =>
          !types.some(type => type === WEBHOOK_EVENT_WILDCARD) ||
          types.length === 1,
        {
          message:
            'Use "*" on its own to subscribe to all events; do not combine it with specific types.',
        }
      )
  );
}
