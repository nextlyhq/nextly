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

import {
  previewContainerName,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import {
  NODE_ID_ATTRIBUTE,
  PageRenderer,
  previewContainerStyle,
} from "@nextlyhq/blocks-react";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import { cn } from "@nextlyhq/ui/utils";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { CanvasDragHandlers } from "./canvas-drag";
import { offeredTiers } from "./canvas-width";
import { selectionModeFor, type SelectionMode } from "./selection";

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

/**
 * The element a node id was rendered as, or `null` when it is not on screen.
 *
 * The inverse of {@link nodeIdFromEvent}, and beside it because the two are one
 * mapping read in two directions — separated, they become two answers to what a
 * node id means in the DOM.
 *
 * Ids are COMPARED rather than interpolated into a selector. A node id reaches
 * here from stored data, so any character CSS treats specially makes
 * `querySelector` either throw or match something else entirely.
 *
 * Deliberately not the {@link SELECTED_ATTRIBUTE} marker. That marker is applied
 * in a passive effect, so on the render where the selection changes it is still
 * on the previously selected element, and any chrome measuring in a layout
 * effect would spend a frame measuring the wrong block.
 */
export function nodeElement(root: HTMLElement, id: string): Element | null {
  let found: Element | null = null;
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    if (found === null && element.getAttribute(NODE_ID_ATTRIBUTE) === id) {
      found = element;
    }
  });
  return found;
}

/**
 * Every element the renderer marked as a node, in document order.
 *
 * Beside {@link nodeElement} because both answer from the same marker, and a
 * caller that needs all of them should not walk the tree with its own selector.
 *
 * Chrome drawn INSIDE the canvas root carries no node marker, so it is excluded
 * by construction rather than by a filter that would have to be kept in step
 * with whatever chrome arrives next.
 */
export function nodeElements(root: HTMLElement): readonly Element[] {
  const found: Element[] = [];
  // `forEach` for the reason given in `nodeElement`: a `NodeList` is only
  // iterable under a lib this package does not compile with.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    found.push(element);
  });
  return found;
}

/**
 * The observed entry's inline size, across the shapes `ResizeObserver` has had.
 *
 * `contentBoxSize` was specified as a SEQUENCE, and Firefox shipped it as a
 * single object first; both shapes are still reachable, and polyfills predating
 * it expose only `contentRect`. Read as an array alone, every one of those
 * reports `undefined` on every notification — and the caller cannot tell that
 * from "nothing has been measured yet", so the canvas would apply tablet rules
 * while the inspector stayed on the base tier and the author's edits landed in
 * a breakpoint they were not looking at.
 *
 * `contentRect` is the right fallback rather than a lesser one: like
 * `contentBoxSize` it is a LAYOUT size, so the editor's canvas zoom does not
 * scale it — which `getBoundingClientRect()` would, reporting what a reader
 * sees rather than what a container query resolves against. `builder-shell.tsx`
 * measures on the same property for the same reason. It carries `width` rather
 * than an inline size, so the two agree only in a horizontal writing mode; the
 * admin is one, and the sequence shape above is preferred wherever it exists.
 */
function inlineSizeOf(entry: ResizeObserverEntry): number | undefined {
  const box: unknown = entry.contentBoxSize;
  const first: unknown = Array.isArray(box) ? box[0] : box;
  const inline = (first as ResizeObserverSize | undefined)?.inlineSize;
  if (typeof inline === "number") return inline;
  const width = entry.contentRect?.width;
  return typeof width === "number" ? width : undefined;
}

/**
 * Report a box's real inline size to its owner whenever it changes.
 *
 * `ResizeObserver` rather than a resize listener on the window: the box changes
 * width when the inspector opens, when a rail panel is toggled and when the
 * pane is dragged, none of which resize the window. A window listener would
 * report the same number across all three.
 */
function useReportedInlineWidth(
  box: React.RefObject<HTMLElement | null>,
  report: ((width: number | undefined) => void) | undefined
): void {
  /*
   * The reporter is held in a ref, and the effect does NOT depend on it.
   *
   * A host writing `onMeasured={w => setWidth(w)}` inline hands a new function
   * on every render. Depended on directly, every real measurement would update
   * the parent, produce a new identity, tear the observer down — reporting
   * `undefined` from the cleanup, as if the canvas had gone — and build a new
   * one that immediately reports the real width again. The derived tier
   * oscillates and the observer churn can sustain a render loop, on a host that
   * did nothing wrong.
   *
   * So the effect keys on whether a reporter EXISTS, which is the only part of
   * it that changes what the observer should do.
   */
  const latest = useRef(report);
  useEffect(() => {
    latest.current = report;
  }, [report]);
  const measuring = report !== undefined;
  useEffect(() => {
    const element = box.current;
    if (element === null || !measuring) return;
    // Guarded by CALLABILITY rather than presence: jsdom defines the global on
    // some setups without a working constructor, so a property test passes and
    // the construction throws.
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry === undefined) return;
      latest.current?.(inlineSizeOf(entry));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      /*
       * The box is gone, so the last number it reported describes nothing.
       *
       * Left standing, a caller goes on deriving a tier from a width no
       * element has — and the editor unmounts this canvas whenever the site's
       * stored styles stop being readable, which a cached query can do on a
       * refocus long after the first measurement. The inspector would keep
       * writing into whichever tier the stale width implied, with no preview
       * box on screen and the control that sets it disabled.
       *
       * `undefined` is the honest report and the one the caller already
       * handles: nothing has been observed.
       */
      latest.current?.(undefined);
    };
  }, [box, measuring]);
}

/**
 * The canvas root's own style: the container the sheet queries, and the width
 * the box is being asked to show.
 *
 * A MAXIMUM with an auto inline margin rather than a fixed width, because the
 * region may be narrower than the tier asked for — a wide breakpoint inside a
 * half-width editor pane cannot be honoured, and stretching the box past its
 * region would put the page under the inspector.
 *
 * Centred rather than left-aligned, which is what every builder surveyed does
 * and is not merely cosmetic: an off-centre narrow box reads as a layout that
 * has broken rather than as a viewport being simulated.
 */
function previewBoxStyle(
  preview: CanvasPreview | undefined
): React.CSSProperties {
  if (preview === undefined) return {};
  return {
    ...previewContainerStyle(preview.container),
    ...(preview.width === undefined
      ? {}
      : { maxWidth: `${preview.width}px`, marginInline: "auto" }),
  };
}

/**
 * Mark the selected elements on the rendered tree.
 *
 * Applied AFTER the renderer has produced them, rather than asked of
 * `PageRenderer`. Which node an editor considers current is an editor's
 * concern, and a published route renders the same document without one —
 * pushing it into the renderer's contract would put editor state in the
 * component that serves live pages.
 *
 * Ids are COMPARED in JavaScript rather than matched with a selector built from
 * one. A node id reaches this from stored data, and interpolating it into
 * `querySelector` makes any character CSS treats specially either throw or,
 * worse, match something else.
 *
 * `page` is a dependency because the rendered tree is what carries the markers:
 * a re-render replaces the elements, and an effect keyed on the selection alone
 * would leave the new tree carrying none at all.
 */
function useSelectionMarkers(
  box: React.RefObject<HTMLElement | null>,
  marked: readonly string[],
  selectedId: string | null,
  page: React.ReactNode
): void {
  useEffect(() => {
    const container = box.current;
    if (container === null) return;
    // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
    // that declares its iterator, and this package compiles without one — so the
    // loop that reads more naturally does not type-check here.
    container.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
      const id = element.getAttribute(NODE_ID_ATTRIBUTE);
      if (id === null || !marked.includes(id)) {
        element.removeAttribute(SELECTED_ATTRIBUTE);
        return;
      }
      // The VALUE carries which member the panels answer for. A boolean
      // attribute could not, and a second attribute for the primary would be a
      // state where a block is primary without being selected.
      element.setAttribute(
        SELECTED_ATTRIBUTE,
        id === selectedId ? "primary" : ""
      );
    });
  }, [box, selectedId, marked, page]);
}

/**
 * Which ids to mark, given what the host supplied.
 *
 * The primary alone when a host has not adopted the set yet, which keeps every
 * existing caller correct without a change. `[]` rather than `[null]` for an
 * empty selection: the marker is applied by id, and a null in the set would
 * match the elements carrying no id at all.
 */
function markedIds(
  selectedIds: readonly string[] | undefined,
  selectedId: string | null
): readonly string[] {
  if (selectedIds !== undefined) return selectedIds;
  return selectedId === null ? [] : [selectedId];
}

/**
 * The canvas's pointer handlers, which share one rule: chrome is not the page.
 *
 * Together rather than separately, because that rule is the whole of what they
 * have in common and a version where each handler remembers it for itself is
 * the version where the next one does not. Pressing a control drawn over the
 * canvas would otherwise resolve to "no node" and deselect the very block that
 * control acts on.
 */
function useCanvasPointer(
  onSelect: ((id: string | null, mode: SelectionMode) => void) | undefined,
  onDoubleClick: ((event: React.MouseEvent<HTMLDivElement>) => void) | undefined
): {
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
} {
  const click = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (onSelect === undefined || isChrome(event.target)) return;
      // A click on the canvas background resolves to null, which CLEARS the
      // selection rather than being ignored. Ignoring it leaves an inspector
      // showing a node the author believes they have deselected.
      onSelect(nodeIdFromEvent(event.target), selectionModeFor(event));
    },
    [onSelect]
  );
  const doubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isChrome(event.target)) return;
      onDoubleClick?.(event);
    },
    [onDoubleClick]
  );
  return { onClick: click, onDoubleClick: doubleClick };
}

/**
 * A canvas showing the page inside a resizable box rather than at the browser's
 * own width.
 *
 * The container is REQUIRED and the rest is not, because it is what makes the
 * other two mean anything: the editor canvas is not an iframe, so the sheet is
 * emitted into the admin document and `@media` asks the WINDOW. Only a sheet
 * compiled against a container name has rules this box can answer.
 */
export interface CanvasPreview {
  /**
   * The container name the sheet was compiled against.
   *
   * Passed through {@link previewContainerStyle}, which supplies the
   * `container-type` alongside the name: a named container left at the default
   * `normal` is not a size-query container, so every rule the preview compile
   * emitted stays inactive while the sheet is valid and the name matches.
   */
  container: string;
  /**
   * The width to constrain the box to, in CSS pixels, or absent to fill the
   * region.
   *
   * A MAXIMUM rather than a fixed width, because the region may be narrower
   * than the tier being asked for — a wide breakpoint inside a half-width
   * editor pane cannot be honoured, and stretching the box past its region
   * would put the page under the inspector instead.
   */
  width?: number;
  /**
   * The box's MEASURED inline size, reported whenever it changes.
   *
   * Reported rather than derived from {@link CanvasPreview.width}, because
   * those are different numbers and only one of them decides anything. The
   * requested width is a ceiling; what the container queries resolve against is
   * the width the box actually got. A caller that assumed the request was
   * honoured would name a tier the box is not showing — the same
   * confident-wrong-answer this whole preview mechanism exists to remove.
   *
   * `undefined` until the first measurement, which is a real state rather than
   * a default: nothing has been observed yet, and a caller must not report a
   * tier as live on the strength of a box nobody has looked at.
   */
  onMeasured?: (width: number | undefined) => void;
}

/**
 * The breakpoints the compile will actually run against, or `undefined` when
 * nothing will be compiled at all.
 *
 * The page tier's when it has one and the site sheet's otherwise, which is the
 * same order the container itself is bound in — so this answers for the compile
 * that will really happen rather than for the inputs a caller passed.
 *
 * `undefined` is the state where a caller has neither binding site:
 * `siteStyles={false}` opts out of the shared sheet, and a stored artifact
 * arrives with no style context.
 */
function compiledBreakpoints(
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>
): BreakpointSet | undefined {
  if (render?.styleContext !== undefined)
    return render.styleContext.breakpoints;
  return typeof siteStyles === "object" ? siteStyles.breakpoints : undefined;
}

/**
 * Whether this canvas is previewing at all, and under what name.
 *
 * Asked once, here, so the sheet, the box and the measurement cannot disagree
 * about it. Two things make a preview inert despite a caller asking for one,
 * and they fail the same way — the box constrains and measures while the rules
 * still answer to the WINDOW, so a caller deriving an edit target from the
 * measurement writes to a tier the canvas is not displaying.
 *
 * A REFUSED name is the first: `previewContainerName` turns down an empty,
 * reserved, malformed or oversized value, and the compile falls back to
 * published `@media`.
 *
 * NOWHERE TO BIND is the second, and the name is perfectly good in that one.
 * There are exactly two binding sites — the page tier's style context and the
 * site tier's sheet — and a caller can legitimately have neither:
 * `siteStyles={false}` opts out of the shared sheet, and a stored artifact
 * arrives with no style context.
 *
 * NOTHING TO SIMULATE is the third. A preview compile rewrites every
 * CONTAINER-axis rule to `@container nx-not-previewable (width < 0px)`, which
 * matches nothing — the engine refusing a question a preview box cannot answer,
 * and the right trade when there are viewport tiers to gain in exchange. With
 * no emitted viewport tier the same price buys nothing: a container-only site
 * would have every one of its breakpoints stop matching here while they keep
 * working on the published page. Decided in the component rather than at one
 * mount, so every consumer of this API keeps published mode for that set.
 */
function activePreview(
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>,
  preview: CanvasPreview | undefined
): CanvasPreview | undefined {
  const container = previewContainerName(preview?.container);
  if (preview === undefined || container === undefined) return undefined;
  const breakpoints = compiledBreakpoints(render, siteStyles);
  // Undefined here IS "nowhere to bind": the two binding sites are the only
  // places a breakpoint set can come from, so their absence is one condition
  // rather than two that have to be kept in step.
  if (breakpoints === undefined) return undefined;
  return offeredTiers(breakpoints).length === 0
    ? undefined
    : { ...preview, container };
}

/**
 * The renderer's inputs, made to agree with the box the canvas establishes.
 *
 * BOTH tiers, from one hook, because they are one decision read twice. A page's
 * node styles and a site's named classes each emit their own breakpoint rules
 * and each carry their own `previewContainer`; bound on only one, a class's
 * tablet rule stays an `@media` answered by the WINDOW while the node's tablet
 * rule became a `@container` answered by the box — so narrowing the canvas
 * moves one and not the other, and a block styled by a class does not respond.
 *
 * The container is written IN rather than asked for: it and the container this
 * element establishes are the same fact, and a caller holding two places to say
 * it has two chances to say it differently. Overwritten rather than defaulted,
 * so a host supplying a different name is corrected instead of believed.
 */
function usePreviewedInputs(
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>,
  preview: CanvasPreview | undefined
): {
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  sheet: NonNullable<PageRendererProps["siteStyles"]>;
  /**
   * The preview that is actually in force, or `undefined` when none is.
   *
   * A NAME the compiler refuses is not a preview. `previewContainerName` turns
   * down an empty, reserved, malformed or oversized value, and the compile then
   * falls back to published `@media` — so a box that went on constraining and
   * measuring itself would resize without changing a single tier, and a caller
   * deriving an edit target from the measurement would write to a breakpoint
   * the canvas is not displaying. That is the same confident-wrong-answer the
   * whole mechanism exists to remove, arrived at through the refusal path.
   *
   * Normalised HERE and nowhere else, so the sheet, the box and the measurement
   * cannot disagree about whether this canvas is previewing at all.
   */
  active: CanvasPreview | undefined;
} {
  return useMemo(() => {
    const active = activePreview(render, siteStyles, preview);
    if (active === undefined) {
      return { rendered: render, sheet: siteStyles, active: undefined };
    }
    return {
      active,
      /*
       * `styleContext` absent is left alone: without it the renderer compiles
       * no per-node sheet, so there are no page rules for a container to
       * answer.
       */
      rendered:
        render?.styleContext === undefined
          ? render
          : {
              ...render,
              styleContext: {
                ...render.styleContext,
                previewContainer: active.container,
              },
            },
      /*
       * `false` is a real value — a host saying it serves NO site sheet — and
       * spreading it would turn that refusal into an object carrying a
       * container name and nothing else, compiling an empty sheet where the
       * caller asked for none.
       */
      sheet:
        typeof siteStyles === "object"
          ? { ...siteStyles, previewContainer: active.container }
          : siteStyles,
    };
  }, [render, siteStyles, preview]);
}

export interface CanvasProps {
  /** The document being edited. */
  document: BlockDocument;
  /**
   * The site sheet, the same value the published route passes. Required — see
   * the module docblock for why this one is not optional.
   */
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>;
  /**
   * The preview box this canvas establishes, or absent to render at the
   * region's own width against a published sheet.
   *
   * One object rather than three props, for the reason
   * {@link CanvasProps.dragHandlers} is one: the set cannot then be PARTIALLY
   * wired, and every partial wiring here fails silently. A width without a
   * container resizes a box whose sheet still queries the window, so the page
   * reflows and not one breakpoint changes. A container nobody observes leaves
   * the surface that owns the box unable to say which tier is live.
   *
   * The container also travels INTO the compile from here rather than being
   * asked for twice: `render.styleContext.previewContainer` is overwritten with
   * `container`, so the box the queries are written against and the box this
   * element establishes cannot be different names.
   */
  preview?: CanvasPreview;
  /**
   * The PRIMARY selected node's id, or null when the selection is empty.
   *
   * The one the inspector edits. Marked `data-nx-selected="primary"` so a
   * multi-block selection can show which member the panels answer for — with
   * one block selected there is nothing to distinguish and the distinction
   * costs nothing.
   */
  selectedId?: string | null;
  /**
   * Every selected id. Defaults to the primary alone.
   *
   * A separate prop rather than derived from `selectedId`, because the canvas
   * must not decide what a selection IS — `selection.ts` does, and a canvas
   * that reconstructed the set from one id would silently disagree with it the
   * moment there were two.
   */
  selectedIds?: readonly string[];
  /**
   * Raised with the clicked node's id and the gesture its modifiers meant, or
   * null when the click hit no node.
   *
   * The MODE travels with the id because only the event knows it, and a caller
   * reading modifiers off a later render's event would read a different click.
   */
  onSelect?: (id: string | null, mode: SelectionMode) => void;
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
   * Raised when a double-click lands on the page.
   *
   * Separate from `onSelect` because the two gestures mean different things and
   * one handler deciding between them by counting clicks would be a second
   * place the distinction lives. A double-click that hits no editable value
   * does nothing, which the handler decides — the canvas does not know what is
   * editable.
   */
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
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
  selectedIds,
  onSelect,
  render,
  className,
  dragHandlers,
  onDoubleClick,
  overlay,
  preview,
}: CanvasProps) {
  const root = useRef<HTMLDivElement | null>(null);

  /*
   * What to mark. The primary alone when a host has not adopted the set yet,
   * which keeps every existing caller correct without a change.
   */
  const marked = useMemo(
    () => markedIds(selectedIds, selectedId),
    [selectedIds, selectedId]
  );
  const pointer = useCanvasPointer(onSelect, onDoubleClick);

  // Keyed on the document identity so a re-render for an unrelated reason —
  // a selection change, a hover — does not rebuild the rendered tree.
  const { rendered, sheet, active } = usePreviewedInputs(
    render,
    siteStyles,
    preview
  );

  useReportedInlineWidth(root, active?.onMeasured);

  const page = useMemo(
    () => (
      <PageRenderer
        {...rendered}
        document={document}
        siteStyles={sheet}
        // What makes the hit-testing above possible at all. The renderer emits
        // the node attribute only when asked, because a PUBLISHED page should
        // not carry an editor's addressing — so the canvas asks and a route
        // does not. Spread first and set here deliberately: a caller passing
        // `nodeAttribute: false` through `render` would silently disable
        // selection for the whole canvas.
        nodeAttribute
      />
    ),
    [rendered, document, sheet]
  );

  useSelectionMarkers(root, marked, selectedId, page);

  return (
    <div
      ref={root}
      className={cn(CANVAS_ROOT_CLASS, className)}
      // On the canvas ROOT rather than an inner wrapper, because the overlays
      // are positioned in this element's own content coordinates: a box inside
      // it would size the page while leaving the drop indicator and the
      // selection chrome measuring the region instead.
      style={previewBoxStyle(active)}
      // The id the canvas believes is current, for a caller that wants the
      // answer without walking the tree. Named apart from the per-element
      // marker deliberately: one carries an id and the other is a boolean, and
      // a single name meaning both is the kind of thing that reads correctly
      // right up until someone writes a selector against the wrong one.
      data-nx-selected-id={selectedId ?? undefined}
      onClick={pointer.onClick}
      onDoubleClick={pointer.onDoubleClick}
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
