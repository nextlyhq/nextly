/**
 * Plugin Event Bus (D8 / D51)
 *
 * A first-class, in-process event bus that is **typed, async, observe-only,
 * post-commit, and error-isolated**. Events are the *reaction* path — use a
 * hook (synchronous, in-transaction, can modify/abort) for must-happen work,
 * and an event to react/notify. Delivery is **best-effort**: a failing handler
 * is logged and isolated, never surfaced to the emitter (D51). A durable
 * backend may be added later (additive, like webhooks).
 *
 * Mirrors the {@link HookRegistry} `globalThis` singleton pattern so the bus
 * survives ESM module duplication under Next.js/Turbopack — without this,
 * subscriptions registered during `init()` would be lost on re-evaluation.
 *
 * @module events/event-bus
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { GeneratedTypes } from "../direct-api/types/shared";

/** Minimal logger shape used for isolated-failure diagnostics. */
interface EventLogger {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Event name.
 *
 * When generated types exist (run `nextly generate:types`), this narrows to the
 * union of known event names (per-collection `collection.*` events, the core
 * document/auth/media families, `plugin.initialized`, and each plugin's declared
 * `contributes.events`, D47). Without generated types it falls back to `string`
 * (same convention as `CollectionSlug`), so arbitrary names still emit/subscribe.
 */
export type EventName = GeneratedTypes extends { events: infer E }
  ? keyof E & string
  : string;

/** The envelope every handler receives. */
export interface EventEnvelope<P = unknown> {
  name: EventName;
  payload: P;
}

/** Observe-only event handler. Return value is ignored (cannot modify/abort). */
export type EventHandler<P = unknown> = (
  event: EventEnvelope<P>
) => void | Promise<void>;

/**
 * Reserved framework-emitted event prefixes. Emitting a name under one of these
 * never warns even if no plugin declared it (the host owns them).
 */
const RESERVED_EVENT_PREFIXES = [
  "plugin.",
  "collection.",
  "auth.",
  "document.",
  "media.",
  // Core emits `user.created` and `user.deleted`; a plugin declaring its own
  // event under this prefix would be indistinguishable from them.
  "user.",
];

/**
 * Whether an event name belongs to core.
 *
 * One answer for both questions it is asked: whether an emit needs a
 * declaration, and whether a plugin may emit it at all. A plugin emitting
 * `user.deleted` for a live user would make every listener act on a deletion
 * that never happened — unlinking an identity, dropping stored data — so the
 * per-plugin bus refuses these names, and core emits them through the raw bus.
 */
export function isReservedEventName(name: EventName): boolean {
  return RESERVED_EVENT_PREFIXES.some(prefix => name.startsWith(prefix));
}

export class EventBus {
  private handlers: Map<EventName, Set<EventHandler>> = new Map();
  private declaredEvents: Set<EventName> = new Set();
  private inFlight: Set<Promise<void>> = new Set();
  /**
   * The cause each in-flight handler is traced to, for those that have one:
   * the work run under {@link runCaused} emitted its event, directly or
   * through the handlers of events it emitted.
   */
  private readonly caused = new Map<Promise<void>, symbol>();
  /** The cause the calling async context runs under, when it has one. */
  private readonly causes = new AsyncLocalStorage<symbol>();
  private logger: EventLogger | undefined;

  /**
   * Provide a logger for isolated-failure diagnostics. Falls back to `console`
   * when unset. The runtime wires the resolved Nextly logger at boot.
   */
  setLogger(logger: EventLogger): void {
    this.logger = logger;
  }

  /**
   * Record custom event names declared via `contributes.events` (D9) so they
   * are introspectable and emit without a warning.
   */
  registerDeclaredEvents(names: EventName[]): void {
    for (const name of names) this.declaredEvents.add(name);
  }

  /** All declared custom event names (introspection). */
  getDeclaredEvents(): EventName[] {
    return [...this.declaredEvents];
  }

  /** Subscribe to an event. */
  on<P = unknown>(name: EventName, handler: EventHandler<P>): void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as EventHandler);
  }

  /** Unsubscribe a previously-registered handler. */
  off<P = unknown>(name: EventName, handler: EventHandler<P>): void {
    const set = this.handlers.get(name);
    if (!set) return;
    set.delete(handler as EventHandler);
    if (set.size === 0) this.handlers.delete(name);
  }

  /**
   * Emit an event. Fire-and-forget, observe-only, best-effort: handlers run in
   * registration order, each isolated so one failure never blocks the others
   * or the emitter (D51). Returns immediately — use {@link settle} in tests to
   * await in-flight async handlers.
   */
  emit<P = unknown>(name: EventName, payload: P): void {
    if (!this.isKnownName(name)) {
      const text = `[events] emitted undeclared event "${name}" — declare it in a plugin's contributes.events`;
      if (this.logger?.warn) this.logger.warn(text);
      else console.warn(text);
    }

    const set = this.handlers.get(name);
    if (!set || set.size === 0) return;

    const envelope: EventEnvelope<P> = { name, payload };
    // The emitter's cause, if it runs under one. Each handler is called here,
    // in the emitter's async context, so its own work inherits that cause,
    // and what it emits in turn, however late, is traced to it too.
    const cause = this.causes.getStore();
    // Snapshot so handlers that (un)subscribe during dispatch don't mutate the
    // set we're iterating.
    for (const handler of [...set]) {
      try {
        const result = handler(envelope);
        if (
          result &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          const tracked: Promise<void> = Promise.resolve(result).catch(err => {
            this.logError(name, err);
          });
          this.inFlight.add(tracked);
          if (cause !== undefined) this.caused.set(tracked, cause);
          void tracked.finally(() => {
            this.inFlight.delete(tracked);
            this.caused.delete(tracked);
          });
        }
      } catch (err) {
        this.logError(name, err);
      }
    }
  }

  /**
   * Run `work` so that every event it emits, and every event the handlers of
   * those emit in turn, is traced to `cause`, for {@link settleCaused}.
   */
  runCaused<T>(cause: symbol, work: () => T): T {
    return this.causes.run(cause, work);
  }

  /**
   * Await the handlers traced to `cause` until none is running, for at most
   * `timeoutMs`, for a caller about to tear the runtime down under them: the
   * plugin lifecycle command, after a plugin's `onInstall` or `onUninstall`.
   * A handler chain the work set off is drained however long it is, while a
   * producer started anywhere else, such as a plugin's `init()`, is not
   * waited for, since one its plugin stops only in `destroy()` would never let
   * the bus empty. Resolves true when every traced handler finished in time.
   */
  async settleCaused(cause: symbol, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const pending = [...this.caused]
        .filter(([, traced]) => traced === cause)
        .map(([promise]) => promise);
      if (pending.length === 0) return true;
      const left = deadline - Date.now();
      if (left <= 0) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), left);
      });
      try {
        const finished = await Promise.race([
          Promise.allSettled(pending).then(() => true),
          late,
        ]);
        if (!finished) return false;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Await all in-flight async handlers. **Testing aid** — production emit is
   * fire-and-forget. Drains repeatedly so handler chains that emit again
   * settle too.
   */
  async settle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  /** Remove all handlers and declared events. For testing/teardown. */
  clear(): void {
    this.handlers.clear();
    this.declaredEvents.clear();
    this.inFlight.clear();
    this.caused.clear();
  }

  private isKnownName(name: EventName): boolean {
    if (this.declaredEvents.has(name)) return true;
    return isReservedEventName(name);
  }

  private logError(name: EventName, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const text = `[events] handler for "${name}" failed: ${message}`;
    if (this.logger?.error) this.logger.error(text);
    else console.error(text);
  }
}

// Use globalThis to survive ESM module duplication in Next.js/Turbopack — the
// same guard the hook registry uses. Without it, each re-evaluation would
// create a new bus and drop subscriptions registered during registerServices().
const globalForEvents = globalThis as unknown as {
  __nextly_eventBus?: EventBus;
};

if (!globalForEvents.__nextly_eventBus) {
  globalForEvents.__nextly_eventBus = new EventBus();
}

const globalBus: EventBus = globalForEvents.__nextly_eventBus;

/** Get the global event bus singleton. Always use this for shared access. */
export function getEventBus(): EventBus {
  return globalBus;
}

/** Reset the global event bus (testing only). */
export function resetEventBus(): void {
  globalBus.clear();
}
