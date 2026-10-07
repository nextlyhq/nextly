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
  type PluginAuditApi,
  type PluginCapabilities,
  type PluginConfig,
  type PluginContext,
  type PluginDatabase,
  type PluginDefinition,
  type PluginEmailService,
  type PluginEmailSettings,
  type PluginMediaService,
  type PluginRawDatabase,
  type PluginSummary,
  type PluginUserService,
  type PluginVersionsService,
  type PluginTransaction,
  type PluginFilterRegistry,
  type PluginHookRegistry,
  type PluginSettingsApi,
} from "./plugin-context";

// What each hook point carries, by name; a plugin augments the map.
export type {
  HookPointContext,
  HookPointNameOf,
  HookPointPayload,
  HookPointPayloads,
  HookPointValue,
} from "./hook-point-payloads";

// What `ctx.auth` offers a plugin that authenticated someone elsewhere.
export type {
  CompleteLoginOptions,
  PluginAuthApi,
} from "../auth/plugin-auth-api";

export type {
  PluginAuditDeclaration,
  PluginContributions,
  PluginHookPointDeclaration,
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
  PluginAdminStatsWidget,
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
  PluginRouteCaller,
  PluginRouteIdentity,
  PluginRouteContext,
  PluginRouteHandler,
  PluginRouteMount,
  PluginRouteRateLimit,
  Middleware,
  RouteMethod,
} from "./routes/route-types";
