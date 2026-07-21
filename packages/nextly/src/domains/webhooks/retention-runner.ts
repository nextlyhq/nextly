/**
 * Webhook domain — opportunistic retention passes.
 *
 * The drain is the natural home for retention, but it only runs where webhooks
 * are actually configured. The event ledger fills on every content write
 * regardless, so installs with no webhooks — the majority — would never prune at
 * all if the drain were the only trigger. This is the seam that covers them:
 * content writes offer to run a pass, and the gate decides.
 *
 * Two layers of gating, for different reasons. The in-process guard makes the
 * common case free: once a pass is claimed, this process stops consulting the
 * database for a full interval, so a busy site pays nothing per write. The
 * stored gate behind it is what coordinates across processes and survives a
 * restart, which an in-memory value alone cannot.
 *
 * @module domains/webhooks/retention-runner
 */

import type { Logger } from "../../shared/types";

import { pruneWebhookDataSafely, type PruneDeps } from "./prune";
import type { ResolvedWebhookRetentionConfig } from "./retention-config";
import { claimRetentionPass, type RetentionGateStore } from "./retention-gate";

export interface RetentionRunnerDeps {
  policy: ResolvedWebhookRetentionConfig;
  prune: PruneDeps;
  gate: RetentionGateStore;
  /** Injectable so tests can move time without sleeping. */
  now?: () => Date;
  logger?: Logger;
}

/**
 * Runs retention passes on demand, at most one per interval.
 *
 * `maybeRun` never throws and never rejects: callers hang it off a successful
 * content write, and housekeeping must not be able to turn that into an error.
 */
export class WebhookRetentionRunner {
  /** Epoch ms before which this process will not consult the stored gate. */
  private nextEligibleAt = 0;

  constructor(private readonly deps: RetentionRunnerDeps) {}

  /**
   * @param maxBatches Caps this pass, overriding the policy. The write path
   *   passes a small number so a save that happens to win the gate is not held
   *   up by a full backlog sweep; the drain leaves it unset and takes the lot.
   */
  async maybeRun(maxBatches?: number): Promise<void> {
    try {
      const now = (this.deps.now ?? (() => new Date()))().getTime();
      if (now < this.nextEligibleAt) return;

      // Held off BEFORE the stored gate is consulted, so a burst of concurrent
      // writes in one process produces one database read rather than one per
      // write. A pass that then loses the stored gate still waits its turn,
      // which is the intended outcome.
      this.nextEligibleAt = now + this.deps.policy.intervalMs;

      const claimed = await claimRetentionPass(
        this.deps.gate,
        this.deps.policy.intervalMs,
        new Date(now)
      );
      if (!claimed) return;

      const policy =
        maxBatches === undefined
          ? this.deps.policy
          : { ...this.deps.policy, maxBatchesPerRun: maxBatches };
      await pruneWebhookDataSafely(this.deps.prune, policy);
    } catch (error) {
      // pruneWebhookDataSafely and claimRetentionPass both absorb their own
      // failures, so reaching here means something unforeseen. Swallow it for
      // the same reason they do.
      this.deps.logger?.warn?.("webhook retention pass could not start", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
