/**
 * Breakpoints: removing breakpoints from the site (the service, the count, the
 * cascade a save carries out, and what `init` wires for it), and the routes
 * for Settings' Site tab, setting the breakpoints, carrying a removal on,
 * undoing one, and where one stands.
 */
import { DEFAULT_LIMITS, type NamedClass } from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRoute } from "@nextlyhq/plugin-sdk";

import { registerRemovalWriteReport } from "../breakpoint-removal/after-commit";
import { removalRunStore } from "../breakpoint-removal/run-store";
import {
  breakpointRemovalService,
  type BreakpointRemovalService,
} from "../breakpoint-removal/service";
import {
  countRemovalOnSite,
  nameDocumentsOnSite,
} from "../breakpoint-removal/site-counter";
import type { CompositionSetup } from "../fields/blocks-composition";
import type { HostAddress } from "../host-rewrite/contract";
import type { RewriteInstall } from "../host-rewrite/service";
import { siteBreakpointUndoRoute } from "../site-breakpoint-undo";
import {
  siteBreakpointRemovalRoute,
  siteBreakpointRemovalStatusRoute,
  siteBreakpointsRoute,
  siteSettingsRoute,
  type BreakpointCascade,
  type BreakpointRemoval,
  type BreakpointsRouteContext,
  type SiteSettingsRouteContext,
} from "../site-settings";
import { siteBreakpoints } from "../site-style";
import {
  readStoredSiteStyleVersioned,
  SITE_STYLE_SLUG,
} from "../site-style-storage";
import type { InitContext, siteStyleReads } from "./install-context";
import type { Definition } from "./state";

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

/** How the routes, the services and the write path reach a removal. */
export interface BreakpointRemovalParts {
  readonly removalService: () => BreakpointRemovalService;
  readonly openBreakpointRemoval: NonNullable<
    CompositionSetup["openBreakpointRemoval"]
  >;
  readonly breakpointRemoval: BreakpointRemoval & {
    readonly cascade: BreakpointCascade;
  };
}

/** Removing breakpoints, over the definition's installed context. */
export function breakpointRemovalParts(
  def: Definition
): BreakpointRemovalParts {
  const { opts, state, configStyle } = def;
  const removalService = (): BreakpointRemovalService =>
    breakpointRemovalService(() => {
      if (state.removalInstall === null) {
        throw new Error(
          "[page-builder] a breakpoint removal ran before the plugin was installed"
        );
      }
      return state.removalInstall;
    });
  // The open removal as the write path's locks read it: before `init`, the
  // read throws, and a lock then accepts nothing extra.
  const openBreakpointRemoval = () => removalService().openRemoval();
  // The site as a removal's count and an undo's report read it.
  const removalSite = () => ({
    site: () => state.rewriteInstall?.site ?? null,
    naming: async () => {
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      return getCachedNextly();
    },
    componentCollection: state.rewriteInstall?.store.collection,
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
        state.removalLogger?.error(message, meta),
    },
  };
  return { removalService, openBreakpointRemoval, breakpointRemoval };
}

/**
 * What removing breakpoints reads once the plugin is installed, and the
 * report that strips a write holding a removed breakpoint's values again.
 */
export function installBreakpointRemoval(
  ctx: InitContext,
  def: Definition,
  composition: CompositionSetup,
  rewriteInstall: RewriteInstall,
  siteStyle: ReturnType<typeof siteStyleReads>
): void {
  const { state, configStyle } = def;
  const siteStyleNow = siteStyle.styleNow;
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
  state.removalInstall = {
    db: ctx.db,
    dialect: ctx.dialect,
    site: rewriteInstall.site,
    defaults: configStyle,
    definedBreakpoints,
    breakpointsNow: async () => siteBreakpoints(await siteStyleNow()) ?? null,
  };
  state.removalLogger = ctx.logger;
  // A write holding a removed breakpoint's values, committed after the
  // removal's walk stripped that document, sends it back to be stripped
  // again from what was saved, the removal done or not.
  registerRemovalWriteReport({
    ctx,
    runs: () => removalRunStore(ctx.db, ctx.dialect),
    definedBreakpoints,
    mayHoldBlocks: collection => state.writeReach.mayHoldBlocks(collection),
  });
}

/** The routes breakpoints contribute, by name. */
export function routesForBreakpoints(
  def: Definition,
  breakpointRemoval: BreakpointRemovalParts["breakpointRemoval"]
): {
  readonly siteSettings: PluginRoute;
  readonly siteBreakpoints: PluginRoute;
  readonly siteBreakpointRemoval: PluginRoute;
  readonly siteBreakpointUndo: PluginRoute;
  readonly siteBreakpointRemovalStatus: PluginRoute;
} {
  const { configStyle } = def;
  return {
    // Settings' Site tab: what the caller may change there, and the one
    // way the site's breakpoints change.
    // With the removals still holding what they removed, so the tab can
    // follow one that is still going.
    siteSettings: siteSettingsRoute(configStyle, breakpointRemoval),
    // A set that removes breakpoints strips what they held from the site;
    // one that does not finish in its save is carried on by the second.
    siteBreakpoints: siteBreakpointsRoute(breakpointRemoval),
    siteBreakpointRemoval: siteBreakpointRemovalRoute(breakpointRemoval),
    // The newest removal undone, within its 30 days; its walk is carried
    // on through the removal route.
    siteBreakpointUndo: siteBreakpointUndoRoute(breakpointRemoval),
    // Where one removal stands, read by its id.
    siteBreakpointRemovalStatus:
      siteBreakpointRemovalStatusRoute(breakpointRemoval),
  };
}
