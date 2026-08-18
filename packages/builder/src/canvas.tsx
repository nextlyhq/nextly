"use client";

/**
 * The editing canvas — the authored page, drawn by the same renderer that draws
 * the published one.
 *
 * It delegates every pixel to `PageRenderer` and adds only the things editing
 * needs on top: which node is selected, which is under the pointer, and the
 * outlines that say so. Nothing here knows how a heading or a gallery draws
 * itself, and that is the property worth protecting — a canvas with its own
 * rendering path is a second implementation of "what does this page look like",
 * and the two drift in the direction nobody tests, so the preview stops matching
 * the page while both look correct in isolation.
 *
 * That mattered concretely: the editor this replaces DID have its own compiler
 * and its own block set, and the two disagreed about the token namespace, about
 * where a page's nodes live, and about what a binding is. A faithful preview was
 * unreachable from there by construction, not by neglect.
 *
 * **`siteStyles` is a required prop, deliberately.** `PageRenderer` takes it as
 * optional because a standalone consumer may legitimately emit no site sheet,
 * but for the canvas an omitted sheet is never correct: the design tokens, the
 * block-type defaults and the named classes all live in it, so a canvas without
 * it shows a page whose grid, clipping and colours are missing exactly where the
 * published page has them. Making it optional here would let a faithful-looking
 * preview be wrong in a way no assertion catches, so the type demands it and the
 * host has to supply what the route supplies.
 *
 * @module canvas
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE, PageRenderer } from "@nextlyhq/blocks-react";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import { cn } from "@nextlyhq/ui/utils";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { CanvasDragHandlers } from "./canvas-drag";

/**
 * The class marking the canvas root, and the boundary the hit-test stops at.
 *
 * The walk needs an upper bound for the reason given in
 * {@link nodeIdFromEvent}, and that bound has to be identifiable from a DOM
 * node rather than from React state, because the walk starts at an event
 * target and climbs.
 */
export const CANVAS_ROOT_CLASS = "nx-canvas";

/**
 * Marks the selected block's own element.
 *
 * Boolean by presence rather than carrying the id: the element already states
 * its id through `NODE_ID_ATTRIBUTE`, and repeating it here would be a second
 * copy that a partial re-mark could leave disagreeing with the first.
 *
 * Exported because a host styling the canvas, and a test asserting what is
 * selected, both need to name it — and a string typed twice is a contract with
 * no compiler behind it.
 */
export const SELECTED_ATTRIBUTE = "data-nx-selected";

/**
 * Marks editor chrome drawn over the page, which is not part of the page.
 *
 * A click on the canvas background CLEARS the selection, and the overlay sits
 * inside the canvas root — so without this a press on any control drawn over
 * the page resolves to "no node" and deselects the very block that control
 * acts on. The floating toolbar would run its action and then watch itself
 * disappear.
 *
 * An attribute rather than each overlay calling `stopPropagation`: the rule
 * belongs to what chrome IS, and the version where every new overlay has to
 * remember it is the version where the next one does not. The drop indicator
 * needs no marker only because it takes no pointer events at all.
 */
export const CHROME_ATTRIBUTE = "data-nx-chrome";

/** Whether an event started inside editor chrome rather than inside the page. */
function isChrome(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(`[${CHROME_ATTRIBUTE}]`) !== null
  );
}

/**
 * How a pointer event on the canvas resolves to a node id, or to nothing.
 *
 * `closest` rather than reading the target directly: a click lands on whatever
 * leaf is under the pointer — a `<span>` inside a heading, an `<img>` inside a
 * card — and the node that owns it is an ancestor. Reading the target alone
 * selects nothing for every block that renders more than one element, which is
 * most of them.
 *
 * The attribute name comes from `@nextlyhq/blocks-react` rather than being
 * spelled here. The renderer writes it and this reads it, so two spellings
 * would be two declarations of one name, and the day it moves the hit-testing
 * would resolve nothing while every test that hard-coded it still passed.
 *
 * **Bounded at the canvas root, which is not a detail.** The renderer applies
 * the attribute by cloning the block's root element and returns the output
 * untouched when it is not a single host element — so a block rendering a
 * fragment or a component carries none. An unbounded `closest` then walks past
 * it to the nearest ANCESTOR that has one, and returns that node's id: a
 * confidently WRONG selection rather than a missing one.
 *
 * The two failures are not equally bad. A miss is visible immediately — the
 * author clicks and nothing happens. A wrong hit selects a container while the
 * author believes they selected the child inside it, and every edit afterwards
 * lands on the wrong node with nothing to indicate it.
 */
export function nodeIdFromEvent(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const owner = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
  if (owner === null) return null;
  // Inside THIS canvas, not merely inside something carrying the attribute. A
  // canvas rendered within another rendered page would otherwise resolve a
  // click to the outer page's node.
  if (owner.closest(`.${CANVAS_ROOT_CLASS}`) === null) return null;
  return owner.getAttribute(NODE_ID_ATTRIBUTE);
}

export interface CanvasProps {
  /** The document being edited. */
  document: BlockDocument;
  /**
   * The site sheet, the same value the published route passes. Required — see
   * the module docblock for why this one is not optional.
   */
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>;
  /** The selected node's id, or null when the selection is empty. */
  selectedId?: string | null;
  /** Raised with the clicked node's id, or null when the click hit no node. */
  onSelect?: (id: string | null) => void;
  /**
   * Everything else the renderer needs, passed through untouched.
   *
   * Spread rather than re-declared field by field: `PageRenderer` owns that
   * contract, and restating it here would be a second copy that silently stops
   * accepting whatever the renderer gains next.
   */
  render?: Omit<PageRendererProps, "document" | "siteStyles">;
  className?: string;
  /**
   * Pointer handlers for dragging blocks, from `useCanvasDrag`.
   *
   * Taken as an object rather than as individual props so the set cannot be
   * partially wired: a canvas carrying `onPointerDown` without `onPointerUp`
   * starts gestures it never ends, and the failure is a canvas that behaves
   * normally until the first drag.
   */
  dragHandlers?: CanvasDragHandlers;
  /**
   * Editor chrome drawn ABOVE the page — the drop indicator today.
   *
   * Inside the root rather than beside it, because the overlay is positioned in
   * the canvas's own content coordinates and the root is what establishes them.
   * Rendered after the page so it paints on top without needing a stacking
   * context of its own.
   */
  overlay?: React.ReactNode;
}

/**
 * The canvas.
 *
 * Selection is addressed by node ID and never by position. The engine's document
 * makes ids the only addressing anything stores, and a positional selection
 * breaks the moment a sibling is inserted above it — silently, by pointing at a
 * different block rather than at nothing.
 */
export function Canvas({
  document,
  siteStyles,
  selectedId = null,
  onSelect,
  render,
  className,
  dragHandlers,
  overlay,
}: CanvasProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSelect) return;
      // Chrome is not the page. Pressing a button drawn over the canvas is not
      // a click on the background, and treating it as one would deselect the
      // block that button acts on.
      if (isChrome(event.target)) return;
      // A click on the canvas background resolves to null, which CLEARS the
      // selection rather than being ignored. Ignoring it leaves an inspector
      // showing a node the author believes they have deselected.
      onSelect(nodeIdFromEvent(event.target));
    },
    [onSelect]
  );

  // Keyed on the document identity so a re-render for an unrelated reason —
  // a selection change, a hover — does not rebuild the rendered tree.
  const page = useMemo(
    () => (
      <PageRenderer
        {...render}
        document={document}
        siteStyles={siteStyles}
        // What makes the hit-testing above possible at all. The renderer emits
        // the node attribute only when asked, because a PUBLISHED page should
        // not carry an editor's addressing — so the canvas asks and a route
        // does not. Spread first and set here deliberately: a caller passing
        // `nodeAttribute: false` through `render` would silently disable
        // selection for the whole canvas.
        nodeAttribute
      />
    ),
    [render, document, siteStyles]
  );

  // Marked on the rendered element AFTER the renderer has produced it, rather
  // than asked of `PageRenderer`. Which node an editor considers current is an
  // editor's concern, and a published route renders the same document without
  // one — pushing it into the renderer's contract would put editor state in the
  // component that serves live pages.
  //
  // Compared in JavaScript rather than matched with a selector built from the
  // id. A node id reaches this from stored data, and interpolating it into
  // `querySelector` makes any character CSS treats specially either throw or,
  // worse, match something else.
  useEffect(() => {
    const container = root.current;
    if (container === null) return;
    // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
    // that declares its iterator, and this package compiles without one — so the
    // loop that reads more naturally does not type-check here.
    container.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
      element.toggleAttribute(
        SELECTED_ATTRIBUTE,
        element.getAttribute(NODE_ID_ATTRIBUTE) === selectedId
      );
    });
    // Re-marked whenever the rendered tree changes as well as when the
    // selection does: a re-render replaces the elements, and an effect keyed on
    // the selection alone would leave the new tree carrying no marker at all.
  }, [selectedId, page]);

  return (
    <div
      ref={root}
      className={cn(CANVAS_ROOT_CLASS, className)}
      // The id the canvas believes is current, for a caller that wants the
      // answer without walking the tree. Named apart from the per-element
      // marker deliberately: one carries an id and the other is a boolean, and
      // a single name meaning both is the kind of thing that reads correctly
      // right up until someone writes a selector against the wrong one.
      data-nx-selected-id={selectedId ?? undefined}
      onClick={handleClick}
      // Spread rather than merged with a handler of this component's own: the
      // canvas has no pointer behaviour of its own apart from the drag, so
      // there is nothing to combine, and merging would create a second place
      // where the two could be ordered wrongly.
      {...dragHandlers}
    >
      {page}
      {overlay}
    </div>
  );
}
