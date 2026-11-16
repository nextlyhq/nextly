/**
 * A development warning for an outbound call made from the in-transaction
 * phase.
 *
 * The phase may run more than once for one write: a version-conflict retry
 * runs it again, and a rollback discards what it wrote. A database write
 * through the handler's `db` is undone with the attempt; a request to another
 * service is not, so a handler that sends one may send it twice, or for a
 * write that never commits. Nothing can stop the call, so this says so, once
 * per handler owner, while the plugin is being written.
 *
 * Calls are seen through `node:diagnostics_channel`: `undici:request:create`,
 * which the runtime's `fetch` publishes, and `http.client.request.start`,
 * which `http.request` and `https.request` publish. The owner of the running
 * handler travels in an AsyncLocalStorage set around it, so a call made
 * anywhere beneath the handler is attributed to it, and one made elsewhere is
 * not.
 *
 * Loaded with the phase itself, so a process that registers no in-transaction
 * handler never loads it. Outside development it subscribes to nothing.
 *
 * @module hooks/in-transaction-outbound
 */
import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";

/** The channels an outbound request is published on. */
const OUTBOUND_CHANNELS = [
  "undici:request:create",
  "http.client.request.start",
] as const;

/** What the warning is written through: the core logger's `warn`. */
export interface OutboundWarningLogger {
  warn(payload: object): void;
}

/** The owner of the in-transaction handler running in this flow, if any. */
const runningHandler = new AsyncLocalStorage<string>();

/** Owners already warned, so a handler that calls out often warns once. */
const warnedOwners = new Set<string>();

/** The live subscription, or undefined while nothing is watched. */
let watching:
  | { logger: OutboundWarningLogger; listener: (message: unknown) => void }
  | undefined;

/**
 * Where a request was going, as a host: never the path or the query, which
 * can carry a token.
 */
function targetOf(message: unknown): string {
  const request = (message as { request?: unknown } | null)?.request;
  if (typeof request !== "object" || request === null) return "unknown";
  // `fetch` (undici) names the origin; `http.request` names the host.
  const { origin, host } = request as { origin?: unknown; host?: unknown };
  if (typeof origin === "string") {
    try {
      return new URL(origin).host;
    } catch {
      return "unknown";
    }
  }
  return typeof host === "string" ? host : "unknown";
}

/**
 * Start watching for outbound calls made from an in-transaction handler, in
 * development only. Idempotent: a second call keeps the one subscription and
 * writes through the logger it was handed last.
 */
export function watchOutboundCalls(logger: OutboundWarningLogger): void {
  if (process.env.NODE_ENV !== "development") return;
  if (watching) {
    watching.logger = logger;
    return;
  }
  const listener = (message: unknown): void => {
    const owner = runningHandler.getStore();
    if (owner === undefined || warnedOwners.has(owner) || !watching) return;
    warnedOwners.add(owner);
    watching.logger.warn({
      kind: "in-transaction-outbound-call",
      owner,
      target: targetOf(message),
      message:
        `An in-transaction handler registered by "${owner}" made an outbound call. ` +
        "The phase runs again when the write is retried, and its work is discarded " +
        "when the write rolls back, so the call may be repeated or made for a write " +
        "that never happens. Make it from an after-commit hook or an event instead.",
    });
  };
  for (const name of OUTBOUND_CHANNELS) {
    diagnosticsChannel.subscribe(name, listener);
  }
  watching = { logger, listener };
}

/** Run `work` as the in-transaction handler `owner` registered. */
export function runWatched<T>(owner: string, work: () => T): T {
  return runningHandler.run(owner, work);
}

/**
 * Stop watching and forget who was warned, so a test can start from nothing.
 *
 * @internal
 */
export function stopWatchingOutboundCalls(): void {
  if (watching) {
    for (const name of OUTBOUND_CHANNELS) {
      diagnosticsChannel.unsubscribe(name, watching.listener);
    }
  }
  watching = undefined;
  warnedOwners.clear();
}
