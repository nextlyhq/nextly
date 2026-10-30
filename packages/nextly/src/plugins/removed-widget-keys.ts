/**
 * The contribution keys a plugin no longer adds widgets or widget data sources
 * through, and the startup refusal of a plugin that still carries one.
 *
 * A plugin's widgets are declared with `defineWidget` under
 * `contributes.dashboard.widgets`, and each widget's `load` reads its data as
 * the person asking. `contributes.admin.widgets` and
 * `contributes.widgetSources` are not fields of the contributions type, so a
 * TypeScript plugin cannot name them; a plugin written in JavaScript, or one
 * whose manifest arrives as parsed JSON, still can, and is refused at startup
 * by name rather than having its cards silently absent.
 *
 * The keys are read here, from the value as plain JavaScript hands it over,
 * and nowhere else: the startup refusal and every reader that still looks at
 * the keys ask this module, so they cannot disagree about what a plugin
 * carries.
 *
 * Imports nothing beyond the error type, so the component-map generator and
 * the source fold can read the keys without loading the widget validator.
 *
 * @module plugins/removed-widget-keys
 */

import { NextlyError } from "../errors/nextly-error";

import type { PluginDefinition } from "./plugin-context";

/** The keys, spelled as under `contributes`. */
const REMOVED_WIDGET_KEYS = ["admin.widgets", "widgetSources"] as const;

/** One of {@link REMOVED_WIDGET_KEYS}. */
type RemovedWidgetKey = (typeof REMOVED_WIDGET_KEYS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * What `plugin` carries under `contributes.<key>`, or `undefined` when it
 * carries nothing there.
 */
export function carriedRemovedKey(
  plugin: PluginDefinition,
  key: RemovedWidgetKey
): unknown {
  const contributes: unknown = plugin.contributes;
  if (!isRecord(contributes)) return undefined;
  if (key === "widgetSources") return contributes.widgetSources;
  const admin = contributes.admin;
  return isRecord(admin) ? admin.widgets : undefined;
}

/**
 * The startup failure for a plugin carrying `key`, in the one sentence its
 * author acts on: which plugin, which key, and what to write instead.
 *
 * The public message stays generic, as for every plugin configuration
 * failure; the sentence goes to `logMessage`, where a startup failure is read.
 */
function removedWidgetKeyError(
  pluginName: string,
  key: RemovedWidgetKey
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_PLUGIN_REMOVED_WIDGET_CHANNEL",
    publicMessage: "Plugin configuration is invalid.",
    logMessage:
      `Plugin "${pluginName}" declares contributes.${key}, which Nextly no ` +
      "longer reads: declare each widget with defineWidget() under " +
      "contributes.dashboard.widgets, and read its data in that widget's load.",
    logContext: { plugin: pluginName, key: `contributes.${key}` },
  });
}

/**
 * Refuses the first plugin carrying any of {@link REMOVED_WIDGET_KEYS}.
 *
 * Any value counts, an empty list included: the key is not a field, so a
 * plugin naming it is written against a contract that no longer exists.
 * Disabled plugins are checked too, so enabling one is never what turns a
 * healthy install into one that refuses to start.
 */
export function assertNoRemovedWidgetKeys(
  plugins: readonly PluginDefinition[]
): void {
  for (const plugin of plugins) {
    for (const key of REMOVED_WIDGET_KEYS) {
      if (carriedRemovedKey(plugin, key) !== undefined) {
        throw removedWidgetKeyError(plugin.name, key);
      }
    }
  }
}
