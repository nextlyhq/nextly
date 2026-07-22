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
  requestTimeoutMs: 10_000,
};

/**
 * Schedules an immediate, bounded drain after a content write's response, when
 * the runtime supports `after()` and at least one endpoint is enabled. Stateless
 * beyond the resolved `after` reference, so a single instance is shared across
 * every write path.
 */
export class WebhookFastDrainScheduler {
  // Resolved once on first use; an instance field (not module scope) so a test
  // with its own injected loader is not shadowed by an earlier resolution.
  private cachedAfter: AfterFn | null | undefined;

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
   * write: it self-gates on runtime support and on there being a subscriber, and
   * never throws — a failure here must never turn a successful write into an
   * error, and the scheduled drain is always the backstop.
   */
  async offer(): Promise<void> {
    if (this.cachedAfter === undefined) this.cachedAfter = this.loadAfter();
    const after = this.cachedAfter;
    // No `after()` (non-Next runtime, or Next < 15): the scheduled drain delivers.
    if (!after) return;

    // Cheap, cached gate: with no subscriber there is nothing to deliver, so do
    // not extend the invocation with an after() callback at all.
    let enabled: readonly unknown[];
    try {
      enabled = await this.registry.getEnabledEndpoints();
    } catch {
      // A registry read failure must not affect the write; the drain delivers.
      return;
    }
    if (enabled.length === 0) return;

    try {
      after(() => this.drain());
    } catch {
      // `after()` throws outside a request scope (build time, a CLI write). The
      // scheduled drain handles it.
    }
  }

  /**
   * The scheduled work: one bounded drain. Fan-out reads endpoints fresh, so a
   * subscriber added between the gate check and here is still seen. Absorbs its
   * own failures — this runs after the response, so there is nothing to fail.
   */
  private async drain(): Promise<void> {
    try {
      await runWebhookDrain(this.adapter, this.registry, this.drainOptions);
    } catch (err) {
      this.logger?.warn?.(
        "webhook fast-path drain failed; the scheduled drain will retry",
        { error: err instanceof Error ? err.message : String(err) }
      );
    }
  }
}
