/**
 * The capabilities a plugin's own manifest cannot grant itself.
 *
 * A manifest is written by the plugin's author and changes with every update
 * of the plugin, so a capability that reaches beyond the plugin's own data
 * needs a second party: the app, which lists the plugins it allows to hold it
 * in `nextly.config.ts`. That list is in the app's own code review, so an
 * update cannot quietly widen what a plugin may do.
 *
 * One rule per capability, all checked here, so the boot and every CLI command
 * that resolves plugins refuse the same configuration with the same message.
 * Each rule names the config line that grants it, because the fix for a
 * refusal is always that line.
 *
 * This is not a sandbox: a plugin is trusted code in the app's process, and
 * its own code can still reach core's internals. The listing makes the grant
 * deliberate and reviewable.
 *
 * @module plugins/plugin-consent
 * @since 1.0.0
 */
import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";

/**
 * @experimental What the app grants plugins beyond their own manifests, by
 * plugin name. A plugin that declares one of these capabilities without being
 * listed for it refuses the boot.
 */
export interface PluginConsent {
  /**
   * Plugins allowed `capabilities.db.rawSql`: the live database handle at
   * `ctx.db.raw`. From `db.rawSqlPlugins` in `nextly.config.ts`.
   */
  rawSql: readonly string[];
}

/** No plugin is granted anything: what an app that lists nothing gets. */
export const NO_PLUGIN_CONSENT: PluginConsent = snapshotPluginConsent({
  rawSql: [],
});

/**
 * The grants an app's config makes.
 *
 * Read from the config as the app wrote it, before any plugin's `setup`
 * transformer runs: a transformer is plugin code, and one that could add its
 * own name here would grant itself the capability the listing exists to
 * withhold.
 */
export function pluginConsentFromConfig(config: {
  db?: { rawSqlPlugins?: readonly string[] };
}): PluginConsent {
  return snapshotPluginConsent({ rawSql: config.db?.rawSqlPlugins ?? [] });
}

/**
 * A copy of `consent` that nothing can change: the object and every list in
 * it are new and frozen.
 *
 * The boot judges the declared list and the transformed list against the
 * same grants, and plugin code runs between the two. A grant that plugin code
 * could reach and push onto would let a plugin list itself between the
 * checks, so the boot holds this copy rather than the caller's object.
 */
export function snapshotPluginConsent(consent: PluginConsent): PluginConsent {
  return Object.freeze({ rawSql: Object.freeze([...consent.rawSql]) });
}

/** One capability that needs the app's consent. */
interface ConsentRule {
  /** The manifest key, as an author writes it. */
  capability: string;
  /** What holding it gives the plugin, for the refusal. */
  grants: string;
  /** Whether a plugin's manifest declares the capability. */
  declares: (plugin: PluginDefinition) => boolean;
  /** The names the app lists for it. */
  listed: (consent: PluginConsent) => readonly string[];
  /** The `nextly.config.ts` line that lists exactly `names`. */
  configLine: (names: readonly string[]) => string;
}

const CONSENT_RULES: readonly ConsentRule[] = [
  {
    capability: "capabilities.db.rawSql",
    grants: "the live database handle at ctx.db.raw, which reaches every table",
    declares: plugin => plugin.capabilities?.db?.rawSql === true,
    listed: consent => consent.rawSql,
    configLine: names =>
      `db: { rawSqlPlugins: [${names.map(name => JSON.stringify(name)).join(", ")}] }`,
  },
];

/**
 * Refuse the boot when an enabled plugin declares a capability the app has
 * not listed it for.
 *
 * Every unlisted plugin is named at once, with the whole line to write: the
 * names already listed plus the missing ones, so pasting it fixes the
 * configuration in one edit. A disabled plugin is skipped, as every other
 * manifest check skips it: it runs nothing, so it holds nothing.
 */
export function assertPluginConsent(
  plugins: readonly PluginDefinition[],
  consent: PluginConsent
): void {
  for (const rule of CONSENT_RULES) {
    const listed = rule.listed(consent);
    const unlisted = plugins
      .filter(plugin => plugin.enabled !== false && rule.declares(plugin))
      .map(plugin => plugin.name)
      .filter(name => !listed.includes(name));
    if (unlisted.length === 0) continue;
    const line = rule.configLine([...new Set([...listed, ...unlisted])]);
    const who =
      unlisted.length === 1
        ? `Plugin "${unlisted[0]}" declares`
        : `Plugins ${unlisted.map(name => `"${name}"`).join(", ")} declare`;
    throw resolutionError(
      "capability-not-listed",
      `${who} ${rule.capability}, which grants ${rule.grants}, but the app does not list ${unlisted.length === 1 ? "it" : "them"}. ` +
        `Review the plugin, then add this line to nextly.config.ts: ${line}`,
      { plugins: unlisted, capability: rule.capability, configLine: line }
    );
  }
}
