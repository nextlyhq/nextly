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

/**
 * The registry surface a drain reads. Fan-out uses the FRESH read so a new
 * subscriber committed by another process is never missed (a fanned-out event is
 * never reconsidered).
 */
export type WebhookDrainRegistry = Pick<
  WebhookEndpointRegistry,
  "getEnabledEndpointsFresh"
>;

/**
 * What bounds one SCHEDULED drain pass.
 *
 * Published from the domain rather than held privately by the route, because
 * there is now more than one scheduled trigger: the `/api/webhooks/drain` route
 * and the `webhooks:drain` job the shared runner performs. Two triggers with two
 * copies of these numbers is two answers to "how long may a tick take", and the
 * first divergence would show up as deliveries retrying forever on whichever
 * trigger was killed mid-pass.
 *
 * `maxDurationMs` is the hard bound a latency-bounded trigger relies on; the
 * per-request timeout lives with the transport and is deliberately shorter, so a
 * single hung receiver cannot stretch the pass much past it.
 */
export const SCHEDULED_DRAIN_BOUNDS = {
  maxRounds: 10,
  fanOutBatchSize: 50,
  deliverBatchSize: 25,
  maxDurationMs: 25_000,
} as const;

/**
 * The wall-clock budget one background-jobs pass allows itself.
 *
 * Stated here rather than imported from the route, because the route imports
 * from this module and the reverse would be a cycle. Kept equal to
 * `JOBS_RUN_MAX_DURATION_MS`, and the drain bounds below are derived from it.
 */
const JOBS_PASS_BUDGET_MS = 20_000;

/**
 * What bounds a drain running as a JOB, inside a jobs pass.
 *
 * Narrower than {@link SCHEDULED_DRAIN_BOUNDS}, and the difference is the whole
 * point. `runJobs` checks its budget before STARTING a handler and cannot
 * interrupt a running one, so a handler that begins with a budget wider than
 * the pass's own can outlive the invocation entirely — the platform kills the
 * process before the job row is finalized, and the sweep is simply retried
 * having done partial work.
 *
 * The per-request timeout is tightened for the same reason: at the engine
 * default a single hung receiver could stretch the pass well past its budget
 * even having started on time.
 */
export const IN_PASS_DRAIN_BOUNDS = {
  maxRounds: 10,
  fanOutBatchSize: 50,
  deliverBatchSize: 25,
  // Two thirds of the pass budget, leaving room for the in-flight request the
  // bound below caps and for the finalize that follows it.
  maxDurationMs: Math.floor(JOBS_PASS_BUDGET_MS * 0.6),
  requestTimeoutMs: 5_000,
} as const;

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
   * Deliveries attempted per round before the next fan-out round. Unclaimed rows
   * wait for the next tick.
   */
  deliverBatchSize?: number;
  /**
   * Wall-clock budget for the whole drain. The hard bound a latency-bounded
   * trigger relies on: the drain returns within about this plus one in-flight
   * request timeout even when receivers hang, so a serverless cron tick finishes
   * before its platform kills it and the next tick continues.
   */
  maxDurationMs?: number;
  /**
   * Per-request delivery timeout. A cron trigger passes a shorter value than the
   * engine default so a single hung receiver cannot stretch the pass past the
   * budget by much.
   */
  requestTimeoutMs?: number;
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
      // Read endpoints fresh each pass: fan-out commits an event as done
      // permanently, so it must see an endpoint another process just created
      // rather than a cached list that could drop the new subscriber for good.
      loadEndpoints: () => registry.getEnabledEndpointsFresh(),
      now: options?.now,
      batchSize: options?.fanOutBatchSize,
    },
    deliver: {
      db: adapter,
      decryptSecret: options?.decryptSecret ?? decryptWebhookSecret,
      transport: options?.transport,
      now: options?.now,
      batchSize: options?.deliverBatchSize,
      requestTimeoutMs: options?.requestTimeoutMs,
    },
    maxRounds: options?.maxRounds,
    maxDurationMs: options?.maxDurationMs,
    retention: options?.retention,
  });
}
