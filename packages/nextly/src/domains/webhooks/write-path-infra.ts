/**
 * Webhook domain — shared write-path infrastructure resolution.
 *
 * A write path that records an outbox event wants two post-commit hooks, exactly
 * as the collection/single/media services already wire: the fast-path drain (so
 * a recorded event is delivered immediately instead of at the next scheduled
 * trigger) and a bounded retention pass (so a frequently-written resource trims
 * what it fills without waiting for the scheduled drain).
 *
 * The retention pass covers BOTH domains — the webhook outbox and the audit
 * trails — each on its own window and its own gate. It is absent only when
 * neither has anything to prune, so an install with webhook retention off and
 * audit retention on still gets one; wiring that forwards a single policy
 * leaves the other domain unpruned rather than failing. The drain hook is
 * likewise optional, and a bare container (CLI, tests) has neither.
 *
 * Centralized because the user write paths reach the mutation service through
 * several construction sites (DI registration, the legacy facade, and the auth
 * registration handler); resolving the infrastructure here keeps them identical
 * and keeps the container lookup out of the auth domain.
 *
 * @module domains/webhooks/write-path-infra
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import { MetaRetentionGate } from "../../domains/retention/gate";
import {
  buildRetentionRunner,
  retentionPoliciesFrom,
} from "../../domains/retention/passes";
import type { RetentionRunner } from "../../domains/retention/runner";
import type { Logger } from "../../shared/types";

import type { WebhookFastDrainScheduler } from "./after-drain";

/** The optional post-commit hooks a webhook-recording write path offers. */
export interface WebhookWritePathInfra {
  fastDrainScheduler?: WebhookFastDrainScheduler;
  retentionRunner?: RetentionRunner;
}

/**
 * Resolve the fast-path drain and retention runner from the DI container.
 *
 * The drain is a shared singleton registered by the webhook services; the
 * retention runner is built per call from the configured policy, matching how
 * `get media()` and the collection/single registrations construct it. Absent
 * pieces resolve to `undefined`, so a caller safely optional-chains them.
 */
export function resolveWebhookWritePathInfra(
  adapter: DrizzleAdapter,
  logger: Logger
): WebhookWritePathInfra {
  const fastDrainScheduler = container.has("webhookFastDrainScheduler")
    ? container.get<WebhookFastDrainScheduler>("webhookFastDrainScheduler")
    : undefined;

  const config = container.has("config")
    ? container.get<NextlyServiceConfig>("config")
    : undefined;

  const retentionRunner = buildRetentionRunner({
    adapter: adapter,
    ...retentionPoliciesFrom(config),
    gate: new MetaRetentionGate(adapter),
    logger,
  });

  return { fastDrainScheduler, retentionRunner };
}
