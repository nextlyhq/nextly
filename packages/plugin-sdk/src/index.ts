/**
 * @nextlyhq/plugin-sdk — the public, author-facing plugin surface (D43).
 *
 * This package IS the stability boundary (D40). Each export below carries a
 * `@public` or `@experimental` tag per the **stability ladder** (D55): a surface
 * graduates to `@public` only once a first-party plugin has exercised it in
 * production. The authoritative ledger — plus the semver guarantee and the
 * deprecation policy — lives in `STABILITY.md` next to this file.
 *
 * `@public` here means: breaking it is a Nextly major (D40), governed by the
 * deprecation policy. `@experimental` means: no compatibility guarantee yet.
 *
 * @packageDocumentation
 */

/** @public The plugin entry point — wraps a definition for `defineConfig({ plugins })`. */
export { definePlugin } from "nextly";

/**
 * Core plugin contract types.
 * @public `PluginDefinition`, `PluginContributions`, `PluginContext`,
 *   `PluginPermission`, `PermissionSlug`, `ServiceOpts`, `AuthUser`.
 * @experimental `PluginHookRegistry` — the `ctx.hooks` registration surface is
 *   not yet exercised by a first-party plugin (see STABILITY.md). Phase-2
 *   contribution types — `PluginRole` (D67), `PluginEmailProvider` /
 *   `PluginEmailTemplate` (D65), `ScheduledTask` (D61, reserved) — are also
 *   `@experimental`.
 */
export type {
  PluginDefinition,
  PluginContributions,
  PluginContext,
  PluginHookRegistry,
  PluginPermission,
  PluginRole,
  PluginEmailProvider,
  PluginEmailTemplate,
  ScheduledTask,
  PermissionSlug,
  ServiceOpts,
  AuthUser,
} from "nextly";

/**
 * Managed data access (D56) — the `ctx.services.collections` surface: rich
 * queries (filters/sort/pagination/relations via QueryOptions), `count`, and
 * `createMany`. Aggregations beyond `count` use the raw `ctx.db` escape hatch
 * (D33), which stays `@experimental`.
 *
 * @public Graduated in P9 — `plugin-form-builder` and `plugin-seo` depend on it
 *   (D56). This is the highest-scrutiny surface (D55); treat changes carefully.
 */
export type {
  PluginCollectionService,
  QueryOptions,
  PaginatedResult,
  BatchOperationResult,
} from "nextly";

/**
 * Plugin HTTP routes (P4, D25/D26/D27) — `contributes.routes` author surface.
 * @public Exercised by redirects (lookup) and seo (sitemap).
 */
export type {
  PluginRoute,
  PluginRouteContext,
  PluginRouteHandler,
  Middleware,
  RouteMethod,
} from "nextly";

/**
 * Admin UI contributions (P5, D19–D23) — `contributes.admin` author surface.
 * The component-registration runtime lives on `@nextlyhq/plugin-sdk/admin`.
 *
 * @public `PluginAdminContributions`, `PluginAdminPage`, `PluginCollectionView`,
 *   `PluginMenuItem`, `ComponentPath` — exercised by `plugin-form-builder`.
 * @experimental `PluginAdminWidget` — dashboard-widget rendering is deferred to
 *   M8 (D22); the contract is reserved, not rendered.
 */
export type {
  ComponentPath,
  PluginAdminContributions,
  PluginAdminPage,
  PluginAdminWidget,
  PluginCollectionView,
  PluginMenuItem,
} from "nextly";

/**
 * Hook types.
 * @public `HookContext` — exercised by `plugin-form-builder`'s collection hook.
 * @experimental `HookType`, `HookHandler` — the `ctx.hooks` plugin-registration
 *   path is not yet exercised by a first-party plugin.
 */
export type { HookType, HookHandler, HookContext } from "nextly";

/**
 * Event bus (D8/D51) — `ctx.events` surface + types.
 * @public Exercised by seo (`ctx.events.on`).
 */
export type { EventBus, EventEnvelope, EventHandler, EventName } from "nextly";

/**
 * Event-name constants (D69) — document/auth/media families. The event names
 * (and payloads) are part of the semver-protected surface (D40).
 * @public
 */
export {
  DocumentEvents,
  AuthEvents,
  MediaEvents,
  type DocumentEventName,
  type AuthEventName,
  type MediaEventName,
} from "nextly";

/**
 * Filter/action registry (D63) — `ctx.filters` / `ctx.actions` surface + seam types.
 * @experimental No first-party plugin contributes a filter/action through this
 *   surface yet (see STABILITY.md).
 */
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

/**
 * Auth extensibility (D71/D57) — pluggable strategies + auth-flow hooks +
 * challenge protocol + auth-page UI. Strategies are app-opt-in; hooks/challenges/
 * UI are normal contributions.
 * @experimental No first-party plugin exercises this yet; it stays experimental
 *   until one does (D55). See STABILITY.md.
 */
export type {
  AuthInput,
  AuthOutcome,
  AuthStrategy,
  Challenge,
  ChallengeDefinition,
  AuthHooks,
  AuthHookName,
} from "nextly";

/**
 * Secrets (D37) — redact secret config/env values at every leak vector.
 * @experimental No first-party plugin wraps a secret yet; the redaction contract
 *   is solid but unexercised (see STABILITY.md).
 */
export { Secret, secret, isSecret } from "./secret";
