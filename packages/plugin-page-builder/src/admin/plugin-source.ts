/**
 * The name the plugin's client reads go by, and the source the registry
 * attributes these blocks to, for diagnostics.
 *
 * A module of its own, with no imports, so the modules that register blocks
 * and the one that reads a stored document can both name it without importing
 * each other.
 *
 * @module @nextlyhq/plugin-page-builder/admin/plugin-source
 */
export const PLUGIN_SOURCE = "@nextlyhq/plugin-page-builder";
