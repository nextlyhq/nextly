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
 * @experimental `collectionDraftSplit` — whether a collection stores a working
 *   draft beside its published row.
 *
 * A plugin storing anything per published/draft has to know, and cannot work it
 * out: the split resolves from five conditions together, and `status: true` —
 * the flag that looks like the answer — is true for collections that keep no
 * draft at all. A plugin that guesses writes records against a document which
 * does not exist, and nothing downstream can tell them from real ones.
 *
 * Takes the collection AS AUTHORED, so `versions: true` and `{ drafts: true }`
 * both work. The reason travels with the verdict, so a caller can say WHY a
 * collection it expected to draft does not.
 *
 * Re-exported here because this is the only surface a plugin may depend on.
 * Reaching into `nextly` for it would work and would be a plugin depending on
 * core's layout rather than on a contract.
 */
export { collectionDraftSplit } from "nextly";
/**
 * @experimental `AuthoredDraftSplitCollection` is the collection shape the
 *   question accepts, and `DraftSplitEligibility` / `DraftSplitDisabledReason`
 *   are the verdict it answers with. Tagged on their own declaration: a release
 *   tag applies to the declaration it precedes, so the block above classifies
 *   the function alone and these three would otherwise be published untagged.
 */
export type {
  AuthoredDraftSplitCollection,
  DraftSplitEligibility,
  DraftSplitDisabledReason,
} from "nextly";

/**
 * @experimental `resolvedCollectionDraftSplit` — the same question, asked of a
 *   collection the SCHEMA BUILDER created.
 *
 * A Builder collection is not authored config. It lives in the dynamic registry,
 * which stores `versions` already resolved, so `collectionDraftSplit` above is
 * the one shape it can never take — the checker rejects it, and untyped code
 * gets `false` for a collection whose drafts are ON, because nothing named
 * `drafts.enabled` is there to read. A plugin reaching a Builder collection
 * through `ctx.services.collections.getCollection` holds a record for this one.
 *
 * Which to call is decided by where the collection CAME FROM, not by inspecting
 * it: the two inputs overlap in neither direction, and a runtime check that
 * tried to tell them apart would misread the boolean shorthand and fail
 * silently in the direction that disables drafts.
 *
 * That record is not DECLARED as one, which is why `resolvedCollectionView`
 * below exists: `getCollection` returns `Collection`, whose fields live under
 * `schemaDefinition` and which promises no root-level `status` or `versions`,
 * so its result is not assignable here however faithfully the object carries
 * them. Project it rather than asserting it.
 */
export { resolvedCollectionDraftSplit } from "nextly";
/**
 * @experimental `ResolvedDraftSplitCollection` is the registry-shaped input
 *   `resolvedCollectionDraftSplit` accepts. Tagged on its own declaration: a
 *   release tag applies to the declaration it precedes.
 */
export type { ResolvedDraftSplitCollection } from "nextly";
/**
 * @experimental `resolvedCollectionView` — a registry record, projected onto
 *   the shape above.
 *
 * Published rather than left to each plugin. The projection is the only way to
 * get from the documented producer to the documented consumer without an
 * assertion, so every plugin needing the question would otherwise write it, and
 * a projection restated per caller drifts from the type it feeds while all of
 * them still compile. It reads every property as unknown and checks it, which
 * is the honest handling of a value whose declared type under-states it.
 */
export { resolvedCollectionView } from "nextly";

/**
 * Plugin identity and classification.
 * @experimental `PLUGIN_CATEGORIES` and `isPluginCategory` enumerate and narrow
 *   the vocabulary `category` accepts; `pluginAdminSlug` derives the identifier
 *   the admin addresses a plugin by (`"@acme/p"` → `"acme-p"`), which is the
 *   same derivation the admin routes on. No first-party plugin consumes them
 *   yet (D55).
 */
export { PLUGIN_CATEGORIES, isPluginCategory, pluginAdminSlug } from "nextly";

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
 * Which fields a level addresses, with presentational groups flattened.
 *
 * An unnamed group lays fields out and stores its children at the level it sits
 * in; a named one stores them under itself. A plugin walking a collection's
 * fields has to make that distinction to find where a value is actually kept,
 * and reimplementing it is a second answer to one question.
 *
 * @experimental
 */
export { addressableFields } from "nextly";

/**
 * What a caller passes to control the walk, and what it emits.
 *
 * `descendInto` chooses which unnamed containers are transparent, and the
 * choice has to be made during the walk: the result holds the flattened
 * children themselves, so a field reached through one container is the same
 * object as the same field reached through another.
 *
 * @experimental
 */
export type {
  AddressableFieldsOptions,
  AddressableField,
  UnvalidatedAddressableField,
} from "nextly";

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
 * @experimental Read-only registry access to the app's Singles.
 *
 * Forwarded here because this package is the supported import surface for a
 * plugin author: a type exported only from `nextly` cannot be named by a plugin
 * following the documented surface, so the helper it was added for would have
 * had to widen to `unknown`.
 */
export type {
  PluginSinglesService,
  PluginSinglesResult,
  PluginSingleRecord,
  SerializedFieldConfig,
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
 * @experimental `PluginAdminWidget` — dashboard widgets render (D22); the
 *   contribution shape is still settling, so it graduates once a first-party
 *   plugin ships one.
 */
export type {
  ComponentPath,
  JsonObject,
  JsonValue,
  PluginAdminContributions,
  PluginAdminPage,
  PluginNavSection,
  PluginAdminWidget,
  PluginAdminCustomWidget,
  PluginAdminDataWidget,
  PluginAdminStatsWidget,
  PluginAdminDeclarativeWidget,
  PluginAdminQuerylessWidget,
  DeclarativeWidgetArchetype,
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
/**
 * @experimental Email provider authoring. Unexercised by a first-party plugin,
 * so it graduates per D55 once one ships — see STABILITY.md.
 */
export { defineEmailProvider, MAX_EMAIL_PROVIDER_TYPE_LENGTH } from "nextly";
/** @experimental See `defineEmailProvider`. */
export type {
  EmailProviderDefinition,
  EmailProviderConfigField,
  EmailProviderCapabilities,
  EmailProviderDescriptor,
  ProviderAvailability,
  RegisteredEmailProvider,
} from "nextly";

/**
 * @experimental Background jobs.
 *
 * A plugin declares a job type with `defineJob` and asks for one to happen with
 * `nextly.jobs.queue`. Held experimental per D55 until a first-party plugin
 * ships one — the release drain is core's, not a plugin's, so nothing has yet
 * exercised this from the outside.
 */
export { defineJob, MAX_JOB_SLUG_LENGTH } from "nextly";
/** @experimental See `defineJob`. */
export type {
  JobContext,
  JobDefinition,
  JobDefinitionInput,
  JobInputFor,
  JobRetryPolicy,
  JobSlug,
  QueueJobArgs,
  QueueJobResult,
} from "nextly";

/**
 * @experimental Dashboard widgets (D22/C9) — the registry a widget declares
 * itself to, the source registry a query names, and the declarative query
 * contract itself.
 *
 * Forwarded here for the reason the Singles surface above is: a plugin imports
 * only from `@nextlyhq/plugin-sdk` and `@nextlyhq/ui`, never from core, so a
 * registry exported from the `nextly` root alone is one an author following the
 * documented surface cannot reach at all. There is no `nextly/widgets` subpath,
 * so this is the only supported spelling.
 *
 * Every contract a published shape NAMES travels with it, the way core's own
 * root export does: `WidgetDefinition.defaultHeight` is a `WidgetHeight`, and a
 * `WidgetSource` is built out of `WidgetSourceField`, `WidgetSourceKind` and
 * `WidgetOp` — a public property whose type has no public name can be inferred
 * but never annotated.
 *
 * Held `@experimental` alongside `PluginAdminWidget`, which is the same feature
 * seen from the contributions side: the widget contract graduates per D55 once a
 * first-party plugin ships one. See STABILITY.md.
 */
export {
  WIDGET_SIZES,
  WIDGET_CHROME,
  WIDGET_HEIGHTS,
  WIDGET_ARCHETYPES,
  WIDGET_OPS,
  WIDGET_SOURCE_KINDS,
  WIDGET_SOURCE_FIELD_TYPES,
  registerWidget,
  registerSource,
  type WidgetDefinition,
  type WidgetAction,
  type WidgetQuery,
  type WidgetSize,
  type WidgetChrome,
  type WidgetHeight,
  type WidgetArchetype,
  type DataWidgetArchetype,
  type QuerylessWidgetArchetype,
  type WidgetSource,
  type WidgetSourceField,
  type WidgetSourceFieldType,
  type WidgetSourceKind,
  type WidgetOp,
} from "nextly";
