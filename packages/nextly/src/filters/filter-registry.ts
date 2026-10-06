/**
 * Filter Registry (D63)
 *
 * A typed, async, error-isolated filter and action registry that follows the
 * WordPress-style filter/action model. Filters transform a value (threading it
 * through each registered handler); actions fire for side effects only.
 *
 * Both filters and actions are **error-isolated**: a throwing handler is logged
 * and skipped; the value/execution continues with the remaining handlers.
 *
 * Mirrors the {@link EventBus} and {@link HookRegistry} `globalThis` singleton
 * pattern so the registry survives ESM module duplication under Next.js/Turbopack.
 *
 * @module filters/filter-registry
 */

/**
 * @experimental The seam/registry key used by BOTH filters and actions (D63).
 * Pass this as the `name` argument to `addFilter`, `addAction`, `applyFilters`,
 * `runActions`, and `removeFilter`/`removeAction`.
 */
export type FilterName = string;

/** @experimental A value-transforming handler registered via {@link FilterRegistry.addFilter} (D63). */
export type Filter<V = unknown, C = unknown> = (
  value: V,
  context: C
) => V | Promise<V>;

/** @experimental A side-effect handler registered via {@link FilterRegistry.addAction} (D63). */
export type Action<P = unknown, C = unknown> = (
  payload: P,
  context: C
) => void | Promise<void>;

/**
 * A veto point's verdict.
 *
 * A decision is a VALUE rather than a thrown refusal because filters are
 * error-isolated — a handler that vetoed by throwing would be skipped, and the
 * chain would come back allow.
 */
export type Decision = { allow: true } | { allow: false; reason: string };

/**
 * A verdict as a fresh {@link Decision}, or null when it is not one.
 *
 * Only a boolean `allow` is read as a verdict: a string, a number, or an
 * object with no `allow` is malformed, never "truthy enough". A denial with
 * no usable reason is given one, so a denial always says something.
 */
function normaliseDecision(raw: unknown): Decision | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { allow, reason } = raw as { allow?: unknown; reason?: unknown };
  if (allow === true) return { allow: true };
  if (allow === false) {
    return {
      allow: false,
      reason: typeof reason === "string" && reason !== "" ? reason : "denied",
    };
  }
  return null;
}

/** @experimental Minimal logger shape for filter/action error diagnostics (D63). */
export interface FilterLogger {
  warn?(message: string, meta?: unknown): void;
  error?(message: string, meta?: unknown): void;
}

/**
 * @experimental Typed, async, error-isolated filter and action registry (D63).
 *
 * Filters thread a value through each registered handler in registration order;
 * actions fire for side effects only. A throwing handler is logged and skipped —
 * the value/execution continues with the remaining handlers.
 */
export class FilterRegistry {
  private filters = new Map<FilterName, Filter[]>();
  private actions = new Map<FilterName, Action[]>();
  private logger?: FilterLogger;

  setLogger(logger: FilterLogger): void {
    this.logger = logger;
  }

  addFilter<V = unknown, C = unknown>(
    name: FilterName,
    fn: Filter<V, C>
  ): void {
    let list = this.filters.get(name);
    if (!list) {
      list = [];
      this.filters.set(name, list);
    }
    list.push(fn as Filter);
  }

  removeFilter<V = unknown, C = unknown>(
    name: FilterName,
    fn: Filter<V, C>
  ): void {
    const list = this.filters.get(name);
    if (!list) return;
    const idx = list.indexOf(fn as Filter);
    if (idx > -1) list.splice(idx, 1);
    if (list.length === 0) this.filters.delete(name);
  }

  async applyFilters<V = unknown, C = unknown>(
    name: FilterName,
    value: V,
    context: C
  ): Promise<V> {
    const list = this.filters.get(name);
    if (!list || list.length === 0) return value;

    let acc = value;
    for (const fn of [...list]) {
      try {
        acc = await (fn as Filter<V, C>)(acc, context);
      } catch (err) {
        this.logError("filter", name, err);
        // keep acc as it was before this throwing filter
      }
    }
    return acc;
  }

  /**
   * Run a chain of handlers that VETO rather than transform.
   *
   * Ordinary filters are error-isolated: a throwing handler is logged and
   * skipped so one bad plugin cannot break a seam. That is right for
   * transforming a value and exactly wrong for deciding whether something is
   * allowed — a crashing "deny" would be skipped, and the answer would come
   * back allow. A veto has to fail CLOSED.
   *
   * Two rules make that true:
   *  - a handler that throws denies, and stops the chain;
   *  - a handler may keep or DOWNGRADE the decision, never upgrade it. Once
   *    something has said no, a later handler cannot overrule it, so the order
   *    plugins happen to load in cannot decide access.
   *
   * Every verdict is NORMALISED, because the types do not reach a JavaScript
   * plugin or an `as any` return: `{ allow: "false" }` or `{ allow: 1 }` came
   * back unchanged, and a caller testing `if (verdict.allow)` allowed. So
   * `undefined` keeps the prior verdict, `allow: true` and `allow: false` are
   * read as said, and anything else denies with `"malformed-decision"` and
   * stops the chain. The FIRST denial's reason is the one kept, whatever a
   * later handler returns or throws. What comes back is always a fresh
   * `{ allow: boolean; reason?: string }`.
   */
  async applyDecision<C = unknown>(
    name: FilterName,
    initial: Decision,
    context: C
  ): Promise<Decision> {
    let decision = normaliseDecision(initial) ?? {
      allow: false,
      reason: "malformed-decision",
    };
    const list = this.filters.get(name);
    if (!list || list.length === 0) return decision;

    for (const fn of [...list]) {
      const step = await this.runDecisionHandler(
        fn as Filter<Decision, C>,
        name,
        decision,
        context
      );
      decision = step.decision;
      if (step.stop) return decision;
    }
    return decision;
  }

  /**
   * One handler's turn in a decision chain: the verdict after it, and whether
   * the chain stops there.
   */
  private async runDecisionHandler<C>(
    fn: Filter<Decision, C>,
    name: FilterName,
    prior: Decision,
    context: C
  ): Promise<{ decision: Decision; stop: boolean }> {
    // A COPY of the verdict goes in, never the authoritative object: a
    // JavaScript handler can rewrite `allow` in place, and the mutated input
    // would then read as true on BOTH sides of the upgrade check below — the
    // denial overturned by the very object that carried it.
    let raw: unknown;
    try {
      raw = await fn({ ...prior }, context);
    } catch (err) {
      this.logError("decision", name, err);
      return { decision: deniedFrom(prior, "hook-error"), stop: true };
    }

    if (raw === undefined || raw === null)
      return { decision: prior, stop: false };
    const next = normaliseDecision(raw);
    if (!next) {
      this.logger?.warn?.(
        `[nextly] A decision handler for "${name}" returned a malformed verdict; denied.`
      );
      return { decision: deniedFrom(prior, "malformed-decision"), stop: true };
    }

    // A denial is final. A later denial keeps the first reason, which is the
    // one that decided the outcome; a later allow is logged rather than
    // silently ignored, because a plugin trying to overrule a denial is a
    // mistake worth seeing, and letting it through would make the verdict
    // depend on load order.
    if (!prior.allow) {
      if (next.allow) {
        this.logger?.warn?.(
          `[nextly] A decision handler for "${name}" tried to overrule a denial; ignored.`
        );
      }
      return { decision: prior, stop: false };
    }
    return { decision: next, stop: false };
  }

  addAction<P = unknown, C = unknown>(
    name: FilterName,
    fn: Action<P, C>
  ): void {
    let list = this.actions.get(name);
    if (!list) {
      list = [];
      this.actions.set(name, list);
    }
    list.push(fn as Action);
  }

  removeAction<P = unknown, C = unknown>(
    name: FilterName,
    fn: Action<P, C>
  ): void {
    const list = this.actions.get(name);
    if (!list) return;
    const idx = list.indexOf(fn as Action);
    if (idx > -1) list.splice(idx, 1);
    if (list.length === 0) this.actions.delete(name);
  }

  async runActions<P = unknown, C = unknown>(
    name: FilterName,
    payload: P,
    context: C
  ): Promise<void> {
    const list = this.actions.get(name);
    if (!list || list.length === 0) return;

    for (const fn of [...list]) {
      try {
        await (fn as Action<P, C>)(payload, context);
      } catch (err) {
        this.logError("action", name, err);
        // isolate and continue with the next action
      }
    }
  }

  clear(): void {
    this.filters.clear();
    this.actions.clear();
  }

  hasFilters(name: FilterName): boolean {
    return (this.filters.get(name)?.length ?? 0) > 0;
  }

  hasActions(name: FilterName): boolean {
    return (this.actions.get(name)?.length ?? 0) > 0;
  }

  private logError(
    kind: "filter" | "action" | "decision",
    name: string,
    err: unknown
  ): void {
    const message = err instanceof Error ? err.message : String(err);
    const text = `[filters] ${kind} for "${name}" threw and was ${kind === "filter" ? "skipped" : "isolated"}: ${message}`;
    if (this.logger?.error) this.logger.error(text, err);
    else console.error(text, err);
  }
}

// Use globalThis to survive ESM module duplication in Next.js/Turbopack — the
// same guard the event bus and hook registry use. Without it, each re-evaluation
// would create a new registry, losing all registered filters and actions.
const globalForFilters = globalThis as unknown as {
  __nextly_filterRegistry?: FilterRegistry;
};

if (!globalForFilters.__nextly_filterRegistry) {
  globalForFilters.__nextly_filterRegistry = new FilterRegistry();
}

const globalFilters: FilterRegistry = globalForFilters.__nextly_filterRegistry;

/** Get the global filter registry singleton. Always use this for shared access. */
export function getFilterRegistry(): FilterRegistry {
  return globalFilters;
}

/** Reset the global filter registry (testing only). */
export function resetFilterRegistry(): void {
  globalFilters.clear();
}

/** A denial for `reason`, unless the verdict already denies, which it keeps. */
function deniedFrom(prior: Decision, reason: string): Decision {
  return prior.allow ? { allow: false, reason } : prior;
}
