/**
 * Per-plugin custom-service registry.
 *
 * Plugins contribute service factories via `contributes.services`; the runtime
 * registers them here keyed by plugin name, and exposes them **lazily** as
 * `ctx.services.plugins.<name>.<svc>` and `nextly.plugins.<name>.<svc>`
 * — the same registry, two surfaces. Lazy resolution (a service factory
 * runs at most once, on first access) makes cross-plugin access order-
 * independent and never instantiates an unused service.
 *
 * `globalThis`-pinned + cleared per boot (like the route registry and the
 * subscription tracker, B2) so HMR re-registration never accumulates or leaks
 * stale instances.
 *
 * @module plugins/services/plugin-services-registry
 */

interface ServiceEntry {
  factory: () => unknown;
  instance?: unknown;
  resolved: boolean;
}

const globalForServices = globalThis as unknown as {
  __nextly_pluginServices?: Map<string, Map<string, ServiceEntry>>;
};

function store(): Map<string, Map<string, ServiceEntry>> {
  if (!globalForServices.__nextly_pluginServices) {
    globalForServices.__nextly_pluginServices = new Map();
  }
  return globalForServices.__nextly_pluginServices;
}

// Transient guard against a service factory resolving its own id (would recurse).
const resolving = new Set<string>();

/**
 * Register a plugin's service factory. `factory` should already be bound to the
 * plugin's context by the caller (the runtime registers `() => userFactory(ctx)`).
 * Re-registering the same key replaces the factory and drops any cached instance.
 */
export function registerPluginService(
  pluginName: string,
  svcName: string,
  factory: () => unknown
): void {
  const map = store();
  let svcs = map.get(pluginName);
  if (!svcs) {
    svcs = new Map();
    map.set(pluginName, svcs);
  }
  svcs.set(svcName, { factory, resolved: false });
}

/** Run a service factory once and cache it; `undefined` if not registered. */
function resolve(pluginName: string, svcName: string): unknown {
  const entry = store().get(pluginName)?.get(svcName);
  if (!entry) return undefined;
  if (entry.resolved) return entry.instance;

  const key = `${pluginName}:${svcName}`;
  if (resolving.has(key)) {
    throw new Error(
      `NEXTLY_PLUGIN_SERVICE_CYCLE: service "${svcName}" of plugin "${pluginName}" resolves itself during construction.`
    );
  }
  resolving.add(key);
  try {
    entry.instance = entry.factory();
    entry.resolved = true;
    return entry.instance;
  } finally {
    resolving.delete(key);
  }
}

/**
 * Build the lazy `plugins.<name>.<svc>` namespace. A Proxy reads the registry at
 * access time, so it reflects every registered service regardless of when the
 * namespace object was created (contexts are built before all services register).
 */
export function buildPluginServicesNamespace(): Record<
  string,
  Record<string, unknown>
> {
  return new Proxy(
    {},
    {
      get(_target, pluginName) {
        if (typeof pluginName !== "string") return undefined;
        return new Proxy(
          {},
          {
            get(_t, svcName) {
              if (typeof svcName !== "string") return undefined;
              return resolve(pluginName, svcName);
            },
            has(_t, svcName) {
              return (
                typeof svcName === "string" &&
                (store().get(pluginName)?.has(svcName) ?? false)
              );
            },
          }
        );
      },
      has(_target, pluginName) {
        return typeof pluginName === "string" && store().has(pluginName);
      },
    }
  );
}

/** Drop all registered plugin services (per-boot reset / HMR safety / tests). */
export function clearPluginServices(): void {
  store().clear();
  resolving.clear();
}
