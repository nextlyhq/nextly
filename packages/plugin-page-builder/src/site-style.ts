/**
 * The site's style inputs, in one place.
 *
 * Breakpoints are site-level data this plugin owns: the engine never reads
 * storage, so it validates against whatever set it is handed, and a document
 * naming a breakpoint id warns rather than errors until the real set arrives.
 * That arrangement is what keeps the engine storage-agnostic, and it puts the
 * answer here.
 *
 * It lives in its own module because TWO surfaces need it and they must not
 * disagree. The field validator compiles a document against these breakpoints;
 * the editor canvas compiles the site sheet against them to draw the same
 * document. Two empty sets written separately look identical on the day they
 * are written, and the day one of them gains a real breakpoint is the day the
 * canvas draws a layout the validator does not accept — with each side
 * internally consistent, so nothing looks wrong.
 *
 * Node-safe: no React, no admin imports. The validator runs server-side.
 *
 * @module @nextlyhq/plugin-page-builder/site-style
 */
import type { BreakpointSet, SiteSheetInput } from "@nextlyhq/blocks-engine";

/**
 * The site's breakpoints.
 *
 * Empty because this plugin has nowhere to store them yet. Stated as a value
 * rather than left implicit so the storage, when it lands, has exactly one
 * function to replace — and both consumers move together by construction.
 */
export function siteBreakpoints(): BreakpointSet {
  return { viewport: [], container: [] };
}

/**
 * What the editor canvas compiles its stylesheet from.
 *
 * Only `breakpoints` is populated today. `tokens`, `fonts`, `classes` and
 * `blockBases` are a site's own design inputs, supplied by the host route's
 * config on a published page, and this plugin does not store them — so they are
 * OMITTED rather than defaulted. An invented token set would render a canvas
 * that looks finished and matches no published page, which is worse than one
 * that plainly shows block defaults: a wrong preview is trusted, an unstyled
 * one is questioned.
 *
 * The gap is real and worth naming: until a site's tokens reach the admin, the
 * canvas is a structural preview rather than a visual proof.
 */
export function siteSheet(): SiteSheetInput {
  return { breakpoints: siteBreakpoints() };
}
