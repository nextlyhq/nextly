/**
 * The Page Builder plugin's entry: `pageBuilder()` composes the plugin from
 * the parts in `plugin-definition/` (the options, the install context, the
 * definition's shared holders, each area's `init` wiring and routes, the
 * services and jobs, and the admin contributions), and this module exports
 * the names it always has.
 */
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";

// Imported rather than read at runtime so it can never drift from the published
// package: a hardcoded literal had fallen eight releases behind, and
// `validatePluginVersions` checks a contributor's `dependsOn` range against THIS
// value. A static JSON import is inlined by the bundler, so unlike a
// `createRequire` lookup it adds no Node builtin to this entry — which is
// isomorphic and reachable from a browser bundle.
import { version as PLUGIN_VERSION } from "../package.json";

import {
  bindingsToFixAttention,
  bindingsToFixWidget,
} from "./bindings-report/widget";
import {
  registerCoreBlocks,
  registerDeclaredBlocks,
  runningBlocks,
} from "./blocks/registration-service";
import { collectionReach } from "./collection-reach";
import {
  installDefaultLayout,
  seedDefaultLayoutAtStart,
} from "./default-layout/install";
import { blocksFieldType } from "./fields/blocksField";
import { editorFormsRoutes } from "./forms/editor-forms-route";
import {
  createFormProviders,
  FORM_SERVICE,
  startFormProviders,
} from "./forms/providers";
import { FORM_SEND_LIMITS, formReceiverRoute } from "./forms/route";
import { SITE_FORMS_SERVICE_NAME, siteForms } from "./forms/site-forms";
import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";
import { registerNamedQueriesAtBoot } from "./named-queries";
import { warnNestedBlocksFields } from "./nested-blocks-fields";
import { PAGE_BUILDER_PLACEMENT } from "./overview/admin-panel";
import { adminContributions } from "./plugin-definition/admin";
import {
  bindingReportParts,
  installBindingReport,
  routesForBindings,
} from "./plugin-definition/bindings";
import {
  breakpointRemovalParts,
  installBreakpointRemoval,
  routesForBreakpoints,
} from "./plugin-definition/breakpoints";
import {
  pluginCollections,
  pluginSingles,
} from "./plugin-definition/collections";
import {
  installComponentRemoval,
  installComposition,
  registerReadinessNotice,
  retiredReader,
  routesForComponents,
} from "./plugin-definition/components";
import {
  declaredFieldGroups,
  installContext,
  sitesBlocks,
  sitesQueries,
} from "./plugin-definition/install-context";
import {
  installLayoutComponentGuard,
  installLayoutReadinessNotice,
  routesForLayouts,
} from "./plugin-definition/layouts";
import {
  componentStoreOf,
  refreshCodeTier,
  refuseStoreSharingAPluginSlug,
  type PageBuilderOptions,
} from "./plugin-definition/options";
import {
  installAddressClaims,
  routesForPages,
  startAddressClaims,
} from "./plugin-definition/pages";
import { pluginJobs, pluginServices } from "./plugin-definition/services";
import { routesForSiteCode } from "./plugin-definition/site-code";
import {
  installSiteStyleLocks,
  routesForSiteStyle,
} from "./plugin-definition/site-style";
import { routesForStartup } from "./plugin-definition/startup";
import { createDefinition } from "./plugin-definition/state";
import {
  installTemplates,
  routesForTemplates,
} from "./plugin-definition/templates";
import {
  installUsageMaintenance,
  routesForUsage,
  usageParts,
} from "./plugin-definition/usage";
import {
  pageBuilderSchema,
  pageBuilderSchemaPlugin,
} from "./schema/definition";
import { LOCK_SHARED_STYLES_DECLARATION } from "./shared-styles-routes";
import {
  BREAKPOINT_REMOVAL_UNDONE_AUDIT,
  BREAKPOINT_REMOVAL_UNDONE_METADATA,
} from "./site-breakpoint-undo";
import {
  SITE_CODE_SAVED_AUDIT,
  SITE_CODE_SAVED_METADATA,
} from "./site-code/route";
import {
  BREAKPOINT_REMOVED_AUDIT,
  BREAKPOINT_REMOVED_METADATA,
} from "./site-settings";
import { removedSiteStyleOption, siteBreakpoints } from "./site-style";
import { MANAGE_TEMPLATE_ROUTING_DECLARATION } from "./templates/template-routing";
import { countThePages } from "./usage-count-after-migrate";
import { variablesInUseCheck } from "./variables-routes";

export {
  blocksOf,
  installContext,
  namedQueriesOf,
  registeredCollectionSlugs,
  singlesDeclaringBlocks,
} from "./plugin-definition/install-context";
export type { PageBuilderOptions } from "./plugin-definition/options";

export const pageBuilder = (
  opts: PageBuilderOptions = {}
): PluginDefinition => {
  // The holders `init` fills and the values worked out from the options,
  // shared by every part below; a bad option refuses here, while the config
  // is read.
  const def = createDefinition(opts);
  // The form providers other plugins register, read by the form receiver.
  const formProviders = createFormProviders();
  // The Form block's picker and the canvas's picked form, read as the author.
  const editorForms = editorFormsRoutes(formProviders);
  // What a routed page's forms need: where they post, and its providers' forms.
  const pageForms = siteForms({
    providers: formProviders,
    componentStore: componentStoreOf(opts),
  });
  const { state, templateAddresses, configStyle, configClassIds, fonts } = def;
  const { pagesCountOf, uncoveredPagesOf, usageSourceOf, countPlacements } =
    usageParts(def);
  const readRetiredFor = retiredReader(def);
  const { bindingReportDeps, bindingsVisibleTo, bindingReportPass } =
    bindingReportParts(def);
  const { removalService, openBreakpointRemoval, breakpointRemoval } =
    breakpointRemovalParts(def);
  // Each area's routes by name, listed below in the order the plugin
  // declares them.
  const pages = routesForPages(def);
  const components = routesForComponents(def, {
    countPlacements,
    readRetiredFor,
  });
  const templates = routesForTemplates(def);
  const layouts = routesForLayouts(def);
  const bindings = routesForBindings(def, bindingReportDeps);
  const usage = routesForUsage(def);
  const breakpoints = routesForBreakpoints(def, breakpointRemoval);
  const siteCode = routesForSiteCode(def);
  const siteStyle = routesForSiteStyle(def, {
    usageSourceOf,
    uncoveredPagesOf,
  });
  // The reads the builder opens on, asked in one request.
  const startup = routesForStartup({
    loopCollections: bindings.loopCollections,
    namedQueries: bindings.namedQueries,
    patternCapability: components.patternCapability,
    siteStyle: siteStyle.siteStyle,
    pageCollection: pages.pageCollection,
  });
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
      // Its own rail item after Forms, opening the overview: see
      // `overview/admin-panel.ts`.
      ...PAGE_BUILDER_PLACEMENT,
    },
    // A deploy's `nextly migrate`, and `nextly plugins install`, count the
    // pages into the usage index, so a deployed site starts counted rather
    // than refusing every removal until someone presses Count now
    // (`usage-count-after-migrate`). The install covers a first deploy that
    // migrates before the plugin is installed, which skips `onMigrate`.
    // Bounded, and safe beside another run, as `onMigrate` must be.
    onMigrate: async ctx => {
      await countThePages(pagesCountOf(ctx));
    },
    onInstall: async ctx => {
      await countThePages(pagesCountOf(ctx));
    },
    // Registers what other plugins DECLARED, and resolves the registry service
    // on the way, which is what empties it for the boot. The service is lazy:
    // on a boot where nothing contributes, nobody else resolves it and the
    // previous boot's blocks would survive. Doing it here makes the reset
    // unconditional, and cannot wipe a contributor whose `init` ran first,
    // because the factory is memoized for the boot and clears only on its
    // first resolution.
    init: ctx => {
      // The order of every step below is load-bearing, and each area's
      // function keeps the registrations it holds in this same sequence:
      // the core blocks register before the declared ones, the named queries
      // once every block is known, the code tier after them, then the
      // guards and hooks, each after the ones it relies on. No step is moved
      // past another area's.

      // The store judged again against the site's renames, before anything
      // is wired to it.
      refuseStoreSharingAPluginSlug(
        componentStoreOf(opts),
        [],
        ctx.self.collections
      );
      state.installed = installContext(ctx, opts);
      // Read per question from `ctx.config`, the declarations as every
      // plugin's contributions and extensions leave them.
      state.writeReach = collectionReach({
        collections: () => ctx.config.collections,
        fieldGroups: declaredFieldGroups(ctx),
        addresses: templateAddresses,
        own: () => new Set(Object.values(ctx.self.collections)),
      });
      registerCoreBlocks(ctx, def.blocks);
      registerDeclaredBlocks(ctx, def.blocks);
      // Starts this boot's form providers, so the last boot's are forgotten
      // even when no plugin registers one.
      startFormProviders(ctx.services);
      pageForms.start(ctx.self);
      // The site's named queries and the ones plugins declare, into a
      // registry emptied for this boot.
      state.namedQueries = registerNamedQueriesAtBoot(ctx, opts.namedQueries);
      // Every registered block is known now, other plugins' among them, so
      // the code tier takes all their looks.
      refreshCodeTier(
        configStyle,
        configClassIds,
        opts.siteStyle,
        def.blocks.all()
      );
      // Class-usage maintenance. Registered here rather than beside the
      // collection, because it is a property of the plugin being INSTALLED: the
      // index table exists whether or not anything maintains it, and a host
      // that installs the plugin is asking for both.
      // Refuse deleting a component a Layout still names. Registered beside
      // the index maintenance because both answer "is this still in use", and
      // separately because they answer it about different things: the index is
      // a count over many pages, this is a refusal over few Layouts, and the
      // refusal has to be exact at the moment it refuses.
      installLayoutComponentGuard(ctx);

      // One template per collection, and the hooks around it.
      const templatesSlug = installTemplates(ctx, def);

      // The site's one default Layout: refuse deleting or unpublishing it, and
      // queue the repair when a write gets past that.
      state.defaultLayoutSetup = installDefaultLayout(ctx, {
        siteHeaderFooter: def.siteHeaderFooter,
        componentStore: componentStoreOf(opts),
      });

      // How a blocks value is judged, and judged again in each write's
      // transaction; with the site style reads the judgement uses.
      const { composition, siteStyle: siteStyleReads } = installComposition(
        ctx,
        def,
        templatesSlug,
        openBreakpointRemoval
      );
      // The site style's write locks, and what a variable's in-use check
      // reads.
      const variableCheckSetup = installSiteStyleLocks(
        ctx,
        def,
        siteStyleReads,
        { usageSourceOf, uncoveredPagesOf }
      );
      // The usage indexes kept current on every write.
      installUsageMaintenance(ctx, def);
      // A write of the site style dropping a variable still in use is
      // refused before its transaction, by the check the remove route makes.
      state.variablesInUse = variablesInUseCheck(variableCheckSetup);
      registerReadinessNotice(ctx, opts);
      // Who holds each address: pages and collection entries.
      installAddressClaims(ctx, def);
      installLayoutReadinessNotice(ctx);
      // A component's retired fields, its removal hold and cleanup, the
      // fence on every write, the component guards (after the Layout guard),
      // and the rewrite's install.
      const rewriteInstall = installComponentRemoval(
        ctx,
        def,
        composition,
        countPlacements
      );
      installBindingReport(ctx, def, bindingReportDeps);
      installBreakpointRemoval(
        ctx,
        def,
        composition,
        rewriteInstall,
        siteStyleReads
      );
      // A blocks field below the top level has no Page Builder to open, and the
      // operator should learn that from the log before an author meets it in
      // the form.
      warnNestedBlocksFields(ctx.config, message => ctx.logger.warn(message));
      // A `siteStyle.spacingMode` left in a host's options (a type error,
      // so only an untyped host gets here) is ignored, and said so once.
      const removed = removedSiteStyleOption(opts.siteStyle);
      if (removed !== undefined) ctx.logger.warn(removed);
    },
    // Seed the default Layout once the system is assembled, so a fresh site
    // has one before its first page is drawn. Deliberately not awaited:
    // `seedDefaultLayoutAtStart` says why, and catches every failure itself.
    onReady: async () => {
      await startAddressClaims(state);
      const setup = state.defaultLayoutSetup;
      if (setup !== null) void seedDefaultLayoutAtStart(setup);
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
      // And `forms`, the channel a plugin adds a form provider through.
      services: {
        ...pluginServices(def, { removalService, readRetiredFor }),
        [FORM_SERVICE]: () => formProviders.start(),
        [SITE_FORMS_SERVICE_NAME]: () => pageForms.service(),
      },
      // The form receiver's send limit per visitor address.
      limits: FORM_SEND_LIMITS,
      // The backfill sweep. Contributed unconditionally beside the index it
      // fills: the work is owed from the moment this plugin meets existing
      // content, and no request or hook ever becomes the moment to enqueue it.
      //
      // The deps are resolved through the holder on every pass rather than
      // captured, so a handler that somehow ran before `init` refuses with a
      // named reason instead of walking a half-built configuration.
      jobs: pluginJobs(def, { removalService, bindingReportPass }),
      collections: pluginCollections(def),
      singles: pluginSingles(def, removalService),
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
        blocksFieldType(
          siteBreakpoints(configStyle),
          () => state.composition,
          // The started site's registry: a dev server's config reload builds
          // this field type again from a definition whose init never runs.
          runningBlocks(def.blocks)
        ),
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
        components.blocksList,
        components.patternLibrary,
        components.componentLibrary,
        components.savePattern,
        components.patternCapability,
        pages.publishReadiness,
        pages.publishDependencies,
        components.componentFacts,
        ...components.removalHolds,
        components.variantUse,
        components.componentFromSelection,
        components.pageActions,
        components.definitionActions,
        templates.templateActions,
        templates.templatePreviewEntries,
        templates.templatePreviewEntry,
        templates.conditionsPreviewEntry,
        templates.templateRouting,
        templates.templateCollectionRetarget,
        templates.templateCollectionChoices,
        templates.entryDesigns,
        templates.templatesPanel,
        components.manifest,
        ...components.componentActions,
        pages.entries,
        pages.pagesSearch,
        bindings.loopCollections,
        bindings.namedQueries,
        bindings.listEntries,
        bindings.canvasBindings,
        bindings.canvasSourcesChanged,
        bindings.bindingFields,
        bindings.unbindPlan,
        usage.overview,
        bindings.bindingsToFix,
        bindings.shownOn,
        pages.pageAddress,
        pages.addressWaiting,
        ...pages.pagesWrite,
        layouts.makeDefault,
        layouts.removeLayout,
        ...components.componentDelete,
        layouts.layoutChoices,
        layouts.layoutCounts,
        ...layouts.layoutWrites,
        pages.pageCollection,
        breakpoints.siteSettings,
        breakpoints.siteBreakpoints,
        breakpoints.siteBreakpointRemoval,
        breakpoints.siteBreakpointUndo,
        breakpoints.siteBreakpointRemovalStatus,
        ...siteCode.siteCode,
        ...components.exportFile,
        components.importFile,
        siteStyle.siteStyle,
        ...siteStyle.fonts,
        ...siteStyle.sharedStyles,
        ...siteStyle.variables,
        startup.builderStartup,
        editorForms.list,
        editorForms.describe,
        // The one public route every form on the site posts to.
        formReceiverRoute({
          providers: formProviders,
          componentStore: componentStoreOf(opts),
          ...(opts.limits === undefined ? {} : { limits: opts.limits }),
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
            "Change the site's breakpoints, and choose its default header & footer set.",
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
      admin: adminContributions(def),
    },
  });
  // The route a site renders its pages with reads this page builder's own
  // queries through `namedQueriesOf`: bound to this definition, never to a
  // registry another site's boot can replace.
  sitesQueries.set(plugin, {
    definitionOf: name => state.namedQueries.definitionOf(name),
  });
  // And its blocks through `blocksOf`, for a process serving several sites.
  sitesBlocks.set(plugin, def.blocks);
  // A host's component store must not share a slug with the plugin's own
  // collections: refused while the config is read, before anything is keyed
  // by it. A rename is judged again in `init`, once it is known.
  refuseStoreSharingAPluginSlug(
    componentStoreOf(opts),
    (plugin.contributes?.collections ?? []).map(collection => collection.slug)
  );
  return plugin;
};
