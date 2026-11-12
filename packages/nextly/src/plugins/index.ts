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
export type { FrozenCopy, FrozenValue } from "../shared/lib/plain-copy";
export type { AdminPlacement as AdminPlacementType } from "./admin-placement";

export {
  definePlugin,
  createPluginContext,
  type PluginAdminAppearance,
  type PluginAdminConfig,
  type PluginActionRegistry,
  type PluginAuditApi,
  type PluginSecurityApi,
  type PluginCapabilities,
  type PluginConfig,
  type PluginContext,
  type PluginDurableEvents,
  type PluginEmitOptions,
  type PluginEvents,
  type PluginDatabase,
  type PluginDefinition,
  type PluginEmailService,
  type PluginEmailSettings,
  type PluginMediaService,
  type PluginRawDatabase,
  type PluginSummary,
  type PluginUserService,
  type PluginVersionsService,
  type PluginInsert,
  type PluginTransaction,
  type PluginFilterRegistry,
  type PluginHookRegistry,
  // `ctx.hooks.onInTransaction`'s handler and what it is handed.
  type InTransactionContext,
  type InTransactionHandler,
  type PluginSettingsApi,
} from "./plugin-context";
// `ctx.cache`, and the tag spelling its reads and expiries share.
export type { PluginCacheApi } from "./plugin-cache";
export { pluginCacheTag } from "../revalidation/compute-tags";
export type {
  PluginPinOptions,
  PluginPinTransaction,
  PluginVersionPin,
  PluginVersionPinHolder,
  PluginVersionPins,
} from "./plugin-version-pins";
export {
  PasswordTooLongError,
  type PasswordCheck,
  type PasswordHelper,
  type PasswordRules,
} from "./security/password-helper";
export type {
  OneTimeSecrets,
  SecretData,
  TxOption,
} from "./security/one-time-secrets";
export type { KeyedDigests } from "./security/keyed-digest";
export type { OpaqueSecrets } from "./security/opaque-secrets";
export {
  standardWebhooks,
  type InboundWebhookDelivery,
  type InboundWebhookReading,
  type InboundWebhookScheme,
  type ClaimDeliveryOptions,
  type DeliveryClaim,
  type DeliveryClaimResult,
  type PluginReceivedWebhooks,
  type VerifiedWebhook,
  type VerifyWebhookOptions,
  type WebhookRefusal,
  type WebhookVerification,
} from "./security/inbound-webhooks";

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
  PluginFieldWrite,
  PluginStoredValue,
  PluginStoredValueTarget,
  PluginFieldInstance,
  PluginFieldIssue,
  PluginFieldValidationResult,
  PluginFieldCodegen,
  PluginFieldCodegenImport,
  FieldSurface,
  PluginSchedule,
  ScheduledTask,
  PluginWebhookEventType,
  PluginTranslations,
  PermissionSlug,
} from "./contributions";

// Admin UI contributions — `contributes.admin` author surface.
export type {
  ComponentPath,
  JsonObject,
  JsonValue,
  PluginAdminContributions,
  PluginAdminPage,
  PluginCollectionView,
  OverridableDocumentAction,
  PluginDocumentActionOverride,
  PluginDocumentActionOverrides,
  PluginDocumentView,
  PluginFieldTypeDocumentView,
  PluginPanelSection,
  PluginAdminPlaceDeclaration,
  AdminBlockContribution,
  AdminBulkActionContribution,
  AdminColumnContribution,
  AdminContribution,
  AdminContributionAction,
  AdminRowActionContribution,
  AdminSidebarSectionContribution,
  AdminTabContribution,
  PluginListFilterDeclaration,
  PluginListFilterOption,
  PluginMenuItem,
  PluginMenuItemFields,
  PluginNavSection,
  PluginAdminPanel,
  PluginPanelGroup,
  PluginItemCount,
  PluginHeaderContributions,
  PluginHeaderSlotContributions,
  PluginHeaderUserMenuContributions,
  PluginItemPlace,
  PluginUserMenuAction,
  PluginUserMenuItem,
  PluginUserMenuLink,
} from "./admin-contributions";
export type { RowPredicate, RowPredicateValue } from "./row-predicate";
export type { AdminContributionKind } from "./admin-places";

// The places on admin pages plugins add to, and the ids every surface takes.
export {
  CORE_ADMIN_PLACES,
  isCoreAdminPlace,
  type AdminPlaceId,
  type AdminPlaces,
  type CoreAdminPlaceId,
} from "./admin-places";

// Plugin HTTP routes — `contributes.routes` surface.
export type {
  PluginRoute,
  PluginRouteCaller,
  PluginRouteCanOptions,
  PluginRouteIdentity,
  PluginRouteContext,
  PluginRouteHandler,
  PluginRouteMount,
  PluginRouteRateLimit,
  PluginRouteLimitKey,
  Middleware,
  RouteMethod,
} from "./routes/route-types";

// Proxy handlers: `contributes.proxy`, asked by the app's Proxy.
export type { PluginProxyHandler, ProxyAnswer } from "./proxy/proxy-types";

// Plugin-defined kinds of signed-in person: `contributes.principals`, a
// route's `principal`, `ctx.principals` and `nextly.principals`.
export type {
  NextlyPrincipals,
  PluginPrincipalsApi,
  PluginRoutePrincipal,
  Principal,
  PrincipalAnswer,
  PrincipalAttributeDescriptors,
  PrincipalAttributes,
  PrincipalAttributesOf,
  PrincipalAttributeType,
  PrincipalAttributeTypeOf,
  PrincipalAttributeValue,
  PrincipalKindContribution,
  PrincipalKindDefinition,
  PrincipalRecord,
  PrincipalRef,
  PrincipalReportOptions,
} from "./principals/types";
