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
import { copyPlainValues, isPlainObject } from "../shared/lib/plain-copy";

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

/**
 * The definition members that are a plugin's own code, read by reference.
 * `contributes` is code too, and is recorded leaf by leaf (`pluginCode`).
 */
const PLUGIN_CODE_KEYS = [
  "init",
  "destroy",
  "setup",
  "onReady",
  "onInstall",
  "onUninstall",
] as const satisfies readonly (keyof PluginDefinition)[];

/**
 * A copy of each definition that plugin code cannot reach back through.
 *
 * Plain objects and arrays are rebuilt and functions kept, so editing a copy
 * in place, its `capabilities` or `contributes` included, changes nothing the
 * app or the boot holds. An accessor is read once, here, so a manifest that
 * answers differently on a later read is judged on what the copy recorded.
 * A definition that is not a plain object keeps its own data and, read
 * through its prototype, its lifecycle methods.
 */
export function copyPluginDefinitions(
  plugins: readonly PluginDefinition[]
): PluginDefinition[] {
  return plugins.map(plugin => {
    if (isPlainObject(plugin)) return copyPlainValues(plugin);
    const copy = copyPlainValues({ ...plugin });
    for (const key of PLUGIN_CODE_KEYS) {
      const code: unknown = plugin[key];
      if (typeof code === "function") Object.assign(copy, { [key]: code });
    }
    return copy;
  });
}

/**
 * What one configured plugin was before any `setup` transformer ran, as
 * frozen data: its name, the capabilities its manifest declared that need
 * the app's consent, and its own code.
 */
export interface PreSetupPlugin {
  readonly name: string;
  /** The `CONSENT_RULES` capabilities the manifest declared. */
  readonly declares: readonly string[];
  /**
   * The plugin's code as `[path, value]` pairs: each lifecycle function by
   * reference, and every leaf of `contributes` (a function or other object
   * by reference, a primitive by value) under its path.
   */
  readonly code: readonly (readonly [string, unknown])[];
}

/**
 * Record each plugin as it stands before any `setup` transformer runs.
 *
 * Plain data, frozen, rather than the definitions: a transformer receives
 * definitions, and anything it can reach it can edit in place. The checks
 * after the transformers compare the transformed list with this record, so
 * what a transformer does to the objects it was given cannot change what the
 * record says the app configured.
 */
export function recordPreSetupPlugins(
  plugins: readonly PluginDefinition[]
): readonly PreSetupPlugin[] {
  return Object.freeze(
    plugins.map(plugin =>
      Object.freeze({
        name: plugin.name,
        declares: Object.freeze(
          CONSENT_RULES.filter(rule => rule.declares(plugin)).map(
            rule => rule.capability
          )
        ),
        code: pluginCode(plugin),
      })
    )
  );
}

/**
 * A plugin's code as frozen `[path, value]` pairs, in a stable order: the
 * lifecycle functions, then every leaf of `contributes` under its path.
 *
 * Leaves rather than the `contributes` object, because the copies the boot
 * hands around are rebuilt: two copies of one definition hold different
 * containers and the same leaves. A container reached a second time is
 * recorded once, as a reference to the path it was first seen at.
 */
function pluginCode(
  plugin: PluginDefinition
): readonly (readonly [string, unknown])[] {
  const entries: (readonly [string, unknown])[] = PLUGIN_CODE_KEYS.map(key =>
    Object.freeze([key, plugin[key]] as const)
  );
  const seen = new Map<object, string>();
  const walk = (value: unknown, path: string): void => {
    if (!Array.isArray(value) && !isPlainObject(value)) {
      entries.push(Object.freeze([path, value] as const));
      return;
    }
    const first = seen.get(value);
    if (first !== undefined) {
      entries.push(Object.freeze([path, `[seen at ${first}]`] as const));
      return;
    }
    seen.set(value, path);
    const keys = Array.isArray(value)
      ? value.map((_, index) => String(index))
      : Object.keys(value);
    entries.push(
      Object.freeze([
        path,
        `[${Array.isArray(value) ? "array" : "object"} ${keys.join(",")}]`,
      ] as const)
    );
    for (const key of keys) {
      walk((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  };
  walk(plugin.contributes, "contributes");
  return Object.freeze(entries);
}

/**
 * The config a plugin's `setup` transformers start from: `config` with a
 * copy of the resolved `plugins` (`copyPluginDefinitions`), a `db` block that
 * is a copy of the app's with a frozen `rawSqlPlugins`, and no
 * `pluginConsent`.
 *
 * A transformer is plugin code. Handed the app's own `db` object, one could
 * add its name to `db.rawSqlPlugins` there, and every later read of that
 * config would grant it: the CLI deriving consent from the config it
 * loaded, a boot retried after a failure, the dev server registering again.
 * Handed the resolved definitions themselves, one could rename another
 * plugin or flip its capabilities in place. Whatever a transformer does to
 * the copies stays in the config it returns. The boot and the CLI both start
 * their transformers from this, so neither hands plugin code a grant.
 */
export function setupTransformerInput<
  C extends {
    plugins?: PluginDefinition[];
    db?: object;
    pluginConsent?: PluginConsent;
  },
>(
  config: C,
  plugins: readonly PluginDefinition[]
): C & { plugins: PluginDefinition[] } {
  const input: C & { plugins: PluginDefinition[] } = {
    ...config,
    plugins: copyPluginDefinitions(plugins),
  };
  delete input.pluginConsent;
  if (config.db === undefined) return input;
  const db: object = { ...config.db };
  if ("rawSqlPlugins" in db && Array.isArray(db.rawSqlPlugins)) {
    db.rawSqlPlugins = Object.freeze([...db.rawSqlPlugins]);
  }
  return Object.assign(input, { db });
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
  /** The config key the app lists names under. */
  configKey: string;
}

const CONSENT_RULES: readonly ConsentRule[] = [
  {
    capability: "capabilities.db.rawSql",
    grants: "the live database handle at ctx.db.raw, which reaches every table",
    declares: plugin => plugin.capabilities?.db?.rawSql === true,
    listed: consent => consent.rawSql,
    configLine: names =>
      `db: { rawSqlPlugins: [${names.map(name => JSON.stringify(name)).join(", ")}] }`,
    configKey: "db.rawSqlPlugins",
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

/**
 * Refuse a capability that needs the app's consent when a `setup` transformer
 * introduced it.
 *
 * The app's listing names a plugin it reviewed: the manifest that plugin
 * declares under that name. On the transformed list a plugin holds the
 * capability only when the plugins recorded before setup
 * (`recordPreSetupPlugins`) had an entry with the same name declaring it. A
 * transformer that renames a plugin onto a listed name, adds a plugin under
 * one, or adds the capability to a plugin that did not declare it would
 * otherwise inherit a grant the app made for something else. Judged against
 * the record rather than the definitions, so an edit a transformer makes in
 * place reaches only the transformed list. Disabled plugins are skipped, as
 * `assertPluginConsent` skips them.
 */
export function assertConsentDeclaredBeforeSetup(
  declared: readonly PreSetupPlugin[],
  transformed: readonly PluginDefinition[]
): void {
  for (const rule of CONSENT_RULES) {
    for (const plugin of transformed) {
      if (plugin.enabled === false || !rule.declares(plugin)) continue;
      const configured = declared.find(entry => entry.name === plugin.name);
      if (configured?.declares.includes(rule.capability)) continue;
      const what =
        configured === undefined
          ? `A setup transformer added plugin "${plugin.name}", or renamed another plugin to that name, and it declares ${rule.capability}`
          : `A setup transformer added ${rule.capability} to plugin "${plugin.name}", whose own manifest does not declare it`;
      throw resolutionError(
        "capability-added-by-setup",
        `${what}. That capability grants ${rule.grants}, and the app's listing covers only a plugin that declares it in its own manifest under the listed name. ` +
          `Declare ${rule.capability} in the manifest of the plugin the app configures, rather than in a setup transformer.`,
        { plugin: plugin.name, capability: rule.capability }
      );
    }
  }
}

/**
 * One warning for each name the app lists that matches no configured plugin.
 *
 * Such an entry grants nothing today, and is not a failure: an app keeps its
 * listing while it removes or renames a plugin. It is named because it is a
 * grant waiting for whatever next arrives under that name, and because a
 * misspelt name reads as a listing that works.
 */
export function unmatchedConsentWarnings(
  plugins: readonly PluginDefinition[],
  consent: PluginConsent
): string[] {
  const configured = new Set(plugins.map(plugin => plugin.name));
  return CONSENT_RULES.flatMap(rule =>
    [...new Set(rule.listed(consent))]
      .filter(name => !configured.has(name))
      .map(
        name =>
          `${rule.configKey} lists "${name}", which matches no configured plugin, so it grants nothing. Remove it, or correct the name if it is misspelt.`
      )
  );
}
