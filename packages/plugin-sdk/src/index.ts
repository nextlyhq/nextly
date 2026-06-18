/**
 * @nextlyhq/plugin-sdk — the public, author-facing plugin surface (D43).
 *
 * This package IS the stability boundary (D40). Everything re-exported here is
 * `@experimental` until first-party plugins have exercised it (D55). `ctx.services`
 * is the highest-scrutiny surface and stays experimental the longest.
 *
 * Added in P3b: `useCan`/`<Can>` (D36 client) + the `secret` field (D37).
 * `createTestNextly` (P1) lives on the `@nextlyhq/plugin-sdk/testing` subpath.
 */
export { definePlugin } from "nextly";

export type {
  PluginDefinition,
  PluginContributions,
  PluginContext,
  PluginHookRegistry,
  PluginPermission,
  PermissionSlug,
  ServiceOpts,
  AuthUser,
} from "nextly";

// Plugin HTTP routes (P4, D25/D26/D27) — `contributes.routes` author surface.
export type {
  PluginRoute,
  PluginRouteContext,
  PluginRouteHandler,
  Middleware,
  RouteMethod,
} from "nextly";

// Admin UI contributions (P5, D19–D23) — `contributes.admin` author surface.
// The component-registration runtime lives on `@nextlyhq/plugin-sdk/admin`.
export type {
  ComponentPath,
  PluginAdminContributions,
  PluginAdminPage,
  PluginAdminWidget,
  PluginCollectionView,
  PluginMenuItem,
} from "nextly";

export type { HookType, HookHandler, HookContext } from "nextly";

// Event bus (D8/D51) — `ctx.events` surface + types.
export type { EventBus, EventEnvelope, EventHandler, EventName } from "nextly";

// Event-name constants (D69) — document/auth/media families.
export {
  DocumentEvents,
  AuthEvents,
  MediaEvents,
  type DocumentEventName,
  type AuthEventName,
  type MediaEventName,
} from "nextly";

// Filter/action registry (D63) — ctx.filters / ctx.actions surface + seam types.
export {
  FilterSeams,
  type Filter,
  type Action,
  type CoreFilterSeam,
  type PluginFilterRegistry,
  type PluginActionRegistry,
  type EmailPayloadFilterValue,
  type EmailFilterContext,
  type EmailAfterSendValue,
  type NavCollectionItem,
  type NavFilterContext,
  type ListQueryWhere,
  type ListQueryFilterContext,
} from "nextly";

// Secrets (D37) — redact secret config/env values at every leak vector.
export { Secret, secret, isSecret } from "./secret";
