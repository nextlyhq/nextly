/**
 * The site's own breakpoints, offered as preview viewports.
 *
 * ## Why this lives in the plugin
 *
 * A site's breakpoints are page-builder data: they are stored in this plugin's
 * `site-style` single, they are author-named, and there are up to seven of them
 * per axis. Core does not know that slug and the admin package depends on
 * neither this plugin nor `blocks-engine`, so neither can read them — and
 * neither should, because a site that does not use the page builder has none
 * and would be offered widths its stylesheet never breaks at.
 *
 * So the plugin supplies them through the surface core already reads. This is
 * the same shape as `previewUrlFromTemplate`: an application composes it into
 * its own collection config, and core evaluates it without knowing where the
 * answer came from.
 *
 * ## Why a function rather than a list
 *
 * Breakpoints are edited in the page builder, so a list captured when the
 * config was defined goes stale the moment an author changes one — and a stale
 * preset sizes the frame to a width the site no longer uses, which is the exact
 * failure preset widths exist to avoid. The function is evaluated per mint, on
 * the server, where the current value is readable.
 *
 * @module preview-viewports
 */
import type { BreakpointContext, BreakpointSet } from "@nextlyhq/blocks-engine";
import { breakpointContexts } from "@nextlyhq/blocks-engine";
import type { PreviewViewport } from "nextly/config";

import type { SiteStyleData } from "./site-style";
import { loadSiteStyle, type SiteStyleReader } from "./site-style-storage";

/**
 * Map a site's viewport breakpoints onto preview viewports.
 *
 * Read through `breakpointContexts` rather than off the stored array, because
 * that reader is what decides which definitions the STYLE COMPILER accepts — it
 * drops a definition whose bound it cannot use and claims each id once. Reading
 * the raw array instead would let the preview offer a width the compiled sheet
 * has no rule for, so the frame would sit at a tier the site never renders.
 */
export function siteStyleViewports(
  breakpoints: BreakpointSet | undefined
): PreviewViewport[] {
  if (breakpoints === undefined) return [];

  /*
   * The label comes from the stored definition and the width from the reader,
   * joined by id. `BreakpointContext` carries no label — it is the compiler's
   * view — so this is the one place the two have to be brought together, and
   * the id is what makes that a lookup rather than a guess about order.
   */
  const labels = new Map(breakpoints.viewport.map(def => [def.id, def.label]));

  return breakpointContexts(breakpoints)
    .map(context => offerableViewport(context, labels))
    .filter((viewport): viewport is PreviewViewport => viewport !== null);
}

/**
 * One context as an offerable viewport, or `null` where it cannot be one.
 *
 * Separated from the walk above so each reason to decline is a single named
 * condition rather than another branch in a loop that also builds a list.
 */
function offerableViewport(
  context: BreakpointContext,
  labels: ReadonlyMap<string, string>
): PreviewViewport | null {
  if (context.axis !== "viewport") return null;

  // The BASE tier has no upper bound by construction — it is "everything
  // wider" — so there is no width to offer for it, and the pane's own
  // Responsive option is what covers that case honestly.
  if (typeof context.maxWidth !== "number") return null;

  // An id with no stored label cannot be named to an author, and a control
  // showing a raw id is worse than one option fewer.
  const label = labels.get(context.id);
  if (label === undefined || label.trim() === "") return null;

  return { label, width: context.maxWidth };
}

/**
 * A `breakpoints` declaration that reads this site's own tiers at mint time.
 *
 * Compose it into a collection's preview config:
 *
 * ```typescript
 * admin: {
 *   preview: {
 *     url: previewUrlFromTemplate("/blocks/{slug}"),
 *     breakpoints: previewViewportsFromSiteStyle({
 *       // Dynamic, because a static import of the reader would cycle back
 *       // through the config this collection is declared in.
 *       reader: async () => (await import("../lib/site-content")).siteReader,
 *     }),
 *   },
 * }
 * ```
 */
export function previewViewportsFromSiteStyle(args: {
  /**
   * How to obtain a reader, rather than a reader.
   *
   * A PROVIDER because this is composed into a collection's config, and a
   * reader does not exist at that moment — the one an application builds is
   * assembled from the config itself, so importing it here is a cycle rather
   * than an inconvenience. Measured in the playground: its `siteReader` module
   * imports `nextly.config`, which imports the collection this would be
   * declared on.
   *
   * Deferring it also matches when the answer is needed. This runs per mint, on
   * the server, long after any reader exists.
   */
  reader: () => SiteStyleReader | Promise<SiteStyleReader>;
  defaults?: SiteStyleData;
}): () => Promise<PreviewViewport[]> {
  return async () => {
    const nextly = await args.reader();
    const style = await loadSiteStyle({
      nextly,
      ...(args.defaults === undefined ? {} : { defaults: args.defaults }),
    });
    return siteStyleViewports(style.breakpoints);
  };
}
