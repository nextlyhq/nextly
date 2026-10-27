/**
 * What the collection and Single write paths are both built with after their language source, in
 * the order their constructors take it. One definition, so the two write paths cannot drift apart.
 *
 * @module di/registrations/content-write-seams
 */
import { MetaRetentionGate } from "../../domains/retention/gate";
import {
  buildRetentionRunner,
  retentionPoliciesFrom,
} from "../../domains/retention/passes";
import type { WebhookFastDrainScheduler } from "../../domains/webhooks/after-drain";
import type { CacheRevalidator } from "../../revalidation/types";
import { container } from "../container";

import type { RegistrationContext } from "./types";

export function contentWriteSeams(ctx: RegistrationContext) {
  const { adapter, logger } = ctx;
  return [
    // A write appends outbox events, so each write path gets its own retention runner: the
    // handler's is not on this path.
    buildRetentionRunner({
      adapter,
      ...retentionPoliciesFrom(ctx.config),
      gate: new MetaRetentionGate(adapter),
      logger,
    }),
    // Shared post-response drain fast path (registered by the webhook services). Absent only when
    // webhooks were never registered.
    container.has("webhookFastDrainScheduler")
      ? container.get<WebhookFastDrainScheduler>("webhookFastDrainScheduler")
      : undefined,
    // Cache revalidator that flushes each write's revalidation intents post-commit. Resolved
    // lazily at flush time (not captured here) because these services are constructed during
    // boot, before a Next cache adapter registers: an eager capture would memoize the no-op and
    // ignore the real adapter that registers later, at request time.
    () =>
      container.has("cacheRevalidator")
        ? container.get<CacheRevalidator>("cacheRevalidator")
        : undefined,
  ] as const;
}
