/**
 * The prompt dispatch of durable plugin events: once the transaction that
 * recorded an event commits, a bounded dispatch pass runs after the response,
 * as a content write's webhook drain does, so the first delivery need not
 * wait for the next `events:dispatch` sweep.
 *
 * It never touches the write: `offer` only registers the pass with Next's
 * `after()` and cannot throw, and the pass logs and swallows its own failure.
 * Outside a Next request (a CLI or a job) there is no `after()` and the
 * offer does nothing; the sweep delivers. The pass is the sweep's own
 * dispatch, deliveries claimed by lease, so a kick racing the sweep, here or
 * in another process, cannot deliver twice. A burst of commits runs one pass
 * at a time in this process, with at most one more queued behind it, and
 * one `after()` callback runs two passes at most.
 *
 * @module domains/plugin-events/kick
 * @experimental
 */
import { runDetachedFromRequest } from "../../auth/caller-scope";
import { container } from "../../di/container";
import type { Logger } from "../../shared/types";
import { loadNextAfter } from "../webhooks/after-drain";

import { dispatchDurableEvents, type DispatchAdapter } from "./dispatch";
import { getDurableSubscribers, type DurableSubscribers } from "./subscribers";

/** Next.js `after()`: runs a callback once the response is finished. */
type AfterFn = (callback: () => void | Promise<void>) => void;

/**
 * How long one prompt pass may start work for. It runs on the write's own
 * invocation, which `after()` extends only so far: the sweep owns any backlog.
 */
const KICK_BUDGET_MS = 5_000;
/** Events fanned out, and deliveries run, per prompt pass at most. */
const KICK_BATCH = 25;
/**
 * Passes one `after()` callback runs at most: its own and one queued behind
 * it. Under a steady stream of commits every pass would queue another, and
 * the callback would hold its invocation open for as long as the stream
 * lasts; what is left is the sweep's.
 */
const KICK_PASSES = 2;

/** What the kick is built from. */
export interface DurableEventsKickOptions {
  /** Resolved per pass: the kick can be built before the database connects. */
  adapter: () => DispatchAdapter;
  subscribers: () => DurableSubscribers;
  logger?: Pick<Logger, "warn">;
  /** Next's `after()`, or null outside Next; injectable for tests. */
  loadAfter?: () => AfterFn | null;
  /** One dispatch pass; the sweep's own, injectable for tests. */
  dispatch?: () => Promise<unknown>;
}

/** @experimental Offers a prompt dispatch once a durable event commits. */
export class DurableEventsKick {
  // Resolved on first use, as the webhook drain's is.
  private cachedAfter: AfterFn | null | undefined;
  // One pass in flight at a time; an offer made meanwhile asks for one more.
  private running = false;
  private queued = false;

  constructor(private readonly options: DurableEventsKickOptions) {}

  /**
   * Register one prompt pass to run after the response. Synchronous and
   * never throws: a failure here must not turn a committed write into an
   * error, and the sweep is always the backstop.
   */
  offer(): void {
    try {
      if (this.cachedAfter === undefined) {
        this.cachedAfter = (this.options.loadAfter ?? loadNextAfter)();
      }
      this.cachedAfter?.(() => this.run());
    } catch {
      // `after()` throws outside a request scope (a build, a CLI write): the
      // sweep delivers.
    }
  }

  /** The passes, coalesced, each failure logged and swallowed. */
  private async run(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    try {
      const dispatch = this.options.dispatch ?? (() => this.dispatchOnce());
      for (let pass = 0; pass < KICK_PASSES; pass += 1) {
        this.queued = false;
        try {
          // As the scheduled dispatch runs it: `after()` runs this in the
          // emitting request's context, and a handler must not act as that
          // request's caller, under its key's scope or its route actor, for
          // every event the pass delivers.
          await runDetachedFromRequest(dispatch);
        } catch (error) {
          // A failed pass does not drop the one queued behind it.
          this.options.logger?.warn(
            "A prompt dispatch of durable events failed; the scheduled dispatch will deliver them",
            { error: error instanceof Error ? error.message : String(error) }
          );
        }
        if (!this.queued) break;
      }
    } finally {
      this.running = false;
    }
  }

  /** One bounded pass of the sweep's own dispatch. */
  private dispatchOnce(): Promise<unknown> {
    return dispatchDurableEvents({
      adapter: this.options.adapter(),
      subscribers: this.options.subscribers(),
      deadline: Date.now() + KICK_BUDGET_MS,
      batch: KICK_BATCH,
    });
  }
}

const globalForKick = globalThis as unknown as {
  __nextly_durableEventsKick?: DurableEventsKick;
};

/**
 * @experimental The process's prompt dispatch, built on first use: one per
 * process, so a burst of commits from every plugin coalesces into one pass
 * at a time. It reads the adapter, the subscribers and the logger as each
 * pass runs, so a container a reload replaces is the one it uses.
 */
export function getDurableEventsKick(): DurableEventsKick {
  globalForKick.__nextly_durableEventsKick ??= new DurableEventsKick({
    adapter: () => container.get<DispatchAdapter>("adapter"),
    subscribers: getDurableSubscribers,
    logger: {
      warn: (message, meta) => {
        if (container.has("logger")) {
          container.get<Logger>("logger").warn(message, meta);
        }
      },
    },
  });
  return globalForKick.__nextly_durableEventsKick;
}
