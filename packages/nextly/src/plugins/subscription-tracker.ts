/**
 * Per-plugin subscription tracker (B2).
 *
 * Plugins subscribe to events/hooks in `init()`. The {@link EventBus} and
 * {@link HookRegistry} are `globalThis` singletons that survive Next.js HMR
 * module re-evaluation, so re-running `init()` would stack a *second* handler on
 * top of the first and the plugin would double-fire — which is why first-party
 * plugins used to hand-roll `globalThis` guards.
 *
 * Instead, the plugin context records an unsubscribe thunk per subscription
 * (keyed by plugin name), and the runtime clears a plugin's prior subscriptions
 * before it re-initializes — mirroring the route registry's clear-and-rebuild
 * pattern. The registry itself is pinned to `globalThis` so it survives HMR
 * alongside the buses it tracks.
 *
 * Only subscriptions made through a plugin context are tracked; core (non-plugin)
 * subscriptions are untouched.
 *
 * @module plugins/subscription-tracker
 */

const globalForSubs = globalThis as unknown as {
  __nextly_pluginSubscriptions?: Map<string, Array<() => void>>;
};

function store(): Map<string, Array<() => void>> {
  if (!globalForSubs.__nextly_pluginSubscriptions) {
    globalForSubs.__nextly_pluginSubscriptions = new Map();
  }
  return globalForSubs.__nextly_pluginSubscriptions;
}

/** Record an unsubscribe thunk for a subscription made by `pluginName`. */
export function recordPluginSubscription(
  pluginName: string,
  undo: () => void
): void {
  const map = store();
  const list = map.get(pluginName) ?? [];
  list.push(undo);
  map.set(pluginName, list);
}

/**
 * Run and drop every recorded unsubscribe thunk for one plugin — or for all
 * plugins when `pluginName` is omitted. Each teardown is isolated so one failure
 * can't block the rest (mirrors plugin destroy isolation, D7).
 */
export function clearPluginSubscriptions(pluginName?: string): void {
  const map = store();
  const run = (list: Array<() => void> | undefined) => {
    for (const undo of list ?? []) {
      try {
        undo();
      } catch {
        // Isolated — a failed teardown can't block the others.
      }
    }
  };
  if (pluginName === undefined) {
    for (const list of map.values()) run(list);
    map.clear();
    return;
  }
  run(map.get(pluginName));
  map.delete(pluginName);
}
