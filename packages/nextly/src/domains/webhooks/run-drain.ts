/**
 * Webhook domain — drain orchestrator.
 *
 * One drain pass = fan out due events into delivery rows, then attempt the due
 * deliveries. Both phases are individually bounded (one batch per call), so the
 * orchestrator loops until a full round makes no progress or a round cap is hit.
 * This is the unit a scheduled trigger (a cron route, `after()`) invokes; the
 * trigger itself is a separate slice.
 *
 * @module domains/webhooks/run-drain
 */

import { deliverDueDeliveries, type DeliverDeps } from "./deliver";
import { fanOutDueEvents, type FanOutDeps } from "./fan-out";
import { pruneWebhookDataSafely, type PruneDeps } from "./prune";
import type { ResolvedWebhookRetentionConfig } from "./retention-config";
import { claimRetentionPass, type RetentionGateStore } from "./retention-gate";

/** Hard cap on rounds so a persistently-retrying backlog can't loop unbounded. */
const DEFAULT_MAX_ROUNDS = 100;

export interface RunDrainDeps {
  fanOut: FanOutDeps;
  deliver: DeliverDeps;
  /** Max fan-out/deliver rounds before returning. Defaults to 100. */
  maxRounds?: number;
  /**
   * Wall-clock budget for the whole drain. Once exceeded the loop stops starting
   * new rounds AND the delivery pass stops attempting new deliveries, so a
   * scheduler tick returns within roughly `maxDurationMs` plus one in-flight
   * request timeout even when receivers hang — instead of `batch × rounds ×
   * timeout`. The durable outbox + delivery lease let the next tick continue.
   * Unbounded when unset (the default; content-write-driven callers do not need
   * it). Measured with the delivery clock so tests stay deterministic.
   */
  maxDurationMs?: number;
  /**
   * Retention, when configured. The pass runs after delivery so it only ever
   * sees rows this drain has finished with, and it is gated so a frequently
   * invoked drain does not prune on every call.
   */
  retention?: {
    policy: ResolvedWebhookRetentionConfig;
    prune: PruneDeps;
    gate: RetentionGateStore;
  };
}

export interface RunDrainResult {
  rounds: number;
  eventsProcessed: number;
  deliveriesCreated: number;
  attempted: number;
  delivered: number;
  retried: number;
  failed: number;
  /**
   * Attempts whose outcome was dropped because the lease had been handed off
   * (a redelivery re-arm or a reclaimed expired lease) — never counted as a
   * committed delivered/retried/failed.
   */
  abandoned: number;
  /** Rows retention removed on this call; zero when the gate held it off. */
  pruned: { events: number; deliveries: number };
}

/**
 * Run the drain to quiescence. Each round fans out one batch of events and
 * attempts one batch of deliveries; the loop stops when a round both fans out no
 * event and attempts no delivery (nothing left that is due right now), or when
 * `maxRounds` is reached. Deliveries scheduled for a future retry are intentionally
 * left for a later drain — this returns once nothing is immediately actionable.
 */
export async function runDrain(deps: RunDrainDeps): Promise<RunDrainResult> {
  const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
  // The delivery clock, reused for the budget so the deadline and the delivery
  // pass compare against the same time source (real in production, pinned in
  // tests).
  const now = deps.deliver.now ?? (() => new Date());
  const deadline =
    deps.maxDurationMs !== undefined
      ? new Date(now().getTime() + deps.maxDurationMs)
      : undefined;
  const result: RunDrainResult = {
    rounds: 0,
    eventsProcessed: 0,
    deliveriesCreated: 0,
    attempted: 0,
    delivered: 0,
    retried: 0,
    failed: 0,
    abandoned: 0,
    pruned: { events: 0, deliveries: 0 },
  };

  for (let round = 0; round < maxRounds; round += 1) {
    const fan = await fanOutDueEvents(deps.fanOut);
    const del = await deliverDueDeliveries(
      deadline ? { ...deps.deliver, deadline } : deps.deliver
    );

    result.rounds += 1;
    result.eventsProcessed += fan.eventsProcessed;
    result.deliveriesCreated += fan.deliveriesCreated;
    result.attempted += del.attempted;
    result.delivered += del.delivered;
    result.retried += del.retried;
    result.failed += del.failed;
    result.abandoned += del.abandoned;

    // Nothing was fanned out and nothing was attempted this round → the queue is
    // drained of everything currently due; stop.
    if (fan.eventsProcessed === 0 && del.attempted === 0) break;
    // Budget spent → stop before starting a new round; the next tick continues.
    if (deadline && now() >= deadline) break;
  }

  // After the queue is quiet, not between rounds: pruning mid-drain would race
  // the deliveries this very call is still working through. Failure is
  // swallowed — a drain that delivered successfully must not report failure
  // because housekeeping could not run.
  const retention = deps.retention;
  if (retention) {
    const due = await claimRetentionPass(
      retention.gate,
      retention.policy.intervalMs
    );
    if (due) {
      const pruned = await pruneWebhookDataSafely(
        retention.prune,
        retention.policy
      );
      result.pruned.events = pruned.events.webhook + pruned.events.audit;
      result.pruned.deliveries = pruned.deliveries;
    }
  }

  return result;
}
