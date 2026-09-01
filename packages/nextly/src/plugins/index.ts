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
// From the import-free modules rather than through `plugin-context`, so this
// barrel does not decide whether a consumer pays for the plugin runtime.
export {
  PLUGIN_CATEGORIES,
  isPluginCategory,
  type PluginCategory,
} from "./plugin-categories";
export { pluginAdminSlug } from "./plugin-slug";
export { collectDeclarations } from "./declarations";
export type { PluginDeclaration } from "./declarations";
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
  PluginFieldValidateArgs,
  PluginFieldInstance,
  PluginFieldIssue,
  PluginFieldValidationResult,
  PluginFieldCodegen,
  PluginFieldCodegenImport,
  FieldSurface,
  ScheduledTask,
  PermissionSlug,
} from "./contributions";

// Admin UI contributions — `contributes.admin` author surface.
export type {
  ComponentPath,
  JsonObject,
  JsonValue,
  PluginAdminContributions,
  PluginAdminPage,
  PluginAdminWidget,
  PluginAdminCustomWidget,
  PluginAdminDataWidget,
  PluginAdminDeclarativeWidget,
  PluginAdminQuerylessWidget,
  DeclarativeWidgetArchetype,
  PluginCollectionView,
  PluginMenuItem,
  PluginNavSection,
} from "./admin-contributions";

// Plugin HTTP routes — `contributes.routes` surface.
export type {
  PluginRoute,
  PluginRouteContext,
  PluginRouteHandler,
  Middleware,
  RouteMethod,
} from "./routes/route-types";
