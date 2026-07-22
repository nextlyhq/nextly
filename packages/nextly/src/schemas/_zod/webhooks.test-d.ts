/**
 * The webhook request schemas must preserve event-type literals.
 *
 * Runtime validation is identical whether the enum is built from the literal
 * tuple or a widened `string[]`, so nothing at runtime can catch the widening.
 * It only shows up at the request-to-service boundary: a parsed body whose
 * `eventTypes` is `string[]` cannot be handed to the endpoint service without
 * a cast, which is exactly the check that should be doing the work there.
 */
import { expectTypeOf } from "vitest";

import type { WebhookEventType } from "../../domains/webhooks/types";

import type { CreateWebhookInput, UpdateWebhookInput } from "./webhooks";

expectTypeOf<CreateWebhookInput["eventTypes"]>().toEqualTypeOf<
  WebhookEventType[]
>();

expectTypeOf<UpdateWebhookInput["eventTypes"]>().toEqualTypeOf<
  WebhookEventType[] | undefined
>();

// Stated explicitly: this is the shape the widening cast produced, and it is
// assignable from the correct type in one direction, so equality alone could
// pass for the wrong reason if the literals ever collapsed to `string`.
expectTypeOf<CreateWebhookInput["eventTypes"]>().not.toEqualTypeOf<string[]>();
