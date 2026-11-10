/**
 * Settings' calls to remove breakpoints: the dry run that counts what a set
 * drops, the confirmed save of it, the call that carries a removal on, and
 * the read of where a removal stands.
 *
 * Outside the site style's write (`useSaveSiteStyle`) on purpose: a confirmed
 * removal is not a step of the editor's undo history. Undoing it there would
 * only define the breakpoint again, empty; it is undone from Settings, which
 * puts its styles back too (`undoBreakpointRemoval`).
 *
 * @module admin/breakpoint-removal-client
 * @experimental
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { readPluginRoute, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_BREAKPOINT_REMOVAL_ROUTE_PATH,
  SITE_BREAKPOINT_UNDO_ROUTE_PATH,
  SITE_BREAKPOINTS_ROUTE_PATH,
  siteBreakpointRemovalStatusPath,
  type SiteBreakpointRemoval,
  type SiteBreakpointRemovalRead,
  type SiteBreakpointRemovalRequest,
  type SiteBreakpointRemovalStatus,
  type SiteBreakpointRemovalsRead,
  type SiteBreakpointsDryRun,
  type SiteBreakpointsRequest,
  type SiteBreakpointsSaved,
} from "../library-contract";

/** A mutation route's answer: its message and the item it carries. */
interface Envelope<T> {
  readonly message: string;
  readonly item: T;
}

/** The item of an answer, or a refusal when the route answered none. */
function itemOf<T>(answer: Envelope<T> | undefined): T {
  if (answer === undefined) {
    throw new Error("The site did not answer. Try again.");
  }
  return answer.item;
}

/** Count what saving `breakpoints` would drop, saving nothing. */
export async function askBreakpointRemoval(
  breakpoints: BreakpointSet
): Promise<SiteBreakpointsDryRun> {
  return itemOf(
    await writePluginRoute<Envelope<SiteBreakpointsDryRun>>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_BREAKPOINTS_ROUTE_PATH,
      body: {
        breakpoints,
        dryRun: true,
      } satisfies SiteBreakpointsRequest,
    })
  );
}

/**
 * Save `breakpoints`, stripping what the breakpoints it removes held, as the
 * person confirmed after the dry run answered with `version`.
 */
export async function confirmBreakpointRemoval(
  breakpoints: BreakpointSet,
  version: string | undefined
): Promise<SiteBreakpointsSaved> {
  return itemOf(
    await writePluginRoute<Envelope<SiteBreakpointsSaved>>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_BREAKPOINTS_ROUTE_PATH,
      body: {
        breakpoints,
        confirmRemoval: true,
        ...(version === undefined ? {} : { version }),
      } satisfies SiteBreakpointsRequest,
    })
  );
}

/** Carry a removal on from where it stopped, for as long as one call walks. */
export async function carryOnBreakpointRemoval(
  runId: string
): Promise<SiteBreakpointRemoval> {
  return itemOf(
    await writePluginRoute<Envelope<SiteBreakpointRemoval>>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_BREAKPOINT_REMOVAL_ROUTE_PATH,
      body: { runId } satisfies SiteBreakpointRemovalRequest,
    })
  );
}

/**
 * Where removal `runId` stands, read by its id: `null` once it holds nothing
 * (done, leaving no document). A read that answers nothing is refused, so
 * nothing known is never taken for done.
 */
export async function readBreakpointRemoval(
  runId: string
): Promise<SiteBreakpointRemovalStatus | null> {
  const read = await readPluginRoute<SiteBreakpointRemovalRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: siteBreakpointRemovalStatusPath(runId),
  });
  if (read === undefined) {
    throw new Error("The site did not say where the removal stands.");
  }
  return read.removal;
}

/**
 * Undo removal `runId`: its breakpoints defined again and their styles put
 * back, as far as one call walks; the rest is carried on through the removal
 * route.
 */
export async function undoBreakpointRemoval(
  runId: string
): Promise<SiteBreakpointsSaved> {
  return itemOf(
    await writePluginRoute<Envelope<SiteBreakpointsSaved>>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_BREAKPOINT_UNDO_ROUTE_PATH,
      body: { runId } satisfies SiteBreakpointRemovalRequest,
    })
  );
}

/**
 * The removals, and the one that can be undone, read alone: an open Settings
 * asks this to learn of a removal or an undo another tab started, without
 * reading the rest of Settings. `undefined` where it answered nothing.
 */
export async function readRemovals(): Promise<
  SiteBreakpointRemovalsRead | undefined
> {
  return readPluginRoute<SiteBreakpointRemovalsRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_BREAKPOINT_REMOVAL_ROUTE_PATH,
  });
}
