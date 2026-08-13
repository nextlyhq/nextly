/**
 * Runs retention passes on demand, at most one per interval per pass.
 *
 * The scheduling problem is the same for every domain that prunes, and it is
 * not the same as the pruning: there is no daemon to hang a timer off (see
 * `./gate`), so passes are offered opportunistically by write paths and gated.
 * Domains supply WHAT to prune; this decides WHEN, so a second domain needing
 * retention adds a pass rather than a second scheduler.
 *
 * Each pass is gated independently, on its own key and its own interval. A
 * single shared gate would let the first pass to run consume the interval for
 * all of them, and the busiest domain would starve every other one — which is
 * the failure that would look exactly like retention silently not working.
 *
 * @module domains/retention/runner
 */

import type { Logger } from "../../shared/types";

import { claimRetentionPass, type RetentionGateStore } from "./gate";
import { warnQuietly } from "./safe-log";

/** One domain's retention work, plus how often it may run. */
export interface RetentionPass {
  /** Distinguishes this pass's gate marker. Must be unique per pass. */
  key: string;
  /** Shortest time between two runs of THIS pass. */
  intervalMs: number;
  /**
   * @param maxBatches Caps this run when the caller is a write path, which
   *   wants a bounded amount of work rather than a full backlog sweep.
   */
  run(maxBatches?: number): Promise<void>;
}

export interface RetentionRunnerDeps {
  passes: RetentionPass[];
  gate: RetentionGateStore;
  /** Injectable so tests can move time without sleeping. */
  now?: () => Date;
  logger?: Logger;
}

export class RetentionRunner {
  /** Epoch ms per pass key, before which this process skips the stored gate. */
  private readonly nextEligibleAt = new Map<string, number>();

  constructor(private readonly deps: RetentionRunnerDeps) {}

  /**
   * `maybeRun` never throws and never rejects: callers hang it off a successful
   * content write, and housekeeping must not be able to turn that into an
   * error. One pass failing must not stop the others from being offered, so
   * each is attempted independently.
   */
  async maybeRun(maxBatches?: number): Promise<void> {
    for (const pass of this.deps.passes) {
      await this.runOne(pass, maxBatches);
    }
  }

  private async runOne(
    pass: RetentionPass,
    maxBatches?: number
  ): Promise<void> {
    try {
      const now = (this.deps.now ?? (() => new Date()))().getTime();
      if (now < (this.nextEligibleAt.get(pass.key) ?? 0)) return;

      // Held off BEFORE the stored gate is consulted, so a burst of concurrent
      // writes in one process produces one database read rather than one per
      // write. A pass that then loses the stored gate still waits its turn,
      // which is the intended outcome.
      this.nextEligibleAt.set(pass.key, now + pass.intervalMs);

      const claimed = await claimRetentionPass(
        this.deps.gate,
        pass.key,
        pass.intervalMs,
        new Date(now)
      );
      if (!claimed) return;

      await pass.run(maxBatches);
    } catch (error) {
      // The pass implementations absorb their own failures, so reaching here
      // means something unforeseen. Swallow it for the same reason they do.
      //
      // Reported through `warnQuietly` because this call sits INSIDE the catch
      // that is supposed to contain everything: an app-supplied logger that
      // throws here throws from the one position nothing is guarding, and the
      // escape reaches the write path that only offered a pass out of courtesy.
      warnQuietly(this.deps.logger, "retention pass could not start", {
        pass: pass.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
