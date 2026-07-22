/**
 * Webhook domain — drain wiring.
 *
 * `runDrain` is pure orchestration over injected deps; this builds those deps
 * from the runtime adapter and the shared endpoint registry and runs one drain.
 * It is the single construction site the two triggers share — the cron/manual
 * `/api/webhooks/drain` route and the post-response `after()` fast path — so they
 * cannot drift in how the engine is assembled.
 *
 * The signing secret is decrypted via `decryptWebhookSecret`, which reads
 * `env.NEXTLY_SECRET` itself, so no secret is threaded through here.
 *
 * @module domains/webhooks/drain-runner
 */

import type { DeliverDatabase, DeliverTransport } from "./deliver";
import type { WebhookEndpointRegistry } from "./endpoint-registry";
import type { FanOutDatabase } from "./fan-out";
import { runDrain, type RunDrainDeps, type RunDrainResult } from "./run-drain";
import { decryptWebhookSecret } from "./secret";

/**
 * The database surface a drain needs: the fan-out and delivery database
 * interfaces the runtime adapter satisfies. Kept as the minimal intersection
 * (rather than the concrete adapter type) so a caller resolves it from the DI
 * container as exactly what the drain uses.
 */
export type WebhookDrainDatabase = FanOutDatabase & DeliverDatabase;

/** The registry surface a drain reads: the enabled endpoints for this pass. */
export type WebhookDrainRegistry = Pick<
  WebhookEndpointRegistry,
  "getEnabledEndpoints"
>;

export interface RunWebhookDrainOptions {
  /** HTTP transport override; the engine defaults to the SSRF-safe safeFetch. */
  transport?: DeliverTransport;
  /** Clock override for deterministic tests. */
  now?: () => Date;
  /** Max fan-out/deliver rounds before returning. */
  maxRounds?: number;
  /**
   * Events fanned out per round. Lowering it (with `maxRounds`) is how a
   * latency-bounded trigger — a serverless cron tick — caps the work one
   * invocation does; the outbox is durable, so the next tick continues.
   */
  fanOutBatchSize?: number;
  /**
   * Deliveries attempted per round. Attempts run sequentially with a per-request
   * timeout, so this is the main lever a cron trigger uses to keep a single tick
   * within its platform's execution limit; unclaimed rows wait for the next tick.
   */
  deliverBatchSize?: number;
  /** Retention housekeeping, when the caller has a policy + gate to run it. */
  retention?: RunDrainDeps["retention"];
  /**
   * Signing-secret decryptor. Defaults to {@link decryptWebhookSecret}, which
   * reads `env.NEXTLY_SECRET`; injectable so a test can drive the delivery path
   * without a configured secret.
   */
  decryptSecret?: (ciphertext: string) => string;
}

/**
 * Assemble the drain deps from the adapter + shared registry and run one drain
 * to quiescence. Deliveries scheduled for a future retry are left for a later
 * pass; this returns once nothing is immediately actionable.
 */
export function runWebhookDrain(
  adapter: WebhookDrainDatabase,
  registry: WebhookDrainRegistry,
  options?: RunWebhookDrainOptions
): Promise<RunDrainResult> {
  return runDrain({
    fanOut: {
      db: adapter,
      // Reuse the shared registry so a CRUD change is reflected on the next
      // pass rather than the next cache expiry.
      loadEndpoints: () => registry.getEnabledEndpoints(),
      now: options?.now,
      batchSize: options?.fanOutBatchSize,
    },
    deliver: {
      db: adapter,
      decryptSecret: options?.decryptSecret ?? decryptWebhookSecret,
      transport: options?.transport,
      now: options?.now,
      batchSize: options?.deliverBatchSize,
    },
    maxRounds: options?.maxRounds,
    retention: options?.retention,
  });
}
