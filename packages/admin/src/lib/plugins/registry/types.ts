import type { AdminIconName } from "@admin/components/icons";

import type { PluginCategory } from "../plugin-categories";

/**
 * A plugin in the curated catalogue. Not necessarily installed.
 *
 * Distinct from `PluginMetadata`, which describes a plugin the server has
 * actually loaded. Everything here is a curated claim; nothing here has been
 * observed running. Callers must not render catalogue data inside a surface
 * that reports what an installed plugin contributes.
 *
 * @module lib/plugins/registry/types
 */
export interface RegistryPlugin {
  /**
   * npm package name, and the identity this joins to `PluginMetadata.name` on.
   * Also the source of the detail-page slug, via `pluginSlug`.
   */
  id: string;
  name: string;
  /** Required, unlike `PluginMetadata.description`: this catalogue is ours. */
  description: string;
  author: string;
  category: PluginCategory;
  tags?: string[];
  /**
   * `lucide` is checked against the icon barrel, unlike a plugin's own
   * `appearance.icon`: this catalogue is ours, so a name nothing exports is a
   * mistake we can refuse at compile time rather than a third party's string
   * we have to tolerate at runtime.
   */
  icon: { lucide: AdminIconName; asset?: string };
  /**
   * What the reader has to write in nextly.config.ts, in the two parts they
   * write it in: an import at the top of the file and an entry in the plugins
   * array.
   *
   * Held as the binding and its arguments rather than as finished lines,
   * because the two mention the same identifier and a stored pair can
   * disagree — an entry naming a symbol the import does not bring in is a
   * recipe that does not compile. Neither part repeats the package name
   * either; that is `id`, and `importStatement()` reads it from there so a
   * rename cannot leave the import fetching the old package while the detail
   * page joins installed state on the new one.
   */
  config: {
    /** The binding the package exports and the plugins array references. */
    exportName: string;
    /**
     * The arguments as written inside the call: `""` for a call that takes
     * none, or `null` when the export goes into the array uncalled. The two
     * are different facts about the package's API, not two spellings of one.
     */
    callArgs: string | null;
    /**
     * Whether the package ships an `/admin` side-effect module that the app's
     * admin route has to import.
     *
     * A fourth edit, in a different file, and omitting it is not a small
     * miss: the plugin installs and its server half runs, so nothing errors,
     * while its admin UI silently never registers — the form builder degrades
     * to plain JSON inputs. Declared rather than assumed, because it is a fact
     * about the package's export map that only some plugins have.
     */
    adminModule?: boolean;
  };
  links?: { homepage?: string; repository?: string; docs?: string };
}

/**
 * Where catalogue data comes from.
 *
 * Async although the only implementation resolves instantly. A synchronous
 * source teaches every consumer that the data is always present and never
 * fails, so the day it becomes remote (an npm keyword search, a hosted
 * registry) every consumer and every test is rewritten. Two states now cost
 * one await.
 */
export interface PluginRegistrySource {
  list(): Promise<RegistryPlugin[]>;
  /** Ordered ids for the curated strip, at most `MAX_FEATURED`. */
  featured(): Promise<string[]>;
}
