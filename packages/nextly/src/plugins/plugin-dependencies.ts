/**
 * The plugins each plugin depends on, as the config in force declares them.
 *
 * A plugin's `ctx.db` may reach another plugin's tables only when it declares
 * that plugin in `dependsOn` or `optionalDependsOn`. Its context is built once,
 * at `init`, and a config reload never runs `init` again, so a set captured
 * then kept the dependencies the plugin booted with: a reload that removed one
 * left the plugin reading and writing the tables the new config had taken
 * away. The boot publishes the declarations here, a reload republishes them
 * when it commits, and `ctx.db` reads them on every access.
 *
 * On globalThis, like the other boot-time registries, so it survives the module
 * re-evaluation Next.js and Turbopack do.
 *
 * @module plugins/plugin-dependencies
 */
import type { PluginDefinition } from "./plugin-context";

const globalForDependencies = globalThis as unknown as {
  __nextly_pluginDependencies?: ReadonlyMap<string, ReadonlySet<string>>;
};

const NONE: ReadonlySet<string> = new Set();

/** The plugins a manifest declares it depends on, required and optional. */
export function declaredDependencies(
  plugin: Pick<PluginDefinition, "dependsOn" | "optionalDependsOn">
): ReadonlySet<string> {
  return new Set([
    ...Object.keys(plugin.dependsOn ?? {}),
    ...Object.keys(plugin.optionalDependsOn ?? {}),
  ]);
}

/** Make `plugins`' declarations the ones in force. */
export function publishPluginDependencies(
  plugins: readonly PluginDefinition[]
): void {
  globalForDependencies.__nextly_pluginDependencies = new Map(
    plugins.map(plugin => [plugin.name, declaredDependencies(plugin)])
  );
}

/** Forget what was published, as a process whose services were cleared. */
export function clearPluginDependencies(): void {
  globalForDependencies.__nextly_pluginDependencies = undefined;
}

/**
 * The plugins `plugin` depends on now.
 *
 * Its own manifest's declaration until anything has been published, which is
 * the context's first moments in a boot that has not reached the publish yet.
 * Once something has, the published config decides: a plugin it no longer
 * lists declares nothing in it, and so depends on nothing.
 */
export function currentDependencies(
  plugin: PluginDefinition
): ReadonlySet<string> {
  const published = globalForDependencies.__nextly_pluginDependencies;
  if (published === undefined) return declaredDependencies(plugin);
  return published.get(plugin.name) ?? NONE;
}
