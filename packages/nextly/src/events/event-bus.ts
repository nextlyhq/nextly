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

/** Minimal logger shape used for isolated-failure diagnostics. */
interface EventLogger {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
}

/** Event name. Loosely typed in P1; codegen-typed names land with D47/P6. */
export type EventName = string;

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
const RESERVED_EVENT_PREFIXES = ["plugin.", "collection.", "auth."];

export class EventBus {
  private handlers: Map<EventName, Set<EventHandler>> = new Map();
  private declaredEvents: Set<EventName> = new Set();
  private inFlight: Set<Promise<void>> = new Set();
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
          void tracked.finally(() => {
            this.inFlight.delete(tracked);
          });
        }
      } catch (err) {
        this.logError(name, err);
      }
    }
  }

  /**
   * Await all in-flight async handlers. **Testing aid** — production emit is
   * fire-and-forget. Drains repeatedly so handler chains that emit again settle
   * too.
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
  }

  private isKnownName(name: EventName): boolean {
    if (this.declaredEvents.has(name)) return true;
    return RESERVED_EVENT_PREFIXES.some(prefix => name.startsWith(prefix));
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
