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
 *   `@experimental`, as are `PluginFieldCodegen` / `PluginFieldCodegenImport`:
 *   the codegen callbacks are new and unexercised by a first-party plugin.
 */
export type {
  PluginDefinition,
  PluginContributions,
  PluginDeclaration,
  PluginCategory,
  PluginContext,
  PluginHookRegistry,
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
  ScheduledTask,
  PermissionSlug,
  ServiceOpts,
  AuthUser,
} from "nextly";

/**
 * Field authoring — the factories and `FieldConfig` type a plugin uses to build
 * the fields it contributes (`contributes.collections` / `contributes.extend`).
 * @public Exercised by `plugin-seo` (its `seo` field group). Field factories
 *   graduate here as first-party plugins exercise them (D55); more can be added
 *   the same way.
 */
export { text, textarea, checkbox, upload, group } from "nextly";
export type { FieldConfig } from "nextly";

/**
 * Declaring a field of a type the plugin itself contributes. The built-in
 * factories cover only the built-in types, so a contributed type has no factory
 * to build its field with; `pluginField` brands one so the authoring surfaces
 * accept it without widening the canonical union every internal reader holds.
 * @public Exercised by `plugin-page-builder` (its `blocks()` factory).
 */
export { pluginField } from "nextly";
export type {
  AuthorableFieldConfig,
  PluginDataFieldConfig,
  PluginFieldInput,
} from "nextly";

/**
 * The shapes a contributed field type's own config extends: the presentation
 * options every field carries, and the request context its callbacks are
 * handed. A plugin declaring a field type has to name both to type its own
 * config interface, so leaving them off this surface forced it to import them
 * from the core entry instead.
 * @public Exercised by `plugin-page-builder` (its `BlocksFieldConfig`).
 */
export type { FieldAdminOptions, RequestContext } from "nextly";

/**
 * Validating values against field declarations. A plugin storing structured
 * content of its own — block props, form submissions — applies the same rules a
 * write does instead of reimplementing `required`, the per-type checks and
 * every plugin field type's own `validate`.
 * @experimental No first-party plugin depends on it yet — core's block props
 *   are its only caller — so it has not met the graduation bar in
 *   STABILITY.md. It graduates once the page builder owns block props.
 */
export { validateFieldValues } from "nextly";
export type {
  ValidateFieldValuesOptions,
  FieldValueDeclaration,
  FieldValueDeclarationInput,
  ValidationIssue,
} from "nextly";

/**
 * The canonical error type, so a hook or route a plugin contributes can reject
 * input the way core does.
 *
 * A hook that throws a plain `Error` is indistinguishable from one that
 * crashed, so its message is treated as a server fault and replaced before it
 * reaches the caller. `NextlyError.validation()` and its siblings carry the
 * status, code and field issues that say the rejection was deliberate.
 *
 * A Direct API caller receives that error as thrown. Over REST the dispatcher
 * currently reconstructs a subset of statuses and maps the rest to 500, so do
 * not build client behaviour on a status reaching REST until that is closed.
 * @public
 */
export { NextlyError } from "nextly";

/**
 * Managed data access (D56) — the `ctx.services.collections` surface: rich
 * queries (filters/sort/pagination/relations via QueryOptions), `count`, and
 * `createMany`. Aggregations beyond `count` use the raw `ctx.db` escape hatch
 * (D33), which stays `@experimental`.
 *
 * @public Graduated in P9 — `plugin-form-builder` depends on it
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
  JsonObject,
  JsonValue,
  PluginAdminContributions,
  PluginAdminPage,
  PluginAdminWidget,
  PluginCollectionView,
  PluginMenuItem,
} from "nextly";

/**
 * Hook types.
 * @public `HookContext` — exercised by `plugin-form-builder`'s collection hook.
 * @experimental `HookType`, `HookContextPhase`, `HookHandler` — the `ctx.hooks`
 *   plugin-registration path is not yet exercised by a first-party plugin.
 *
 * `HookContextPhase` is what `ctx.hooks.on`/`off` accept: every phase except
 * `beforeOperation`, whose handler takes the operation's args instead. The
 * `BeforeOperation*` types below are what `ctx.hooks.onBeforeOperation`/
 * `offBeforeOperation` accept, and are exported so a plugin can type a handler
 * it holds in a variable in order to unregister the same function later.
 */
export type {
  BeforeOperationArgs,
  BeforeOperationContext,
  BeforeOperationHandler,
  HookContext,
  HookContextPhase,
  HookHandler,
  HookType,
} from "nextly";

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

/**
 * Build a contributable email provider.
 *
 * A value export, not a type: an author calls this so their own config type is
 * checked at the point they write the definition and erased only at the
 * boundary core stores it behind.
 */
export { defineEmailProvider, MAX_EMAIL_PROVIDER_TYPE_LENGTH } from "nextly";
export type {
  EmailProviderDefinition,
  EmailProviderConfigField,
  EmailProviderCapabilities,
  EmailProviderDescriptor,
  RegisteredEmailProvider,
} from "nextly";
