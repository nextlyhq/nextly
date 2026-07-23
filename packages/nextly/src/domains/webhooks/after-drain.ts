/**
 * Webhook domain — the post-response drain fast path.
 *
 * After a content write records an outbox event, this kicks a bounded drain via
 * Next.js `after()` so the first delivery attempt happens immediately instead of
 * waiting for the next scheduled trigger. `after()` runs the work once the
 * response is sent, so it adds no latency to the write. Everything degrades
 * gracefully: outside a Next request (a CLI or plain-Node write) or on a Next
 * version without `after`, this is a no-op and the scheduled drain delivers.
 *
 * @module domains/webhooks/after-drain
 */

import { createRequire } from "node:module";

import type { Logger } from "../../shared/types";

import {
  runWebhookDrain,
  type RunWebhookDrainOptions,
  type WebhookDrainDatabase,
} from "./drain-runner";
import type { WebhookEndpointRegistry } from "./endpoint-registry";

/** Next.js `after()`: schedules a callback to run once the response is finished. */
type AfterFn = (callback: () => void | Promise<void>) => void;

/**
 * Resolve Next's `after()` (stable in 15.1) or `unstable_after` (15.0), or null
 * when neither is available (Next 14, or Next not installed).
 *
 * Loaded with `createRequire` for the reason `api/with-error-handler.ts`
 * documents: a static or dynamic ESM `import` of a Next subpath breaks Node's
 * ESM resolver when this package is an external under `serverExternalPackages`,
 * and the `.js`-suffixed workaround sends Turbopack into Next internals that are
 * not on disk. `createRequire` uses Node's CommonJS resolver and is opaque to
 * the bundler, so neither complains.
 */
export function loadNextAfter(): AfterFn | null {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("next/server") as {
      after?: unknown;
      unstable_after?: unknown;
    };
    if (typeof mod.after === "function") return mod.after as AfterFn;
    if (typeof mod.unstable_after === "function") {
      return mod.unstable_after as AfterFn;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Bounds for the fast-path drain. It runs on the WRITE route's invocation
 * (`after()` extends it via `waitUntil`, capped by the route's `maxDuration`),
 * so it only kicks the just-recorded deliveries and returns quickly; the
 * scheduled drain owns the backlog and the retries.
 */
const FAST_PATH_DRAIN_OPTIONS: RunWebhookDrainOptions = {
  maxRounds: 3,
  fanOutBatchSize: 50,
  deliverBatchSize: 25,
  maxDurationMs: 5_000,
  // Below maxDurationMs on purpose: the drain can only stop between deliveries,
  // so the worst case is the budget plus one in-flight request
  // (maxDurationMs + requestTimeoutMs). Keeping the timeout under the budget
  // holds that worst case (~9s) inside a 10s route maxDuration; a receiver that
  // outlasts it is cut off and retried by the scheduled drain.
  requestTimeoutMs: 4_000,
};

/**
 * Schedules an immediate, bounded drain after a content write's response, when
 * the runtime supports `after()`. The subscriber check runs inside the scheduled
 * callback (after the response is sent), never in the write path, so a write is
 * never delayed by a registry read. A single instance is shared across every
 * write path; it holds only a single-flight flag so concurrent writes in one
 * process coalesce into one drain instead of racing.
 */
export class WebhookFastDrainScheduler {
  // Resolved once on first use; an instance field (not module scope) so a test
  // with its own injected loader is not shadowed by an earlier resolution.
  private cachedAfter: AfterFn | null | undefined;

  // Single-flight: at most one fast drain runs in this process at a time. A write
  // that lands while a drain is in flight sets `rerunRequested` so exactly one
  // more pass runs when the current one finishes, instead of scheduling a second
  // drain that would race the first over the same due deliveries. Cross-process
  // races are separately bounded by the per-row delivery lease and the
  // at-least-once + receiver-dedup contract (see deliver.ts).
  private draining = false;
  private rerunRequested = false;

  constructor(
    private readonly adapter: WebhookDrainDatabase,
    private readonly registry: WebhookEndpointRegistry,
    private readonly logger?: Logger,
    // Injectable so a test can drive the scheduled callback without a real Next
    // request scope; defaults to the guarded loader.
    private readonly loadAfter: () => AfterFn | null = loadNextAfter,
    // Injectable so a test can supply a transport/clock; defaults to the
    // fast-path bounds.
    private readonly drainOptions: RunWebhookDrainOptions = FAST_PATH_DRAIN_OPTIONS
  ) {}

  /**
   * Schedule the drain to run after the response. Safe to call after every
   * write: it self-gates on runtime support and never throws — a failure here
   * must never turn a successful write into an error, and the scheduled drain is
   * always the backstop. It does NOT read the database: the subscriber check
   * happens inside the callback so the write path stays free of registry reads.
   *
   * Synchronous: it only registers the callback. The delivery work is owned by
   * `after()` (which survives the response via `waitUntil`), so there is nothing
   * for a caller to await.
   */
  offer(): void {
    try {
      if (this.cachedAfter === undefined) this.cachedAfter = this.loadAfter();
      const after = this.cachedAfter;
      // No `after()` (non-Next runtime, or Next < 15): the scheduled drain delivers.
      if (!after) return;
      after(() => this.drainIfSubscribed());
    } catch {
      // Resolving the loader or registering the callback must never throw into
      // the write path (e.g. `after()` throws outside a request scope: build
      // time, a CLI write). The scheduled drain is the backstop.
    }
  }

  /**
   * The scheduled work: gate on there being a subscriber, then one bounded
   * drain. Both the gate and fan-out read endpoints fresh, so a subscriber
   * another process just created is seen. Absorbs its own failures — this runs
   * after the response, so there is nothing to fail.
   *
   * Single-flight: if a drain is already running in this process, record that a
   * trailing pass is wanted and return, so concurrent writes never launch racing
   * drains. The running drain then loops once more, and because fan-out reads
   * fresh each pass it picks up the events those trailing writes recorded.
   */
  private async drainIfSubscribed(): Promise<void> {
    if (this.draining) {
      this.rerunRequested = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.rerunRequested = false;
        // Fresh read, not the TTL cache: a subscriber another process just
        // created must be seen here, and this runs after the response so the read
        // adds no latency to the write. With no subscriber there is nothing to
        // deliver, so skip the drain rather than fan out events that go nowhere.
        const enabled = await this.registry.getEnabledEndpointsFresh();
        if (enabled.length === 0) {
          // A write offered a drain while this read was in flight — possibly one
          // that just enabled an endpoint this (now stale) read missed. Loop for
          // a fresh read rather than dropping its requested drain.
          if (this.rerunRequested) continue;
          break;
        }
        await runWebhookDrain(this.adapter, this.registry, this.drainOptions);
      } while (this.rerunRequested);
    } catch (err) {
      this.logger?.warn?.(
        "webhook fast-path drain failed; the scheduled drain will retry",
        { error: err instanceof Error ? err.message : String(err) }
      );
    } finally {
      this.draining = false;
    }
  }
}
