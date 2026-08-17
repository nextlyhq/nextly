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
import { PageRenderer } from "@nextlyhq/blocks-react";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import { cn } from "@nextlyhq/ui/utils";
import { useCallback, useMemo } from "react";

/**
 * The attribute the canvas writes its node ids into, and reads them back from.
 *
 * A `data-` attribute rather than the scoped CSS class the compiler already
 * emits: that class is the STYLING contract, so keying selection on it would
 * make an unstyled node unselectable and tie the editor's hit-testing to a
 * naming scheme the compiler is free to change. Declared once here because a
 * writer and a reader that spell it separately are two declarations of one
 * name.
 */
export const CANVAS_NODE_ATTR = "data-nx-node";

/** How a pointer event on the canvas resolves to a node id, or to nothing. */
export function nodeIdFromEvent(target: EventTarget | null): string | null {
  // `closest` rather than reading the target directly: a click lands on whatever
  // leaf is under the pointer — a `<span>` inside a heading, an `<img>` inside a
  // card — and the node that owns it is an ancestor. Reading the target alone
  // selects nothing for every block that renders more than one element, which is
  // most of them.
  if (!(target instanceof Element)) return null;
  const owner = target.closest(`[${CANVAS_NODE_ATTR}]`);
  return owner?.getAttribute(CANVAS_NODE_ATTR) ?? null;
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
      <PageRenderer {...render} document={document} siteStyles={siteStyles} />
    ),
    [render, document, siteStyles]
  );

  return (
    <div
      className={cn("nx-canvas", className)}
      data-nx-selected={selectedId ?? undefined}
      onClick={handleClick}
    >
      {page}
    </div>
  );
}
