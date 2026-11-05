/**
 * The published webhook request schemas keep their event-type literals, and
 * the route's own request schemas hand the endpoint service what it takes.
 *
 * Runtime validation cannot catch a widened type: a schema whose `eventTypes`
 * became `string[]` validates the same bodies. It shows only to code that reads
 * the inferred type, which is why the published schemas are pinned here: they
 * are an export of `nextly/schemas`, and a consumer narrowing on their literals
 * would break if they widened.
 */
import { expectTypeOf } from "vitest";

import type {
  CreateWebhookRequest,
  UpdateWebhookRequest,
} from "../../domains/webhooks/request-schemas";
import type {
  WebhookEventSubscription,
  WebhookEventType,
} from "../../domains/webhooks/types";

import type { CreateWebhookInput, UpdateWebhookInput } from "./webhooks";

/** What the published schemas have always parsed an entry as. */
type CoreSubscription = WebhookEventType | "*";

// The published schemas: core's types and the wildcard, as literals.
expectTypeOf<CreateWebhookInput["eventTypes"]>().toEqualTypeOf<
  CoreSubscription[]
>();
expectTypeOf<UpdateWebhookInput["eventTypes"]>().toEqualTypeOf<
  CoreSubscription[] | undefined
>();
// Stated explicitly, so equality cannot pass for the wrong reason if the
// literals ever collapsed to `string`.
expectTypeOf<CreateWebhookInput["eventTypes"]>().not.toEqualTypeOf<string[]>();

// The route's own schemas take plugins' types too, and what they parse is
// what the endpoint service takes, with no cast at the boundary.
expectTypeOf<CreateWebhookRequest["eventTypes"]>().toMatchTypeOf<
  WebhookEventSubscription[]
>();
expectTypeOf<UpdateWebhookRequest["eventTypes"]>().toMatchTypeOf<
  WebhookEventSubscription[] | undefined
>();
