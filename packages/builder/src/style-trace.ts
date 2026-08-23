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
  BreakpointSet,
  StyleTraceEntry,
} from "@nextlyhq/blocks-engine";
import {
  registeredBlocks,
  resolvePageStylesWithTrace,
} from "@nextlyhq/blocks-react";

/**
 * The declarations the compiler wrote for this document, in cascade order.
 *
 * `undefined` when no compile produced one, which is a real answer rather than a
 * failure — and callers must not read it as "nothing is authored". A control
 * told that would report every value as coming from nowhere, which is worse than
 * showing no indicator at all.
 *
 * The blocks come from `registeredBlocks()`, which is the SAME default
 * `PageRenderer` uses when a host names no resolver, so the two are looking at
 * one registry rather than at two assembled alike.
 */
export function pageStyleTrace(
  document: BlockDocument,
  breakpoints: BreakpointSet
): readonly StyleTraceEntry[] | undefined {
  return resolvePageStylesWithTrace(
    document,
    // No stored artifact. One would be REUSED rather than recompiled, and a
    // reused sheet has no cascade to report — the editor would get `undefined`
    // for a document it can perfectly well compile.
    undefined,
    { breakpoints },
    registeredBlocks(),
    false,
    { trace: true }
  ).trace;
}
