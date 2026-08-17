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
import { useCallback, useMemo } from "react";

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
}: CanvasProps) {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSelect) return;
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

  return (
    <div
      className={cn(CANVAS_ROOT_CLASS, className)}
      data-nx-selected={selectedId ?? undefined}
      onClick={handleClick}
    >
      {page}
    </div>
  );
}
