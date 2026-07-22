/**
 * Webhook DI registrations.
 *
 * Registers the shared endpoint registry and the endpoint management service the
 * REST surface resolves. Delivery, fan-out and retention are assembled by the
 * drain orchestrator; retention policy travels with the services that write
 * events (`register-collections.ts`), because a write is what makes it due.
 *
 * The registry is a shared singleton so a CRUD change through the REST surface
 * invalidates the same cache a running drain reads: without it, a per-drain
 * registry could keep delivering to a disabled endpoint until its own cache
 * expired.
 */

import type { RunWebhookDrainOptions } from "../../domains/webhooks/drain-runner";
import {
  WebhookEndpointRegistry,
  type WebhookEndpointReader,
} from "../../domains/webhooks/endpoint-registry";
import { MetaRetentionGate } from "../../domains/webhooks/retention-gate";
import { WebhookDeliveryQueryService } from "../../domains/webhooks/services/webhook-delivery-query-service";
import { WebhookEndpointService } from "../../domains/webhooks/services/webhook-endpoint-service";
import { container } from "../container";

import type { RegistrationContext } from "./types";

/**
 * How long the shared endpoint cache may serve data changed in OTHER processes
 * before reloading. This instance's own CRUD calls invalidate synchronously; the
 * TTL only bounds cross-process staleness, so a short value is enough without
 * reloading on every drain pass.
 */
const ENDPOINT_REGISTRY_TTL_MS = 30_000;

export function registerWebhookServices(ctx: RegistrationContext): void {
  const { adapter, logger } = ctx;

  container.registerSingleton<WebhookEndpointRegistry>(
    "webhookEndpointRegistry",
    () =>
      new WebhookEndpointRegistry(
        // The adapter satisfies the registry's minimal reader surface; resolve
        // it as exactly that from the container.
        container.get<WebhookEndpointReader>("adapter"),
        { ttlMs: ENDPOINT_REGISTRY_TTL_MS }
      )
  );

  container.registerSingleton<WebhookEndpointService>(
    "webhookEndpointService",
    () =>
      new WebhookEndpointService(
        adapter,
        logger,
        // Share the one registry singleton so every CRUD mutation invalidates
        // the cache the drain reads.
        container.get<WebhookEndpointRegistry>("webhookEndpointRegistry")
      )
  );

  // Read-only surface for the admin delivery log; the drain owns every write.
  container.registerSingleton<WebhookDeliveryQueryService>(
    "webhookDeliveryQueryService",
    () => new WebhookDeliveryQueryService(adapter, logger)
  );

  // Retention deps the drain route runs after delivery. Content writes already
  // offer a retention pass (register-collections.ts), but an install driven only
  // by the cron drain never writes on that path, so the drain must be able to
  // prune too. The gate is DB-backed, so this instance and the content-write
  // runner's coordinate through the same persisted claim — the interval holds
  // whichever fires first, and the other's pass is a no-op. `undefined` when the
  // operator switched retention off (or no app config was supplied).
  container.registerSingleton<RunWebhookDrainOptions["retention"]>(
    "webhookRetentionDeps",
    () =>
      ctx.config.webhookRetention
        ? {
            policy: ctx.config.webhookRetention,
            prune: { adapter, logger },
            gate: new MetaRetentionGate(adapter),
          }
        : undefined
  );
}
