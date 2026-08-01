/**
 * Which plugins actually ran their `init`.
 *
 * A config reload re-reads the config but never re-runs service registration,
 * so it cannot initialize a plugin: no `init`, no contributed services, no
 * `ctx.hooks.on` subscriptions. Flipping `enabled: false` to `true` in
 * `nextly.config.ts` therefore produces a plugin the config calls enabled and
 * the process never started -- and registering the hooks its collections
 * declare would put handlers live that expect services which do not exist.
 *
 * Recorded at boot so the reload can tell "enabled" from "running" and decline
 * to half-start one. A full restart is what actually enables a plugin.
 *
 * On globalThis, like the other boot-time registries, so it survives the module
 * re-evaluation Next.js and Turbopack do.
 *
 * @module plugins/initialized-plugins
 */

const globalForInitializedPlugins = globalThis as unknown as {
  __nextly_initializedPlugins?: Set<string>;
};

/** Replace the set of plugins whose `init` has run in this process. */
export function setInitializedPlugins(names: Iterable<string>): void {
  globalForInitializedPlugins.__nextly_initializedPlugins = new Set(names);
}

/**
 * The plugins whose `init` has run.
 *
 * Absent when service registration has not happened yet, which a caller must
 * read as "unknown" rather than "none": treating it as none would let a reload
 * that arrives before boot completes decide every plugin is unstarted.
 */
export function getInitializedPlugins(): ReadonlySet<string> | undefined {
  return globalForInitializedPlugins.__nextly_initializedPlugins;
}
