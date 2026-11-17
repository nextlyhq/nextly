/**
 * Components and patterns: the publish-readiness notice, the read of a
 * component's retired ids, how a blocks value is judged as composition and
 * judged again in each write's transaction, what a component's removal and
 * Delete component wire at `init`, and the routes for the libraries, the
 * component, pattern and page actions, Delete component, and a design as a
 * file.
 */
import { DEFAULT_LIMITS, type RetiredExposures } from "@nextlyhq/blocks-engine";
import type {
  PluginRoute,
  PluginRouteContext,
  PluginVersionPinHolder,
} from "@nextlyhq/plugin-sdk";

import { blocksListRoute } from "../blocks-list-route";
import { patternCapabilityRoute } from "../capability-route";
import { hostFieldReader } from "../class-usage-runtime";
import { COMPONENT_RETIRED_SLUG } from "../collections/component-retired-exposures";
import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { PATTERNS_SLUG } from "../collections/patterns";
import { componentActionRoutes } from "../component-actions-route";
import {
  registerComponentGuards,
  storedUseCheck,
  storeLifecycle,
} from "../component-delete/guards";
import { componentDeleteRoutes } from "../component-delete/route";
import {
  componentFactsRoute,
  componentStoreShape,
  reconciledRetired,
} from "../component-facts-route";
import { componentFromSelectionRoute } from "../component-from-selection-route";
import { indexHostFinder } from "../component-hosts";
import {
  componentPageReach,
  sitePageReachSources,
} from "../component-page-reach";
import { registerComponentReadinessNotice } from "../component-readiness-hook";
import { componentUsageIndex } from "../component-usage";
import { manifestRoute } from "../composition-manifest";
import { registerCompositionRejudge } from "../composition-rejudge";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import { definitionActionsRoute } from "../definition-actions-route";
import type {
  CompositionSetup,
  LayersLockUnjudged,
} from "../fields/blocks-composition";
import { listFieldsFrom } from "../fields/list-query-judgement";
import { fencedComponentsReader, fenceStore } from "../host-rewrite/fence";
import { registerInTransactionFence } from "../host-rewrite/in-transaction";
import {
  componentDeleteRewriteService,
  type RewriteInstall,
} from "../host-rewrite/service";
import { componentLibraryRoute, patternLibraryRoute } from "../library-route";
import { originStore } from "../origin-store";
import { pageActionsRoute } from "../page-actions-route";
import { removalHoldRoutes } from "../removal-hold-route";
import {
  registerRetiredCleanupCheck,
  retiredCleanupService,
} from "../retired-cleanup";
import { registerRetiredExposures } from "../retired-exposure-hooks";
import { reconcileRetired } from "../retired-history";
import { retiredPins } from "../retired-pins";
import { allRetired, retiredStore } from "../retired-store";
import { savePatternRoute } from "../save-pattern-route";
import { siteLocales as siteLocalesOf } from "../site-style-route";
import { readEntryBlocksFields } from "../templates/entry-content-fields";
import { templateTargets } from "../templates/template-guard";
import { exportRoutes } from "../transfer/export-route";
import { importRoute } from "../transfer/import-route";
import { listDocumentsUsingEach } from "../usage-count";
import { usageHealthService } from "../usage-health-service";
import { usageTableOf, usageTableRows } from "../usage-index-tables";
import { variantUseRoute } from "../variant-use-route";

import {
  type InitContext,
  siteStyleReads,
  installHoldsFor,
  rewriteInstallFor,
} from "./install-context";
import { componentStoreOf, type PageBuilderOptions } from "./options";
import type { Definition } from "./state";
import type { UsageParts } from "./usage";

/**
 * Wire the publish-readiness notice, unless the host turned it off.
 *
 * Lifted out of `init` rather than left inline: initialisation is a list of
 * registrations, and a branch resolving four settings inside it makes the list
 * harder to read than the decision is. Off means NOT REGISTERED, rather than
 * registered and declining per write — a hook that runs on every save to answer
 * "not my business" is cost with no product.
 */
export function registerReadinessNotice(
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

/**
 * The ids a component's published removals retired, as the editor's facts,
 * the definition actions and the composition service read them.
 */
export function retiredReader(
  def: Definition
): (
  ctx: PluginRouteContext
) => (id: string) => Promise<RetiredExposures | null> {
  const { opts, state, retiredHistory, requireInstalled } = def;
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
            ...(state.heldRemovals === undefined
              ? {}
              : { pins: state.heldRemovals }),
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
  return readRetiredFor;
}

/**
 * How a blocks value is judged once the plugin is installed, published on the
 * definition for the field type and the routes, and the judgement made again
 * in each write's own transaction.
 */
export function installComposition(
  ctx: InitContext,
  def: Definition,
  templates: string,
  openBreakpointRemoval: NonNullable<CompositionSetup["openBreakpointRemoval"]>
): {
  composition: CompositionSetup;
  siteStyle: ReturnType<typeof siteStyleReads>;
} {
  const { opts, state, configStyle, namedQuerySource, requireInstalled } = def;
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
  // and the Single's stored record, by the one reading every judgement
  // uses.
  const siteStyle = siteStyleReads(ctx, configStyle);
  state.composition = {
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
    // The site's blocks, whose nesting rules and locks a write is held to.
    blocks: def.blocks,
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
    // A collection's top-level blocks fields, for the field a template's
    // Entry content block draws: read per write, so a field removed a
    // moment ago is refused at the next save that newly chooses it.
    // A failed read is thrown, so the save refuses rather than storing
    // a field nobody checked.
    entryBlocksFields: collection =>
      readEntryBlocksFields(ctx.services.collections, collection),
    listFields: listFieldsFrom({
      record: collection =>
        ctx.services.collections.getCollection(collection, {}),
      // In the write's language: a field's public read rule may depend
      // on it, and the published list is read in the page's.
      readable: async (collection, locale) => {
        // Imported at call time: this module is reached from the package
        // root, which a browser bundle imports.
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
      // Imported at call time: this module is reached from the package
      // root, which a browser bundle imports.
      const { declaredFieldShapes } = await import("nextly/runtime");
      return declaredFieldShapes(ref);
    },
    // Through the Direct API for the validation, and on the write's own
    // transaction for the judgement under the graph lock.
    siteDefinitions: siteStyle.definitions,
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
  // The site's languages, read per write: a held working draft keeps a
  // reference its live form holds in any of them.
  registerCompositionRejudge(
    ctx,
    () => state.composition,
    () => siteLocalesOf(ctx.config)
  );
  return { composition: state.composition, siteStyle };
}

/**
 * What a component's removal and its delete wire once the plugin is
 * installed: where a duplicated component came from, the retired fields and
 * their hold and cleanup, the fence on every write, the component guards,
 * and the install the component-delete rewrite reads the site through.
 */
export function installComponentRemoval(
  ctx: InitContext,
  def: Definition,
  composition: CompositionSetup,
  countPlacements: UsageParts["countPlacements"]
): RewriteInstall {
  const {
    opts,
    state,
    usage,
    retiredHistory,
    requireInstalled,
    requireRewriteInstall,
  } = def;
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
      ctx.self.collections[COMPONENT_RETIRED_SLUG] ?? COMPONENT_RETIRED_SLUG,
  });
  if (opts.componentReadiness !== false) {
    // Registered on first use rather than here: a context without
    // version history (a test's, a host's stand-in) still installs.
    let holder: PluginVersionPinHolder | undefined;
    state.heldRemovals = retiredPins({
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
        ctx.self.collections[COMPONENT_RETIRED_SLUG] ?? COMPONENT_RETIRED_SLUG,
    };
    const retired = retiredStore(retiredTable);
    registerRetiredExposures({
      ctx,
      componentCollection: composition.store.collection,
      componentField: composition.store.field,
      store: retired,
      limits: () => opts.limits ?? DEFAULT_LIMITS,
      memo: retiredHistory,
      pins: state.heldRemovals,
    });
    // While a removal is published, no write may newly set one of its
    // fields: the count the designer confirmed is final until it lands.
    state.removalHolds = installHoldsFor(ctx, opts, composition, {
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
    state.retiredCleanup = cleanup;
    registerRetiredCleanupCheck({
      ctx,
      retired: ids => retired.of(ids),
      cleanup: () => cleanup,
      limits: () => opts.limits ?? DEFAULT_LIMITS,
      store: composition.store,
    });
  } else {
    // Nothing is retired without the readiness hooks, so nothing is owed.
    state.retiredCleanup = {
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
  state.rewriteInstall = rewriteInstallFor(
    ctx,
    opts,
    composition,
    () => usage.reconcile
  );
  return state.rewriteInstall;
}

/** The routes components and patterns contribute, by name. */
export function routesForComponents(
  def: Definition,
  parts: {
    readonly countPlacements: UsageParts["countPlacements"];
    readonly readRetiredFor: ReturnType<typeof retiredReader>;
  }
): {
  readonly blocksList: PluginRoute;
  readonly patternLibrary: PluginRoute;
  readonly componentLibrary: PluginRoute;
  readonly savePattern: PluginRoute;
  readonly patternCapability: PluginRoute;
  readonly componentFacts: PluginRoute;
  readonly removalHolds: PluginRoute[];
  readonly variantUse: PluginRoute;
  readonly componentFromSelection: PluginRoute;
  readonly pageActions: PluginRoute;
  readonly definitionActions: PluginRoute;
  readonly manifest: PluginRoute;
  readonly componentActions: PluginRoute[];
  readonly componentDelete: PluginRoute[];
  readonly exportFile: PluginRoute[];
  readonly importFile: PluginRoute;
} {
  const {
    opts,
    state,
    configStyle,
    usage,
    requireInstalled,
    requireRemovalHolds,
    requireRewriteInstall,
    pageActionBindings,
    namedQueryDeclarations,
  } = def;
  const { countPlacements, readRetiredFor } = parts;
  return {
    // Which registered blocks a blocks field accepts, with their props,
    // for the Schema Builder's outline: code-defined metadata only, to
    // any signed-in caller.
    blocksList: blocksListRoute({
      blocks: () => def.blocks.all(),
      sourceOf: name => def.blocks.sourceOf(name),
    }),
    patternLibrary: patternLibraryRoute(),
    componentLibrary: componentLibraryRoute(componentStoreOf(opts)),
    savePattern: savePatternRoute(def.blocks),
    // What the editor may offer this caller: saving a pattern, making a
    // component or updating a pattern from a selection, and opening a
    // component in its own view from the store definitions live in.
    patternCapability: patternCapabilityRoute(componentStoreOf(opts)),
    // What the component editor needs beside the component's own
    // document: the ids its live definition uses, and the count of
    // documents placing it, read from the usage index the installed host
    // maintains.
    componentFacts: componentFactsRoute({
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
          await usageHealthService(requireInstalled).read(componentUsageIndex);
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
    removalHolds: removalHoldRoutes({
      store: componentStoreOf(opts),
      holds: requireRemovalHolds,
      countPlacements,
      limits: () => opts.limits ?? DEFAULT_LIMITS,
    }),
    // How many placements chose one of a component's variants, for the
    // dialog that confirms deleting it: the usage index lists the hosts,
    // and each host's stored forms are walked as the system.
    variantUse: variantUseRoute({
      store: componentStoreOf(opts),
      hosts: () => state.composition?.hostsOf,
      readForm: async (host, form) =>
        hostFieldReader(await requireInstalled().nextly())(host, form),
      limits: opts.limits ?? DEFAULT_LIMITS,
    }),
    // Save a selection as a component, or convert it into one. Here
    // rather than left to the collection API for the reason the pattern
    // save is: the planner needs the site's block registry.
    componentFromSelection: componentFromSelectionRoute({
      store: componentStoreOf(opts),
      limits: () => opts.limits ?? DEFAULT_LIMITS,
      // Read when a request arrives, after `init` has registered the
      // usage hooks this hands back.
      reconcile: () => usage.reconcile,
      blocks: def.blocks,
    }),
    // The editor's page edits (insert a pattern, place a component, set a
    // placement's values or variant, choose a Layout) and its component
    // definition edits, one action per request, each with a dry run.
    pageActions: pageActionsRoute({
      store: componentStoreOf(opts),
      limits: () => opts.limits ?? DEFAULT_LIMITS,
      bindings: pageActionBindings,
      blocks: def.blocks,
    }),
    definitionActions: definitionActionsRoute({
      store: componentStoreOf(opts),
      limits: () => opts.limits ?? DEFAULT_LIMITS,
      readRetired: readRetiredFor,
      blocks: def.blocks,
    }),
    // What an API client or an agent reads before composing: the
    // patterns, components (fields, slots, variants) and Layouts it may
    // read, and the actions above with their request schemas.
    manifest: manifestRoute({
      store: componentStoreOf(opts),
      limits: () => opts.limits ?? DEFAULT_LIMITS,
      namedQueries: namedQueryDeclarations,
    }),
    // Detach, duplicate and update a pattern, each with a dry run.
    componentActions: componentActionRoutes({
      store: componentStoreOf(opts),
      limits: () => opts.limits ?? DEFAULT_LIMITS,
      reconcile: () => usage.reconcile,
      origins: () => usage.origins,
      blocks: def.blocks,
    }),
    // Delete component: the dry run, each step of the delete as the
    // person who started it, and its progress. A component's own delete
    // refuses every write that does not come through here.
    componentDelete: componentDeleteRoutes({
      store: componentStoreOf(opts),
      install: () => {
        const installed = requireRewriteInstall();
        return {
          rewrite: componentDeleteRewriteService(requireRewriteInstall),
          runs: fenceStore(installed.db, installed.dialect),
        };
      },
    }),
    // A pattern, a component or a Layout as one file, with the components,
    // shared styles, variables, breakpoints and media it depends on,
    // read as the caller.
    exportFile: exportRoutes({
      store: componentStoreOf(opts),
      defaults: configStyle,
      blocks: def.blocks,
    }),
    // Such a file read against this site: a preview of what it adds,
    // reuses and clashes with, or the import itself, as the caller.
    importFile: importRoute({
      store: componentStoreOf(opts),
      defaults: configStyle,
      reconcile: () => usage.reconcile,
      blocks: def.blocks,
    }),
  };
}
