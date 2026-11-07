import {
  allBlocks,
  createNamedQueryRegistry,
  breakpointContexts,
  DEFAULT_LIMITS,
  namedQueryDeclaration,
  resolveSiteTokens,
  tokenIdentity,
  type DocumentLimits,
  type NamedClass,
  type NamedQueryDefinition,
  type NamedQueryRegistry,
  type NamedQuerySource,
  type RemotePattern,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";
import {
  COMPONENT_DOCUMENT_FIELD,
  type NamedQueryLookup,
} from "@nextlyhq/blocks-react";
import {
  definePlugin,
  NextlyError,
  type HookContext,
  readableTitleText,
  resolvedCollectionDraftSplit,
  resolvedCollectionView,
  type PluginCollectionTransaction,
  type PluginCollectionView,
  type PluginDefinition,
  type PluginRouteContext,
  type PluginRouteIdentity,
  type PluginVersionPinHolder,
} from "@nextlyhq/plugin-sdk";
import type { PreviewViewportsDeclaration } from "nextly/config";

// Imported rather than read at runtime so it can never drift from the published
// package: a hardcoded literal had fallen eight releases behind, and
// `validatePluginVersions` checks a contributor's `dependsOn` range against THIS
// value. A static JSON import is inlined by the bundler, so unlike a
// `createRequire` lookup it adds no Node builtin to this entry — which is
// isomorphic and reachable from a browser bundle.
import { version as PLUGIN_VERSION } from "../package.json";

import {
  backfillPageClaims,
  publishedPages,
  type PagesReader,
} from "./address-claims/backfill";
import { committedClaims, type Tx } from "./address-claims/claim-store";
import {
  CONTENT_ADDRESS_SERVICE,
  contentAddressService,
  type ContentAddressService,
} from "./address-claims/content-addresses";
import {
  registerEntryAddressClaims,
  releaseUndeclared,
  settleEntryClaimsAtStart,
  type EntryClaimsDeps,
} from "./address-claims/entry-claims-hook";
import { claimLocales, pageClaims } from "./address-claims/page-claims";
import {
  describeFor,
  registerPageAddressClaims,
} from "./address-claims/page-claims-hook";
import { addressWaitingRoute } from "./address-claims/waiting-report-route";
import { bindingFieldsRoute } from "./binding-fields-route";
import { BINDINGS_TO_FIX_PAGE_HREF } from "./bindings-report/contract";
import { schemaFingerprint } from "./bindings-report/fingerprint";
import { BINDINGS_REPORT_JOB, bindingsReportJob } from "./bindings-report/job";
import { layoutRegionsOf } from "./bindings-report/layout-regions";
import {
  readableAsCaller,
  readableSingles,
  visibleBindings,
} from "./bindings-report/readable";
import { bindingsToFixRoute } from "./bindings-report/route";
import {
  registerBindingReportOnWrite,
  runFullCheck,
  type BindingReportDeps,
} from "./bindings-report/scan";
import { bindingReportStore } from "./bindings-report/store";
import {
  bindingsToFixAttention,
  bindingsToFixWidget,
  EDIT_PAGES_PERMISSION,
} from "./bindings-report/widget";
import {
  BLOCK_SERVICE,
  createBlockRegistrationService,
  registerCoreBlocks,
  registerDeclaredBlocks,
} from "./blocks/registration-service";
import { registerRemovalWriteReport } from "./breakpoint-removal/after-commit";
import { breakpointRemovalJob } from "./breakpoint-removal/job";
import { removalRunStore } from "./breakpoint-removal/run-store";
import {
  BREAKPOINT_REMOVAL_SERVICE,
  breakpointRemovalService,
  type BreakpointRemovalService,
  type RemovalInstall,
} from "./breakpoint-removal/service";
import {
  countRemovalOnSite,
  nameDocumentsOnSite,
} from "./breakpoint-removal/site-counter";
import {
  BINDINGS_TO_FIX_PAGE_COMPONENT,
  BUILDER_VIEW_COMPONENT,
  BUILDER_VIEW_PATH,
  COMPONENT_STORE_DELETE_HOST_COMPONENT,
  DELETE_COMPONENT_REPLACEMENT_COMPONENT,
  ENTRY_DESIGN_SECTION_COMPONENT,
  REMOVE_LAYOUT_ACTION_COMPONENT,
  TEMPLATE_DELETE_COMPONENT,
  TEMPLATE_OWN_DESIGNS_COMPONENT,
} from "./builder-view";
import { canvasBindingsRoute } from "./canvas-bindings-route";
import { canvasPathOption } from "./canvas-path";
import { patternCapabilityRoute } from "./capability-route";
import { blocksFieldReach } from "./class-usage-blocks-fields";
import {
  registerClassUsageMaintenance,
  type CommittedWriteReconciler,
} from "./class-usage-hook";
import { classUsageIndex } from "./class-usage-reconcile";
import { hostFieldReader } from "./class-usage-runtime";
import {
  ADDRESS_CLAIMS_SLUG,
  addressClaimsCollection,
} from "./collections/address-claims";
import { classUsageIndexCollection } from "./collections/class-usage-index";
import {
  COMPONENT_RETIRED_SLUG,
  componentRetiredCollection,
} from "./collections/component-retired-exposures";
import { componentUsageIndexCollection } from "./collections/component-usage-index";
import {
  COMPONENTS_SLUG,
  componentsCollection,
} from "./collections/components";
import { LAYOUTS_SLUG, layoutsCollection } from "./collections/layouts";
import type { PagesCollectionOptions } from "./collections/pages";
import { PAGES_SLUG, pagesCollection } from "./collections/pages";
import { PATTERNS_SLUG, patternsCollection } from "./collections/patterns";
import { templatesCollection, TEMPLATES_SLUG } from "./collections/templates";
import { usageBackfillStateCollection } from "./collections/usage-backfill-state";
import { componentActionRoutes } from "./component-actions-route";
import {
  registerComponentGuards,
  storedUseCheck,
  storeLifecycle,
} from "./component-delete/guards";
import { componentDeleteRoutes } from "./component-delete/route";
import { componentDeleteJob } from "./component-delete/sweep";
import {
  componentFactsRoute,
  componentStoreShape,
  reconciledRetired,
} from "./component-facts-route";
import { componentFromSelectionRoute } from "./component-from-selection-route";
import { indexHostFinder } from "./component-hosts";
import {
  componentPageReach,
  sitePageReachSources,
} from "./component-page-reach";
import { registerComponentReadinessNotice } from "./component-readiness-hook";
import { componentUsageCount, componentUsageIndex } from "./component-usage";
import { seedCompositionGraphLock } from "./composition-graph-lock";
import { manifestRoute } from "./composition-manifest";
import { registerCompositionRejudge } from "./composition-rejudge";
import { COMPOSITION_SERVICE, compositionService } from "./composition-service";
import { withBlockLooks, withCoreLooks } from "./core-looks";
import { declaredSingleSlugs, isOrphanedSingle } from "./declared-singles";
import {
  defaultLayoutJob,
  type EnsureDefaultDeps,
} from "./default-layout/ensure-default";
import {
  installDefaultLayout,
  seedDefaultLayoutAtStart,
  type DefaultLayoutSetup,
} from "./default-layout/install";
import { makeDefaultRoute } from "./default-layout/make-default-route";
import {
  PAGE_BUILDER_SETTINGS_SLUG,
  pageBuilderSettingsSingle,
} from "./default-layout/settings-single";
import { readLayoutSettings } from "./default-layout/store";
import { definitionActionsRoute } from "./definition-actions-route";
import { entriesRoute, titleFieldIn } from "./entries-route";
import type {
  CompositionSetup,
  LayersLockUnjudged,
} from "./fields/blocks-composition";
import { blocksFieldType, BLOCKS_TYPE } from "./fields/blocksField";
import { listFieldsFrom } from "./fields/list-query-judgement";
import { hostFetchPolicy } from "./host-policy";
import type { HostAddress } from "./host-rewrite/contract";
import { fencedComponentsReader, fenceStore } from "./host-rewrite/fence";
import { readSiteFieldGroups } from "./host-rewrite/field-groups";
import { registerInTransactionFence } from "./host-rewrite/in-transaction";
import {
  COMPONENT_DELETE_REWRITE_SERVICE,
  componentDeleteRewriteService,
  type RewriteInstall,
} from "./host-rewrite/service";
import {
  documentHosts,
  siteHostReader,
  siteWalkSource,
  singleToWalk,
  type RewriteDirectApi,
  type SingleToWalk,
} from "./host-rewrite/site";
import {
  layoutChoicesRoute,
  pageCollectionRoute,
} from "./layout-choices-route";
import { registerLayoutComponentGuard } from "./layout-component-guard";
import { registerLayoutReadinessNotice } from "./layout-readiness-hook";
import { layoutFenceFloor } from "./layout-removal/page-reference-guard";
import { removeLayoutRoute } from "./layout-removal/remove-route";
import {
  PAGE_BUILDER_PLUGIN_NAME,
  type SharedStyleUsageKind,
} from "./library-contract";
import {
  componentLibraryRoute,
  DEFAULT_COMPONENT_STORE,
  patternLibraryRoute,
  type ComponentStore,
} from "./library-route";
import { listEntriesRoute } from "./list-entries-route";
import { loopCollectionsRoute } from "./loop-collections-route";
import { namedQueriesRoute, registerNamedQueriesAtBoot } from "./named-queries";
import { warnNestedBlocksFields } from "./nested-blocks-fields";
import { originStore, type OriginStore } from "./origin-store";
import { pageActionsRoute } from "./page-actions-route";
import { pageAddressRoute, pagesSearchRoute } from "./pages-search-route";
import { pagesWriteRoutes } from "./pages-write-route";
import { previewViewportsFromSiteStyle } from "./preview-viewports";
import {
  publishDependenciesRoute,
  publishReadinessRoute,
  type PublishReadinessSetup,
} from "./publish-readiness";
import {
  installRemovalHolds,
  NO_HOLDS,
  removalHoldStore,
  type HoldDirectApi,
  type PlacementCount,
  type RemovalHoldStore,
} from "./removal-hold";
import { removalHoldRoutes } from "./removal-hold-route";
import {
  registerRetiredCleanupCheck,
  RETIRED_CLEANUP_SERVICE,
  retiredCleanupService,
  type RetiredCleanupService,
} from "./retired-cleanup";
import { retiredCleanupJob } from "./retired-cleanup-job";
import {
  blocksFieldPaths,
  registerRetiredExposures,
} from "./retired-exposure-hooks";
import { reconcileRetired, retiredHistoryMemo } from "./retired-history";
import { retiredPins, type RetiredPins } from "./retired-pins";
import { allRetired, retiredStore } from "./retired-store";
import { savePatternRoute } from "./save-pattern-route";
import {
  pageBuilderSchema,
  pageBuilderSchemaPlugin,
} from "./schema/definition";
import {
  LOCK_SHARED_STYLES_DECLARATION,
  firstReadableTitle,
  sharedStyleRoutes,
  storedDocumentsOf,
  type SharedStyleUsageSource,
} from "./shared-styles-routes";
import {
  BREAKPOINT_REMOVAL_UNDONE_AUDIT,
  BREAKPOINT_REMOVAL_UNDONE_METADATA,
  siteBreakpointUndoRoute,
} from "./site-breakpoint-undo";
import {
  SITE_CODE_SAVED_AUDIT,
  SITE_CODE_SAVED_METADATA,
  siteCodeRoutes,
  type PageBuilderSiteCodeOptions,
} from "./site-code/route";
import { siteCodeSingle } from "./site-code/storage";
import {
  resolveFontOptions,
  type PageBuilderFontOptions,
} from "./site-fonts/options";
import { siteFontRoutes } from "./site-fonts/routes";
import {
  BREAKPOINT_REMOVED_AUDIT,
  BREAKPOINT_REMOVED_METADATA,
  MANAGE_SITE_PERMISSION,
  siteBreakpointRemovalRoute,
  siteBreakpointRemovalStatusRoute,
  siteBreakpointsRoute,
  siteSettingsRoute,
  type BreakpointsRouteContext,
  type SiteSettingsRouteContext,
} from "./site-settings";
import { resolveSiteStyle, siteBreakpoints } from "./site-style";
import type { SiteStyleData } from "./site-style";
import { siteStyleExpiry } from "./site-style-expiry";
import { referableClassIds } from "./site-style-record";
import { blocksSurvey, siteStyleRoute } from "./site-style-route";
import {
  loadSiteStyle,
  readStoredSiteStyleVersioned,
  SITE_STYLE_SLUG,
  siteStyleSingle,
  type VariablesInUseCheck,
} from "./site-style-storage";
import {
  configuredSpacingMode,
  readJoiningDecision,
  settleSpacingModeAfterBoot,
  spacingModeJob,
  spacingModeRunInFlight,
  type SpacingModeAtStartDeps,
  type SpacingModeSlugs,
} from "./spacing-mode-at-start";
import {
  SPACING_MODE_SERVICE,
  type SpacingModeReader,
} from "./spacing-mode-reader";
import { spacingModeRoute } from "./spacing-mode-route";
import { spacingModeStore, type SpacingModeStore } from "./spacing-mode-store";
import {
  holdTemplateCollection,
  templateCollectionDelete,
} from "./templates/collection-delete";
import {
  designUnderWhere,
  registerEntryDesignCascade,
} from "./templates/entry-design-cascade";
import { judgeTemplateInTransaction } from "./templates/entry-design-write";
import { entryDesignsRoute } from "./templates/entry-designs-route";
import {
  templateActionsRoute,
  templateRoutingRoute,
} from "./templates/template-actions-route";
import {
  addressSegments,
  checkedTemplateAddresses,
  type PageBuilderTemplateOptions,
} from "./templates/template-addresses";
import {
  addressHolderReader,
  registerTemplateGuard,
  storedAddressesReader,
  templateCollectionProblem,
  templateHolderReader,
  templateTargets,
  type TemplateGuardSetup,
} from "./templates/template-guard";
import {
  templatePreviewEntriesRoute,
  templatePreviewEntryRoute,
} from "./templates/template-preview-route";
import {
  MANAGE_TEMPLATE_ROUTING_DECLARATION,
  storedAddressOf,
  storedAddressProblem,
  TEMPLATE_ADDRESS_FIELD,
} from "./templates/template-routing";
import { unlinkCopies } from "./templates/unlink-copies";
import { tokenUsageIndex } from "./token-usage";
import { exportRoutes } from "./transfer/export-route";
import { importRoute } from "./transfer/import-route";
import { unbindPlanRoute } from "./unbind-plan-route";
import { usageBackfillJob } from "./usage-backfill-job";
import {
  backfillScopes,
  forgetGoneScopes,
  usageBackfillDeps,
  type BackfillHost,
} from "./usage-backfill-wiring";
import { usageBookkeeping } from "./usage-bookkeeping";
import { listDocumentsUsingEach } from "./usage-count";
import {
  USAGE_HEALTH_SERVICE,
  usageHealthService,
} from "./usage-health-service";
import type { UsageIndex, UsageSubject } from "./usage-index";
import {
  usageIndexStores,
  usageTableOf,
  usageTableRows,
} from "./usage-index-tables";
import {
  variableRemovalChecks,
  variableRoutes,
  variablesInUseCheck,
} from "./variables-routes";
import { variantUseRoute } from "./variant-use-route";
import { SINGLE_HOOK_NAMESPACE } from "./write-target";

/**
 * What the plugin-owned `pages` collection is built with, resolved from the
 * host's options.
 *
 * Separated from the factory because it is a decision rather than an assembly
 * step: it is where "a page-builder site's default presets are its own
 * breakpoints" is stated, and reading it beside the collection list would
 * scatter that across the contribution block.
 */
function pagesOptions(
  opts: PageBuilderOptions,
  configStyle: SiteStyleData,
  validateLayout: PagesCollectionOptions["validateLayout"]
): PagesCollectionOptions {
  return {
    ...(validateLayout === undefined ? {} : { validateLayout }),
    ...(opts.pagePreviewPath === undefined
      ? {}
      : { previewPath: opts.pagePreviewPath }),
    ...(pagePreviewBreakpoints(opts, configStyle) ?? {}),
  };
}

/**
 * The viewport declaration the pages preview carries, or nothing.
 *
 * Answers with a whole `{ breakpoints }` fragment rather than a value, so the
 * "offer none" case is an ABSENT key instead of an explicit `undefined`:
 * `resolvePreviewViewports` reads an absent declaration as "offer nothing", and
 * the pane then falls back to Responsive and a custom width.
 */
function pagePreviewBreakpoints(
  opts: PageBuilderOptions,
  configStyle: SiteStyleData
): { breakpoints: PreviewViewportsDeclaration } | undefined {
  if (opts.pagePreviewBreakpoints === false) return undefined;
  if (opts.pagePreviewBreakpoints !== undefined) {
    return { breakpoints: opts.pagePreviewBreakpoints };
  }

  /*
   * The default, and the reason this option exists at all: a page-builder
   * site's breakpoints ARE the widths its stylesheet changes at, so they are
   * the only widths a preset can name without making a claim about somebody
   * else's CSS.
   *
   * Read per mint rather than captured here, because an author edits them in
   * the page builder — a list read once at construction would size the frame to
   * a tier the site no longer has.
   */
  return {
    breakpoints: previewViewportsFromSiteStyle({
      /*
       * Imported at call time, not at module scope. This runs per mint on the
       * server, and a static import would pull the Direct API graph into every
       * consumer of this plugin — including the browser bundle the canvas ships
       * in, which has no use for it and cannot run it.
       */
      reader: async () => {
        const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
        const nextly = await getCachedNextly();
        return { findSingle: args => nextly.findSingle(args) };
      },
      // The code tier, which always holds the core blocks' looks.
      defaults: configStyle,
    }),
  };
}

/**
 * Where the plugin was told component definitions live, for every reader.
 *
 * ONE derivation, handed to the editor's library route and to the readiness
 * notice alike, so a host that keeps its definitions in a collection of its
 * own says so once and both follow. Turned-off readiness says nothing about
 * the store, so the editor reads the plugin's own — the honest default for a
 * host whose definitions come from no collection at all, which no collection
 * read can follow.
 */
function componentStoreOf(opts: PageBuilderOptions): ComponentStore {
  const readiness = opts.componentReadiness;
  if (readiness === false || readiness === undefined) {
    return DEFAULT_COMPONENT_STORE;
  }
  return {
    ...(readiness.collection === undefined
      ? {}
      : { collection: readiness.collection }),
    field: readiness.field ?? COMPONENT_DOCUMENT_FIELD,
  };
}

/**
 * Whether the plugin's own Components collection is the component store: no
 * host store is named, or the one named is it.
 */
function storeIsOwn(store: ComponentStore): boolean {
  return store.collection === undefined || store.collection === COMPONENTS_SLUG;
}

/**
 * The admin views that route a component's delete through Delete component,
 * on the store's collection and no other: the plugin's own when no host store
 * is named, else the host's.
 */
function deleteComponentViews(
  store: ComponentStore
): Record<string, PluginCollectionView> {
  const replaced = {
    documentActions: {
      delete: {
        component: DELETE_COMPONENT_REPLACEMENT_COMPONENT,
        label: "Delete component…",
      },
    },
  };
  return store.collection === undefined || storeIsOwn(store)
    ? { [COMPONENTS_SLUG]: replaced }
    : { [store.collection]: replaced };
}

/**
 * Refuse a component store that shares a slug with a collection this plugin
 * declares, other than naming its own Components collection.
 *
 * The delete's surfaces are keyed by the store's slug, and a key that is one
 * of the plugin's own slugs is read as that plugin collection, through any
 * rename: a host store named `patterns` would get Delete component on the
 * plugin's Patterns, and one named `components` while the plugin's own is
 * renamed would get it on the renamed collection, while the delete itself
 * acts on the host's. Ambiguous either way, so refused, naming both, rather
 * than guessed. `resolved` is the plugin's collections as the site renamed
 * them, known from `init`; without it, only the declared names are judged.
 */
function refuseStoreSharingAPluginSlug(
  store: ComponentStore,
  declared: readonly string[],
  resolved?: Readonly<Record<string, string | undefined>>
): void {
  const slug = store.collection;
  if (slug === undefined) return;
  if (slug === COMPONENTS_SLUG) {
    const renamed = resolved?.[COMPONENTS_SLUG] ?? COMPONENTS_SLUG;
    if (renamed === COMPONENTS_SLUG) return;
    throw new Error(
      `[page-builder] componentReadiness.collection names "${slug}", but the Page Builder's own Components collection is renamed to "${renamed}". Leave componentReadiness.collection unset to keep components in the plugin's collection, or give the host's store a slug the Page Builder does not declare.`
    );
  }
  if (declared.includes(slug)) {
    throw new Error(
      `[page-builder] componentReadiness.collection names "${slug}", which is also a collection the Page Builder declares. A component store of the host's own needs a slug of its own: rename the host's collection, or leave componentReadiness.collection unset to use the plugin's Components collection.`
    );
  }
}

/**
 * A host's own component store's slug, or `undefined` when the store is the
 * plugin's own collection.
 */
function hostStoreOf(store: ComponentStore): string | undefined {
  return store.collection === undefined || storeIsOwn(store)
    ? undefined
    : store.collection;
}

/**
 * Wire the publish-readiness notice, unless the host turned it off.
 *
 * Lifted out of `init` rather than left inline: initialisation is a list of
 * registrations, and a branch resolving four settings inside it makes the list
 * harder to read than the decision is. Off means NOT REGISTERED, rather than
 * registered and declining per write — a hook that runs on every save to answer
 * "not my business" is cost with no product.
 */
function registerReadinessNotice(
  // Named structurally rather than by importing the plugin context type: only
  // the capabilities used are declared, so a later edit reaching for a service
  // this has no business with shows up as a type error here.
  ctx: {
    self: { collections: Record<string, string | undefined> };
    hooks: unknown;
    services: unknown;
  },
  opts: PageBuilderOptions
): void {
  const readiness = opts.componentReadiness;
  if (readiness === false) return;
  registerComponentReadinessNotice({
    ctx: ctx as never,
    // The RESOLVED slug, for the reason the index slug is resolved: an
    // integrator may rename the collection, and a hook holding the literal
    // would ask about a table that does not exist and report every embedded
    // component as unpublished.
    componentCollection:
      componentStoreOf(opts).collection ??
      ctx.self.collections[COMPONENTS_SLUG] ??
      COMPONENTS_SLUG,
    // Defaults to the field the RENDERER defaults to, so the check reads the
    // document the page draws from rather than every blocks field the store
    // happens to have.
    componentField: componentStoreOf(opts).field,
    // Layouts name their area components in a repeater; read through it, a
    // Layout published with an unpublished header is reported as a page is.
    layoutCollection: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    // The SAME bounds the renderer draws under, asked per call. A notice
    // derived under different ones names components inside a document the page
    // never renders.
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    ...optionalScope(readiness),
  });
}

/** What the publish-readiness routes read, from the same options the notice does. */
function publishReadinessSetup(
  opts: PageBuilderOptions
): PublishReadinessSetup {
  return {
    store: componentStoreOf(opts),
    enabled: opts.componentReadiness !== false,
    limits: () => opts.limits ?? DEFAULT_LIMITS,
  };
}

/**
 * The two settings that are absent by default rather than defaulted.
 *
 * Spread as a unit so the registration above stays a list of resolved values.
 * Both narrow what the notice speaks about, and both are unset for the ordinary
 * install: a collection declares one blocks field, and every collection with
 * one is content some route renders.
 */
function optionalScope(
  readiness: Exclude<PageBuilderOptions["componentReadiness"], false>
): {
  pageField?: string;
  renderedCollections?: readonly string[];
} {
  return {
    ...(readiness?.pageField === undefined
      ? {}
      : { pageField: readiness.pageField }),
    ...(readiness?.renderedCollections === undefined
      ? {}
      : { renderedCollections: readiness.renderedCollections }),
  };
}

export interface PageBuilderOptions {
  /** Disable behavior while still applying schema. Default true. */
  enabled?: boolean;
  /**
   * The document limits pages are rendered under, when they are not the
   * engine's defaults.
   *
   * Set the SAME value here and on `PageRenderer.limits` (or on the style
   * context it reads). The renderer decides which nodes a page draws; this
   * decides which nodes the class-usage index counts, and both ask the engine
   * the same question through `selectNodes`. Handing them different bounds
   * makes them answer about different documents — a class applied to a node the
   * page renders would be missing from the index, and a usage-based delete
   * reads that absence as "not used".
   *
   * Left unset, both use the engine defaults and agree by construction.
   */
  limits?: DocumentLimits;
  /**
   * The site's named queries: a collection list's custom sources, made with
   * `defineNamedQuery` from `@nextlyhq/plugin-sdk/blocks`. Registered on each
   * boot beside the ones plugins declare, all or nothing.
   *
   * @experimental
   */
  namedQueries?: readonly NamedQueryDefinition[];
  /**
   * Where component definitions live: what publishing a page checks when it
   * warns that some are not live, and what the EDITOR reads to draw them.
   *
   * Defaults to the component store this plugin contributes, which is where the
   * renderer reads them from unless a route says otherwise. A route MAY say
   * otherwise: `createBlocksPage` accepts `componentCollection` to name a
   * different store and `resolveComponents` to supply definitions from
   * somewhere that is not a collection at all. Neither is visible from here —
   * the route is configured in the host's app — so a host that redirected the
   * renderer must redirect this too, or the notice judges the page against a
   * store it does not render from and reports live components as missing, and
   * the editor draws a different definition for the same id than the page
   * does, or none. Naming `collection` and `field` here redirects both at once.
   *
   * `false` turns the notice off, which is the honest setting for a host whose
   * definitions come from a custom `resolveComponents` source: no collection
   * can answer the question, so asking one produces a warning about nothing.
   * The editor then reads the plugin's own store, the one thing it can read.
   */
  componentReadiness?:
    | false
    | {
        collection?: string;
        field?: string;
        pageField?: string;
        /**
         * The collections a route renders. Unset, every collection with a
         * blocks field is examined; named, the notice stays quiet about
         * content no route serves, since claiming components "will not appear
         * for visitors" is a claim about a page that does not exist.
         */
        renderedCollections?: readonly string[];
      };
  /**
   * Whether the editor shows its getting-started checklist. Default true.
   *
   * A site that teaches its authors the editor some other way turns it off
   * here rather than asking every one of them to dismiss it. Travels to the
   * browser through `clientConfig` for the same reason `remotePatterns` does:
   * the canvas runs there, where a server-side option cannot reach it.
   */
  checklist?: boolean;
  /**
   * Remote hosts a page may load images, video and embeds from, in the same
   * shape `next/image` uses.
   *
   * The editor canvas renders the same blocks the published page does, so it
   * has to enforce the same allowlist — otherwise it hides media the live page
   * shows, and the preview stops being a preview. Declared here rather than
   * only on `PageRenderer` because the canvas runs in the browser, where a
   * component prop from the host's server config cannot reach it.
   *
   * Set the SAME value on `PageRenderer.remotePatterns` from
   * `@nextlyhq/plugin-page-builder/render`, and pass it to `cspDirectives()` or
   * `cspHeaderValue()`. Three assignments: each surface reads only what it was
   * handed, and the CSP helpers default to an empty list.
   *
   * Even then the three are not identical. CSP cannot express a `pathname` or
   * `search` constraint, so `cspDirectives()` omits such a host rather than
   * widening the policy to its whole origin; `unexpressibleHosts()` reports what
   * it refused so the host can write that source itself.
   *
   * **Enforced for** the built-in block renderers and structured style values,
   * through `isFetchableUrl`; the embed HTML sanitizer; the editor canvas. A
   * CUSTOM block is handed the patterns and must apply them itself — `RenderNode`
   * passes them in and cannot inspect the element a block returns.
   *
   * **Not custom CSS.** `sanitizeCustomCss` takes no patterns and drops every
   * url naming a host, whether by scheme — including `https://site.example/a.png`,
   * the site's own origin, since compilation has no document origin to compare
   * against — or by the scheme-less `//cdn.example/a.png`. What survives is a
   * path naming no host: `/a.png`, `a.png`. That is a property of the stored
   * TEXT, not of the eventual request — a cross-origin `<base href>` on the
   * host document re-points every such path at another origin, which is a
   * surface a parser cannot reach and one reason `cspDirectives()` emits
   * `base-uri`. That surface is stricter than this value, not governed by it.
   *
   * **Also `@nextlyhq/blocks-react`**, which now bounds what a published page
   * fetches — but only when it is TOLD to, and from its own field. Pass the same
   * list as `hostPolicy={{ remotePatterns }}` on its `PageRenderer`, or as
   * `hostPolicy` in `createBlocksPage({ ... })`. Leaving it unset while this is
   * configured means the editor and the published page enforce different rules,
   * which is the failure this note exists to prevent: the canvas refuses a host
   * the live page then loads.
   *
   * That covers the three ways the published page reaches out — a block's own
   * markup, the compiled stylesheet, and the link-preview image in metadata.
   * The renderer's remaining checks are about SCHEMES and stay narrower than a
   * host rule: the engine's CSS compiler limits an explicit scheme to
   * `http`/`https` and leaves a scheme-less value alone, so `//cdn.example/a.png`
   * passes the scheme check and is judged by the host list instead; a block's
   * attribute props admit `http`, `https`, `mailto` and `tel` and refuse every
   * other scheme.
   *
   * A CUSTOM block written against `blocks-react` is bounded only if it asks,
   * for the same reason as above: the boundary sees the element a block returned
   * and not the URLs it chose. `hostPolicy.trustedFrameOrigins` remains a
   * separate question — it decides whether an embed keeps its own origin, which
   * is a sandbox permission rather than whether the frame is loaded.
   *
   * Object patterns only. This value is serialized to the browser and a `URL`
   * does not survive that: it would arrive as a string. Converting one here
   * would mean deciding what its default `pathname` of `"/"` means as a glob,
   * and guessing at that in a security control is worse than declining the
   * input.
   */
  remotePatterns?: readonly RemotePattern[];
  /**
   * The site's style DEFAULTS: tokens, fonts, named classes and breakpoints
   * stated in code. The stored Site Style document layers over these —
   * `resolveSiteStyle` in `site-style` is the one merge — so a site whose
   * design lives in the repository states it here, and an admin's saved edit
   * overrides exactly what it names and nothing else.
   *
   * Feeds two surfaces from one statement: the blocks field's server-side
   * validator judges documents against these breakpoints, and the editor
   * canvas compiles its preview sheet from the whole set (it travels through
   * `clientConfig`, so it must hold nothing secret — it is emitted into the
   * CSS of every public page anyway).
   *
   * A published route states the same value once more, on `loadSiteStyle`'s
   * `defaults`, for the same reason `remotePatterns` appears on more than one
   * surface: the route helper runs where this option cannot reach it. Define
   * the object once and hand it to both.
   */
  siteStyle?: SiteStyleData;

  /**
   * Where this application serves its pages, as a path with `{field}`
   * placeholders — `"/{slug}"` for a blocks page at the site root,
   * `"/blocks/{slug}"` for one mounted under a prefix.
   *
   * **Setting this is what enables shareable preview links for pages**, and
   * there is deliberately no default. The plugin cannot install the host's
   * preview route or its draft gate, and cannot discover where pages are
   * mounted — so a defaulted path would let an editor mint a link that resolves
   * to nothing, while declaring nothing gets them an explanation instead.
   */
  pagePreviewPath?: string;

  /**
   * Where this application serves the editor's canvas route: the path of a
   * route whose page is `PageBuilderCanvas` from
   * `@nextlyhq/plugin-page-builder/canvas`, inside the layouts the site's
   * pages are published in.
   *
   * **Setting this is what draws the canvas inside the site's own layout**, so
   * its global stylesheets, fonts, header and footer show around the page
   * being edited exactly as they do around the published page. There is no
   * default, for the reason `pagePreviewPath` has none: the plugin cannot add
   * a route to the application, and a defaulted path would load a page that is
   * not there. Without it, the canvas draws on a blank page of the editor's own
   * and says so.
   *
   * A path on this site only, such as `"/page-builder-canvas"`: the editor
   * draws into the frame's document, which a browser allows on its own origin
   * alone.
   *
   * A site whose pages sit under their language writes `{locale}` where the
   * code goes, as in `"/{locale}/page-builder-canvas"`: the editor loads the
   * route for the language being edited, and for the default language leaves
   * the segment out, as most localized sites serve it.
   */
  canvasPath?: string;

  /**
   * The viewport widths the pages preview offers.
   *
   * Defaults to **this site's own breakpoints**, read from the `site-style`
   * single at the moment a preview link is minted. That default is the whole
   * point: a page-builder site's breakpoints ARE the widths its stylesheet
   * changes at, so they are the only widths a preset can name without making a
   * claim about somebody else's CSS — and requiring every host to wire that up
   * by hand would leave the feature switched off for the workflow it was built
   * for.
   *
   * Read per mint rather than captured here, because an author edits those
   * breakpoints in the page builder: a list read once at boot would size the
   * frame to a tier the site no longer has.
   *
   * Pass a list or a function of your own to override it, or `false` to offer
   * none — the pane then falls back to Responsive and a custom width, which is
   * everything it can offer honestly without inventing numbers.
   *
   * Ignored without a `pagePreviewPath`: there is no preview to offer them on.
   */
  pagePreviewBreakpoints?: PreviewViewportsDeclaration | false;

  /**
   * Catalogue fonts in Design → Fonts. Adding one makes the SERVER download
   * its files from the catalogue into the site's media, so published pages
   * load fonts only from the site. The server reaches the two catalogue hosts
   * (declared as this plugin's outbound hosts) and nothing else. `{ catalogue:
   * false }` turns the catalogue off; uploading a font file still works.
   */
  fonts?: PageBuilderFontOptions;

  /**
   * Site code: the code people who may change the site's settings add to
   * every published page, in Settings, under Site. Declare the site's
   * Content Security Policy here (`csp`, a header value or a function read on
   * each check) so code is checked against it before it is saved.
   *
   * @experimental
   */
  siteCode?: PageBuilderSiteCodeOptions;

  /**
   * Collection templates: where each collection defined in code serves its
   * entries, drawn with the collection's published template.
   *
   * ```ts
   * pageBuilder({ templates: { addresses: { posts: "/blog" } } });
   * ```
   *
   * serves each published post at `/blog/<its slug>` from the site's content
   * route (`createContentPage` with `pageBuilderContent()`), once the
   * collection's template is published. An address not in its one spelling,
   * or under a path the runtime keeps, refuses to start; so do two
   * collections given one address, and a collection that cannot have a
   * template.
   *
   * @experimental New public surface: its name and shape may change before
   * it is marked stable.
   */
  templates?: PageBuilderTemplateOptions;
}

/**
 * The code tier refreshed with every registered block's looks, other
 * plugins' among them, once they have all registered at init. Updated in
 * place: every reader holds this one object and this one set, and none has
 * read them yet.
 */
function refreshCodeTier(
  configStyle: SiteStyleData,
  configClassIds: Set<string>,
  siteStyle: SiteStyleData | undefined
): void {
  configStyle.classes = resolveSiteStyle(
    withBlockLooks(siteStyle, allBlocks())
  ).classes;
  configClassIds.clear();
  for (const entry of configStyle.classes ?? []) configClassIds.add(entry.id);
}

/**
 * What the plugin publishes to the editor in the browser, as the admin's
 * `clientConfig`, or nothing when the host stated none of it.
 *
 * The canvas runs in the browser, where a server-side option cannot reach it,
 * so what it needs travels with the rest of the admin metadata: the media
 * allowlist, the checklist, the canvas route, the site style, the document
 * limits and whether there is a font catalogue. All of it is plain data that
 * survives the trip, and the serializer rejects a future addition that does
 * not.
 *
 * Sent only when the host said something. An always-present `clientConfig`
 * would make every future reader distinguish "the host set this" from "the
 * default is showing", which is what the absent key already says. Each key is
 * written only where the host stated it, so a config with no key is one the
 * host said nothing in.
 */
function adminClientConfig(
  opts: PageBuilderOptions,
  {
    configStyle,
    canvasPath,
    fontsOff,
  }: {
    configStyle: SiteStyleData;
    canvasPath: string | undefined;
    fontsOff: boolean;
  }
): { clientConfig?: Record<string, unknown> } {
  const clientConfig: Record<string, unknown> = {
    // The Fonts tab offers no catalogue when the host turned it off, rather
    // than one whose routes do not exist.
    ...(fontsOff ? { fontCatalogue: false } : {}),
    ...(opts.remotePatterns === undefined
      ? {}
      : { remotePatterns: opts.remotePatterns }),
    ...(opts.checklist === undefined ? {} : { checklist: opts.checklist }),
    // A host's own component store, by slug, for the delete tools the header
    // draws for its list. A slug, nothing secret.
    ...(hostStoreOf(componentStoreOf(opts)) === undefined
      ? {}
      : { componentStore: hostStoreOf(componentStoreOf(opts)) }),
    // The canvas route's path, which the editor loads its frame from. A path,
    // never a secret: the route serves an empty page.
    ...(canvasPath === undefined ? {} : { canvasPath }),
    // The RESOLVED defaults tier rather than the raw option, so the canvas and
    // the validator read one answer. Plain data: tokens, fonts, classes and
    // breakpoints all serialize, and none of it is secret — a published page
    // emits it as CSS.
    // Always stated: the code tier holds the core blocks' looks even when the
    // host states no site style of its own.
    siteStyle: configStyle,
    /*
     * The bounds the renderer draws under, so the admin asks the same question
     * the page answers. The classes manager walks the open document to say
     * which classes a page applies, and a walk under different limits selects
     * different nodes — reporting a class as absent from a page that renders
     * it. Plain numbers, and nothing secret: the published page is drawn under
     * them.
     */
    ...(opts.limits === undefined
      ? {}
      : { limits: jsonSafeLimits(opts.limits) }),
  };
  return Object.keys(clientConfig).length === 0 ? {} : { clientConfig };
}

/**
 * The Page Builder plugin factory. Call it in a host app's
 * `defineConfig({ plugins: [pageBuilder()] })`.
 */
/**
 * Document limits in a form that survives the client-config round trip.
 *
 * `clientConfig` is refused at BOOT unless it is delivered unchanged through
 * JSON, and `Infinity` is not a JSON value — it round-trips to `null`, so
 * publishing it raw takes the whole plugin down. An infinite bound is
 * deliberately supported by the engine, whose byte measurement refuses to
 * reject one, so it has to be carried rather than dropped.
 *
 * `null` is the wire spelling for "no bound", and the admin reads it back as
 * `Infinity`. Encoded here because this is where the value crosses into JSON.
 */
function jsonSafeLimits(limits: DocumentLimits): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(limits).map(([key, value]) => [
      key,
      Number.isFinite(value) ? value : null,
    ])
  );
}

/** What {@link singlesRegistryPages} yields for a registry it cannot read whole. */
const UNREADABLE_PAGE = Symbol("unreadable registry page");

/**
 * The Singles registry, a page at a time, ending after the last one; or
 * {@link UNREADABLE_PAGE}, and then nothing more, when a page is not shaped as
 * one or the population changed while it was listed.
 *
 * The count the first page reported is held because this walk pages by OFFSET,
 * so it carries the same shift as the collection registry above: a Single
 * deleted behind the cursor moves the rest back and one is never read. Here the
 * missed row could be a Single that HOLDS blocks, so a changed count is read as
 * a registry that cannot be read whole.
 */
async function* singlesRegistryPages(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): AsyncGenerator<readonly unknown[] | typeof UNREADABLE_PAGE> {
  let expected: number | undefined;
  for (let offset = 0; ; offset += REGISTRY_PAGE_SIZE) {
    const listed: unknown = await ctx.services.singles.list({
      offset,
      limit: REGISTRY_PAGE_SIZE,
    });
    const rows = (listed as { data?: unknown }).data;
    const total = (listed as { total?: unknown }).total;
    if (!Array.isArray(rows) || typeof total !== "number") {
      yield UNREADABLE_PAGE;
      return;
    }
    expected ??= total;
    if (total !== expected) {
      yield UNREADABLE_PAGE;
      return;
    }
    yield rows;
    // Bounded by BOTH, so neither a `total` that disagrees with the rows nor an
    // empty page can spin this. An empty page with work still claimed is the
    // shape that would otherwise loop for ever.
    if (rows.length === 0 || offset + rows.length >= total) return;
  }
}

/** How many registry rows one page of the collection listing asks for. */
const REGISTRY_PAGE_SIZE = 100;

/**
 * Every collection's registry record, page by page, for the schema
 * fingerprint the bindings report checks against. Refused when a page cannot
 * be read, so a fingerprint is never taken over part of the registry.
 */
async function collectionRegistryRows(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const listed: unknown = await ctx.services.collections.listCollections(
      { page, limit: REGISTRY_PAGE_SIZE, sortBy: "slug", sortOrder: "asc" },
      undefined as never
    );
    const data = (listed as { data?: unknown }).data;
    const hasMore = (listed as { pagination?: { hasMore?: unknown } })
      .pagination?.hasMore;
    if (!Array.isArray(data) || typeof hasMore !== "boolean") {
      throw new Error(
        "[page-builder] the collection registry could not be read for the bindings report"
      );
    }
    rows.push(...data);
    if (!hasMore || data.length === 0) return rows;
  }
}

/** Every Single's registry record, for the same fingerprint. */
async function singleRegistryRows(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for await (const page of singlesRegistryPages(ctx)) {
    if (page === UNREADABLE_PAGE) {
      throw new Error(
        "[page-builder] the Singles registry could not be read for the bindings report"
      );
    }
    rows.push(...page);
  }
  return rows;
}

/** How many field groups one read of the registry asks for. */
const FIELD_GROUP_PAGE_SIZE = 100;

/**
 * Every field group's registry record, for the same fingerprint: a binding
 * reaches a field group's fields where a collection or a Single places it, so
 * a change to one changes what those bindings are judged against.
 */
async function fieldGroupRows(): Promise<unknown[]> {
  const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
  const nextly = await getCachedNextly();
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += FIELD_GROUP_PAGE_SIZE) {
    const page = await nextly.fieldGroups.find({
      limit: FIELD_GROUP_PAGE_SIZE,
      offset,
    });
    rows.push(...page.items);
    // Bounded by a short page, so an empty one ends the read.
    if (page.items.length < FIELD_GROUP_PAGE_SIZE) return rows;
  }
}

/** How often a read of the bindings report may start a check, at most. */
const BINDINGS_REFRESH_MS = 60_000;

/** How long a check a read starts may run. */
const BINDINGS_REFRESH_RUN_MS = 20_000;

/**
 * How long a save removing breakpoints walks the site before it answers with
 * the run to carry on: short enough to answer well inside a request's time,
 * long enough that a small site finishes in the save itself.
 */
const REMOVAL_WALK_MS = 9_000;

/**
 * How long a save removing breakpoints counts what they held, for the audit
 * trail, before it records what it has: with the walk, a save answers within
 * about fifteen seconds.
 */
const REMOVAL_COUNT_MS = 5_000;

/**
 * What the font catalogue adds to the plugin: the two hosts its server may
 * reach, its routes, and whether the host turned it off. Worked out once, so
 * the plugin's definition spreads the parts rather than asking at each.
 */
function fontCatalogueParts(fonts: ReturnType<typeof resolveFontOptions>): {
  off: boolean;
  capabilities: { capabilities?: { net: { outbound: string[] } } };
  routes: ReturnType<typeof siteFontRoutes>;
} {
  if (fonts === false) return { off: true, capabilities: {}, routes: [] };
  return {
    off: false,
    capabilities: { capabilities: { net: { outbound: [...fonts.outbound] } } },
    routes: siteFontRoutes({ fonts }),
  };
}

/**
 * Every collection slug the registry holds, or `undefined` when it could not
 * be read.
 *
 * PAGED, and the paging is the point rather than a formality. The listing is
 * paginated, so a single unpaged call returns the server's default page — and
 * the collections past it would simply have no scopes, while completion is
 * judged against that same short list and reports the index whole. That is the
 * defect this enumeration exists to remove, reintroduced by reading it
 * carelessly.
 *
 * `hasMore` is what ends the loop, so the read is exhausted rather than assumed
 * to fit. A page that cannot be understood ends it as a REFUSAL — `undefined`
 * rather than what was collected so far — because a short list here is
 * indistinguishable from a small site.
 */
export async function registeredCollectionSlugs(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): Promise<readonly string[] | undefined> {
  const slugs: string[] = [];

  // The row count the first page reported, so a population that CHANGED while
  // this walked is refused rather than partially read. The listing pages by
  // offset, so deleting a row the walk has already passed shifts everything
  // behind it back and the next page starts one row late — the row that crossed
  // the boundary is never seen. It gets no scopes, completion is judged against
  // a list missing it, and health reports the index whole while that
  // collection's documents are unindexed. That is the confident-zero this
  // enumeration exists to remove, arriving through the paging.
  //
  // The service offers no cursor, only `page`/`limit`, so a keyset walk is not
  // available here. Comparing the total is what IS available, and it catches
  // the deletion this fails on. It does not catch a delete and a create in the
  // same window, which leaves the count unchanged — stated rather than implied,
  // because a fence that reads as complete is worse than one with a named edge.
  let expected: number | undefined;

  for (let page = 1; ; page += 1) {
    const listed: unknown = await ctx.services.collections.listCollections(
      // Ordered so the pages partition the rows: an unordered paged read has no
      // defined order between pages, so a slug can appear twice or not at all.
      { page, limit: REGISTRY_PAGE_SIZE, sortBy: "slug", sortOrder: "asc" },
      // A sweep acts as nobody, and listing which collections exist is not the
      // privileged part.
      undefined as never
    );

    const rows = (listed as { data?: unknown }).data;
    const pagination = (
      listed as {
        pagination?: { hasMore?: unknown; total?: unknown };
      }
    ).pagination;
    if (
      !Array.isArray(rows) ||
      typeof pagination?.hasMore !== "boolean" ||
      typeof pagination.total !== "number"
    ) {
      return undefined;
    }
    expected ??= pagination.total;
    if (pagination.total !== expected) return undefined;

    for (const row of rows) {
      const slug = (row as { slug?: unknown }).slug;
      // A row whose slug cannot be read is a collection this cannot enumerate,
      // and dropping it silently is the same defect as a short page: its scopes
      // are never created, so completeness is judged against a list missing it
      // and reports the index whole while that collection's content is
      // unindexed. Refused rather than skipped, for the reason every other
      // unreadable input here is.
      if (typeof slug !== "string" || slug.length === 0) return undefined;
      slugs.push(slug);
    }

    if (!pagination.hasMore) return slugs;
  }
}

/**
 * Turn the installed plugin context into what a backfill pass needs.
 *
 * Every member is a FUNCTION rather than a resolved value, and that is the
 * whole shape of it. A site can gain a collection, a locale or a draft variant
 * after boot, and the Direct API is not resolvable until services are
 * registered — so anything captured here would be a fact about the moment the
 * plugin was installed, used to decide whether an index covering the site as it
 * is now is complete.
 */
function installContext(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  opts: PageBuilderOptions
): BackfillHost {
  return {
    /*
     * Imported at CALL time, not at module scope, for the reason the preview
     * reader above gives: this entry is isomorphic and reachable from a browser
     * bundle, and `nextly/runtime` aggregates the request lifecycle — its graph
     * reaches `fs`, `crypto`, `module`, `async_hooks` and more, none of which a
     * browser can resolve or run. A static import puts all of it in the module
     * graph of every consumer that imports so much as `isBlocksField` from the
     * package root.
     *
     * Resolved per pass either way. `requireNextly` refuses until services are
     * registered and boot migrations have settled, which is exactly the guard a
     * job wants: a pass that ran too early fails and is re-queued rather than
     * reading a database whose schema is unverified.
     */
    nextly: async () => (await import("nextly/runtime")).requireNextly(),
    // The LIVE registry, not the configured list. `class-usage-hook` opens by
    // saying the set of collections is not known when a plugin is wired — which
    // is why the write path registers on the wildcard — because the Schema
    // Builder creates collections at runtime and those exist only here. A
    // backfill reading the configured set would walk a narrower population than
    // the hooks maintain while judging readiness against that same short list.
    //
    // A superset rather than a different set: code-first collections are synced
    // into the registry with `source: "code"`, so nothing declared is lost.
    //
    // `undefined` when the registry cannot be read, which the enumeration
    // treats as a refusal rather than as a site with nothing to index.
    collectionSlugs: () => registeredCollectionSlugs(ctx),
    // The REGISTRY record, which is what carries the resolved fields and the
    // draft split — the declared config alone answers neither after a rename.
    // No request context: a sweep acts as nobody, and reading a collection's
    // own configuration is not the privileged part.
    resolveCollection: slug =>
      ctx.services.collections.getCollection(slug, undefined as never),
    hasDrafts: async collection =>
      (await resolvedCollectionDraftSplit(resolvedCollectionView(collection)))
        .eligible,
    singles: () => singlesDeclaringBlocks(ctx),
    locales: () =>
      ctx.config.localization?.locales.map(locale => locale.code) ?? [],
    // The SAME bounds the renderer draws under, for the reason the write path
    // reads them per call: an index derived under different ones records a
    // different document than the page serves.
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    // The index rows, in the plugin's own tables.
    db: ctx.db,
    // The run, its progress and the dirty mark, in the plugin's own tables.
    bookkeeping: () => usageBookkeeping(ctx.db, ctx.dialect),
  };
}

/**
 * The hold a component's removal takes while it is published, wired over the
 * plugin's bookkeeping table: the fence on every write, the count again as
 * the publish is written, and the release once it lands (`removal-hold`).
 */
function installHoldsFor(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  opts: PageBuilderOptions,
  composition: CompositionSetup,
  parts: {
    readonly nextly: () => Promise<HoldDirectApi>;
    readonly count: (componentId: string) => Promise<PlacementCount>;
  }
): RemovalHoldStore {
  const { collection, field } = composition.store;
  return installRemovalHolds({
    ctx,
    store: removalHoldStore({
      nextly: parts.nextly,
      // RESOLVED, for the reason every own table is: a host may rename it.
      collection:
        ctx.self.collections[COMPONENT_RETIRED_SLUG] ?? COMPONENT_RETIRED_SLUG,
    }),
    componentCollection: collection,
    componentField: field,
    storedDraft: storedDraftOf,
    // The declared blocks fields, surveyed as the strip on every write
    // surveys them.
    paths: (slug, context) =>
      blocksFieldPaths(ctx, slug, context as HookContext<unknown>),
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    count: parts.count,
    lifecycle: async () => {
      const store = (await ctx.services.collections.getCollection(
        collection,
        undefined as never
      )) as { status?: unknown } | null;
      return store?.status === true;
    },
  });
}

/**
 * What the component-delete rewrite reads the installed site through: the
 * live registries, the Direct API (through the SDK, at call time), the
 * Layouts, and the usage index as a hint.
 */
function rewriteInstallFor(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  opts: PageBuilderOptions,
  composition: CompositionSetup
): RewriteInstall {
  // The booted instance through the SDK, the plugin's stable surface, imported
  // at call time for the reason `defaultLayoutDeps` gives.
  const nextly = async (): Promise<RewriteDirectApi> => {
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    return getCachedNextly();
  };
  return {
    db: ctx.db,
    dialect: ctx.dialect,
    site: {
      nextly,
      collectionSlugs: () => registeredCollectionSlugs(ctx),
      resolveCollection: slug =>
        ctx.services.collections.getCollection(slug, undefined as never),
      singles: () => singlesDeclaringBlocks(ctx),
      locales: () =>
        ctx.config.localization?.locales.map(locale => locale.code) ?? [],
      defaultLocale: () => ctx.config.localization?.defaultLocale,
      layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
      // A document whose field groups hold no blocks field is no host: its
      // field groups' values are stored apart, where no copy can be.
      fieldGroups: siteFieldGroups(ctx, nextly),
    },
    hints: async componentId => {
      const found = await composition.hostsOf?.placing([componentId]);
      const seen = new Set<string>();
      const hints: { slug: string; id: string }[] = [];
      for (const host of found?.hosts ?? []) {
        // Collection entries only: the walk after the hints reads every
        // Single anyway, and a hint names an entry by its id.
        if (host.single === true) continue;
        const key = `${host.slug}\u001F${host.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hints.push({ slug: host.slug, id: host.id });
      }
      return hints;
    },
    store: composition.store,
    limits: () => opts.limits ?? DEFAULT_LIMITS,
  };
}

/**
 * A written document's pending working draft, read as the system, or `null`
 * where there is none: what a write's hold judgement compares with beside
 * the live row its hook is handed. A Single's hooks name it `single:<slug>`.
 */
async function storedDraftOf(at: {
  readonly collection: string;
  readonly id: string | undefined;
}): Promise<unknown> {
  const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
  const nextly: RewriteDirectApi = await getCachedNextly();
  const single = at.collection.startsWith(SINGLE_HOOK_NAMESPACE)
    ? at.collection.slice(SINGLE_HOOK_NAMESPACE.length)
    : undefined;
  try {
    const row =
      single !== undefined
        ? await nextly.findSingle({
            slug: single,
            createIfMissing: false,
            draft: true,
            status: "all",
            depth: 0,
            overrideAccess: true,
          })
        : at.id === undefined
          ? null
          : await nextly.findByID({
              collection: at.collection,
              id: at.id,
              draft: true,
              status: "all",
              depth: 0,
              overrideAccess: true,
            });
    const pending = row as { _isWorkingDraft?: unknown } | null;
    return pending?._isWorkingDraft === true ? pending : null;
  } catch (error) {
    if (NextlyError.isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Every live Single whose declaration holds a blocks field, with its fields
 * and its localization master switch, or `undefined` when the registry cannot
 * be read whole. Orphaned code-first rows are left out: removing a code-first
 * Single from config leaves its registry row readable until someone runs the
 * destructive cleanup, and that row says nothing about content that exists.
 *
 * PAGED and exhausted, for the reason the collection listing is: a short read
 * leaves out a Single a later page holds, and the usage index would call
 * itself whole without having walked it.
 */
export async function singlesDeclaringBlocks(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): Promise<SingleToWalk[] | undefined> {
  const declared = declaredSingleSlugs(ctx);
  const configured = configuredSingles(ctx);
  const localizedSite = (ctx.config.localization?.locales.length ?? 0) > 0;
  const found: SingleToWalk[] = [];
  for await (const rows of singlesRegistryPages(ctx)) {
    if (rows === UNREADABLE_PAGE) return undefined;
    const page = singlesDeclaringBlocksIn(rows, declared);
    if (page === undefined) return undefined;
    for (const single of page) {
      found.push(
        singleToWalk(single, configured.get(single.slug), localizedSite)
      );
    }
  }
  return found;
}

/**
 * One live Single holding blocks, read as {@link singlesDeclaringBlocks} reads
 * each, from the Singles registry, which creates nothing; `undefined` when no
 * live Single of that slug holds a blocks field. Refused when the registry's
 * answer cannot be read, so a save it cannot place is a maintenance failure
 * rather than a Single silently left out.
 */
async function liveSingle(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  slug: string
): Promise<SingleToWalk | undefined> {
  const listed: unknown = await ctx.services.singles.list({
    slugAllowlist: [slug],
    limit: 1,
  });
  const rows = (listed as { data?: unknown }).data;
  const page = Array.isArray(rows)
    ? singlesDeclaringBlocksIn(rows, declaredSingleSlugs(ctx))
    : undefined;
  if (page === undefined) {
    throw new Error(
      `[page-builder] the Singles registry could not be read for "${slug}", so its usage could not be recorded`
    );
  }
  const single = page.find(entry => entry.slug === slug);
  if (single === undefined) return undefined;
  const localizedSite = (ctx.config.localization?.locales.length ?? 0) > 0;
  return singleToWalk(single, configuredSingles(ctx).get(slug), localizedSite);
}

/** The Singles declared in code, by slug, as the site's config states them. */
function configuredSingles(ctx: {
  config?: { singles?: unknown };
}): ReadonlyMap<string, { fields?: unknown; localized?: unknown }> {
  const singles = ctx.config?.singles;
  const bySlug = new Map<string, { fields?: unknown; localized?: unknown }>();
  if (!Array.isArray(singles)) return bySlug;
  for (const single of singles) {
    const slug = (single as { slug?: unknown } | null)?.slug;
    if (typeof slug === "string") {
      bySlug.set(slug, single as { fields?: unknown; localized?: unknown });
    }
  }
  return bySlug;
}

/**
 * The site's field groups, read once per walk from the registry through the
 * Direct API, with the code's declarations for a slug the registry does not
 * hold; nothing at all where the registry cannot be read to the end
 * (`host-rewrite/field-groups`).
 */
function siteFieldGroups(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0],
  nextly: () => Promise<RewriteDirectApi>
): () => Promise<(slug: string) => { readonly fields?: unknown } | undefined> {
  const inCode = declaredFieldGroups(ctx);
  return () =>
    readSiteFieldGroups({
      page: async (offset, limit) =>
        (await nextly()).fieldGroups.find({ limit, offset }),
      inCode,
      warn: (message, meta) => ctx.logger.warn(message, meta),
    });
}

/**
 * The field groups the site declares in code, by slug, as its config states
 * them.
 */
function declaredFieldGroups(ctx: {
  config?: { fieldGroups?: unknown };
}): (slug: string) => { readonly fields?: unknown } | undefined {
  const groups = ctx.config?.fieldGroups;
  const bySlug = new Map<string, { readonly fields?: unknown }>();
  if (Array.isArray(groups)) {
    for (const group of groups) {
      const slug = (group as { slug?: unknown } | null)?.slug;
      if (typeof slug === "string") {
        bySlug.set(slug, group as { readonly fields?: unknown });
      }
    }
  }
  return slug => bySlug.get(slug);
}

/**
 * The live Singles on one registry page whose declaration holds a blocks
 * field; `undefined` when a live row carries no readable slug, since a Single
 * that cannot be named cannot be read.
 */
function singlesDeclaringBlocksIn(
  rows: readonly unknown[],
  declared: ReadonlySet<string> | undefined
): { slug: string; fields?: unknown }[] | undefined {
  const found: { slug: string; fields?: unknown }[] = [];
  for (const row of rows) {
    if (isOrphanedSingle(row, declared)) continue;
    const slug = (row as { slug?: unknown } | null)?.slug;
    if (typeof slug !== "string") return undefined;
    const fields = (row as { fields?: unknown }).fields;
    const reach = blocksFieldReach({ fields });
    if (reach.fields.length > 0 || reach.unreachable) {
      found.push({ slug, fields });
    }
  }
  return found;
}

/** The named queries each page builder this process made registers. */
const sitesQueries = new WeakMap<PluginDefinition, NamedQueryLookup>();

/**
 * The named queries the page builder `plugin` registers for its site, run
 * functions included: what a route rendering that site's pages takes as its
 * `namedQueries`. Bound to that one page builder, so two sites served from
 * one process never resolve each other's queries. Nothing for a plugin that
 * is not a page builder.
 *
 * ```ts
 * export const builder = pageBuilder({ namedQueries: [upcomingEvents] });
 * // app/[...slug]/page.tsx
 * createBlocksPage({ ..., namedQueries: namedQueriesOf(builder) });
 * ```
 *
 * @experimental
 */
export function namedQueriesOf(plugin: PluginDefinition): NamedQueryLookup {
  return sitesQueries.get(plugin) ?? { definitionOf: () => undefined };
}

export const pageBuilder = (
  opts: PageBuilderOptions = {}
): PluginDefinition => {
  /**
   * The installed context, published by `init` for the backfill job to read.
   *
   * `contributes` is evaluated when the plugin is DEFINED and a job handler
   * runs long afterwards, so the two cannot share a value through an argument.
   * A holder is what bridges them, and it is safe in the one direction it is
   * used: nothing reads it until a handler runs, and a handler runs only after
   * the runner exists, which is after `init`.
   *
   * Deliberately not a captured Direct API. `requireNextly` refuses until
   * services are registered and boot migrations have settled, so resolving it
   * at definition time would throw during config; the holder stores the CONTEXT
   * and every pass resolves the API itself.
   */
  let installed: BackfillHost | null = null;
  // This page builder's named queries: the site's own from the start, so a
  // route built before boot already knows them, and rebuilt with the ones
  // plugins declare on each boot. Its own, so two sites in one process never
  // resolve each other's.
  let namedQueries: NamedQueryRegistry = createNamedQueryRegistry();
  namedQueries.register(opts.namedQueries ?? [], {
    source: "pageBuilder({ namedQueries })",
  });
  const namedQuerySource: NamedQuerySource = {
    declarationOf: name => namedQueries.declarationOf(name),
  };
  const namedQueryDeclarations = () =>
    namedQueries.all().map(namedQueryDeclaration);

  /**
   * What the default-Layout repair needs from the installed plugin: the
   * RESOLVED slugs and the log. Published by `init` for the same reason
   * `installed` is — the repair job is contributed before `init` runs and
   * handled long after it.
   */
  let defaultLayoutSetup: DefaultLayoutSetup | null = null;
  // The claiming of existing pages' addresses, set by `init` and run once the
  // boot has finished.
  // It answers whether every page was settled.
  let pageClaimsBackfill: (() => Promise<boolean>) | null = null;
  // Set once that pass has finished, after which a page save need not claim
  // the existing pages its list's later pages would fall on.
  let pageClaimsBackfilled = false;
  // Which initialization the flag belongs to. A reload under HMR runs
  // `init` again on this same definition, so the flag is reset there, and a
  // pass started by an earlier initialization, still running, never sets it
  // for the new one (whose languages may differ).
  let pageClaimsInit = 0;
  // Each collection's code-declared template address, checked when the
  // plugin is defined, so a malformed or shared one refuses to start.
  const templateAddresses = checkedTemplateAddresses(opts.templates);
  // The same addresses as written, each in its one spelling once checked:
  // what a stored address is compared with.
  const declaredPaths: ReadonlyMap<string, string> = new Map(
    Object.entries(opts.templates?.addresses ?? {}).filter(([collection]) =>
      templateAddresses.has(collection)
    )
  );
  // Who holds a path, for the site's content route, set by `init`.
  let contentAddresses: ContentAddressService | null = null;
  const requireContentAddresses = (): ContentAddressService => {
    if (contentAddresses === null) {
      throw new Error(
        "[page-builder] the content route asked for an address before the plugin was installed"
      );
    }
    return contentAddresses;
  };
  // Refuses to start when a collection given a template address cannot have
  // a template: run once every plugin's collections are registered.
  let checkTemplateAddresses: (() => Promise<void>) | null = null;
  // Brings the entries' claims to the declared addresses, after the pages'.
  let entryClaimsPass: (() => Promise<void>) | null = null;
  // Releases the claims of collections no longer given an address.
  let undeclaredSweep: (() => Promise<void>) | null = null;
  // The start-up passes over the address store while they run: pages, the
  // sweep, then entries. The addresses listed for pre-rendering wait for it,
  // so a build never lists a store the passes are still filling or moving.
  let addressStartup: Promise<void> | null = null;
  // How many of a collection's entries wait for an address, set by `init`.
  let waitingEntriesOf: ((collection: string) => Promise<number>) | null = null;
  // What the template actions run with, for the route and the service.
  const templateActions = {
    guard: (): TemplateGuardSetup => requireTemplateGuard(),
    waitingEntries: (collection: string): Promise<number> => {
      if (waitingEntriesOf === null) {
        throw new Error(
          "[page-builder] a template action ran before the plugin was installed"
        );
      }
      return waitingEntriesOf(collection);
    },
  };

  /**
   * The templates guard's lookups over the installed plugin: the RESOLVED
   * templates slug, the plugin's own collections, the registry and the
   * hook-free own read. Published by `init`, and read by the template route
   * and service per call, so a request reaching them before `init` refuses
   * rather than judging against slugs nothing resolved.
   */
  let templateGuard: TemplateGuardSetup | null = null;
  const requireTemplateGuard = (): TemplateGuardSetup => {
    if (templateGuard === null) {
      throw new Error(
        "[page-builder] a template action ran before the plugin was installed"
      );
    }
    return templateGuard;
  };

  /**
   * The repair's deps for one run, the Direct API resolved at call time. A run
   * before `init` refuses with a named reason and the sweep is re-queued,
   * rather than writing to slugs the plugin has not resolved.
   */
  const defaultLayoutDeps = async (): Promise<EnsureDefaultDeps> => {
    if (defaultLayoutSetup === null) {
      throw new Error(
        "[page-builder] the default Layout repair ran before the plugin was installed"
      );
    }
    // The booted instance through the SDK, imported at call time for the
    // reason the preview reader above gives: this entry reaches a browser
    // bundle, and the Direct API graph has no place there.
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    return { ...defaultLayoutSetup, nextly: await getCachedNextly() };
  };

  /**
   * What the spacing-model step and its reader need from the installed
   * plugin: the store over the plugin's own table and the RESOLVED slugs it
   * reads. Published by `init` for the reason `defaultLayoutSetup` is.
   */
  let spacingSetup: {
    store: SpacingModeStore;
    slugs: SpacingModeSlugs;
    survey: SpacingModeAtStartDeps["survey"];
    siteStyle: string;
    warn: (message: string, meta?: Record<string, unknown>) => void;
  } | null = null;

  /**
   * Put the composition graph lock's row in place, once the plugin's tables
   * exist. Published by `init` for the reason `defaultLayoutSetup` is.
   */
  let seedGraphLock: (() => Promise<void>) | null = null;

  /** The installed spacing-model store, or a refusal naming why it is missing. */
  const requireSpacingSetup = (): NonNullable<typeof spacingSetup> => {
    if (spacingSetup === null) {
      throw new Error(
        "[page-builder] the site's spacing model was asked for before the plugin was installed"
      );
    }
    return spacingSetup;
  };

  /**
   * The start's decision while it runs: the default-Layout seed, then the
   * spacing step. `null` once it has settled.
   */
  let spacingStartup: Promise<void> | null = null;

  /** The step's deps for one run, the Direct API resolved at call time. */
  const spacingModeDeps = async (): Promise<SpacingModeAtStartDeps> => {
    const { store, slugs, survey, siteStyle, warn } = requireSpacingSetup();
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    const configured = configuredSpacingMode(opts.siteStyle);
    return {
      store,
      slugs,
      survey,
      ...(configured === undefined ? {} : { configured }),
      nextly: await getCachedNextly(),
      expire: () => siteStyleExpiry(warn)(siteStyle),
    };
  };

  /**
   * How the blocks field judges composition, once the plugin is installed.
   * Until then only a document's own rules run: nothing is installed to read
   * the library through.
   */
  let composition: CompositionSetup | undefined;

  /**
   * What the component-delete rewrite needs from the installed plugin,
   * published by `init` for the reason `installed` is: the service is
   * contributed before `init` runs and called long after it.
   */
  let rewriteInstall: RewriteInstall | null = null;
  /**
   * The installed plugin as the "Bindings to fix" report reads it, published
   * by `init`: its job and its route are contributed before `init` runs.
   */
  let bindingReportCtx:
    | Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
    | null = null;
  const bindingReportDeps: BindingReportDeps = {
    store: () =>
      bindingReportCtx === null
        ? null
        : bindingReportStore(bindingReportCtx.db, bindingReportCtx.dialect),
    // Each source's declared fields, as a save judges bindings by them.
    shapesOf: async ref => {
      const { declaredFieldShapes } = await import("nextly/runtime");
      return declaredFieldShapes(ref);
    },
    // And a list's item bindings, against the rows its named query declares.
    namedQueries: namedQuerySource,
    // Documents read as the walk reads them, and the components they place as
    // visitors are served them.
    reading: () => {
      const install = rewriteInstall;
      if (install === null) return null;
      const site = install.site;
      const read = siteHostReader(site);
      return {
        hostsOf: at => documentHosts(site, at),
        read,
        // A page's Layout, as visitors are served it: its regions' components
        // placed, so their bindings are judged against the page's entry.
        layoutOf: at => {
          const ctx = bindingReportCtx;
          const setup = defaultLayoutSetup;
          return ctx === null || setup === null
            ? Promise.resolve(undefined)
            : layoutRegionsOf(at, {
                pages: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
                slugs: setup.slugs,
              });
        },
        components: async (id, draft) => {
          try {
            const found = await read({
              kind: "collection",
              slug: install.store.collection,
              id,
              path: [install.store.field],
            });
            const value =
              draft && found.draft !== null && found.draft.kind === "value"
                ? found.draft
                : found.published;
            return value.kind === "value"
              ? { kind: "document", document: value.value }
              : { kind: "absent" };
          } catch {
            return { kind: "unreadable" };
          }
        },
      };
    },
    // The sweep, started as soon as a write marks a document, at most once a
    // second; the jobs pass runs it where nothing starts it.
    kick: () => {
      const ctx = bindingReportCtx;
      const now = Date.now();
      if (ctx === null || now - bindingsKickedAt < 1000) return;
      bindingsKickedAt = now;
      ctx.services.jobs
        .runSweepNow(BINDINGS_REPORT_JOB, {
          maxDurationMs: BINDINGS_REFRESH_RUN_MS,
        })
        .catch((error: unknown) =>
          ctx.logger.warn(
            "[page-builder] the bindings report's judgement could not start; the next jobs pass runs it.",
            { error }
          )
        );
    },
    limits: () => opts.limits ?? DEFAULT_LIMITS,
    placeOf: at => {
      if (at.kind === "single") return "singles";
      const own = bindingReportCtx?.self.collections ?? {};
      const named = (slug: string) => own[slug] ?? slug;
      if (at.slug === named(PAGES_SLUG)) return "pages";
      // The component store the composition reads, a configured one included.
      if (
        at.slug === (rewriteInstall?.store.collection ?? named(COMPONENTS_SLUG))
      )
        return "components";
      if (at.slug === named(PATTERNS_SLUG)) return "patterns";
      if (at.slug === named(LAYOUTS_SLUG)) return "layouts";
      return "entries";
    },
  };
  let bindingsKickedAt = 0;
  /**
   * How many broken bindings a person may see, read as them by the report
   * route's own read, for the dashboard's card and attention line.
   */
  const bindingsVisibleTo = async (
    user: PluginRouteIdentity["user"]
  ): Promise<number> => {
    const ctx = bindingReportCtx;
    const store = bindingReportDeps.store();
    if (ctx === null || store === null) return 0;
    return visibleBindings(
      {
        caller: { identity: () => Promise.resolve({ user }) },
        services: ctx.services,
      },
      await store.list()
    );
  };
  /** The latest save among the documents named, for the fingerprint. */
  const latestSave = async (collections: readonly string[]) => {
    const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
    const nextly = await getCachedNextly();
    const parts: string[] = [];
    for (const collection of collections) {
      const found = await nextly.find({
        collection,
        sort: "-updatedAt",
        limit: 1,
        depth: 0,
        status: "all",
        overrideAccess: true,
      });
      const latest = (found.items[0] as { updatedAt?: unknown } | undefined)
        ?.updatedAt;
      parts.push(
        `${collection}:${String(found.meta.total)}:${JSON.stringify(latest ?? null)}`
      );
    }
    return parts.join("|");
  };
  /** One pass of the report's check of every document, until `deadline`. */
  const bindingReportPass = async (deadline: Date) => {
    const ctx = bindingReportCtx;
    const site = rewriteInstall?.site;
    if (ctx === null || site === undefined) return "paused" as const;
    const walk = siteWalkSource(site);
    return runFullCheck(
      {
        documents: cursor => walk.documents(cursor),
        cursorOf: document => walk.cursorOf(document),
        fingerprint: () =>
          schemaFingerprint({
            collections: () => collectionRegistryRows(ctx),
            singles: () => singleRegistryRows(ctx),
            fieldGroups: () => fieldGroupRows(),
            namedQueries: () => namedQueryDeclarations(),
            blocks: () => allBlocks(),
            designs: async () => {
              const saves = await latestSave([
                rewriteInstall?.store.collection ?? COMPONENTS_SLUG,
                defaultLayoutSetup?.slugs.layouts ?? LAYOUTS_SLUG,
              ]);
              // And the site's default Layout, which every page naming none
              // is drawn in.
              const setup = defaultLayoutSetup;
              if (setup === null) return saves;
              const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
              const settings = await readLayoutSettings(
                await getCachedNextly(),
                setup.slugs
              );
              return `${saves}|default:${settings.defaultLayout ?? ""}`;
            },
          }),
      },
      bindingReportDeps,
      deadline
    );
  };
  let bindingsRefreshedAt = 0;
  const requireRewriteInstall = (): RewriteInstall => {
    if (rewriteInstall === null) {
      throw new Error(
        "[page-builder] the component-delete rewrite ran before the plugin was installed"
      );
    }
    return rewriteInstall;
  };
  // What Delete component's sweep reads and moves, resolved per pass.
  const componentDeleteSweepDeps = () => {
    const installed = requireRewriteInstall();
    const runs = fenceStore(installed.db, installed.dialect);
    return {
      deleting: () => runs.runsAt("deleting"),
      store: () => runs,
      exists: async (componentId: string) => {
        const nextly = await installed.site.nextly();
        const found = await nextly.find({
          collection: installed.store.collection,
          where: { id: { equals: componentId } },
          status: "all",
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        return found.items.length > 0;
      },
      now: () => new Date(),
    };
  };

  /**
   * The installed context, or a refusal naming why it is missing.
   *
   * Throwing beats defaulting here. Every plausible default is a claim about a
   * site this has not read — no collections, no locales, the declared slugs —
   * and each of those reports the backfill finished on a site it never looked
   * at. A refusal fails the pass, and the sweep is re-queued.
   */
  const requireInstalled = (): BackfillHost => {
    if (installed === null) {
      throw new Error(
        "[page-builder] the usage backfill ran before the plugin was installed, so it has no configuration to enumerate"
      );
    }
    return installed;
  };
  // Resolved once, with no stored tier: at config time there is no database to
  // read, so what the factory can wire into the validator and the canvas is
  // the defaults tier. The stored tier reaches the published route through
  // `loadSiteStyle`, which reads per request.
  // The core blocks' looks join the code tier, so the site receives them as
  // shared styles its code supplies.
  const configStyle = resolveSiteStyle(withCoreLooks(opts.siteStyle));
  // The code tier's class ids, for the routes that refuse to rename or remove
  // what code supplies. One set, refreshed in place with the code tier.
  const configClassIds = new Set(
    (configStyle.classes ?? []).map(entry => entry.id)
  );
  // The font catalogue's hosts and caps, refused at boot when unusable, and
  // what it adds to the plugin.
  const fonts = fontCatalogueParts(resolveFontOptions(opts.fonts));
  // The canvas route's path, refused at boot when it names another origin.
  const canvasPath = canvasPathOption(opts.canvasPath);

  // The usage indexes' reconciler for a write made in a transaction the
  // caller owns, which their hooks skip. Set by `init`, read per request.
  const usage: {
    reconcile?: CommittedWriteReconciler;
    origins?: OriginStore;
  } = {};
  // What deriving retired ids from component history has read so far, shared
  // by the repair after a failed record and the editor's facts read.
  const retiredHistory = retiredHistoryMemo();
  // The versions a lost removal is derived from, held until a repair records
  // it. Set by `init`, which holds the context pins are made through; read by
  // the facts route's repair, which releases them.
  let heldRemovals: RetiredPins | undefined;
  // The holds a component's removal takes while it is published. Set by
  // `init`, which holds the bookkeeping table's slug; read by the hold route.
  let removalHolds: RemovalHoldStore | null = null;
  const requireRemovalHolds = (): RemovalHoldStore => {
    // Nothing is retired without the readiness hooks, so a removal loses no
    // value and nothing need be held: a hold asked for holds nothing.
    if (opts.componentReadiness === false) return NO_HOLDS;
    if (removalHolds === null) {
      throw new Error(
        "[page-builder] a component removal was held before the plugin was installed"
      );
    }
    return removalHolds;
  };
  /**
   * One usage index as the shared-style and variable routes read it: its
   * health, the documents using each reference in one bounded read, and which
   * kind of document a collection holds. The composition stores are
   * components, patterns and Layouts; every other collection with a page
   * builder field holds pages, as the editor's page search reads them.
   */
  const usageSourceOf = <TRow extends UsageSubject>(
    collections: Readonly<Record<string, string | undefined>>,
    index: UsageIndex<TRow>
  ): SharedStyleUsageSource => {
    const kinds = new Map<string, SharedStyleUsageKind>([
      [
        componentStoreOf(opts).collection ??
          collections[COMPONENTS_SLUG] ??
          COMPONENTS_SLUG,
        "components",
      ],
      [collections[PATTERNS_SLUG] ?? PATTERNS_SLUG, "patterns"],
      [collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG, "layouts"],
    ]);
    return {
      health: () => usageHealthService(requireInstalled).read(index),
      // One bounded read for a whole page of references.
      documentsUsingEach: async (ids, health) =>
        listDocumentsUsingEach({
          index,
          rows: usageTableRows(requireInstalled().db, usageTableOf(index)),
          referenceIds: ids,
          health,
        }),
      kindOf: collection => kinds.get(collection) ?? "pages",
    };
  };
  // The in-use check a write of the site style that drops a variable is
  // judged by. Set by `init`, which holds the context the stored documents
  // are listed through; read by the Single's guard on such a write.
  let variablesInUse: VariablesInUseCheck | undefined;
  // The booted Direct API through the SDK, imported at call time for the
  // reason `defaultLayoutDeps` gives.
  const bootedNextly = async () =>
    (await import("@nextlyhq/plugin-sdk")).getCachedNextly();
  /**
   * How many documents place a component directly, from the usage index: the
   * number the removal dialog says, and the one a hold counts again. The
   * index rows live in the plugin's own tables, so no route context is read.
   */
  const countPlacements = () => async (id: string) => {
    const health = usageHealthService(requireInstalled);
    return componentUsageCount({
      read: health.counts(componentUsageIndex),
      componentId: id,
      health: await health.read(componentUsageIndex),
    });
  };
  // The cleanup of retired values still stored, published by `init` for the
  // reason `rewriteInstall` is: its service and sweep are contributed before
  // `init` runs and called long after it.
  let retiredCleanup: RetiredCleanupService | null = null;
  const requireRetiredCleanup = (): RetiredCleanupService => {
    if (retiredCleanup === null) {
      throw new Error(
        "[page-builder] the cleanup of removed component fields ran before the plugin was installed"
      );
    }
    return retiredCleanup;
  };
  // The ids a published removal retired: those the write hooks recorded, and
  // those the component's published history implies, recorded here when the
  // table lacks them. Where the hooks are not registered (the host renders
  // components from a source of its own), nothing is recorded, so `null`. A
  // localized store records no retirements (see the write hooks), so it
  // answers `null` too. Read by the editor's facts and by the API's
  // definition actions, which must never hand a retired id out again.
  const readRetiredFor = (
    ctx: PluginRouteContext
  ): ((id: string) => Promise<RetiredExposures | null>) => {
    if (opts.componentReadiness === false) return () => Promise.resolve(null);
    const components =
      componentStoreOf(opts).collection ??
      ctx.self.collections[COMPONENTS_SLUG] ??
      COMPONENTS_SLUG;
    return reconciledRetired({
      shape: () =>
        componentStoreShape(ctx.services.collections, components, ctx.user),
      reconcile: (id, lifecycle) =>
        reconcileRetired(
          {
            history: ctx.services.versions,
            componentCollection: components,
            componentField: componentStoreOf(opts).field,
            lifecycle,
            memo: retiredHistory,
            ...(heldRemovals === undefined ? {} : { pins: heldRemovals }),
            store: retiredStore({
              nextly: () => requireInstalled().nextly(),
              collection:
                ctx.self.collections[COMPONENT_RETIRED_SLUG] ??
                COMPONENT_RETIRED_SLUG,
            }),
            logger: ctx.logger,
          },
          id
        ),
    });
  };
  /**
   * What removing breakpoints needs from the installed plugin, published by
   * `init` for the reason `rewriteInstall` is: the service, the Single's guard
   * and the routes are made before `init` runs and called long after it.
   */
  let removalInstall: RemovalInstall | null = null;
  // Where a removal's save logs a walk that failed after its set was stored;
  // published by `init` beside the install.
  let removalLogger: {
    error(message: string, meta?: Record<string, unknown>): void;
  } | null = null;
  const removalService = (): BreakpointRemovalService =>
    breakpointRemovalService(() => {
      if (removalInstall === null) {
        throw new Error(
          "[page-builder] a breakpoint removal ran before the plugin was installed"
        );
      }
      return removalInstall;
    });
  // The open removal as the write path's locks read it: before `init`, the
  // read throws, and a lock then accepts nothing extra.
  const openBreakpointRemoval = () => removalService().openRemoval();
  // The site as a removal's count and an undo's report read it.
  const removalSite = () => ({
    site: () => rewriteInstall?.site ?? null,
    naming: async () => {
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      return getCachedNextly();
    },
    componentCollection: rewriteInstall?.store.collection,
    limits: () => opts.limits ?? DEFAULT_LIMITS,
  });
  // How the breakpoints routes count a removal and carry it out.
  const breakpointRemoval = {
    defaults: configStyle,
    // The site style's Single as stored, renamed or not, read past its own
    // read permission: the site permission the routes ask for admits it.
    // With the version the read was of, which a save hands back so a write
    // made since is not overwritten.
    stored: async (routeCtx: SiteSettingsRouteContext) => {
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      const nextly = await getCachedNextly();
      const { stored, rev } = await readStoredSiteStyleVersioned({
        nextly: { findSingle: args => nextly.findSingle(args) },
        slug: routeCtx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
        overrideAccess: true,
      });
      return rev === undefined ? stored : { ...stored, version: rev };
    },
    // Walked with the rewrite's own view of the site, so a removal counts
    // exactly the documents its cascade reaches.
    count: (
      removed: ReadonlyMap<string, string>,
      classes: readonly NamedClass[],
      routeCtx: BreakpointsRouteContext,
      deadline?: Date
    ) =>
      countRemovalOnSite(
        removalSite(),
        routeCtx,
        removed,
        classes,
        ...(deadline === undefined ? [] : [deadline])
      ),
    // The documents an undo could not put back, named as the person asking.
    names: (hosts: readonly HostAddress[], routeCtx: BreakpointsRouteContext) =>
      nameDocumentsOnSite(removalSite(), routeCtx, hosts),
    // A save counts for the audit, then walks, this long at most before it
    // answers with the run to carry on.
    cascade: {
      service: removalService,
      walkMs: REMOVAL_WALK_MS,
      countMs: REMOVAL_COUNT_MS,
      logError: (message: string, meta: Record<string, unknown>) =>
        removalLogger?.error(message, meta),
    },
  };
  const plugin = definePlugin({
    name: PAGE_BUILDER_PLUGIN_NAME,
    version: PLUGIN_VERSION,
    // The floor states the version carrying the APIs this plugin needs, not the
    // one it was first published against. Two of them: `blocks()` builds its
    // field with `pluginField`, and the editor reads its allowlist through
    // `usePluginClientConfig`, which the SDK re-exports from the admin package.
    // Against a core older than either, the import resolves to nothing and the
    // failure is a crash while the config is evaluated or the field mounts.
    //
    // Written from this package's OWN version rather than a literal, because
    // every published package here versions in lockstep: a plugin at version X
    // and a core at version X are always released together, so requiring a core
    // at least as new as this build is exactly the compatibility this needs. A
    // literal cannot say that. The APIs above land in the same release as the
    // plugin build that first calls them, and that version does not exist while
    // the change is being written — naming the next one guesses at a release
    // that has not happened, and leaves the source tree, where core carries the
    // CURRENT version, unable to satisfy its own plugin.
    nextly: `>=${PLUGIN_VERSION}`,
    // Identity metadata for the admin plugins page, mirroring package.json.
    author: "Nextly",
    homepage: "https://nextlyhq.com",
    repository: "https://github.com/nextlyhq/nextly",
    license: "MIT",
    category: "content",
    tags: ["page-builder", "blocks", "visual-editor"],
    enabled: opts.enabled,
    // The catalogue's two hosts, the only ones the server may reach, so an
    // add's downloads go through `ctx.fetch` and are listed where a reviewer
    // reads them.
    ...fonts.capabilities,
    admin: {
      // How the plugin names itself wherever the admin lists it. Without this
      // the dashboard section and the plugins list fall back to `meta.name`,
      // which is the raw package specifier — `@nextlyhq/plugin-page-builder`
      // shown where the form builder shows "Forms". `Layout` is the feature's
      // own mark rather than any one menu entry's, so the plugins list and the
      // sidebar heading draw the same feature the same way.
      appearance: { icon: "Layout", label: "Page Builder" },
      description:
        "Build pages visually from blocks with drag-and-drop editing",
    },
    // Registers what other plugins DECLARED, and resolves the registry service
    // on the way, which is what empties it for the boot. The service is lazy:
    // on a boot where nothing contributes, nobody else resolves it and the
    // previous boot's blocks would survive. Doing it here makes the reset
    // unconditional, and cannot wipe a contributor whose `init` ran first,
    // because the factory is memoized for the boot and clears only on its
    // first resolution.
    init: ctx => {
      // The store judged again against the site's renames, before anything
      // is wired to it.
      refuseStoreSharingAPluginSlug(
        componentStoreOf(opts),
        [],
        ctx.self.collections
      );
      installed = installContext(ctx, opts);
      registerCoreBlocks(ctx);
      registerDeclaredBlocks(ctx);
      // The site's named queries and the ones plugins declare, into a
      // registry emptied for this boot.
      namedQueries = registerNamedQueriesAtBoot(ctx, opts.namedQueries);
      // Every registered block is known now, other plugins' among them, so
      // the code tier takes all their looks.
      refreshCodeTier(configStyle, configClassIds, opts.siteStyle);
      // Class-usage maintenance. Registered here rather than beside the
      // collection, because it is a property of the plugin being INSTALLED: the
      // index table exists whether or not anything maintains it, and a host
      // that installs the plugin is asking for both.
      // Refuse deleting a component a Layout still names. Registered beside
      // the index maintenance because both answer "is this still in use", and
      // separately because they answer it about different things: the index is
      // a count over many pages, this is a refusal over few Layouts, and the
      // refusal has to be exact at the moment it refuses.
      registerLayoutComponentGuard({
        ctx,
        // RESOLVED slugs. A host may rename either, and a guard holding the
        // declared name would register on a collection nothing deletes from
        // and scan one that does not exist — refusing nothing, silently.
        componentsCollection:
          ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG,
        layoutsCollection: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
      });

      // One template per collection: the guard that sets each template's
      // place and names the template already holding it. RESOLVED slugs, for
      // the reason the guard above takes them.
      const templates = ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG;
      // The address store's collection, as the address claims reach it.
      const addressClaims = {
        services: ctx.services,
        slug: ctx.self.collections[ADDRESS_CLAIMS_SLUG] ?? ADDRESS_CLAIMS_SLUG,
        dialect: ctx.dialect,
      };
      templateGuard = {
        templatesCollection: templates,
        ownCollections: () => new Set(Object.values(ctx.self.collections)),
        readCollection: async slug => {
          try {
            return (await ctx.services.collections.getCollection(
              slug,
              undefined as never
            )) as unknown as Record<string, unknown>;
          } catch (error) {
            if (NextlyError.isNotFound(error)) return null;
            throw error;
          }
        },
        holderOf: templateHolderReader(ctx.services.ownCollections, templates),
        holdEntry: (tx, collection, id) =>
          ctx.services.collections.holdEntryInTransaction(tx, collection, id),
        // Read as the system and in any state: whether the entry exists is
        // the question, and who may see it is the action's to ask.
        entryExists: async (collection, id) => {
          const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
          const nextly = (await getCachedNextly()) as unknown as {
            findByID(args: Record<string, unknown>): Promise<unknown>;
          };
          try {
            const row = await nextly.findByID({
              collection,
              id,
              overrideAccess: true,
              status: "all",
              depth: 0,
              select: { id: true },
            });
            return typeof row === "object" && row !== null;
          } catch (error) {
            if (NextlyError.isNotFound(error)) return false;
            throw error;
          }
        },
        declaredAddresses: declaredPaths,
        addressHolderOf: addressHolderReader(
          ctx.services.ownCollections,
          templates
        ),
      };
      registerTemplateGuard(ctx, templateGuard);
      // An entry's own design is deleted with its entry, in the delete's
      // transaction, and a deleted template's copies lose their link to it.
      registerEntryDesignCascade(ctx.hooks, {
        templates,
        ownCollections: () => new Set(Object.values(ctx.self.collections)),
        // On the delete's own transaction, for update: the design is deleted
        // next, and no second pooled connection is taken while the delete
        // holds one.
        designUnder: async (tx, key) => {
          const found =
            await ctx.services.ownCollections.listEntriesInTransaction(
              tx,
              templates,
              {
                where: designUnderWhere(key),
                pagination: { limit: 1 },
                depth: 0,
              },
              { lock: "update" }
            );
          const id = (found.data[0] as { id?: unknown } | undefined)?.id;
          return typeof id === "string" || typeof id === "number"
            ? String(id)
            : null;
        },
        unlinkCopiesOf: (tx, id) =>
          unlinkCopies<PluginCollectionTransaction>(
            {
              listForUpdate: (transaction, options) =>
                ctx.services.ownCollections.listEntriesInTransaction(
                  transaction,
                  templates,
                  options,
                  { lock: "update" }
                ),
              list: (transaction, options) =>
                ctx.services.ownCollections.listEntriesInTransaction(
                  transaction,
                  templates,
                  options
                ),
              update: (transaction, copy, data) =>
                ctx.services.collections.updateEntryInTransaction(
                  transaction,
                  templates,
                  copy,
                  data
                ),
            },
            tx,
            id
          ),
        deleteInTransaction: (tx, slug, id) =>
          ctx.services.collections.deleteEntryInTransaction(tx, slug, id),
      });
      // A template written while its collection is deleted holds the
      // collection in its own transaction, so the two take turns: see
      // `holdTemplateCollection`.
      ctx.hooks.onInTransaction(
        templates,
        holdTemplateCollection<PluginCollectionTransaction>(
          (transaction, collection) =>
            ctx.services.collections.holdCollectionInTransaction(
              transaction,
              collection
            )
        )
      );
      // After the collection is held: the row a template write commits is
      // judged again on its transaction, and a new own design holds its
      // entry, so one written while the entry is deleted is refused or
      // deleted with it, whichever path wrote it: see `entry-design-write`.
      ctx.hooks.onInTransaction(
        templates,
        judgeTemplateInTransaction<PluginCollectionTransaction>(
          (transaction, collection, id) =>
            ctx.services.collections.holdEntryInTransaction(
              transaction,
              collection,
              id
            )
        )
      );
      // A collection's template and its entries' own designs go with the
      // collection: listed in its delete dialog, and removed in the delete's
      // transaction, so none is left drawing a collection that is gone.
      ctx.hooks.onCollectionDelete(
        templateCollectionDelete<PluginCollectionTransaction>({
          own: () => new Set(Object.values(ctx.self.collections)),
          services: {
            listTemplates: options =>
              ctx.services.ownCollections.listEntries(templates, options),
            listTemplatesInTransaction: (transaction, options) =>
              ctx.services.ownCollections.listEntriesInTransaction(
                transaction,
                templates,
                options,
                { lock: "update" }
              ),
            deleteTemplateInTransaction: (transaction, id) =>
              ctx.services.collections.deleteEntryInTransaction(
                transaction,
                templates,
                id,
                {}
              ),
            // Named by the field the collection names its entries by, and
            // its value read as core reads a title, so the dialog shows the
            // names people recognise.
            entryTitles: async (collection, ids) => {
              const config = await ctx.services.collections
                .getCollection(collection, undefined as never)
                .catch(() => null);
              const field =
                (typeof config === "object" && config !== null
                  ? titleFieldIn(config)?.name
                  : undefined) ?? "title";
              const found = await ctx.services.collections.listEntries(
                collection,
                {
                  where: { id: { in: [...ids] } },
                  pagination: { limit: ids.length },
                  select: { id: true, [field]: true },
                  depth: 0,
                },
                { as: "system" }
              );
              const titles = new Map<string, string>();
              for (const entry of found.data as Record<string, unknown>[]) {
                const title = readableTitleText(entry[field]);
                if (entry.id !== undefined && title !== undefined) {
                  titles.set(String(entry.id), title);
                }
              }
              return titles;
            },
          },
        })
      );

      // The site's one default Layout: refuse deleting or unpublishing it, and
      // queue the repair when a write gets past that.
      defaultLayoutSetup = installDefaultLayout(ctx);

      // The site's spacing model, kept in the plugin's own table, and the
      // RESOLVED slugs the one-time step reads to tell an existing site from
      // a fresh one.
      spacingSetup = {
        store: spacingModeStore(ctx.db, ctx.dialect),
        slugs: {
          layouts: defaultLayoutSetup.slugs.layouts,
          settings: defaultLayoutSetup.slugs.settings,
        },
        // Where block documents may live: the registry's survey of every
        // collection and live Single holding a blocks field the builder opens,
        // the same survey the editor's style route asks.
        survey: () => blocksSurvey(ctx),
        // The RESOLVED Site Style slug, whose cached reads a recorded model
        // expires.
        siteStyle: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
        warn: (message, meta) => ctx.logger.warn(message, meta),
      };

      // How a blocks value is judged as a reader would receive it: where
      // components live, the caps, who places a component, and where to say
      // so when some of those could not be judged. Set here because the
      // resolved slugs exist only once the plugin is installed; the field type
      // was declared before that and reads this through a getter.
      // What the server log says when the field's validation could not judge
      // a write's Layers locks.
      const warnLayersLockUnjudged = (found: LayersLockUnjudged) =>
        ctx.logger.warn(
          `[page-builder] a save was not checked against the blocks locked in Layers, because the stored value could not be read (${found.reason}); a locked block it changed was not protected`,
          {
            field: found.field,
            kind: found.kind,
            slug: found.slug,
            id: found.id,
            reason: found.reason,
          }
        );
      // The site's style as a write is judged against: the code's defaults
      // and the stored record of the Single as renamed, read when asked.
      const siteStyleNow = async () => {
        // Imported at call time, for the reason the readers above give: this
        // entry reaches a browser bundle, where the Direct API has no place.
        const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
        const nextly = await getCachedNextly();
        return loadSiteStyle({
          nextly: { findSingle: args => nextly.findSingle(args) },
          defaults: configStyle,
          slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
        });
      };
      composition = {
        store: {
          // The collection components actually live in, resolved the way the
          // readiness notice resolves it: a configured store is named
          // literally, and the plugin's own collection follows the host's
          // rename.
          collection:
            componentStoreOf(opts).collection ??
            ctx.self.collections[COMPONENTS_SLUG] ??
            COMPONENTS_SLUG,
          field: componentStoreOf(opts).field,
        },
        // The SAME bounds the renderer draws under. Judged under different
        // ones, a save would refuse a page the renderer draws, or pass one it
        // cuts short.
        limits: opts.limits ?? DEFAULT_LIMITS,
        // Off where the host turned component readiness off, which is the
        // setting for a renderer drawing components from its own
        // `resolveComponents` source: no collection stands for that source, so
        // a document composed against this store would be judged by
        // definitions it is not drawn with.
        composesDocuments: opts.componentReadiness !== false,
        // What a page may refer to, from one read of the site style: the
        // code's defaults and the stored record of the Single as renamed,
        // read per write so a style or a breakpoint removed a moment ago is
        // gone for the next save.
        // What a page's collection lists may filter and sort by: each
        // collection's declared fields from its record, and the ones the
        // public may read as a published page's bindings are judged. Read per
        // write, so a field hidden a moment ago is refused at the next save.
        // This site's named queries, for a list whose source is one.
        namedQueries: namedQuerySource,
        // Where templates live, under the host's name for them, so a
        // template's lists and conditions are judged against the collection
        // it draws, read from the template itself.
        templates: templateTargets(ctx.services.ownCollections, templates),
        listFields: listFieldsFrom({
          record: collection =>
            ctx.services.collections.getCollection(collection, {}),
          // In the write's language: a field's public read rule may depend
          // on it, and the published list is read in the page's.
          readable: async (collection, locale) => {
            // Imported at call time, for the reason the readers above give.
            const { bindingFieldShapes } = await import("nextly/runtime");
            return bindingFieldShapes(
              { collection },
              locale === undefined ? {} : { locale }
            );
          },
        }),
        // What a page's bindings may read: each source's declared fields,
        // whoever may read them, since binding a field the public may not read
        // is allowed. Read per write, so a field renamed a moment ago is judged
        // at the next save.
        bindingShapes: async ref => {
          // Imported at call time, for the reason the readers above give.
          const { declaredFieldShapes } = await import("nextly/runtime");
          return declaredFieldShapes(ref);
        },
        siteDefinitions: async () => {
          const style = await siteStyleNow();
          // Imported at call time: it imports `node:async_hooks`, which a
          // browser bundle reaching this entry cannot resolve.
          const { withProvisionalTokenIds } = await import(
            "./transfer/provisional-variables"
          );
          return {
            // Capped and resolved as the compiler reads the library, so a
            // page may reference exactly the classes it applies.
            classIds: referableClassIds(style.classes ?? []),
            // The ones its stylesheet is emitted under.
            breakpointIds: new Set(
              breakpointContexts(siteBreakpoints(style)).map(
                context => context.id
              )
            ),
            // Every tier of variables, as the stylesheet resolves them, so a
            // page may name exactly the variables it renders with. An
            // import's judging writes also count the variables it adds, which
            // the site style holds only once the import applies; no other
            // write sees any.
            tokenIds: withProvisionalTokenIds(
              new Set(resolveSiteTokens(style.tokens).tokens.map(tokenIdentity))
            ),
          };
        },
        hostsOf: indexHostFinder({
          rows: () => usageTableRows(ctx.db, usageTableOf(componentUsageIndex)),
          health: () =>
            usageHealthService(requireInstalled).read(componentUsageIndex),
        }),
        onUnjudged: unjudged =>
          ctx.logger.warn(
            `[page-builder] a component save could not be judged inside ${
              unjudged.listIncomplete
                ? `${String(unjudged.count)} or more`
                : String(unjudged.count)
            } of the documents that place it: ${unjudged.reasons.join("; ")}`,
            { componentId: unjudged.componentId }
          ),
        // The refusal names no document, so the operator is told which.
        onHostsBroken: broken =>
          ctx.logger.warn(
            `[page-builder] a component save was refused because it would break ${String(broken.hosts.length)} of the documents that place it`,
            { componentId: broken.componentId, hosts: broken.hosts }
          ),
        onHostsStillBroken: found =>
          ctx.logger.warn(
            `[page-builder] a component save left ${String(found.hosts.length)} document(s) that already break a lock inside it no worse; they need repairing where they are stored`,
            { componentId: found.componentId, hosts: found.hosts }
          ),
        onPlacementUnjudged: found =>
          ctx.logger.warn(
            `[page-builder] a save kept ${String(found.breaks)} block placement(s) the editor's rules refuse, because the stored value they may already be part of could not be read; repair them in the editor`,
            {
              field: found.field,
              kind: found.kind,
              slug: found.slug,
              id: found.id,
            }
          ),
        onLayersLockUnjudged: warnLayersLockUnjudged,
        onBindingsUnjudged: found =>
          ctx.logger.warn(
            `[page-builder] a save kept ${String(found.bindings)} binding problem(s) the schema refuses, because the stored value they may already be part of could not be read; repair them in the editor`,
            {
              field: found.field,
              kind: found.kind,
              slug: found.slug,
              id: found.id,
            }
          ),
        // The components being deleted, read from the plugin's own table on
        // each write that places a component. A table that cannot be read
        // refuses only writes adding a component, and says so here.
        // The open breakpoint removal, whose strip a lock accepts.
        openBreakpointRemoval,
        fencedComponents: fencedComponentsReader(
          () => fenceStore(ctx.db, ctx.dialect),
          error =>
            ctx.logger.warn(
              "[page-builder] the components being deleted could not be read, so writes adding a component are refused until they can be",
              { error }
            )
        ),
        onLockedExposures: found =>
          ctx.logger.warn(
            `[page-builder] a component exposes ${String(found.exposures.length)} field(s) a contentOnly lock holds; placements cannot change them. Remove each exposure, or loosen the lock on its slot.`,
            {
              componentId: found.componentId,
              exposures: found.exposures.map(entry => ({
                id: entry.exposureId,
                label: entry.label,
                slot: entry.slot,
                holder: entry.holderType,
              })),
            }
          ),
      };

      // Every write changing a blocks value is judged again in its own
      // transaction under the graph lock, so two saves made at once cannot
      // each pass against the graph as it stood before the other.
      registerCompositionRejudge(ctx, () => composition);
      seedGraphLock = () =>
        seedCompositionGraphLock(ctx.db, ctx.dialect).catch((error: unknown) =>
          ctx.logger.warn(
            "[page-builder] the composition graph lock's row could not be put in place; the first write locking it inserts it",
            { error }
          )
        );

      usage.reconcile = registerClassUsageMaintenance({
        ctx,
        // Both indexes' rows, in the plugin's own tables.
        stores: () => usageIndexStores(ctx.db),
        // A saved Single's declaration, from the Singles registry, which
        // reads it without creating the Single's document.
        single: slug => liveSingle(ctx, slug),
        // The registry record, projected. `getCollection` is declared to
        // return a shape that promises none of the properties this question
        // reads, while returning an object that carries all of them.
        draftSplit: (collection: unknown) =>
          resolvedCollectionDraftSplit(resolvedCollectionView(collection)),
        // Read per call, not captured: a host can reconfigure either, and a
        // value captured at install would keep deriving rows under bounds the
        // renderer no longer applies.
        locales: () =>
          ctx.config.localization?.locales.map(locale => locale.code) ?? [],
        // The SAME bounds the renderer draws under. Deriving the index under
        // different ones records a different document than the page serves:
        // raised bounds leave classes on the extra nodes unindexed, so a class
        // the page renders reads as unused.
        limits: () => opts.limits ?? DEFAULT_LIMITS,
        // A failed write marks the index dirty, so health stops calling it
        // whole until a full rebuild has walked the site again.
        markDirty: () => usageBookkeeping(ctx.db, ctx.dialect).markDirty(),
      });
      // A write of the site style dropping a variable still in use is
      // refused, by the check the remove route makes. It names no document,
      // since the write's author is not a caller this can ask.
      variablesInUse = variablesInUseCheck({
        usage: usageSourceOf(ctx.self.collections, tokenUsageIndex),
        // The block types the pages are rendered with, read per check.
        blocks: allBlocks,
        documents: async () => storedDocumentsOf(ctx, await bootedNextly()),
        limits: opts.limits ?? DEFAULT_LIMITS,
        pathOf: () => "tokens",
      });
      registerReadinessNotice(ctx, opts);
      // A page's address, and its paginated list's later pages, held in the
      // address store in the save's own transaction, so two documents never
      // hold one address whichever path saved them.
      const claimsStore = addressClaims;
      const pagesSlug = ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG;
      const siteLocales = (): readonly string[] =>
        claimLocales(
          ctx.config.localization?.locales.map(locale => locale.code) ?? [],
          ctx.config.localization?.defaultLocale
        );
      pageClaimsInit += 1;
      pageClaimsBackfilled = false;
      const claimsInit = pageClaimsInit;
      // On the save's own connection, so naming a refusal takes no second
      // connection from the pool while the save holds one.
      const readPage = async (
        tx: Tx,
        id: string
      ): Promise<Readonly<Record<string, unknown>> | null> => {
        try {
          const found =
            await ctx.services.ownCollections.findEntryByIdInTransaction(
              tx,
              pagesSlug,
              id
            );
          return found;
        } catch (error) {
          if (NextlyError.isNotFound(error)) return null;
          throw error;
        }
      };
      registerPageAddressClaims(ctx.hooks, {
        pages: pagesSlug,
        claims: claimsStore,
        locales: siteLocales,
        readPage,
        ...(opts.pagePreviewPath === undefined
          ? {}
          : { pathTemplate: opts.pagePreviewPath }),
        backfillDone: () => pageClaimsBackfilled,
        publishedPages: async function* () {
          const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
          const nextly = (await getCachedNextly()) as unknown as PagesReader;
          yield* publishedPages(nextly, pagesSlug);
        },
      });
      pageClaimsBackfill = async () => {
        const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
        const complete = await backfillPageClaims({
          pages: pagesSlug,
          claims: claimsStore,
          locales: siteLocales(),
          ...(opts.pagePreviewPath === undefined
            ? {}
            : { pathTemplate: opts.pagePreviewPath }),
          nextly: (await getCachedNextly()) as unknown as PagesReader,
          withTransaction: work =>
            ctx.services.collections.withTransaction(work),
          warn: (message, meta) => ctx.logger.warn(message, meta),
          current: () => claimsInit === pageClaimsInit,
        });
        // Only a pass that settled every page ends the saves' part in it: a
        // page it failed to read or claim is still unclaimed, so saves keep
        // claiming the pages in a list's way until a later boot's pass
        // finishes.
        if (complete && claimsInit === pageClaimsInit) {
          pageClaimsBackfilled = true;
        }
        return complete;
      };
      // Each collection's entries hold `<its address>/<slug>` while it and
      // the collection's template are published, in the save's transaction,
      // beside the pages, so an entry and a page never share an address.
      const templatesSlug =
        ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG;
      // Named as a page's save names the document in its way.
      const describeHolder = (tx: Tx) =>
        describeFor({ pages: pagesSlug, readPage }, tx);
      // A collection's record as the registry answers it, or null. Given a
      // write's transaction, read on that transaction's own connection, so
      // a save holding the pool's last connection never waits for another.
      const collectionRecord = async (
        slug: string,
        tx?: Tx
      ): Promise<Record<string, unknown> | null> => {
        try {
          return (await (tx === undefined
            ? ctx.services.collections.getCollection(slug, undefined as never)
            : ctx.services.collections.getCollectionInTransaction(
                tx,
                slug
              ))) as unknown as Record<string, unknown>;
        } catch (error) {
          if (NextlyError.isNotFound(error)) return null;
          throw error;
        }
      };
      const readStoredAddresses = storedAddressesReader(
        ctx.services.ownCollections,
        templatesSlug
      );
      // The entries of `collection` waiting for an address another document
      // holds, as last committed, for the template action's answer.
      waitingEntriesOf = async collection => {
        const waiting = new Set<string>();
        for (let page = 1; ; page += 1) {
          const { rows, total } = await committedClaims(
            claimsStore,
            {
              kind: { equals: "waiting" },
              holderCollection: { equals: collection },
            },
            { limit: 500, page }
          );
          for (const row of rows) {
            if (
              row.kind === "waiting" &&
              row.holder?.collection === collection
            ) {
              waiting.add(row.holder.id);
            }
          }
          if (rows.length === 0 || page * 500 >= total) return waiting.size;
        }
      };
      const claimsDeps: EntryClaimsDeps = {
        claims: claimsStore,
        addresses: templateAddresses,
        templates: templatesSlug,
        locales: siteLocales,
        describe: describeHolder,
        pages: pagesSlug,
        pagesBackfilled: () => pageClaimsBackfilled,
        // The registry's record says whether the collection's entries carry
        // a Draft/Published status, which a field named `status` does not.
        // Asked inside a write's transaction, so read on it.
        lifecycle: async (collection, tx) =>
          (await collectionRecord(collection, tx))?.status === true,
        pagesWithSlugs: async slugs => {
          const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
          const nextly = (await getCachedNextly()) as unknown as PagesReader;
          const found = await nextly.find({
            collection: pagesSlug,
            where: {
              status: { equals: "published" },
              slug: { in: [...slugs] },
            },
            limit: slugs.length,
            overrideAccess: true,
            depth: 0,
          });
          return (found.items as Readonly<Record<string, unknown>>[]).flatMap(
            row =>
              typeof row.id === "string" || typeof row.id === "number"
                ? [
                    {
                      id: String(row.id),
                      ...pageClaims(row, siteLocales(), opts.pagePreviewPath),
                    },
                  ]
                : []
          );
        },
        // Hook-free and as the system, as the template guard reads it, so a
        // read hook cannot hide a template that serves entries.
        templateOf: async (collection, tx) => {
          const read = {
            where: { collection: { equals: collection } },
            pagination: { limit: 1 },
            // Asked on every save of a collection with a slug: the routing
            // columns alone, never the template's design.
            select: {
              id: true,
              collection: true,
              status: true,
              [TEMPLATE_ADDRESS_FIELD]: true,
            },
            depth: 0,
          };
          // On a save's transaction, its own connection: a save holding the
          // pool's last connection never waits for a second one.
          const found =
            tx === undefined
              ? await ctx.services.ownCollections.listEntries(
                  templatesSlug,
                  read
                )
              : await ctx.services.ownCollections.listEntriesInTransaction(
                  tx,
                  templatesSlug,
                  read
                );
          const row = found.data[0] as Record<string, unknown> | undefined;
          if (row === undefined || row.collection !== collection) return null;
          const address = storedAddressOf(row[TEMPLATE_ADDRESS_FIELD]);
          return {
            published: row.status === "published",
            address: address === null ? null : addressSegments(address),
          };
        },
        storedAddresses: async () =>
          new Map(
            [...(await readStoredAddresses()).entries()].map(
              ([collection, address]) => [collection, addressSegments(address)]
            )
          ),
        // The page builder's own documents are pages, stores and
        // bookkeeping, never entries served under a template address.
        neverServed: collection =>
          Object.values(ctx.self.collections).includes(collection),
        // The template guard's own judgement of which collections may have
        // one; a localized collection is refused an address.
        mayHaveTemplate: async collection => {
          const problem = await templateCollectionProblem(
            collection,
            collectionRecord,
            new Set(Object.values(ctx.self.collections))
          );
          return (
            problem === null &&
            (await collectionRecord(collection))?.localized !== true
          );
        },
        storedAddressProblem: (address, collection) =>
          storedAddressProblem(address, collection, {
            declared: declaredPaths,
          }),
        publishedEntries: async (collection, page, size) => {
          const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
          const nextly = (await getCachedNextly()) as unknown as PagesReader;
          const found = await nextly.find({
            collection,
            // Published only, and a no-op on a collection without a
            // Draft/Published lifecycle, whose entries are all live.
            status: "published",
            // `id` is unique and on every collection; `createdAt` is absent
            // where timestamps are off, and ties would let a paged walk skip
            // an entry at a batch's edge.
            sort: "id",
            limit: size,
            page,
            overrideAccess: true,
            depth: 0,
          });
          return found.items as readonly Readonly<Record<string, unknown>>[];
        },
      };
      // Whatever is declared in code: a collection created at runtime is
      // given its address on its template, at any time after start.
      registerEntryAddressClaims(ctx.hooks, claimsDeps);
      const passDeps = {
        ...claimsDeps,
        withTransaction: <T>(work: (tx: Tx) => Promise<T>) =>
          ctx.services.collections.withTransaction(work),
        warn: (message: string, meta: Record<string, unknown>) =>
          ctx.logger.warn(message, meta),
      };
      entryClaimsPass = () => settleEntryClaimsAtStart(passDeps);
      undeclaredSweep = () => releaseUndeclared(passDeps);
      checkTemplateAddresses = async () => {
        const own = new Set(Object.values(ctx.self.collections));
        const problems: string[] = [];
        // An address declared in code is compared with every other
        // collection's stored one: two collections may not share one. A
        // collection promoted into code taking over its own stored address
        // is no clash.
        const stored = await readStoredAddresses();
        for (const [collection, address] of declaredPaths) {
          for (const [other, held] of stored) {
            if (held === address && other !== collection) {
              problems.push(
                `"${collection}" is given the address "${address}" in code, which the collection "${other}" is already served at, set on its template in the admin. Each collection needs an address of its own: change one of them.`
              );
            }
          }
        }
        for (const collection of templateAddresses.keys()) {
          const problem = await templateCollectionProblem(
            collection,
            collectionRecord,
            own
          );
          if (problem !== null) {
            problems.push(problem);
            continue;
          }
          // One slug serves an entry in every language, as a page's does: a
          // localized collection's entries have a slug and a state in each,
          // which an address per language would have to follow.
          if ((await collectionRecord(collection))?.localized === true) {
            problems.push(
              `The collection "${collection}" is localized, and a localized collection's entries cannot be served under a template address yet.`
            );
          }
        }
        if (problems.length > 0) {
          throw new Error(
            `[page-builder] templates.addresses cannot be used: ${problems.join(" ")}`
          );
        }
      };
      contentAddresses = contentAddressService({
        claims: claimsStore,
        // The site's default language, where a localized site names one.
        defaultLocale: () =>
          ctx.config.localization?.defaultLocale || siteLocales()[0] || "en",
        // The claims collection too: the start-up passes write it alone.
        collections: [
          pagesSlug,
          templatesSlug,
          claimsStore.slug,
          ...templateAddresses.keys(),
        ],
        holders: [pagesSlug, ...templateAddresses.keys()],
        // Served while its template stores an address and it may still have
        // a template: one that lost its `slug` field or became localized
        // is served nowhere, whatever claims its entries still hold.
        storesAddress: async collection =>
          ((await claimsDeps.templateOf(collection))?.address ?? null) !==
            null && (await claimsDeps.mayHaveTemplate(collection)),
        // Listed for pre-rendering: those given an address in code, and
        // those whose template stores one.
        entryHolders: async () => [
          ...new Set([
            ...templateAddresses.keys(),
            ...(await readStoredAddresses()).keys(),
          ]),
        ],
        startup: () => addressStartup,
      });
      // A page published naming a Layout that is not: it is served inside the
      // site's default until its own is published, and the author is told.
      registerLayoutReadinessNotice({
        ctx,
        pages: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
        layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
        settings:
          ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
          PAGE_BUILDER_SETTINGS_SLUG,
      });
      // A component's removed fields: recorded when the definition dropping
      // them is published, and their values stripped from every later write.
      // On the store pages are composed against, so a host that redirected it
      // retires the fields of the definitions its pages actually place.
      // Not where the host renders components from its own source: no
      // collection stands for it, and the plugin's store, holding retirements of
      // its own, would strip fields that source still exposes.
      // Where a duplicated component came from, in the same bookkeeping
      // table as the retired ids.
      usage.origins = originStore({
        nextly: () => requireInstalled().nextly(),
        collection:
          ctx.self.collections[COMPONENT_RETIRED_SLUG] ??
          COMPONENT_RETIRED_SLUG,
      });
      if (opts.componentReadiness !== false) {
        // Registered on first use rather than here: a context without
        // version history (a test's, a host's stand-in) still installs.
        let holder: PluginVersionPinHolder | undefined;
        heldRemovals = retiredPins({
          holder: () =>
            (holder ??= ctx.services.versions.pins.registerHolder({
              name: "retired-fields",
              label: "Page Builder removed fields",
            })),
          transaction: work => ctx.db.transaction(work),
          history: () => ctx.services.versions,
          componentCollection: composition.store.collection,
          componentField: composition.store.field,
        });
        // RESOLVED, for the reason every own table is: a host may rename it.
        const retiredTable = {
          nextly: () => requireInstalled().nextly(),
          collection:
            ctx.self.collections[COMPONENT_RETIRED_SLUG] ??
            COMPONENT_RETIRED_SLUG,
        };
        const retired = retiredStore(retiredTable);
        registerRetiredExposures({
          ctx,
          componentCollection: composition.store.collection,
          componentField: composition.store.field,
          store: retired,
          limits: () => opts.limits ?? DEFAULT_LIMITS,
          memo: retiredHistory,
          pins: heldRemovals,
        });
        // While a removal is published, no write may newly set one of its
        // fields: the count the designer confirmed is final until it lands.
        removalHolds = installHoldsFor(ctx, opts, composition, {
          nextly: () => requireInstalled().nextly(),
          count: countPlacements(),
        });
        // The values already stored when a field was retired: walked out of
        // every document by the sweep below, and walked again when a write
        // committed after the walk passed its document puts one back.
        const cleanup = retiredCleanupService({
          install: requireRewriteInstall,
          retired: () => allRetired(retiredTable),
          logger: ctx.logger,
        });
        retiredCleanup = cleanup;
        registerRetiredCleanupCheck({
          ctx,
          retired: ids => retired.of(ids),
          cleanup: () => cleanup,
          limits: () => opts.limits ?? DEFAULT_LIMITS,
          store: composition.store,
        });
      } else {
        // Nothing is retired without the readiness hooks, so nothing is owed.
        retiredCleanup = {
          advance: () => Promise.resolve({ walked: [], finished: true }),
          walkAgain: () => Promise.resolve(),
        };
      }
      // Every write holding a component being deleted is judged again last
      // inside its own transaction: before the delete, it sends its document
      // back to be converted again from what was saved; once the delete is
      // under way, it is refused as made from a stale copy.
      registerInTransactionFence({
        ctx,
        limits: () => opts.limits ?? DEFAULT_LIMITS,
        // A component being deleted may not itself change meanwhile.
        components: composition.store.collection,
      });
      // A component's own delete only through Delete component, and no
      // unpublish of one documents place. Registered after the Layout guard,
      // so a component a Layout uses is refused naming the Layout first.
      {
        const placing = composition.hostsOf;
        const store = composition.store.collection;
        // The registry's record of the collection, which a store made in the
        // admin changes there; never read inside a caller's transaction.
        const lifecycle = storeLifecycle(
          async () =>
            (
              (await ctx.services.collections.getCollection(store, {})) as {
                status?: unknown;
              } | null
            )?.status === true
        );
        registerComponentGuards({
          ctx,
          components: store,
          runs: () => fenceStore(ctx.db, ctx.dialect),
          hostsOf: () => placing,
          confirmUnused: storedUseCheck(() =>
            componentDeleteRewriteService(requireRewriteInstall)
          ),
          lifecycle,
        });
      }
      rewriteInstall = rewriteInstallFor(ctx, opts, composition);
      // The "Bindings to fix" report: each committed write's document judged
      // again, and every document by the sweep once the schema changes.
      bindingReportCtx = ctx;
      registerBindingReportOnWrite(ctx, bindingReportDeps);
      // The breakpoints the write path judges a save against: one read of
      // the site's style, the same answer the blocks field gets. A removal's
      // walk, its locks and the write report all ask it, so they agree on
      // which removed ids the site defines again.
      const definitions = composition.siteDefinitions;
      const definedBreakpoints = async () => {
        if (definitions === undefined) {
          throw NextlyError.internal({
            logContext: { reason: "breakpoint-removal-no-site-definitions" },
          });
        }
        return (await definitions()).breakpointIds;
      };
      removalInstall = {
        db: ctx.db,
        dialect: ctx.dialect,
        site: rewriteInstall.site,
        defaults: configStyle,
        definedBreakpoints,
        breakpointsNow: async () =>
          siteBreakpoints(await siteStyleNow()) ?? null,
      };
      removalLogger = ctx.logger;
      // A write holding a removed breakpoint's values, committed after the
      // removal's walk stripped that document, sends it back to be stripped
      // again from what was saved, the removal done or not.
      registerRemovalWriteReport({
        ctx,
        runs: () => removalRunStore(ctx.db, ctx.dialect),
        definedBreakpoints,
      });
      // A blocks field below the top level has no Page Builder to open, and the
      // operator should learn that from the log before an author meets it in
      // the form.
      warnNestedBlocksFields(ctx.config, message => ctx.logger.warn(message));
    },
    // Seed the default Layout once the system is assembled, so a fresh site
    // has one before its first page is drawn. Deliberately not awaited:
    // `seedDefaultLayoutAtStart` says why, and catches every failure itself.
    //
    // Then record the site's spacing model, once: AFTER the seed, so the seed
    // is recorded and not taken for content. Neither step throws.
    onReady: async () => {
      // A collection given a template address that cannot have a template
      // refuses to start, naming it: checked once every plugin's
      // collections are registered.
      await checkTemplateAddresses?.();
      // Existing pages' addresses, claimed in the background, then the
      // entries' under their collections' addresses, pages first: the
      // passes never throw, and a boot is not held for them.
      const backfill = pageClaimsBackfill;
      const entryPass = entryClaimsPass;
      const sweep = undeclaredSweep;
      if (backfill !== null) {
        // The entries' pass only after every page holds its address: until
        // then an entry could take a path a page is still owed. Releasing a
        // removed collection's claims takes nothing a page is owed, so it
        // runs whether or not the pages' pass completed.
        // Not awaited, so the boot is not held; the address listing joins it
        // instead (see the content address service).
        const startup = backfill()
          .then(async complete => {
            await sweep?.();
            if (complete) await entryPass?.();
          })
          .catch(() => undefined);
        addressStartup = startup;
        void startup.finally(() => {
          if (addressStartup === startup) addressStartup = null;
        });
      }
      void seedGraphLock?.();
      const setup = defaultLayoutSetup;
      const spacing = spacingSetup;
      const seeded =
        setup === null ? Promise.resolve() : seedDefaultLayoutAtStart(setup);
      if (spacing !== null) {
        // Not awaited, so the boot is not held; a style read made meanwhile
        // joins it instead (see the spacing-model service below).
        const startup = seeded.then(() =>
          settleSpacingModeAfterBoot(spacingModeDeps, spacing.warn)
        );
        spacingStartup = startup;
        void startup.finally(() => {
          if (spacingStartup === startup) spacingStartup = null;
        });
      }
    },
    // Moves with every migration of the plugin's own tables below.
    schemaVersion: pageBuilderSchemaPlugin.schemaVersion,
    contributes: {
      // The usage indexes' bookkeeping: the current run, each scope's progress
      // and the dirty mark. Tables rather than collections, so no admin
      // screen, REST route or Direct API call reaches them.
      schema: pageBuilderSchema,
      // The audit rows this plugin writes: one per breakpoint removed, with
      // what removing it dropped, and one per removal undone.
      audit: {
        kinds: [
          {
            kind: BREAKPOINT_REMOVED_AUDIT,
            metadataKeys: [...BREAKPOINT_REMOVED_METADATA],
          },
          {
            kind: BREAKPOINT_REMOVAL_UNDONE_AUDIT,
            metadataKeys: [...BREAKPOINT_REMOVAL_UNDONE_METADATA],
          },
          // One per site code save: hashes, sizes and counts, never the code.
          {
            kind: SITE_CODE_SAVED_AUDIT,
            metadataKeys: [...SITE_CODE_SAVED_METADATA],
          },
        ],
      },
      // The channel another plugin adds blocks through. Core carries no
      // `contributes.blocks` key — a plugin contributing blocks is contributing
      // to the page builder, not to Nextly — so the registry is offered here and
      // reached via `ctx.services.plugins`.
      services: {
        [BLOCK_SERVICE]: () => createBlockRegistrationService(),
        // The index-wide facts behind "used on N pages", bound to the
        // installation. Offered as a service because answering needs the
        // installed context — which collections the registry holds, which
        // generation the index was derived under — and nothing outside this
        // plugin can assemble those. Without it a finished backfill changes
        // nothing anybody can observe: every consumer takes the conservative
        // branch and the answer stays a floor for ever.
        [USAGE_HEALTH_SERVICE]: () => usageHealthService(requireInstalled),
        // Turning every copy of a component into plain blocks before it is
        // deleted: the run (which fences the component), the rewrite of every
        // host as the person who started it, and its progress.
        [COMPONENT_DELETE_REWRITE_SERVICE]: () =>
          componentDeleteRewriteService(requireRewriteInstall),
        // Removing breakpoints from the site: the run, one open at a time,
        // and the walk stripping what they held, as the system.
        [BREAKPOINT_REMOVAL_SERVICE]: removalService,
        // Taking a component's retired field values out of every document
        // still holding them; the sweep below drives it.
        [RETIRED_CLEANUP_SERVICE]: () => requireRetiredCleanup(),
        // The site's spacing model, for a render that holds only the Direct
        // API: `loadSiteStyle` reads it through this service. Resolved per
        // call, so a read before `init` refuses rather than answering a
        // default the site never chose.
        // A read finding no model while this process is still deciding one,
        // at start or in a sweep, waits for that decision, so a first render
        // is not drawn under a default the site is about to replace.
        // The composition API for code serving a request of its own (another
        // plugin's route, the MCP endpoint): the manifest and the page and
        // definition actions, each the function its route runs, as the
        // caller handed in. Bound to this plugin's own context, so a caller
        // from another plugin is read against this plugin's collections.
        [COMPOSITION_SERVICE]: ctx =>
          compositionService(ctx, {
            store: componentStoreOf(opts),
            limits: () => opts.limits ?? DEFAULT_LIMITS,
            readRetired: readRetiredFor,
            templates: templateActions,
            namedQueries: namedQueryDeclarations,
          }),
        // Who holds a path, for the site's one content route: a page, or a
        // collection's entry under its template address. Read as committed,
        // through the store every save's collision check writes.
        [CONTENT_ADDRESS_SERVICE]: () => requireContentAddresses(),
        [SPACING_MODE_SERVICE]: (): SpacingModeReader => ({
          read: () =>
            readJoiningDecision(
              requireSpacingSetup().store,
              () => spacingStartup ?? spacingModeRunInFlight()
            ),
        }),
      },
      // The backfill sweep. Contributed unconditionally beside the index it
      // fills: the work is owed from the moment this plugin meets existing
      // content, and no request or hook ever becomes the moment to enqueue it.
      //
      // The deps are resolved through the holder on every pass rather than
      // captured, so a handler that somehow ran before `init` refuses with a
      // named reason instead of walking a half-built configuration.
      jobs: [
        usageBackfillJob({
          scopes: async () => backfillScopes(requireInstalled()),
          state: () => usageBackfillDeps(requireInstalled()).state(),
          rebuild: (scope, walk) =>
            usageBackfillDeps(requireInstalled()).rebuild(scope, walk),
          forgetGone: (scopes, fenced, run) =>
            forgetGoneScopes(requireInstalled(), scopes, fenced, run),
        }),
        // The default-Layout repair. A sweep, so the runner keeps one queued
        // and every jobs pass confirms the site still has a published default,
        // whatever path took it away; the guards also queue it directly.
        defaultLayoutJob(defaultLayoutDeps),
        // The spacing-model step, retried on every pass until a model is
        // recorded; then one indexed read per pass.
        spacingModeJob(spacingModeDeps),
        // The cleanup of retired field values, owed whenever a component's
        // retired ids hold more than its last walk was for. A pass with none
        // owed reads the retired table and each such component's run.
        retiredCleanupJob(requireRetiredCleanup),
        // The breakpoint removal a write opened again, which nobody is
        // waiting on: carried on each pass until it is done.
        breakpointRemovalJob(removalService),
        // The check of every document for the bindings report, when the
        // schema changed since the last complete one.
        bindingsReportJob(bindingReportPass),
        // Delete component's sweep: a delete that stopped after its write
        // becomes its tombstone. Never a host write or a delete.
        componentDeleteJob(componentDeleteSweepDeps),
      ],
      // The index is contributed unconditionally, alongside the pages it
      // describes. Its table existing is what lets the maintenance path write
      // to it without a first-run branch, exactly as the site style single is
      // registered whether or not the host stated any defaults.
      // The composition stores, contributed unconditionally beside the pages
      // they serve. Each is a collection rather than a shape inside one,
      // because a collection is what core seeds permissions for: the six
      // actions on `patterns` are separate rows from the six on `components`,
      // so "may create a pattern" and "may publish a component to every page
      // that carries it" are already different grants on the day this ships.
      // A single table discriminated by a column would leave both behind one
      // permission and could not declare a slug unique per kind.
      collections: [
        pagesCollection(
          pagesOptions(
            opts,
            configStyle,
            // Read per write through the holder `init` fills: the field is
            // declared before the plugin is installed.
            layoutFenceFloor(() => defaultLayoutSetup?.removals)
          )
        ),
        patternsCollection(),
        // The plugin's own collection is the store unless the host names one.
        componentsCollection({
          isStore: storeIsOwn(componentStoreOf(opts)),
        }),
        layoutsCollection(),
        classUsageIndexCollection(),
        componentUsageIndexCollection(),
        // Who holds each served address, so no two documents share one.
        addressClaimsCollection(),
        // Each component's retired field and slot ids, recorded when a
        // definition that drops one is published. Contributed unconditionally,
        // because every write to a page that places a component reads it.
        componentRetiredCollection(),
        // The designs a collection's entries are drawn with, one per
        // collection.
        templatesCollection(),
        // The backfill's former progress collection. Nothing reads or writes
        // it any more: progress lives in the plugin's own tables. Still
        // declared so an existing site keeps its table and registry row as
        // they are, rather than meeting a collection that disappeared.
        usageBackfillStateCollection(),
      ],
      // The Site Style global: one versioned, access-controlled document the
      // stored style tier lives in. Registered whether or not the host stated
      // defaults, because the storage existing is what the style studios and
      // the API write against.
      // Given the SAME host list the published sheet, the canvas and the
      // inspector are given, through the same derivation: a named class is
      // emitted verbatim into every public page, so a `url()` stored here is a
      // request every visitor makes. `hostFetchPolicy` is the one place that
      // turns a pattern list into a predicate, so there is one answer to "may
      // this be fetched" rather than one per surface. A host that configured
      // no patterns gets today's behaviour: the engine treats an absent policy
      // as unasked.
      singles: [
        siteStyleSingle(
          {
            ...hostFetchPolicy(opts.remotePatterns),
            // The CONFIG tier this site states in code, so the write gate
            // judges what consumers actually compile. Without it a stored
            // class whose slug a config class already holds is accepted and
            // then dropped at render, and the node referencing it gets no
            // rule at all. The code tier, which always holds the core blocks'
            // looks.
            defaults: configStyle,
          },
          // A locked shared style may be stripped by an open removal, in the
          // settings write that stores its set: judged by every id it
          // removed, which the site still defines while that write is judged.
          () => removalService().openRemovalAsSaved(),
          // A write dropping a variable is judged by the remove route's check.
          () => variablesInUse
        ),
        // Where the site's default Layout is recorded. Contributed whether or
        // not any Layout exists yet, because the repair writes it on a site
        // that has none, and the make-default route writes it on every other.
        pageBuilderSettingsSingle(),
        // The code every published page carries, written only by the site
        // code route, which judges it first.
        siteCodeSingle(),
      ],
      // One field type, where there were two. The other named the previous
      // editor's document — a shape this package defined itself, stored under a
      // synthetic root, and validated with its own rules. A site that declared
      // it got a field the engine could not read and the current renderer could
      // not draw, so the two field types were not alternatives but rival
      // formats, and only this one is a format anything else understands.
      // Built against the configured breakpoints, so a document write is
      // validated against the same set the canvas draws with. With none
      // configured this is the empty set, which the engine treats permissively.
      fieldTypes: [
        blocksFieldType(siteBreakpoints(configStyle), () => composition),
      ],
      // The one read the insert panel makes. A route rather than a collection
      // read from the browser, because the index it serves has two sources —
      // stored rows and, later, patterns a plugin declares in code — and only a
      // server sees both. Measured besides: the admin's collection hooks are
      // not exported from `@nextlyhq/plugin-sdk/admin`, which is the only
      // surface this package may import from, so there is no browser-side
      // collection read available to it at all.
      //
      // And the one write that fills it. Contributed beside the read rather
      // than left to the collection API, because what a saved pattern IS is
      // the planner's answer and the planner needs the server's block
      // registry — the browser holds the core blocks and not the ones another
      // plugin declared.
      //
      // And the component definitions, on a route of their own: the canvas
      // needs them on every editor mount to draw an instance at all, and a
      // plugin route declares one permission, so the tier a role may read
      // without the other has to be reachable without the other's gate.
      routes: [
        patternLibraryRoute(),
        componentLibraryRoute(componentStoreOf(opts)),
        savePatternRoute(),
        // What the editor may offer this caller: saving a pattern, making a
        // component or updating a pattern from a selection, and opening a
        // component in its own view from the store definitions live in.
        patternCapabilityRoute(componentStoreOf(opts)),
        // What a publish would leave unpublished, asked by the editor before
        // it, and the offer's write: each chosen component or Layout
        // published as the author.
        publishReadinessRoute(publishReadinessSetup(opts)),
        publishDependenciesRoute(publishReadinessSetup(opts)),
        // What the component editor needs beside the component's own
        // document: the ids its live definition uses, and the count of
        // documents placing it, read from the usage index the installed host
        // maintains.
        componentFactsRoute({
          store: componentStoreOf(opts),
          countPlacements,
          // How many pages a change reaches, for the banner over the view:
          // through other components by the same index, and through the
          // Layouts wrapping pages, read live, the site's default included.
          countPages: ctx => async id => {
            const rows = usageTableRows(
              requireInstalled().db,
              usageTableOf(componentUsageIndex)
            );
            const health =
              await usageHealthService(requireInstalled).read(
                componentUsageIndex
              );
            // Imported at call time, as the Layout choices route does, so the
            // entry stays free of the runtime graph.
            const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
            return componentPageReach(
              id,
              sitePageReachSources({
                nextly: await getCachedNextly(),
                slugs: {
                  layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
                  settings:
                    ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
                    PAGE_BUILDER_SETTINGS_SLUG,
                },
                pagesCollection: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
                componentsCollection:
                  componentStoreOf(opts).collection ??
                  ctx.self.collections[COMPONENTS_SLUG] ??
                  COMPONENTS_SLUG,
                notPages: new Set([
                  ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
                  ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
                ]),
                documentsUsingEach: componentIds =>
                  listDocumentsUsingEach({
                    index: componentUsageIndex,
                    rows,
                    referenceIds: componentIds,
                    health,
                  }),
              })
            );
          },
          // The ids a published removal retired; `null` adds no field.
          readRetired: readRetiredFor,
        }),
        // A removal's hold at publish: the count taken again, and while held
        // no write sets a removed field (`removal-hold`).
        ...removalHoldRoutes({
          store: componentStoreOf(opts),
          holds: requireRemovalHolds,
          countPlacements,
          limits: () => opts.limits ?? DEFAULT_LIMITS,
        }),
        // How many placements chose one of a component's variants, for the
        // dialog that confirms deleting it: the usage index lists the hosts,
        // and each host's stored forms are walked as the system.
        variantUseRoute({
          store: componentStoreOf(opts),
          hosts: () => composition?.hostsOf,
          readForm: async (host, form) =>
            hostFieldReader(await requireInstalled().nextly())(host, form),
          limits: opts.limits ?? DEFAULT_LIMITS,
        }),
        // Save a selection as a component, or convert it into one. Here
        // rather than left to the collection API for the reason the pattern
        // save is: the planner needs the server's block registry.
        componentFromSelectionRoute({
          store: componentStoreOf(opts),
          limits: () => opts.limits ?? DEFAULT_LIMITS,
          // Read when a request arrives, after `init` has registered the
          // usage hooks this hands back.
          reconcile: () => usage.reconcile,
        }),
        // The editor's page edits (insert a pattern, place a component, set a
        // placement's values or variant, choose a Layout) and its component
        // definition edits, one action per request, each with a dry run.
        pageActionsRoute({
          store: componentStoreOf(opts),
          limits: () => opts.limits ?? DEFAULT_LIMITS,
        }),
        definitionActionsRoute({
          store: componentStoreOf(opts),
          limits: () => opts.limits ?? DEFAULT_LIMITS,
          readRetired: readRetiredFor,
        }),
        // Give a collection its template, publish or delete it, set its address,
        // and give an entry its own design or take it away, each with a dry run.
        templateActionsRoute(templateActions),
        // A template's preview in the editor: the entries of its collection
        // the author may preview, and the one being previewed, read as the
        // author asking. Reads only: which entry is previewed is not stored.
        templatePreviewEntriesRoute({ guard: requireTemplateGuard }),
        templatePreviewEntryRoute({ guard: requireTemplateGuard }),
        // Whether this caller may set or change a template address: what the
        // template form asks before it offers the address for editing. Not a
        // security boundary: the field's rules and the action decide.
        templateRoutingRoute(),
        // A collection's own designs, its template and its names, read as
        // the caller: what the admin's Design section, Design column and the
        // template's own designs list draw from.
        entryDesignsRoute({ guard: requireTemplateGuard }),
        // What an API client or an agent reads before composing: the
        // patterns, components (fields, slots, variants) and Layouts it may
        // read, and the actions above with their request schemas.
        manifestRoute({
          store: componentStoreOf(opts),
          limits: () => opts.limits ?? DEFAULT_LIMITS,
          namedQueries: namedQueryDeclarations,
        }),
        // Detach, duplicate and update a pattern, each with a dry run.
        ...componentActionRoutes({
          store: componentStoreOf(opts),
          limits: () => opts.limits ?? DEFAULT_LIMITS,
          reconcile: () => usage.reconcile,
          origins: () => usage.origins,
        }),
        // The relation control's read: a collection's entries as `{ id, title }`,
        // for the collections a registered block prop names as relation targets,
        // read as the author asking.
        entriesRoute(),
        // The editor's page search: the site's pages (entries of collections
        // with a Page Builder field, the composition stores left out), by
        // title, read as the author asking.
        pagesSearchRoute(componentStoreOf(opts), opts.pagePreviewPath),
        // A collection loop's menus: the collections the author may read,
        // the plugin's own stores left out, with each one's sortable fields.
        loopCollectionsRoute(componentStoreOf(opts)),
        // The site's named queries, without their run functions: what the
        // editor offers as a list's custom sources.
        namedQueriesRoute(namedQueryDeclarations),
        // A collection list's entries on the canvas, read as the author asking
        // reads them, drafts included, for a collection they may read. A
        // list whose source is a named query runs it here, on the server,
        // where its run function lives.
        listEntriesRoute(name => namedQueries.definitionOf(name)),
        // The canvas's bound props: the entry being edited, the Singles its
        // bindings read and the site settings, read as the author asking.
        canvasBindingsRoute(),
        // The fields the inspector's picker offers a binding, as the author
        // asking may read them, each marked by whether visitors may.
        bindingFieldsRoute(),
        // An unbind's plan for the inspector, against the document it holds:
        // the same decision as the page actions API's, applied by the editor.
        unbindPlanRoute(),
        // The documents whose bindings no longer fit, for those who edit
        // pages, each listed only when the caller may read it.
        bindingsToFixRoute({
          store: bindingReportDeps.store,
          readable: (routeCtx, entries) => readableAsCaller(routeCtx, entries),
          // A read starts a check when the schema may have changed, at most
          // once a minute, and never waits for it.
          refresh: routeCtx => {
            const now = Date.now();
            if (now - bindingsRefreshedAt < BINDINGS_REFRESH_MS) return;
            bindingsRefreshedAt = now;
            routeCtx.services.jobs
              .runSweepNow(BINDINGS_REPORT_JOB, {
                maxDurationMs: BINDINGS_REFRESH_RUN_MS,
              })
              .catch((error: unknown) =>
                bindingReportCtx?.logger.warn(
                  "[page-builder] the bindings report's check could not start; the next jobs pass runs it.",
                  { error }
                )
              );
          },
          // Where a Layout region's binding is edited, and the language the
          // builder edits, for each row's way into the editor.
          componentStore: () =>
            rewriteInstall?.store.collection ??
            bindingReportCtx?.self.collections[COMPONENTS_SLUG] ??
            COMPONENTS_SLUG,
          defaultLocale: () =>
            bindingReportCtx?.config.localization?.defaultLocale,
          readableSingles: (routeCtx, slugs) =>
            readableSingles(routeCtx, slugs),
        }),
        // Where one page is served as it is saved, for Settings' address
        // line, resolved as the search resolves each page's path.
        pageAddressRoute(componentStoreOf(opts), opts.pagePreviewPath),
        addressWaitingRoute(),
        // The Pages panel's writes: create, duplicate, rename and delete a
        // page, each as the author asking, in exactly the collections the
        // search lists.
        ...pagesWriteRoutes(componentStoreOf(opts)),
        // The one write that chooses the site's default Layout. A route rather
        // than an edit to the settings Single, because choosing a default has
        // preconditions (the Layout is published, the caller may publish
        // Layouts) that a plain Single write cannot state.
        makeDefaultRoute(),
        // Remove Layout: the one way a Layout is deleted or unpublished, fenced
        // and checked so no page and not the site's default is taken from
        // under it. The Layout's own delete and unpublish refuse every write
        // that does not come through here.
        removeLayoutRoute(),
        // Delete component: the dry run, each step of the delete as the
        // person who started it, and its progress. A component's own delete
        // refuses every write that does not come through here.
        ...componentDeleteRoutes({
          store: componentStoreOf(opts),
          install: () => {
            const installed = requireRewriteInstall();
            return {
              rewrite: componentDeleteRewriteService(requireRewriteInstall),
              runs: fenceStore(installed.db, installed.dialect),
            };
          },
        }),
        // The Layouts an author may choose for a page, with the published
        // regions the editor draws around it, read as the author from the
        // component store the editor's library reads, under the bounds the
        // published renderer draws with.
        layoutChoicesRoute(
          componentStoreOf(opts),
          () => opts.limits ?? DEFAULT_LIMITS
        ),
        // Which collection holds the pages, as renamed: the picker draws on
        // that collection's forms and no other.
        pageCollectionRoute(),
        // Settings' Site tab: what the caller may change there, and the one
        // way the site's breakpoints change.
        // With the removals still holding what they removed, so the tab can
        // follow one that is still going.
        siteSettingsRoute(configStyle, breakpointRemoval),
        // A set that removes breakpoints strips what they held from the site;
        // one that does not finish in its save is carried on by the second.
        siteBreakpointsRoute(breakpointRemoval),
        siteBreakpointRemovalRoute(breakpointRemoval),
        // The newest removal undone, within its 30 days; its walk is carried
        // on through the removal route.
        siteBreakpointUndoRoute(breakpointRemoval),
        // Where one removal stands, read by its id.
        siteBreakpointRemovalStatusRoute(breakpointRemoval),
        // The site's code, read, checked and saved under the site settings
        // permission; saved by a signed-in person only.
        ...siteCodeRoutes({
          nextly: async () => {
            const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
            const nextly = await getCachedNextly();
            return {
              findSingle: args => nextly.findSingle(args),
              updateSingle: args => nextly.updateSingle(args),
            };
          },
          options: opts.siteCode,
          permission: MANAGE_SITE_PERMISSION,
          // Read as the server, for "Last changed by": the name only.
          personName: async id => {
            const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
            const nextly = await getCachedNextly();
            const person = await nextly.users.findByID({ id });
            return typeof person?.name === "string" && person.name !== ""
              ? person.name
              : null;
          },
        }),
        // A pattern, a component or a Layout as one file, with the components,
        // shared styles, variables, breakpoints and media it depends on,
        // read as the caller.
        ...exportRoutes({
          store: componentStoreOf(opts),
          defaults: configStyle,
        }),
        // Such a file read against this site: a preview of what it adds,
        // reuses and clashes with, or the import itself, as the caller.
        importRoute({
          store: componentStoreOf(opts),
          defaults: configStyle,
          reconcile: () => usage.reconcile,
        }),
        // The editor's read of the stored site style, for anyone who may
        // edit something the builder opens: the canvas cannot draw without it.
        siteStyleRoute(componentStoreOf(opts)),
        // The owner's choice of how blocks are spaced, asked of the same
        // permission a Site Style write needs.
        // A choice expires the cached pages that read the site style, and says
        // so in the plugin's log when it cannot.
        spacingModeRoute(slug =>
          siteStyleExpiry(requireSpacingSetup().warn)(slug)
        ),
        // Design → Fonts' catalogue: read it, and add a family to the site.
        ...fonts.routes,
        // The Design panel's shared styles: lock and unlock one, how widely
        // each is used and where, and removing the unused. Usage is read from
        // the class usage index the installed host maintains.
        ...sharedStyleRoutes({
          configClassIds,
          usage: ctx => usageSourceOf(ctx.self.collections, classUsageIndex),
        }),
        // The Variables panel: how widely each variable is used and where,
        // from the variable usage index and the site's shared styles, and
        // removing the ones the site added that nothing uses. A count now is
        // the shared styles' count route: one sweep fills every index.
        ...variableRoutes({
          defaults: configStyle,
          usage: ctx => usageSourceOf(ctx.self.collections, tokenUsageIndex),
          // A block type's own default styles are a use, read per request.
          blocks: allBlocks,
          inUse: (ctx, readNamed) =>
            variableRemovalChecks({
              usage: usageSourceOf(ctx.self.collections, tokenUsageIndex),
              blocks: allBlocks,
              documents: async () =>
                storedDocumentsOf(ctx, await bootedNextly()),
              limits: opts.limits ?? DEFAULT_LIMITS,
              // The first use named only if this caller may open it.
              firstReadable: uses =>
                firstReadableTitle(
                  uses,
                  readNamed,
                  async slug => (await ctx.caller?.can("read", slug)) ?? false
                ),
              pathOf: id => id,
            }),
        }),
      ],
      // The grant that lets a role change the site's settings in the editor's
      // Settings: its breakpoints, through the one route that changes them,
      // and with the Layout rights its default Layout, through make-default.
      // A permission of its own rather than `update-site-style` or
      // `update-page-builder-settings`: redefining the site's devices is not
      // a style, and the second grant would name a Single nobody edits directly.
      permissions: [
        {
          action: "manage",
          resource: "page-builder-site",
          label: "Manage page builder site settings",
          description:
            "Change the site's breakpoints, and choose its default Layout.",
        },
        // Locking a shared style is its own grant, distinct from changing
        // Design (`update-site-style`), so a lock protects a style from every
        // Design manager who does not hold it. Asked by the lock route alone.
        LOCK_SHARED_STYLES_DECLARATION,
        // Setting or changing where a collection's entries are served moves
        // live addresses, so it is a grant of its own, apart from updating
        // templates. Asked by the address field's rules and the template
        // action.
        MANAGE_TEMPLATE_ROUTING_DECLARATION,
      ],

      // No `publish` permission. One was declared here and nothing ever read
      // it: publishing a page is a status change on the entry, which
      // `update-pages` already covers, and no code path asked whether the user
      // could publish. Granting it did nothing and withholding it prevented
      // nothing. Declare it again alongside the check that reads it.
      // The "Bindings to fix" card, for those who edit pages, hidden while
      // they may see no broken binding.
      dashboard: {
        widgets: [bindingsToFixWidget(bindingsVisibleTo)],
        // And a line on the Needs your attention card every dashboard shows.
        attention: [bindingsToFixAttention(bindingsVisibleTo)],
      },
      admin: {
        // What the editor in the browser needs of the options: see
        // `adminClientConfig`.
        ...adminClientConfig(opts, {
          configStyle,
          canvasPath,
          fontsOff: fonts.off,
        }),
        // The "Bindings to fix" page, at
        // `/admin/plugins/nextlyhq-plugin-page-builder/bindings-to-fix`,
        // reached from its dashboard card and the editor's notice.
        pages: [
          {
            path: "/bindings-to-fix",
            component: BINDINGS_TO_FIX_PAGE_COMPONENT,
            requiredPermission: EDIT_PAGES_PERMISSION,
          },
        ],
        // The three LIBRARIES, and no link to Pages.
        //
        // Pages is an ordinary collection that happens to declare a `blocks`
        // field — a title, a slug and the document — and the Collections
        // listing already offers it, because it is not hidden and claims no
        // sidebar group. A second entry here was the same screen named twice.
        //
        // It is also a claim the code does not support. The page builder is a
        // FIELD TYPE, so any collection may declare it and a Single may too;
        // nothing in the engine, the builder or this package knows the slug
        // `pages`. A menu promising "the page builder lives here, and it means
        // Pages" gets less true the moment a second collection declares the
        // field, and nothing would ever add that one.
        //
        // So content sits with content, and this menu holds what is genuinely
        // global: the pieces pages are built FROM. An author already switches
        // page from inside the editor, whose left rail carries a Pages panel —
        // which is where that job belongs, since it is done while building
        // rather than while deciding what to build.
        //
        // Each entry names the permission that makes its screen reachable, so
        // a role without it is not offered a link into a list it would be
        // refused, and each names its `collection`, so a host that renames one
        // gets a link to the collection it actually registered and a gate on
        // the permission that slug actually seeds. Spelling either literally
        // would strand the link and hide the item from the readers who can
        // open the list.
        //
        // They sit under this plugin's own heading rather than a section of
        // their own: the sidebar's section vocabulary is a closed list in core
        // with no design entry, so grouping them elsewhere would mean widening
        // that list — a change to the admin's navigation model, and a larger
        // question than where three links go.
        // The editor is a full-screen view of the document, offered wherever a
        // blocks field is used — including collections the Schema Builder adds
        // later — and opened by the field's card at that address.
        documentViews: [
          {
            path: BUILDER_VIEW_PATH,
            fieldType: BLOCKS_TYPE,
            component: BUILDER_VIEW_COMPONENT,
            label: "Page Builder",
          },
        ],
        // "Remove Layout…" in a Layout's document bar, beside History: the one
        // way an author deletes or unpublishes a Layout, since the form's own
        // delete and unpublish are refused. The slot is offered to every entry
        // form; the component draws only on a saved Layout's own.
        entryFormToolbarSlot: REMOVE_LAYOUT_ACTION_COMPONENT,
        // An entry's own design, where an author meets it.
        //
        // The Design section of an entry's side panel, first, before Status:
        // which design the entry is shown with, and its own design. Declared
        // at the `collection.edit` place with no collections named, so it is
        // offered on every collection's entries, a collection the Schema
        // Builder adds later included; it draws nothing for an entry whose
        // collection cannot have a template, which leaves no section.
        contributions: [
          {
            id: "nextlyhq-plugin-page-builder.entry-design",
            kind: "sidebarSection",
            place: "collection.edit",
            label: "Design",
            component: ENTRY_DESIGN_SECTION_COMPONENT,
            before: "status",
            // On a phone the panel opens only from the document's menu, so
            // the section sits above the form there, where an author meets
            // which design the entry is shown with before its fields.
            narrow: "above-form",
          },
        ],
        // Delete component on the component store, wherever it is: the
        // plugin's own collection (followed through a rename, as every view
        // key is), or the host's store named by `componentReadiness`. The
        // document's own Delete opens the Delete component dialog in its
        // place, keeping its row, its permission and every reason it can't
        // run (a past version on screen, a colleague's claim). A host's store
        // also gets the delete tools above its list, for the row action; the
        // plugin's own collection declares them itself.
        //
        // On a template's own document screen: the entries with their own
        // design, in its panel, and a Delete that says what deleting the
        // template, or an own design, does to the site before it happens.
        views: {
          ...deleteComponentViews(componentStoreOf(opts)),
          [TEMPLATES_SLUG]: {
            documentActions: {
              delete: { component: TEMPLATE_DELETE_COMPONENT },
            },
            panelSections: [
              {
                title: "Own designs",
                component: TEMPLATE_OWN_DESIGNS_COMPONENT,
              },
            ],
          },
        },
        // A host's own store's list gets Delete component on each row through
        // tools drawn in the header, which is on every page: the slot above a
        // list is the host's own to fill, and a second one there would be
        // dropped. Its slug reaches them through `clientConfig`.
        ...(hostStoreOf(componentStoreOf(opts)) === undefined
          ? {}
          : { header: { slot: COMPONENT_STORE_DELETE_HOST_COMPONENT } }),
        menu: [
          {
            label: "Patterns",
            collection: PATTERNS_SLUG,
            to: `/admin/collections/${PATTERNS_SLUG}`,
            icon: "LayoutTemplate",
          },
          {
            label: "Components",
            collection: COMPONENTS_SLUG,
            to: `/admin/collections/${COMPONENTS_SLUG}`,
            icon: "Component",
          },
          {
            label: "Layouts",
            collection: LAYOUTS_SLUG,
            to: `/admin/collections/${LAYOUTS_SLUG}`,
            icon: "PanelsTopLeft",
          },
          // The designs collections' entries are drawn with, and where each
          // collection's entries are served.
          {
            label: "Templates",
            collection: TEMPLATES_SLUG,
            to: `/admin/collections/${TEMPLATES_SLUG}`,
            icon: "LayoutDashboard",
          },
          // The site-wide report of bindings that no longer fit, for those
          // who edit pages, as its page asks.
          {
            label: "Bindings to fix",
            to: BINDINGS_TO_FIX_PAGE_HREF,
            // Neutral: the entry is there whether or not anything needs
            // fixing; the warning sign is for the dashboard line and the
            // editor's chip, which show only when something does.
            icon: "Unlink",
            requiredPermission: EDIT_PAGES_PERMISSION,
          },
        ],
        // No `schemaBuilderSlot`. It named a component this package no longer
        // ships: a schema-builder toggle for turning a collection into a
        // page-builder one, from an editor that stored its own document
        // format. A slot is registered by SPECIFIER, so nothing type-checks
        // the name: pointing at a component that is not exported resolves to
        // nothing at render time. The toolbar slot above names one this entry
        // registers (`admin/index.ts`).
      },
    },
  });
  // The route a site renders its pages with reads this page builder's own
  // queries through `namedQueriesOf`: bound to this definition, never to a
  // registry another site's boot can replace.
  sitesQueries.set(plugin, {
    definitionOf: name => namedQueries.definitionOf(name),
  });
  // A host's component store must not share a slug with the plugin's own
  // collections: refused while the config is read, before anything is keyed
  // by it. A rename is judged again in `init`, once it is known.
  refuseStoreSharingAPluginSlug(
    componentStoreOf(opts),
    (plugin.contributes?.collections ?? []).map(collection => collection.slug)
  );
  return plugin;
};
