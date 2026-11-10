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
 * @experimental `defineWidget` — declares a dashboard widget once: its
 * settings, its data, its size and how it draws. A widget drawn by its own
 * component is handed `WidgetProps<typeof widget>`; the types are here and in
 * `./widgets`. Its `size` is a `WidgetSizeDeclaration` of `GridSize`s, `{ w, h }`
 * on a grid twelve columns wide, the one way a card's size is stated. The
 * types its other fields are written in (`view`, `access` and its
 * `WidgetAccessGate`, `preview`, `summary`) come from here too, and so do
 * `WidgetInterval` and `WidgetRange`, a series read's interval and range, so
 * an author annotating one imports it from where `defineWidget` came from.
 * `WidgetLoadSize` is the `size` a `load` is handed: the card's `{ w, h }` and
 * its tier, the shape `WidgetRenderSize` hands its component.
 * `WidgetSummaryCount` is what a `summary.count` answers: a number, or
 * `{ count, atLeast }` for a floor the header shows as "N+".
 */
export { defineWidget } from "nextly";
/**
 * @experimental `setting` and `option` — a widget's settings, written with the
 * collections' field builders: `setting.select({ label, options: [option("US
 * dollar", "usd")], defaultValue: "usd" })` takes the config `select()` takes
 * in a collection, less the `name` the setting's key gives, with a `label`
 * required. Beside them, the dashboard's pickers: `setting.collection`,
 * `setting.fieldOf`, `setting.dateRange` and the list card's `filter`,
 * `sort`, `groupBy` and `fields`. `option` is the collections' own.
 */
export { option, setting } from "nextly";
/**
 * @experimental `SettingEditorProps`: what a setting's own editor is handed,
 * the component its `editor: { component }` names, drawn in the card's
 * settings sheet in place of the setting's own field.
 */
export type {
  CoreView,
  GridSize,
  SettingEditorProps,
  WidgetAccess,
  WidgetAccessGate,
  WidgetData,
  WidgetInterval,
  WidgetLoadSize,
  WidgetPreviewCase,
  WidgetProps,
  WidgetRange,
  WidgetRenderSize,
  WidgetSizeDeclaration,
  WidgetSummary,
  WidgetSummaryCount,
  WidgetView,
} from "nextly";
/**
 * The types a plugin's widget code is written in, intended to stay as they
 * are: `AnyWidget`, any widget `defineWidget` made, for a function that
 * returns one or a list that holds several; `WidgetReadServices`, the reads a
 * widget's `load`, `shows` and `summary.count` are handed, already bound to
 * the person asking, for a helper those functions share. Types only, core's
 * own, so a plugin names them from here rather than from `nextly`.
 */
export type { AnyWidget, WidgetReadServices } from "nextly";

/**
 * @experimental The number and change formatters a dashboard card's figures are
 * written with, and the colour a chart slot is drawn in, for a widget's own view
 * and for server code alike:
 *
 * - `formatWidgetNumber`: a count, total or chart value, as drawn ("1.2k" at a
 *   small tier, "2,000+" for a floor) and as heard ("2,000 or more").
 * - `formatWidgetChange`: a change against an earlier period, with its arrow
 *   and sign, never its colour alone.
 * - `widgetChartColour`: the token a chart slot is drawn in
 *   (`var(--nx-chart-N)`), the five colours core's charts use in light and dark.
 *
 * Here, at the server-safe root, rather than beside the kit's components in
 * `./admin`: every module of the admin is a client module, which a Server
 * Component cannot call. Each is `@nextlyhq/ui`'s own, from its server-safe
 * entries, so a figure reads the same wherever it is written. The locale is
 * the `locale` option's, `en-US` when none is given.
 */
export {
  chartColour as widgetChartColour,
  formatChange as formatWidgetChange,
  formatCount as formatWidgetNumber,
  type ChartSlot as WidgetChartSlot,
} from "@nextlyhq/ui/format";

/**
 * @experimental `rowsThatFit(size, { density })` — how many list rows a card of
 * `size` draws at a density (`"default"` or `"compact"`): its body's height
 * over one row's, in whole rows, at most ten. A widget's `load` reads it from
 * the `size` it is handed, to ask for no more rows than its card shows. Core's
 * own, the formula its list cards are drawn by, and at this server-safe root
 * beside the formatters for the reason they are: a `load` runs on the server.
 */
export { rowsThatFit } from "nextly";

/**
 * @experimental `defineAttentionItem` — declares one line of the Needs
 * attention card, which a plugin lists under `contributes.dashboard.attention`:
 * a label, optionally a one-line reason, a count taken as the person asking,
 * and where it leads. Who sees it
 * is a permission, or the collections it counts. `AttentionItem` and
 * `AttentionCount` are the types it is written in.
 */
export { defineAttentionItem } from "nextly";
export type { AttentionCount, AttentionItem } from "nextly";
/**
 * `MAX_ATTENTION_ITEMS_PER_PLUGIN` — the most Needs attention items one plugin
 * may declare; startup refuses a plugin that declares more. Published so a
 * plugin with a line per something it reads builds no more than this, rather
 * than restating the number. Intended to be stable: core's own bound, which
 * changes only with a release that says so.
 */
export { MAX_ATTENTION_ITEMS_PER_PLUGIN } from "nextly";

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
 * Which `locale` values are instructions rather than languages.
 * @experimental `isLocaleSelector` — a route that forwards `?locale=` into
 *   `ctx.services` has to tell a visitor's language from the wildcards the
 *   core reads as selectors, and the boundary that refuses those selectors
 *   decides with this same function — so a plugin asks it rather than keeping
 *   a list that agrees with the core's only until one of them gains an entry.
 *   Here because this is the surface a plugin author may import from; the
 *   same symbol on bare `nextly` is not part of the plugin contract. Exercised
 *   by `plugin-form-builder`'s submission redirect; graduates per D55 once
 *   that ships in a release.
 */
export { isLocaleSelector } from "nextly";

/**
 * Where an entry is served, and what names it, as the core answers both.
 * @experimental `previewUrlFromTemplate` fills a path template such as
 *   `/blog/{slug}` from an entry, the way the admin's preview and page search
 *   do, so a plugin holding or linking an entry's address names the one the
 *   host serves rather than a second spelling of it. `readableTitleText`
 *   answers whether a title field's value can name an entry, and as what
 *   text, the way the admin and the activity feed read it. Intended to be
 *   stable; `plugin-page-builder`'s address claims exercise both, and they
 *   graduate per D55 once that ships in a release.
 */
export { previewUrlFromTemplate, readableTitleText } from "nextly/config";

/**
 * @experimental A field's key as the admin's screens word it, where the
 * field carries no label of its own: `humanizeFieldName("membersOnly")` is
 * "Members Only". Core's one humaniser, from a module that imports nothing,
 * so a plugin's server code names a field as the admin does. The same
 * function `./admin` offers a plugin's admin code. `plugin-page-builder`
 * names a template's blocks fields with it.
 */
export { humanizeFieldName } from "nextly/field-label";

/**
 * Which entries have changes waiting to be published.
 * @experimental `PENDING_CHANGE_KEY` — the reserved filter key that keeps,
 *   in a `where` handed to `ctx.services.collections`, only the entries whose
 *   working draft differs from their published row. A plugin that must not
 *   publish someone's unfinished edits as a side effect of its own write asks
 *   the core with this key rather than spelling it, so it names the key the
 *   query layer reads. Held experimental with the other workflow keys until
 *   the dashboard's Needs attention card is complete; `plugin-page-builder`
 *   exercises it when a template delete unlinks its copies.
 */
export { PENDING_CHANGE_KEY } from "nextly/reserved-filter-keys";

/**
 * Core plugin contract types.
 * @public `PluginDefinition`, `PluginContributions`, `PluginContext`,
 *   `PluginPermission`, `PermissionSlug`, `ServiceOpts`, `AuthUser`.
 * @experimental `PluginHookRegistry` — the `ctx.hooks` registration surface is
 *   not yet exercised by a first-party plugin (see STABILITY.md). Phase-2
 *   contribution types — `PluginRole` (D67), `PluginEmailProvider` /
 *   `PluginEmailTemplate` (D65), `PluginSchedule` and the earlier
 *   `ScheduledTask` (deprecated: mapped to a `PluginSchedule` and run, with
 *   a warning, or not run, with a warning saying why) — are also
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
  PluginFieldWrite,
  PluginStoredValue,
  PluginStoredValueTarget,
  PluginFieldInstance,
  PluginFieldIssue,
  PluginFieldValidationResult,
  PluginFieldCodegen,
  PluginFieldCodegenImport,
  PluginSchedule,
  ScheduledTask,
  PluginWebhookEventType,
  PluginTranslations,
  PermissionSlug,
  ServiceOpts,
  AuthUser,
} from "nextly";

/**
 * The runtime surfaces a plugin receives when it declares them, and the
 * declarations that ask for them.
 * @experimental `PluginSettingsApi` (`ctx.settings`), `PluginAuditApi`
 *   (`ctx.audit`), `PluginAuthApi` and `CompleteLoginOptions` (`ctx.auth`),
 *   `PluginCapabilities` (`capabilities`), `PluginAuditDeclaration`
 *   (`contributes.audit`) and `PluginHookPointDeclaration`
 *   (`contributes.hookPoints`). Held experimental until a first-party plugin
 *   exercises them (see STABILITY.md).
 */
export type {
  PluginSettingsApi,
  PluginAuditApi,
  PluginAuthApi,
  CompleteLoginOptions,
  PluginCapabilities,
  PluginAuditDeclaration,
  PluginHookPointDeclaration,
} from "nextly";

/**
 * Kinds of signed-in person a plugin defines: a shop's customers, a site's
 * members, anyone who signs in without being staff.
 * @experimental `PrincipalKindDefinition` and `PrincipalKindContribution`
 *   (`contributes.principals`) with their attribute and record types;
 *   `PluginRoutePrincipal` (a route's `principal`); `Principal`, the person
 *   core hands to `ctx.principal`;
 *   `PrincipalRef`, a person named by kind and id; `PluginPrincipalsApi`
 *   (`ctx.principals`) and `NextlyPrincipals` (`nextly.principals`), with
 *   their `byId`; `reportDeleted` and its `PrincipalReportOptions`, and
 *   `actorPrincipal` and `targetPrincipal` on `ctx.audit.write`; `RunAsPrincipal`, the `principal` option a collection or
 *   Single operation and a `ctx.services` call run as. Meant to
 *   become stable once the feature is complete (see STABILITY.md).
 */
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
  RunAsPrincipal,
} from "nextly";

/**
 * Limits a plugin counts on keys it chooses, before the work they guard runs.
 * @experimental `LimitRule` (`contributes.limits`), `PluginLimiter`
 *   (`ctx.limits`) and its entry, reservation, outcome and check types. The
 *   rule kinds and their meaning, `enforce` and the three `count` modes, the
 *   per-entry verdicts, the atomic reservation, the three results with
 *   `unavailable` distinct, `release`, `reset`, `check`, `clientKey`'s forms
 *   and `store.shared` are meant to become stable (see STABILITY.md).
 */
export type {
  AdmittedReservation,
  EntryVerdict,
  LimitCheck,
  LimitEntry,
  LimitOutcome,
  LimitReservation,
  LimitRule,
  LimitTarget,
  PluginLimiter,
} from "nextly";

/**
 * Core's security helpers, lent to a plugin for the people it signs in itself.
 * @experimental `PluginSecurityApi` (`ctx.security`); `PasswordHelper`
 *   (`ctx.security.passwords`) with `PasswordRules`, `PasswordCheck` and
 *   `PasswordTooLongError`; `BreachedPasswordsConfig`, the site's
 *   `security.breachedPasswords`; `OpaqueSecrets` (`ctx.security.opaque`); and
 *   `OneTimeSecrets` (`ctx.security.secrets`) with `SecretData` and
 *   `TxOption`. Held experimental until a first-party plugin signs people in
 *   with them (see STABILITY.md). `PluginReceivedWebhooks`
 *   (`ctx.security.webhooks`), verifying a received webhook against a
 *   `standardWebhooks` or a plugin's own `InboundWebhookScheme`, is
 *   experimental too, until a first-party plugin receives webhooks with it.
 */
export { PasswordTooLongError, standardWebhooks } from "nextly";
export type {
  PluginSecurityApi,
  PasswordHelper,
  PasswordRules,
  PasswordCheck,
  BreachedPasswordsConfig,
  OpaqueSecrets,
  OneTimeSecrets,
  SecretData,
  TxOption,
  PluginReceivedWebhooks,
  InboundWebhookScheme,
  InboundWebhookDelivery,
  InboundWebhookReading,
  VerifyWebhookOptions,
  WebhookVerification,
  WebhookRefusal,
} from "nextly";

/**
 * The database handles a plugin receives: `ctx.db` is a `PluginDatabase`
 * with a `raw` member that is a `PluginRawDatabase`.
 * @experimental `PluginDatabase` — typed, owner-checked access to the tables
 *   the plugin declared (`contributes.schema`) and its dependencies' tables;
 *   `PluginTransaction` — the handle `ctx.db.transaction` passes its work;
 *   `PluginInsert` — what `ctx.db.insert` takes for a table;
 *   `PluginRawDatabase` — `ctx.db.raw`, the Drizzle fluent builder and a
 *   transaction, with no ownership check, or the live instance for a plugin
 *   that declares `capabilities.db.rawSql` and that the app lists in
 *   `db.rawSqlPlugins` (see STABILITY.md).
 */
export type {
  PluginDatabase,
  PluginInsert,
  PluginRawDatabase,
  PluginTransaction,
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
 * `createMany`, and the batch update `updateMany` takes `BulkUpdateEntry[]`.
 * Aggregations beyond `count` use the `ctx.db.raw` escape hatch
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
  BulkUpdateEntry,
} from "nextly";

/**
 * What the rest of `ctx.services` and `ctx.config` expose, by name, so a
 * plugin can type a helper that takes one of them.
 * @experimental `PluginConfig` (`ctx.config`), `PluginSummary` (an entry of
 *   `ctx.config.plugins`), `PluginEmailSettings` (`ctx.config.email`),
 *   `PluginUserService`, `PluginMediaService`, `PluginEmailService`,
 *   `PluginVersionsService` (the methods `ctx.services.users`, `media`,
 *   `email` and `versions` expose), `PluginCollectionTransaction` (what
 *   `ctx.services.collections.withTransaction` hands its work), and the
 *   version pins of `ctx.services.versions.pins`: `PluginVersionPins`,
 *   `PluginVersionPinHolder`, `PluginVersionPin`, `PluginPinOptions`,
 *   `PluginPinTransaction`, `VersionPinHolderDefinition` (what
 *   `registerHolder` takes) and `VersionRef` (the document a pin is on).
 *   `FrozenCopy`
 *   is the readonly-all-the-way-down type `PluginConfig` is built from, and
 *   `FrozenValue` the type of each of its properties, both exported so a
 *   plugin's declaration files can name them. See STABILITY.md.
 */
export type {
  PluginConfig,
  PluginSummary,
  FrozenCopy,
  FrozenValue,
  PluginEmailSettings,
  PluginUserService,
  PluginMediaService,
  PluginEmailService,
  PluginVersionsService,
  PluginCollectionTransaction,
  PluginVersionPins,
  PluginVersionPinHolder,
  PluginVersionPin,
  PluginPinOptions,
  PluginPinTransaction,
  VersionPinHolderDefinition,
  VersionRef,
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
// `AuthenticatedScope` is here because `ctx.authenticatedScope` is on the
// context below: a route helper typed against it otherwise widens to `unknown`,
// and a grant that widens to `unknown` stops being checkable. Kept OUT of the
// braces because `plugin-surface.test.ts` parses the export list textually and
// reads a comment inside it as an export name.
// `PluginRoutePermissionResolver` / `PluginRoutePermissionScope`: a route
// gating on one of the plugin's OWN collections gives a function rather than a
// slug, because the host can rename those. See `PluginRoute`.
//
// ABOVE the braces, never inside them: `plugin-surface.test.ts` splits this
// block on commas without stripping comments, so an inline note is recorded as
// an export name and the real one is not.
/**
 * @experimental The already-booted Nextly instance, for plugin server work with
 *   no route context to reach through.
 *
 *   `ctx.services` covers a plugin handling its own route. It does not cover
 *   work that runs outside one: a field reader resolved at mint time, a
 *   scheduled task, anything given no `ctx`. Those callers have no config in
 *   scope either, so the initialiser is not an option, and this reads what has
 *   already booted and waits for the migration gate rather than refusing while
 *   it is open.
 *
 *   Re-exported here so a plugin depends on the surface its compatibility is
 *   governed on rather than on core's root entry. `@experimental` means no
 *   promise yet, per the ladder above; the point is that the promise is made
 *   about THIS path once it graduates, while an import of core's root would
 *   still be reaching past the boundary that makes one possible.
 */
export { getCachedNextly } from "nextly";

/**
 * @experimental The canonical response envelopes, and the trusted-client-IP
 *   facade. Graduates per D55 once `plugin-form-builder`'s public form routes
 *   ship in a release.
 *
 * A plugin that owns a top-level route answers a browser directly, so it needs
 *   the body shape every first-party endpoint answers in and the address the
 *   deployment's proxy-trust settings resolve. Hand-building either is how a
 *   route that preserved its URL changed its contract underneath the clients
 *   already calling it, and how an author ends up trusting `x-forwarded-for`.
 *
 *   Re-exported HERE rather than left on the `nextly` root, because this is the
 *   surface a plugin author is promised. Reaching into the root entry for them
 *   couples a published plugin to core's internal layout.
 */
export {
  respondAction,
  respondDoc,
  respondList,
  respondMutation,
  trustedClientIp,
} from "nextly";

/**
 * The plugin route types. `PluginRouteCanOptions` is intended to be stable: it
 * is how a route asks `ctx.caller.can` the type-level question (`anyEntry`),
 * answered by the same access decision as plain `can`.
 */
export type {
  PaginationMeta,
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
  AuthenticatedScope,
  GrantedPermission,
  PluginRoutePermissionResolver,
  PluginRoutePermissionScope,
} from "nextly";

// A VALUE, so it cannot ride in the type-only block above. `narrowScope` is the
// only correct way for a route to restrict its own scope before a call: the
// scope's arrays are frozen, and the two spellings a permission is written in
// are derived from one row list, so an edit that reached only one of them would
// leave the field gate holding a grant the route had given up.
export { narrowScope } from "nextly";

// The route matcher's own grammar. A plugin that takes a path from an operator
// has to refuse a pattern while the config is being written, and deciding that
// locally means a second grammar: one stricter than the matcher refuses paths
// that would have routed, and one looser mounts a pattern while reporting a
// single address.
export { routePathIsLiteral } from "nextly";

// Which collections and singles the caller may read, decided by the same rule a
// row read applies. A plugin describing an install to an agent needs the coarse
// set, and deriving it from permission slugs is the second implementation that
// disclosed a refused collection's contents on one surface while hiding a
// code-authorized one on another.
export { readableContent } from "nextly";
export type {
  ReadableContent,
  ReadableContentCaller,
  ReadableContentEntity,
} from "nextly";

/**
 * @experimental A document's stored field values read with no read hook, and
 *   a write of a field made only if the stored value is still the one read.
 *   Graduates once `@nextlyhq/plugin-page-builder`'s component delete has
 *   rewritten site content through it in a release.
 *
 * A plugin that rewrites content it did not author has two problems the
 *   ordinary Direct API cannot solve: a site's `afterRead` hook can hide or
 *   reshape the value it reads, and a check made before the write's
 *   transaction leaves a gap in which an author's save is overwritten.
 *   `readStoredFields` reads the stored form (live row, working draft, one
 *   language) of fields of a plugin field type stored as JSON, judged by the
 *   person's read access. `updateIfUnchanged` makes the ordinary update as
 *   that person, refused with a `CONFLICT` error when the field no longer
 *   hashes, under the write's own row lock, to what was read. Either may be
 *   made as the system (`{ overrideAccess: true }`), judged as the Direct
 *   API's own `overrideAccess: true` call is, by no access rule or field
 *   read rule; the system may read any field stored as JSON, and its read
 *   also gives the live row's lifecycle (`PluginStoredLifecycle`). A
 *   conditional write may also be made as a caller whose expectation the
 *   system read (`PluginSystemCheckedWrite`): the update is the caller's,
 *   under every rule their own update meets, and the expectation the
 *   system's, so a job that reads as the system and writes as the person who
 *   started it asks that person for no read access its write does not need.
 *   `storedValueHash` is the one hash both sides compare.
 */
export { readStoredFields, storedValueHash, updateIfUnchanged } from "nextly";
export type {
  PluginConditionalUpdate,
  PluginConditionalWriteIdentity,
  PluginStoredDocument,
  PluginStoredFields,
  PluginStoredFieldsRequest,
  PluginStoredIdentity,
  PluginStoredLifecycle,
  PluginSystemCheckedWrite,
  PluginSystemIdentity,
  PluginWriteExpectation,
} from "nextly";

/**
 * @experimental Whether a person may delete one entry, asked of the delete's
 *   own gate without deleting it. Graduates with the stored reads above.
 *
 * `ctx.caller.can(action, resource, { anyEntry: true })` answers yes for a
 *   rule that lets a person delete only some entries, so a plugin that does
 *   work before a delete cannot rely on it. `mayDeleteEntry` runs the very
 *   gate the collection delete runs before its hooks: the person's grant, and
 *   a rule's row filter matched against this entry, in every language it
 *   holds. No hook runs, nothing is written, and an entry that does not exist
 *   answers `false`, as one the person may not delete. `mayWriteEntry` asks
 *   the same of a write: the update gate, the lifecycle gate only where the
 *   status the write names moves the document into or out of published (as
 *   core's update decides it), and each named field's update rule, for an
 *   entry or a Single.
 */
export { mayDeleteEntry, mayWriteEntry } from "nextly";
export type { PluginDeleteCheck, PluginWriteCheck } from "nextly";

/**
 * Admin UI contributions (P5, D19–D23) — `contributes.admin` author surface.
 * The component-registration runtime lives on `@nextlyhq/plugin-sdk/admin`.
 *
 * @public `PluginAdminContributions`, `PluginAdminPage`, `PluginCollectionView`,
 *   `PluginMenuItem`, `ComponentPath` — exercised by `plugin-form-builder`.
 *
 * A plugin's widgets are declared with `defineWidget` under
 * `contributes.dashboard`, and startup refuses a plugin that still carries
 * `contributes.admin.widgets`.
 */
export type {
  ComponentPath,
  JsonObject,
  JsonValue,
  PluginAdminContributions,
  PluginAdminPage,
  PluginNavSection,
  PluginCollectionView,
  PluginMenuItem,
} from "nextly";

/**
 * @experimental A collection's document screen, changed by a plugin for that
 * collection only (`contributes.admin.views[slug]`):
 *
 * - `documentActions` hides a built-in action (`"hidden"`) or replaces it
 *   with the plugin's own component (`{ component, label? }`), for the
 *   `OverridableDocumentAction`s `"delete"` and `"unpublish"`. A replaced
 *   action keeps its row, the permission it needs and every reason it cannot
 *   run, and opens the component instead of the built-in write.
 * - `panelSections` adds `PluginPanelSection`s, `{ title, component }`, to the
 *   document panel after Details, under a heading the admin draws.
 *
 * Collections only; a Single's screen is unchanged. Boot refuses an action
 * that cannot be overridden, an override or section with nothing to draw, and
 * two plugins overriding one action on one collection. The props the
 * components receive are on `@nextlyhq/plugin-sdk/admin`.
 *
 * ```ts
 * contributes: {
 *   admin: {
 *     views: {
 *       layouts: {
 *         documentActions: {
 *           unpublish: "hidden",
 *           delete: {
 *             component: "@acme/plugin-layouts/admin#RemoveLayoutDialog",
 *             label: "Remove layout…",
 *           },
 *         },
 *         panelSections: [
 *           { title: "Used by", component: "@acme/plugin-layouts/admin#LayoutUsage" },
 *         ],
 *       },
 *     },
 *   },
 * },
 * ```
 */
export type {
  OverridableDocumentAction,
  PluginDocumentActionOverride,
  PluginDocumentActionOverrides,
  PluginPanelSection,
} from "nextly";

/**
 * Admin places: the named places on admin pages a plugin adds to, and the
 * places a plugin declares on its own pages (`contributes.admin.places`).
 * A plugin types its own places by augmenting `AdminPlaces` from this module.
 * @experimental No first-party plugin declares or adds to a place yet (see
 *   STABILITY.md).
 */
export {
  CORE_ADMIN_PLACES,
  type AdminPlaceId,
  type AdminPlaces,
  type CoreAdminPlaceId,
  type PluginAdminPlaceDeclaration,
} from "nextly";

/**
 * Entry-list filters a plugin declares (`contributes.admin.filters`): each
 * option narrows the list by a `where` the list read applies with the
 * caller's access, and the choice is kept in the page's URL.
 * @experimental No first-party plugin declares a filter yet (see STABILITY.md).
 */
export type {
  PluginListFilterDeclaration,
  PluginListFilterOption,
} from "nextly";

/**
 * Contributions a plugin adds to admin places (`contributes.admin.contributions`):
 * blocks, tabs, list columns, row and bulk actions and side panel sections,
 * each ordered at its place, with a declared visibility rule and permission.
 * @experimental Nothing in the admin draws them yet (see STABILITY.md).
 */
export type {
  AdminBlockContribution,
  AdminBulkActionContribution,
  AdminColumnContribution,
  AdminContribution,
  AdminContributionAction,
  AdminRowActionContribution,
  AdminSidebarSectionContribution,
  AdminTabContribution,
  AdminContributionKind,
  RowPredicate,
  RowPredicateValue,
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
 *
 * @experimental `InTransactionHandler`, `InTransactionContext` — what
 *   `ctx.hooks.onInTransaction`/`offInTransaction` accept: a handler run inside
 *   a write's own transaction, and the write plus the plugin's database bound
 *   to that transaction. New, and not yet exercised by a first-party plugin.
 */
export type {
  BeforeOperationArgs,
  BeforeOperationContext,
  BeforeOperationHandler,
  HookContext,
  HookContextPhase,
  HookHandler,
  HookType,
  InTransactionContext,
  InTransactionHandler,
} from "nextly";

/**
 * @experimental `recordAdvisoryNotice(notice)` — tell the person whose write
 * this is something TRUE about the state it leaves behind, from a hook that
 * runs inside the write's request (an `after*` hook, say): "this page now uses
 * the site's default layout". The write still reports success, and the admin
 * shows the notice beside it as its own advisories are shown, in an info
 * toast, never in failure wording. Throwing from a hook is how a hook says
 * something FAILED; this is for what did not.
 *
 * `AdvisoryNotice` is what it takes: `phase` (the hook's phase), `collection`
 * (the slug, or `single:<slug>`), a stable `code` of the plugin's own, the
 * whole `message`, and the `entryId` it is about when there is one. The
 * message is shown as written: put nothing in it the person could not already
 * see. A no-op outside a request, where there is nobody to tell. Core's own,
 * re-exported deliberately; intended to stay as it is once a first-party
 * plugin has used it in production.
 *
 * ```ts
 * // In an afterChange hook, with `recordAdvisoryNotice` imported from here:
 * recordAdvisoryNotice({
 *   phase: "afterChange",
 *   collection: "pages",
 *   code: "LAYOUT_FELL_BACK",
 *   message: "This page now uses the site's default layout.",
 *   entryId: id,
 * });
 * ```
 */
export { recordAdvisoryNotice, type AdvisoryNotice } from "nextly";

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
 * Account lifecycle events — `user.created` and `user.deleted`, which core
 * emits after the change commits, with `{ userId }`.
 * @experimental `UserEvents`, `UserEventName`, `UserCreatedPayload`,
 *   `UserDeletedPayload` — held experimental until a first-party plugin
 *   subscribes to them (see STABILITY.md).
 */
export {
  UserEvents,
  type UserEventName,
  type UserCreatedPayload,
  type UserDeletedPayload,
} from "nextly";

/**
 * Filter/action registry (D63) — `ctx.filters` / `ctx.actions` surface + seam types.
 * @experimental No first-party plugin contributes a filter/action through this
 *   surface yet (see STABILITY.md).
 */
export {
  FilterSeams,
  type Decision,
  type Filter,
  type Action,
  type CoreFilterSeam,
  type PluginFilterRegistry,
  type PluginActionRegistry,
  type HookPointContext,
  type HookPointNameOf,
  type HookPointPayload,
  type HookPointPayloads,
  type HookPointValue,
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
  AuthLimitAnswer,
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
 * `nextly.jobs.queue`. `ctx.services.jobs.runSweepNow(slug)` runs one of the
 * plugin's OWN sweeps from a request, for a site no scheduler drains
 * (`PluginJobsNamespace`). Held experimental per D55 until a first-party plugin
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
  PluginJobsNamespace,
  QueueJobArgs,
  QueueJobResult,
} from "nextly";

/**
 * @experimental Dashboard widgets (D22/C9) — the vocabularies a source and its
 * query are checked against, and the query contract itself.
 *
 * Nothing here adds, changes or removes a widget or a data source: a plugin's
 * widgets reach the dashboard only through `contributes.dashboard`, each
 * declared with `defineWidget`, whose `load` reads data as the person asking.
 *
 * Forwarded here for the reason the Singles surface above is: a plugin imports
 * only from `@nextlyhq/plugin-sdk` and `@nextlyhq/ui`, never from core. There
 * is no `nextly/widgets` subpath, so this is the only supported spelling.
 *
 * Every contract a published shape NAMES travels with it, the way core's own
 * root export does: a `WidgetSource` is built out of `WidgetSourceField`,
 * `WidgetSourceKind` and `WidgetOp` — a public property whose type has no
 * public name can be inferred but never annotated.
 *
 * Held `@experimental` with `defineWidget`: the widget contract graduates per
 * D55. See STABILITY.md.
 *
 * `WidgetSourceResolver`, `ResolverOptions`, `WidgetScope` and `ReadCaller`
 * are core's own source contract: what a source's resolver is handed and
 * answers with.
 *
 * `callerReadOptions(caller)` turns the caller a resolver is handed into the
 * `ServiceOpts` a managed read takes. Use it rather than assembling them: the
 * two identity shapes do not meet without an assertion, and it also carries
 * the `authenticatedScope` that keeps an API key judged on its OWN stamped
 * grants instead of the roles of whoever minted it.
 */
export {
  WIDGET_OPS,
  WIDGET_SOURCE_KINDS,
  WIDGET_SOURCE_FIELD_TYPES,
  WIDGET_LIFECYCLES,
  WIDGET_CONDITIONS,
  TIMESERIES_INTERVALS,
  isTimeseriesInterval,
  type WidgetLifecycle,
  type WidgetCondition,
  type WidgetSetting,
  type WidgetQuery,
  type WidgetSource,
  type WidgetSourceField,
  type WidgetFieldChoice,
  type WidgetSourceFieldType,
  type WidgetSourceKind,
  type WidgetOp,
  type TimeseriesInterval,
  callerReadOptions,
  type WidgetSourceResolver,
  type ResolverOptions,
  type WidgetScope,
  type ReadCaller,
} from "nextly";

/**
 * Where a finished login may land.
 * @experimental Re-exported so a plugin never keeps its own copy of the rule
 *   that decides whether a redirect is an open one.
 */
export { sanitizeAdminPath, DEFAULT_ADMIN_PATH } from "nextly";

/**
 * Reading what other plugins declared — an identity provider discovering
 * another plugin's declarations, a dashboard listing what it can integrate
 * with — because a plugin may import only from the SDK. `PluginDeclaration`
 * is exported above with the rest of the declaration types.
 * @experimental
 */
export { collectDeclarations } from "nextly";

/**
 * @experimental `markHtml` — mark HTML a plugin's own code built so an email
 *   template writes it unescaped.
 *
 * A template escapes every value it writes; the mark is what turns that off.
 * Only code marks HTML, and only markup that code built itself: never a value
 * from a request, a form, a stored row or another plugin, since marking it
 * lets whatever it holds into the email as markup.
 *
 * Re-exported here so a plugin reaches it through the package it builds
 * against. The same function as the `nextly` root's, so a mark made here is
 * one the template engine recognises.
 */
export { markHtml } from "nextly";
/**
 * @experimental `TrustedHtml` is what `markHtml` returns. Tagged on its own
 *   declaration: a release tag applies to the declaration it precedes.
 */
export { TrustedHtml } from "nextly";
/**
 * @experimental `EmailTemplateData` is the data a template is rendered with:
 *   lists and objects as well as strings, and a `TrustedHtml` wherever code
 *   marked a value.
 */
export type { EmailTemplateData } from "nextly";
