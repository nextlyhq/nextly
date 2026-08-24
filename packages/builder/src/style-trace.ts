/**
 * The cascade behind the page, for chrome that has to say where a value came from.
 *
 * A control showing "you set this here" or "this comes from `.card`" or "this
 * comes from your desktop setting" is answering a question only the compiler can
 * answer: it has already settled tier order, both breakpoint axes, states
 * joining the base rules, refused values, descendant selectors and specificity.
 * `styleProvenance` reads that answer. This is what fetches it.
 *
 * ## Why the compiler runs a SECOND time here
 *
 * The page the canvas paints is compiled inside `PageRenderer`, and the panel
 * sits outside it. Three shapes were available and this is the one that was
 * ruled on:
 *
 * - Hoisting the compile above the canvas and handing it the finished sheet
 *   compiles once, but the canvas only REUSES a ready-made sheet while its
 *   stamps match. Should they ever drift it recompiles silently, and the
 *   restructure is paid for with nothing left to show and no test that notices.
 * - Having `PageRenderer` report what it compiled is correct by construction,
 *   and puts an editor-only output into the component that renders published
 *   pages — arriving a frame late, so a control would show the previous block's
 *   answer after every click.
 * - Asking again costs a second compile and leaves the render path untouched.
 *   Measured, a hundred-block page compiles in about 1.6ms, so the whole editor
 *   pays roughly three milliseconds per committed edit instead of one and a
 *   half.
 *
 * The deciding argument is the blast radius rather than the cost. Nothing here
 * can change what the canvas paints or what a published page serves; if this is
 * wrong, the thing that is wrong is the indicator, which is the thing under
 * test.
 *
 * **This is not a second implementation.** It calls the same exported function
 * the renderer calls, with the same inputs. The rule that forbids computing one
 * answer twice is about two implementations of a question, not two invocations
 * of one — and the resolver is exported precisely so a consumer can ask.
 *
 * ## The document is NOT pruned first, deliberately
 *
 * `resolvePageStyles` documents a precondition: hand it the document that will
 * RENDER, because a raw one emits rules for nodes a reader withholds and
 * publishes the colours, fonts and `url(...)` of a block nobody was served.
 *
 * That precondition guards PUBLISHING, and nothing here publishes. The sheet is
 * discarded on the next line; only the trace is kept, and it is read in the
 * editor by the panel describing the block an author has selected.
 *
 * Pruning would also make the answer worse where it differs. A node hidden at
 * the breakpoint being edited is still selectable from the Layers panel, and it
 * still has authored values an author is entitled to an explanation of.
 * Compiled from the pruned tree it would have no entries at all, and every one
 * of its controls would report having been set by nobody.
 *
 * @module style-trace
 */

import type {
  BlockDocument,
  DocumentLimits,
  RemotePatternInput,
  SiteSheetInput,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { BlockResolver, PageStyleCascade } from "@nextlyhq/blocks-react";
import { pageStyleTrace as compileTrace } from "@nextlyhq/blocks-react";

/**
 * The declarations the compiler wrote for this document, in cascade order.
 *
 * `undefined` when no compile produced one, which is a real answer rather than a
 * failure — and callers must not read it as "nothing is authored". A control
 * told that would report every value as coming from nowhere, which is worse than
 * showing no indicator at all.
 *
 * The compile itself lives in `@nextlyhq/blocks-react`, and that is not
 * indirection for its own sake. Named classes, block bases, the token prefix and
 * the fetch predicate are each reconciled from TWO tiers — the route's context
 * and the site's — by a function private to that package. A context assembled
 * here instead compiles a cascade the page never had, and the shortfall is
 * silent: measured, with only `breakpoints` passed no class declaration reaches
 * the trace at all, so every value arriving from a named class reports as set by
 * nobody and the "Inherited from `.card`" indicator can never appear.
 */
export function pageStyleTrace(
  document: BlockDocument,
  styleContext: StyleCompileContext | undefined,
  site: SiteSheetInput | undefined,
  options?: {
    readonly remotePatterns?: readonly RemotePatternInput[];
    /**
     * The resolver the CANVAS is rendering with, when the host named one.
     *
     * Forwarded rather than left to the default, because a custom resolver
     * decides two things the trace depends on: a block's base styles, and
     * whether a node draws at all. A canvas rendered with one and a trace
     * compiled without it disagree about which declarations exist, so an origin
     * goes missing or is attributed to the wrong tier.
     *
     * Omitted, the compile falls back to the registry `PageRenderer` uses when a
     * host names none — the same default, not a second one.
     */
    readonly blocks?: BlockResolver;
    /**
     * The caps the canvas prepares and compiles under.
     *
     * The fourth input of this kind, after the site tier, the fetch policy and
     * the resolver — every one of them a field the renderer reads and this
     * wrapper silently defaulted. They fail the same way: the trace describes a
     * compile the page never ran, and says so confidently.
     */
    readonly limits?: DocumentLimits;
  }
): PageStyleCascade | undefined {
  return compileTrace({
    document,
    styleContext,
    site,
    ...(options?.remotePatterns === undefined
      ? {}
      : { remotePatterns: options.remotePatterns }),
    ...(options?.blocks === undefined ? {} : { blocks: options.blocks }),
    ...(options?.limits === undefined ? {} : { limits: options.limits }),
  });
}
