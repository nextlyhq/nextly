/**
 * The one `ctx.auth` every plugin context shares.
 *
 * Built once per process rather than per context, because `runPluginRoute`
 * spreads the base context on every request and a per-context instance would
 * rebuild the auth router dependencies on each one.
 *
 * Its dependencies resolve on FIRST CALL, not at construction: contexts are
 * built while services are still being registered, and asking for the auth
 * router then would fail on a container that is not ready yet.
 *
 * @module plugins/plugin-auth-provider
 * @since 1.0.0
 */
import {
  createPluginAuthApi,
  type CompleteLoginDeps,
  type PluginAuthApi,
} from "../auth/plugin-auth-api";
import { NextlyError } from "../errors/nextly-error";

let memoized: PluginAuthApi | undefined;

/**
 * How the provider reaches the auth router dependencies.
 *
 * Injected rather than imported so this module does not depend on the DI
 * container, which depends on the plugin context in turn.
 */
let resolveDeps: (() => CompleteLoginDeps) | undefined;

/** Register how to build the auth dependencies. Called once, during boot. */
export function setPluginAuthDepsResolver(
  resolver: () => CompleteLoginDeps
): void {
  resolveDeps = resolver;
  // A new resolver means the container was rebuilt, so the memo describes the
  // previous one. Dropped here rather than left for the next reload, or hooks
  // added by a config reload would never apply.
  memoized = undefined;
}

/** Drop the memo so the next call rebuilds. Used when the config reloads. */
export function resetPluginAuthApi(): void {
  memoized = undefined;
}

/** The shared `ctx.auth`. */
export function getPluginAuthApi(): PluginAuthApi {
  if (!memoized) {
    memoized = createPluginAuthApi(() => {
      if (!resolveDeps) {
        throw NextlyError.internal({
          logContext: {
            reason:
              "ctx.auth was used before the auth router was available; this is " +
              "a boot-order problem in Nextly rather than in the plugin",
          },
        });
      }
      return resolveDeps();
    });
  }
  return memoized;
}
