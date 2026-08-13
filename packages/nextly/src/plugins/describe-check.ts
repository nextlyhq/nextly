import type { PluginDefinition } from "./plugin-context";

/**
 * Plugins that ship without an `admin.description`.
 *
 * A description is the only thing that tells an operator what an installed
 * plugin is FOR. Without one every surface that lists plugins — the plugins
 * table, the dashboard section, the detail page — can show only the package
 * specifier, so `@nextlyhq/plugin-page-builder` appears where another plugin
 * shows "Build pages visually from blocks". The reader is left to infer the
 * purpose from a name chosen for npm rather than for them.
 *
 * Pure, and returns the names rather than logging them, so the caller decides
 * whether this is a boot warning, a CLI report, or a test assertion. The same
 * question asked from three places must not become three answers.
 *
 * Deliberately NOT an error. A missing description breaks nothing at runtime,
 * and failing a boot over it would punish an operator for a plugin author's
 * omission — they cannot fix a third-party package from their own config.
 *
 * @module plugins/describe-check
 */
export function pluginsMissingDescription(
  plugins: readonly PluginDefinition[]
): string[] {
  return plugins
    .filter(plugin => !plugin.admin?.description?.trim())
    .map(plugin => plugin.name);
}
