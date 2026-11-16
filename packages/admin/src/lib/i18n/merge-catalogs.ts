/**
 * The admin's catalogs with every installed plugin's merged in, by interface
 * language.
 *
 * Plugin keys and the admin's never meet: startup holds every plugin key to
 * the plugin's own namespace, and the admin's keys begin with a segment no
 * plugin may own. So the merge is a plain union per language, and English
 * stays the fallback for a key a language lacks.
 *
 * @module lib/i18n/merge-catalogs
 */
import type { Catalogs } from "./translate";

/** A plugin's catalog, as its admin metadata carries it. */
type PluginCatalog = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** `base` with each plugin's strings added under their languages. */
export function mergeCatalogs(
  base: Catalogs,
  plugins: readonly { translations?: PluginCatalog }[]
): Catalogs {
  const merged: Record<string, Record<string, string | undefined>> = {};
  for (const [language, entries] of Object.entries(base)) {
    merged[language] = { ...entries };
  }
  for (const plugin of plugins) {
    for (const [language, entries] of Object.entries(
      plugin.translations ?? {}
    )) {
      merged[language] = { ...merged[language], ...entries };
    }
  }
  return merged;
}
