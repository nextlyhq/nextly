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
  /**
   * Shortest time between two runs of THIS pass, asked EACH time a pass is
   * offered rather than captured when it was built.
   *
   * A runner built at boot outlives every hot reload, so a number copied in
   * here keeps its boot-time value: shortening the interval leaves pruning
   * delayed for hours, and lengthening it keeps pruning too often. Both the
   * in-process eligibility clock and the stored gate read it, so a stale value
   * is wrong twice.
   */
  intervalMs: () => number;
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
  /**
   * Epoch ms of this process's last offer per pass key.
   *
   * The TIME rather than a precomputed deadline, so the interval is applied at
   * comparison rather than baked in when the previous offer happened. A stored
   * deadline keeps whatever interval was current when it was written, so
   * shortening a six-hour window would still wait out the remaining six hours
   * once -- the exact delay the setting was changed to avoid.
   */
  private readonly lastOfferedAt = new Map<string, number>();

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

      // Read once per offer and reused for both the in-process hold-off and
      // the stored claim, so the two cannot disagree within one attempt.
      const intervalMs = pass.intervalMs();

      const lastOffered = this.lastOfferedAt.get(pass.key);
      if (lastOffered !== undefined && now < lastOffered + intervalMs) return;

      // Recorded BEFORE the stored gate is consulted, so a burst of concurrent
      // writes in one process produces one database read rather than one per
      // write. A pass that then loses the stored gate still waits its turn,
      // which is the intended outcome.
      this.lastOfferedAt.set(pass.key, now);

      const claimed = await claimRetentionPass(
        this.deps.gate,
        pass.key,
        intervalMs,
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
      // The error is passed WHOLE rather than reduced to a string here.
      // `error.message` is a property access on a value this code did not
      // create, and a getter that throws would do so while building the
      // argument list — outside `warnQuietly`, before any guard applies, which
      // is the same escape route the logger itself had. Whatever rendering the
      // installed logger does happens inside the guard.
      warnQuietly(this.deps.logger, "retention pass could not start", {
        pass: pass.key,
        error,
      });
    }
  }
}
