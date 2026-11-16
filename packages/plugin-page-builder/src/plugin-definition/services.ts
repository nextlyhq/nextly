/**
 * The services and the jobs the plugin contributes: the block registry, the
 * usage health, the component-delete rewrite, breakpoint removal, the cleanup
 * of retired values, the composition API, the content addresses and a page's
 * design metadata, and the sweeps that fill, repair and clean up behind them.
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { SITE_BLOCKS_SERVICE } from "@nextlyhq/blocks-react";
import type { PluginContributions } from "@nextlyhq/plugin-sdk";

import { CONTENT_ADDRESS_SERVICE } from "../address-claims/content-addresses";
import { bindingsReportJob } from "../bindings-report/job";
import {
  BLOCK_SERVICE,
  createBlockRegistrationService,
  registryReader,
} from "../blocks/registration-service";
import { breakpointRemovalJob } from "../breakpoint-removal/job";
import { BREAKPOINT_REMOVAL_SERVICE } from "../breakpoint-removal/service";
import { PAGES_CONTENT_FIELD, PAGES_SLUG } from "../collections/pages";
import { TEMPLATES_SLUG } from "../collections/templates";
import { componentDeleteJob } from "../component-delete/sweep";
import {
  COMPOSITION_SERVICE,
  compositionService,
} from "../composition-service";
import { defaultLayoutJob } from "../default-layout/ensure-default";
import { DESIGN_SEO_SERVICE, designSeoService } from "../design-seo";
import {
  COMPONENT_DELETE_REWRITE_SERVICE,
  componentDeleteRewriteService,
} from "../host-rewrite/service";
import type { PageBuilderContentDirectApi } from "../page-content";
import { RETIRED_CLEANUP_SERVICE } from "../retired-cleanup";
import { retiredCleanupJob } from "../retired-cleanup-job";
import { usageBackfillJob } from "../usage-backfill-job";
import {
  backfillScopes,
  forgetGoneScopes,
  usageBackfillDeps,
} from "../usage-backfill-wiring";
import {
  USAGE_HEALTH_SERVICE,
  usageHealthService,
} from "../usage-health-service";

import type { BindingReportParts } from "./bindings";
import type { BreakpointRemovalParts } from "./breakpoints";
import type { retiredReader } from "./components";
import { SITE_NAMED_QUERIES_SERVICE } from "./install-context";
import { componentStoreOf } from "./options";
import type { Definition } from "./state";

/** The services other code reaches through `ctx.services.plugins`. */
export function pluginServices(
  def: Definition,
  parts: {
    readonly removalService: BreakpointRemovalParts["removalService"];
    readonly readRetiredFor: ReturnType<typeof retiredReader>;
  }
): NonNullable<PluginContributions["services"]> {
  const {
    opts,
    requireInstalled,
    requireRewriteInstall,
    requireRetiredCleanup,
    templateActions,
    namedQueryDeclarations,
    pageActionBindings,
    requireContentAddresses,
  } = def;
  const { removalService, readRetiredFor } = parts;
  return {
    [BLOCK_SERVICE]: () => createBlockRegistrationService(def.blocks),
    // The site's blocks, read-only, for a route given no `blocks` of its own
    // (`@nextlyhq/blocks-react/next` reads this name).
    [SITE_BLOCKS_SERVICE.service]: () => registryReader(def.blocks),
    // And its named queries, for a route whose copy of the page builder
    // never started (`namedQueriesOf`).
    [SITE_NAMED_QUERIES_SERVICE]: () => ({
      definitionOf: (name: string) =>
        def.state.namedQueries.definitionOf(name),
    }),
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
        bindings: pageActionBindings,
        blocks: def.blocks,
      }),
    // Who holds a path, for the site's one content route: a page, or a
    // collection's entry under its template address. Read as committed,
    // through the store every save's collision check writes.
    [CONTENT_ADDRESS_SERVICE]: () => requireContentAddresses(),
    // What the design drawing a page says about it (its title,
    // description and share image), for a plugin that asks about a page
    // outside a request: worked out by the route's own derivation, over
    // the design the route would draw, so it answers what the published
    // page is answered with.
    [DESIGN_SEO_SERVICE]: ctx =>
      designSeoService({
        nextly: async () => {
          const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
          return (await getCachedNextly()) as unknown as PageBuilderContentDirectApi;
        },
        pages: {
          collection: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
          field: PAGES_CONTENT_FIELD,
        },
        templatesCollection:
          ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG,
        // Loaded when first asked: the renderer's Next-coupled entry is
        // needed only once a page is asked about.
        derive: async args => {
          const { designMetadataFor } = await import(
            "@nextlyhq/blocks-react/next"
          );
          return designMetadataFor({
            ...args,
            config: {
              // The booted Direct API the provider read through, which
              // the route's reads take as their reader.
              nextly: args.config.nextly as NonNullable<
                Parameters<typeof designMetadataFor>[0]["config"]["nextly"]
              >,
              // This page builder's own blocks.
              blocks: def.blocks,
            },
          });
        },
      }),
  };
}

/** The jobs the runner keeps for the plugin. */
export function pluginJobs(
  def: Definition,
  parts: {
    readonly removalService: BreakpointRemovalParts["removalService"];
    readonly bindingReportPass: BindingReportParts["bindingReportPass"];
  }
): NonNullable<PluginContributions["jobs"]> {
  const {
    requireInstalled,
    defaultLayoutDeps,
    requireRetiredCleanup,
    componentDeleteSweepDeps,
  } = def;
  const { removalService, bindingReportPass } = parts;
  return [
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
  ];
}
