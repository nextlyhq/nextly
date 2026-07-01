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
  type PluginActionRegistry,
  type PluginContext,
  type PluginDefinition,
  type PluginFilterRegistry,
  type PluginHookRegistry,
} from "./plugin-context";

export type {
  PluginContributions,
  PluginPermission,
  PluginRole,
  PluginEmailProvider,
  PluginEmailTemplate,
  PluginFieldType,
  ScheduledTask,
  PermissionSlug,
} from "./contributions";

// Admin UI contributions — `contributes.admin` author surface.
export type {
  ComponentPath,
  PluginAdminContributions,
  PluginAdminPage,
  PluginAdminWidget,
  PluginCollectionView,
  PluginMenuItem,
} from "./admin-contributions";

// Plugin HTTP routes — `contributes.routes` surface.
export type {
  PluginRoute,
  PluginRouteContext,
  PluginRouteHandler,
  Middleware,
  RouteMethod,
} from "./routes/route-types";
