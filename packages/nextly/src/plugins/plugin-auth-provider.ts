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

import {
  bootNameOf,
  NO_PLUGIN_GRANTS,
  type PluginGrants,
} from "./plugin-consent";
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
 * what the boot granted it.
 *
 * Finishing a login mints a session for whatever account the plugin names,
 * so it is a reach an operator must be able to see before installing the
 * plugin. Two rules make it one:
 *
 * - The boot must have granted the plugin the login capability. `grants` is
 *   the verdict decided once, when the boot resolved the plugin list, from
 *   the manifest as it stood and the app's `auth.loginPlugins` listing. The
 *   live definition is NOT read here: `init` runs as a method on it, so a
 *   plugin that booted without the capability could flip its own flag on and
 *   then call. `ctx.db.raw` is held to its grant the same way.
 * - The grant check answers to the name the boot resolved, snapshotted here
 *   beside the prefix, not to `plugin.name` reread at call time: the same
 *   method call could rename an unlisted plugin onto a listed one and borrow
 *   its grant. The snapshot and the verdict travel together.
 * - The strategy name must be the plugin's own slug, a colon, and a name for
 *   the method. The audit rows record the strategy, and it travels in the
 *   pending token through a second factor, so this is what says WHICH plugin
 *   signed someone in, and how. It also means a plugin cannot record its login
 *   as `password`, which both disguised it and switched the password lockout
 *   back on. A bare `slug:` names the plugin but no method, so a plugin with
 *   two ways in could not be told apart on the rows; it is refused too.
 *
 * A context built outside a boot holds no verdict (`NO_PLUGIN_GRANTS`), so it
 * holds no grant either. Built per context and cheap: the shared instance is
 * looked up on each call, so a config reload that rebuilds it is picked up.
 */
export function getPluginAuthApiFor(
  plugin: PluginDefinition,
  grants: PluginGrants = NO_PLUGIN_GRANTS
): PluginAuthApi {
  // The boot-time name, recorded when the grants were decided: `init`
  // mutates the definition in place, so a name read from it at call time
  // would be whatever the plugin made it.
  const pluginName = bootNameOf(plugin);
  const prefix = `${pluginAdminSlug(pluginName)}:`;
  return {
    currentUser: request => getPluginAuthApi().currentUser(request),
    verifyCsrf: request => getPluginAuthApi().verifyCsrf(request),
    // Async, so a refusal arrives as a rejected promise like every other
    // outcome of this call rather than as a synchronous throw.
    completeLogin: async (userId, opts) => {
      // Programming errors in the plugin, not login outcomes, so they throw
      // where the author sees them rather than redirecting a person to a
      // generic failure.
      if (!grants.login.includes(pluginName)) {
        throw NextlyError.forbidden({
          logContext: {
            reason: "plugin-login-undeclared",
            plugin: pluginName,
            hint: "declare capabilities.auth.login and be listed in auth.loginPlugins to call ctx.auth.completeLogin",
          },
        });
      }
      // Longer than the prefix as well as starting with it: the part after
      // the colon is the method's name, and an empty one is no name. What the
      // name may contain is the shared rule's, applied once the call reaches
      // the shared instance.
      if (
        typeof opts?.strategy !== "string" ||
        !opts.strategy.startsWith(prefix) ||
        opts.strategy.length === prefix.length
      ) {
        throw NextlyError.validation({
          errors: [
            {
              path: "strategy",
              code: "INVALID",
              message: `A plugin's strategy name must be "${prefix}" followed by a name for the method.`,
            },
          ],
          logContext: { plugin: pluginName },
        });
      }
      return getPluginAuthApi().completeLogin(userId, opts);
    },
  };
}
