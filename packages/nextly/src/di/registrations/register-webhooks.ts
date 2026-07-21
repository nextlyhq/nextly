/**
 * Webhook DI registrations.
 *
 * Registers the endpoint management service that the REST surface resolves.
 * Delivery, fan-out and retention are assembled elsewhere: retention travels
 * with the services that write events (`register-collections.ts`), because a
 * write is what makes retention due.
 *
 * The service takes an optional endpoint registry, which is not passed here.
 * The registry is constructed per drain today, so there is no shared instance
 * to invalidate; once one exists it belongs here, or a change made through the
 * REST surface will not be seen by a running drain until its cache expires.
 */

import { WebhookEndpointService } from "../../domains/webhooks/services/webhook-endpoint-service";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function registerWebhookServices(ctx: RegistrationContext): void {
  const { adapter, logger } = ctx;

  container.registerSingleton<WebhookEndpointService>(
    "webhookEndpointService",
    () => new WebhookEndpointService(adapter, logger)
  );
}
