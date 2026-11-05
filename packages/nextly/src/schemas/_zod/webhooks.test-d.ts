/**
 * The webhook request schemas hand the endpoint service a subscription list
 * it accepts without a cast.
 *
 * An entry is the wildcard, one of core's types or a type a plugin declares,
 * so the parsed list is strings. Which strings are accepted is decided when
 * the request is judged, against the event-type registry, not by the type: a
 * cast at the request-to-service boundary is what this guards against.
 */
import { expectTypeOf } from "vitest";

import type { WebhookEventSubscription } from "../../domains/webhooks/types";

import type { CreateWebhookInput, UpdateWebhookInput } from "./webhooks";

// The parsed subscription list is what the service takes, with no cast.
expectTypeOf<CreateWebhookInput["eventTypes"]>().toMatchTypeOf<
  WebhookEventSubscription[]
>();

expectTypeOf<UpdateWebhookInput["eventTypes"]>().toMatchTypeOf<
  WebhookEventSubscription[] | undefined
>();

// And the service's own subscription type still names core's types and the
// wildcard, so code that builds one by hand is checked against them.
expectTypeOf<"entry.created">().toMatchTypeOf<WebhookEventSubscription>();
expectTypeOf<"*">().toMatchTypeOf<WebhookEventSubscription>();
