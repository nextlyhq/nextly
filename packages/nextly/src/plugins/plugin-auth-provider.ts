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

import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";

let memoized: PluginAuthApi | undefined;

/**
 * How the provider reaches the auth router dependencies.
 *
 * Injected rather than imported so this module does not depend on the DI
 * container, which depends on the plugin context in turn.
 */
let resolveDeps: (() => CompleteLoginDeps) | undefined;

/**
 * The dependencies the resolver built, kept until the resolver changes.
 *
 * Building them assembles every plugin context, the hook registries and the
 * served auth UI, and doing that on every `completeLogin` and `currentUser`
 * call made the cheapest question — who is signed in — pay for all of it.
 */
let resolvedDeps: CompleteLoginDeps | undefined;

/** Register how to build the auth dependencies. Called once, during boot. */
export function setPluginAuthDepsResolver(
  resolver: () => CompleteLoginDeps
): void {
  resolveDeps = resolver;
  // A new resolver means the container was rebuilt, so both memos describe
  // the previous one. Dropped here rather than left for the next reload, or
  // hooks added by a config reload would never apply.
  memoized = undefined;
  resolvedDeps = undefined;
}

/** Drop the memos so the next call rebuilds. Used when the config reloads. */
export function resetPluginAuthApi(): void {
  memoized = undefined;
  resolvedDeps = undefined;
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
      resolvedDeps ??= resolveDeps();
      return resolvedDeps;
    });
  }
  return memoized;
}

/**
 * `ctx.auth` for one plugin: the shared instance, with `completeLogin` held to
 * what the plugin declared.
 *
 * Finishing a login mints a session for whatever account the plugin names,
 * so it is a reach an operator must be able to see before installing the
 * plugin. Two rules make it one:
 *
 * - The plugin must declare `capabilities.auth.login`. Without it, any
 *   installed plugin could sign anyone in from any route it mounts, and the
 *   manifest review would show nothing.
 * - The strategy name must begin with the plugin's own slug and a colon. The
 *   audit rows record the strategy, and it travels in the pending token
 *   through a second factor, so this is what says WHICH plugin signed someone
 *   in. It also means a plugin cannot record its login as `password`, which
 *   both disguised it and switched the password lockout back on.
 *
 * Built per context and cheap: the shared instance is looked up on each call,
 * so a config reload that rebuilds it is picked up.
 */
export function getPluginAuthApiFor(plugin: PluginDefinition): PluginAuthApi {
  const prefix = `${pluginAdminSlug(plugin.name)}:`;
  return {
    currentUser: request => getPluginAuthApi().currentUser(request),
    verifyCsrf: request => getPluginAuthApi().verifyCsrf(request),
    // Async, so a refusal arrives as a rejected promise like every other
    // outcome of this call rather than as a synchronous throw.
    completeLogin: async (userId, opts) => {
      // Programming errors in the plugin, not login outcomes, so they throw
      // where the author sees them rather than redirecting a person to a
      // generic failure.
      if (plugin.capabilities?.auth?.login !== true) {
        throw NextlyError.forbidden({
          logContext: {
            reason: "plugin-login-undeclared",
            plugin: plugin.name,
            hint: "declare capabilities.auth.login to call ctx.auth.completeLogin",
          },
        });
      }
      if (
        typeof opts?.strategy !== "string" ||
        !opts.strategy.startsWith(prefix)
      ) {
        throw NextlyError.validation({
          errors: [
            {
              path: "strategy",
              code: "INVALID",
              message: `A plugin's strategy name must begin with "${prefix}".`,
            },
          ],
          logContext: { plugin: plugin.name },
        });
      }
      return getPluginAuthApi().completeLogin(userId, opts);
    },
  };
}
