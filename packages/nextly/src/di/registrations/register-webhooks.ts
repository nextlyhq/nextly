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

import { MetaRetentionGate } from "../../domains/retention/gate";
import {
  buildRetentionRunner,
  retentionPoliciesFrom,
} from "../../domains/retention/passes";
import { WebhookFastDrainScheduler } from "../../domains/webhooks/after-drain";
import type {
  RunWebhookDrainOptions,
  WebhookDrainDatabase,
} from "../../domains/webhooks/drain-runner";
import {
  WebhookEndpointRegistry,
  type WebhookEndpointReader,
} from "../../domains/webhooks/endpoint-registry";
import {
  refreshEndpointPresence,
  setEndpointPresenceRefresher,
  setWebhookAuditEnabled,
} from "../../domains/webhooks/recording-activation";
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

  // Publish the outbox recording gate inputs so the recording choke point can
  // skip events no endpoint would receive. Audit forces recording regardless;
  // endpoint presence is refreshed from the shared registry on a POOLED
  // connection (never a content transaction) at boot, on endpoint CRUD, and on a
  // stale background reload. Prime it now, non-awaited so registration is not
  // blocked on the read; the flag fails open until it lands.
  setWebhookAuditEnabled(ctx.config.webhookAuditEnabled ?? false);
  setEndpointPresenceRefresher(() =>
    container
      .get<WebhookEndpointRegistry>("webhookEndpointRegistry")
      .hasEnabledEndpoints()
  );
  void refreshEndpointPresence();

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

  // Post-response drain fast path, shared by every content-write path. The
  // adapter satisfies the fan-out + delivery surfaces; resolve it as exactly
  // that. Self-gates on Next `after()` support and on there being a subscriber.
  container.registerSingleton<WebhookFastDrainScheduler>(
    "webhookFastDrainScheduler",
    () =>
      new WebhookFastDrainScheduler(
        container.get<WebhookDrainDatabase>("adapter"),
        container.get<WebhookEndpointRegistry>("webhookEndpointRegistry"),
        logger
      )
  );

  // Retention deps the drain route runs after delivery. Content writes already
  // offer a retention pass (register-collections.ts), but an install driven only
  // by the cron drain never writes on that path, so the drain must be able to
  // prune too.
  //
  // Resolved by the audit writer, which is the only trigger an installation
  // taking authentication traffic and no content writes ever reaches. It shares
  // the request-path gate with the content-write runners — the interval holds
  // whichever fires first and the others' passes are no-ops — while the drain
  // claims a separate marker, so a capped request pass cannot consume the
  // full-budget turn.
  //
  // Present whenever EITHER policy has something to prune, so an install with
  // webhook retention off and audit retention on still gets one.
  container.registerSingleton("retentionRunner", () =>
    buildRetentionRunner({
      adapter,
      ...retentionPoliciesFrom(ctx.config),
      gate: new MetaRetentionGate(adapter),
      logger,
    })
  );

  container.registerSingleton<RunWebhookDrainOptions["retention"]>(
    "webhookRetentionDeps",
    () =>
      // Built whenever EITHER policy has something to prune. Keying it on the
      // webhook policy alone made the audit trails' only full-budget trigger
      // disappear the moment an operator switched webhook retention off, which
      // is an unrelated decision: every remaining audit trigger is a request
      // path capped at a batch, so the configured budget became unreachable and
      // a busy trail could grow indefinitely.
      ctx.config.webhookRetention || ctx.config.auditRetention
        ? {
            policy: ctx.config.webhookRetention ?? undefined,
            // Carried whenever a policy exists rather than only when it prunes
            // today: whether it prunes is decided when the pass runs, so a hot
            // reload that widens an entirely-`false` policy reaches this
            // dependency instead of needing a restart.
            auditPolicy: ctx.config.auditRetention,
            prune: { adapter, logger },
            gate: new MetaRetentionGate(adapter),
          }
        : undefined
  );
}
