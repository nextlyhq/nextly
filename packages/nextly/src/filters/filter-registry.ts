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
    kind: "filter" | "action",
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
