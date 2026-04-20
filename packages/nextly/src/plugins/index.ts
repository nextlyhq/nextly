/**
 * Plugin System
 *
 * Exports the plugin context and definition types for creating
 * Nextly plugins.
 *
 * @module plugins
 * @since 1.0.0
 */

export { AdminPlacement } from "./admin-placement";
export type { AdminPlacement as AdminPlacementType } from "./admin-placement";

export {
  definePlugin,
  createPluginContext,
  type PluginAdminAppearance,
  type PluginAdminConfig,
  type PluginContext,
  type PluginDefinition,
  type PluginHookRegistry,
} from "./plugin-context";
