/**
 * Settings' calls to remove breakpoints: the dry run that counts what a set
 * drops, the confirmed save of it, the call that carries a removal on, and
 * the read of where a removal stands.
 *
 * Outside the site style's write (`useSaveSiteStyle`) on purpose: a confirmed
 * removal is not a step of the editor's undo history. Undoing it would only
 * define the breakpoint again, empty, which is not what an author pressing
 * undo expects, and the removal says it cannot be undone.
 *
 * @module admin/breakpoint-removal-client
 * @experimental
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { readPluginRoute, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_BREAKPOINT_REMOVAL_ROUTE_PATH,
  SITE_BREAKPOINTS_ROUTE_PATH,
  SITE_SETTINGS_ROUTE_PATH,
  siteBreakpointRemovalStatusPath,
  type SiteBreakpointRemoval,
  type SiteBreakpointRemovalRead,
  type SiteBreakpointRemovalRequest,
  type SiteBreakpointRemovalStatus,
  type SiteBreakpointsDryRun,
  type SiteBreakpointsRequest,
  type SiteBreakpointsSaved,
  type SiteSettingsRead,
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
 * The removals the Site tab's read reports now, read alone: an open Settings
 * asks this to learn of a removal another tab started. `undefined` where the
 * read reports none, or answered nothing.
 */
export async function readSiteRemovals(): Promise<
  readonly SiteBreakpointRemovalStatus[] | undefined
> {
  const read = await readPluginRoute<SiteSettingsRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_SETTINGS_ROUTE_PATH,
  });
  return read?.removals;
}
