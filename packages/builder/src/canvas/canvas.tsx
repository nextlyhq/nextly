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
 * ## Where the parts live
 *
 * This module is the canvas itself, and it re-exports every name it
 * exported before its areas moved beside it:
 *
 * - `canvas-props.ts`: {@link CanvasProps}.
 * - `canvas-addressing.ts`: which block an element stands for, and back.
 * - `canvas-block-marks.ts`: the marks blocks carry, and each block's mark.
 * - `canvas-entry-content-inert.ts`: the entry's blocks made inert.
 * - `use-canvas-markers.ts`: the walk that writes the marks.
 * - `canvas-site-surface.ts`: the site's surface on the canvas root.
 * - `canvas-pointer.ts`: clicks, context gestures, hover and the frame's
 *   ground.
 * - `canvas-drop-refusal.tsx`: why a dragged block can't land.
 * - `canvas-layout-parts.tsx`: the Layout's regions around the page.
 * - `canvas-drawn-page.tsx`: the page as the canvas draws it.
 * - `canvas-device-hidden.ts`: the blocks hidden on the device shown, drawn
 *   striped.
 *
 * @module canvas
 */

import { cn } from "@nextlyhq/ui/utils";
import {
  type DragEvent,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { isElement } from "../dom-kind";
import { usePreviewedCollection } from "../previewed-entry";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import {
  conditionMarksOf,
  entryContentMarksOf,
  lockMarksOf,
} from "./canvas-block-marks";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import {
  drawnBreakpoints,
  useDeviceHiddenDrawing,
} from "./canvas-device-hidden";
import { useCanvasEnvironment, useDrawnPage } from "./canvas-drawn-page";
import { drawnRefusal } from "./canvas-drop-refusal";
import { useCanvasFrame } from "./canvas-frame-context";
import { RegionsAround } from "./canvas-layout-parts";
import { guardCanvasNavigation } from "./canvas-link-guard";
import {
  markedIds,
  useCanvasHover,
  useCanvasPointer,
  useFrameGroundClick,
} from "./canvas-pointer";
import type { CanvasProps } from "./canvas-props";
import { siteSurface, useSiteSurfaceMarks } from "./canvas-site-surface";
import {
  useAppliedDrawing,
  useEntryContentDrawing,
} from "./entry-content-canvas";
import { useCanvasMarkers } from "./use-canvas-markers";

/**
 * The class marking the canvas root, and the boundary the hit-test stops at.
 *
 * Declared in `shell-state.ts` beside the other markers `builder-chrome.css`
 * spells out literally, and re-exported here because this is where a reader
 * looks for the canvas's own marker. See {@link nodeIdFromEvent} for the walk
 * that needs it as an upper bound.
 */
export { CANVAS_ROOT_CLASS };

// Defined in its own module so the region frames drawn inside the canvas can
// mark themselves as chrome without importing the canvas back.
export { CHROME_ATTRIBUTE } from "./canvas-chrome";

export {
  isOutermostForAddress,
  nodeAddressOf,
  nodeElement,
  nodeIdFromEvent,
  outermostElementsOf,
} from "./canvas-addressing";
export {
  CONDITIONED_ATTRIBUTE,
  CONDITIONED_OWN_ATTRIBUTE,
  DRAG_SOURCE_ATTRIBUTE,
  DROP_PARENT_ATTRIBUTE,
  DROP_REFUSED_ATTRIBUTE,
  ENTRY_CONTENT_ATTRIBUTE,
  LOCKED_ATTRIBUTE,
  lockMarksOf,
  SELECTED_ATTRIBUTE,
} from "./canvas-block-marks";
// Kept so the module's exported names stay the same, though nothing imports it.
// fallow-ignore-next-line unused-type
export type { LockMark } from "./canvas-block-marks";
export { revealedDefinitions } from "./canvas-drawn-page";
export { DropRefusal } from "./canvas-drop-refusal";
export {
  ENTRY_CONTENT_INERT_ATTRIBUTE,
  markEntryContentInert,
  observeEntryContentInertOwnership,
} from "./canvas-entry-content-inert";
export { contextMenuTargetOf } from "./canvas-pointer";
export type { CanvasProps } from "./canvas-props";

/**
 * Refuse the browser's own drag of a picture or a link on the page, which
 * would take the pointer from the canvas's block drag; text being edited
 * keeps it, where dragging selected words moves them.
 */
function refuseNativeDrag(event: DragEvent<HTMLElement>): void {
  const target = event.target;
  if (!isElement(target)) return;
  const editing = '[contenteditable="true"], [contenteditable=""]';
  if (target.closest(editing) !== null) return;
  if (target.closest("img, a, picture, svg") !== null) event.preventDefault();
}

/**
 * The canvas root's style, with the scale the page is painted at published as
 * `--nx-canvas-zoom`.
 *
 * Chrome drawn inside the page (a Layout region's badge and tag) is scaled
 * with everything else when the frame is painted smaller or larger, which
 * makes its words unreadable on a zoomed-out canvas. Reading the factor back
 * lets that chrome undo it and stay at the admin's own size, without each
 * piece measuring the canvas.
 */
function withCanvasScale(
  style: React.CSSProperties | undefined,
  scale: number
): React.CSSProperties {
  return { ...style, "--nx-canvas-zoom": scale } as React.CSSProperties;
}

/**
 * The canvas root, published to both of its readers, and guarded.
 *
 * ONE assignment site for both publications.
 *
 * They are two APIs because they answer two questions — `rootRef` is read in
 * a pointer handler and asks "where is the canvas now"; `onRoot` is a value
 * so a reader can REACT to the canvas arriving, which a ref cannot express
 * because assigning `.current` changes no dependency. Neither can serve the
 * other's caller.
 *
 * But two effects deciding what the element is could drift: an edit to one is
 * invisible to the other, and the two would then hand out different answers
 * with nothing to report it. One effect, one element, published twice.
 *
 * After paint rather than through a merged ref callback: the element is the
 * same for the life of the mount, and one assignment here is easier to follow
 * than a callback keeping two refs agreeing.
 */
function usePublishedRoot(
  root: React.RefObject<HTMLDivElement | null>,
  rootRef: CanvasProps["rootRef"],
  onRoot: CanvasProps["onRoot"]
): void {
  useEffect(() => {
    const element = root.current;
    if (rootRef !== undefined) rootRef.current = element;
    onRoot?.(element);
    return () => {
      if (rootRef !== undefined) rootRef.current = null;
      onRoot?.(null);
    };
  }, [root, rootRef, onRoot]);

  // A link or form the page draws selects its block here and never takes the
  // editor anywhere: see `canvas-link-guard`. Same element, same lifetime as
  // the effect above, so it is installed once per mount.
  useEffect(() => {
    const element = root.current;
    return element === null
      ? undefined
      : guardCanvasNavigation(element, `[${CHROME_ATTRIBUTE}]`);
  }, [root]);
}

/**
 * What is marked as selected, and the pointer handlers that select.
 *
 * The primary alone is marked when a host has not adopted the set yet, which
 * keeps every existing caller correct without a change. A drag's own pointer
 * down runs first, so its behaviour is exactly what it was.
 */
function useSelectionPointer({
  selectedIds,
  selectedId,
  onSelect,
  onDoubleClick,
  onListSortField,
  dragPointerDown,
}: {
  selectedIds: CanvasProps["selectedIds"];
  selectedId: string | null;
  onSelect: CanvasProps["onSelect"];
  onDoubleClick: CanvasProps["onDoubleClick"];
  onListSortField: CanvasProps["onListSortField"];
  dragPointerDown:
    | ((event: React.PointerEvent<HTMLDivElement>) => void)
    | undefined;
}) {
  const marked = useMemo(
    () => markedIds(selectedIds, selectedId),
    [selectedIds, selectedId]
  );
  const pointer = useCanvasPointer(
    onSelect,
    onDoubleClick,
    marked,
    onListSortField
  );
  const canvasPointerDown = pointer.onPointerDown;
  const pointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragPointerDown?.(event);
      canvasPointerDown(event);
    },
    [canvasPointerDown, dragPointerDown]
  );
  return { marked, pointer, pointerDown };
}

/**
 * The locked nodes of the document being edited: a region's while one is
 * edited in place, whose blocks alone carry addresses then, else the page's.
 */
function useEditedLockMarks(
  editing: CanvasProps["editingRegion"],
  page: CanvasProps["document"]
): ReturnType<typeof lockMarksOf> {
  const edited = editing?.document ?? page;
  return useMemo(() => lockMarksOf(edited), [edited]);
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
  rootRef,
  onRoot,
  forcedState,
  siteStyles,
  selectedId = null,
  selectedIds,
  onSelect,
  render,
  className,
  dragHandlers,
  drag,
  onDoubleClick,
  onListSortField,
  overlay,
  regions,
  conditionsUnchecked,
  conditionsApplied,
  composed,
  // The selected region, the ways to select and edit one, and the one edited
  // in place, for the regions alone.
  ...regionUse
}: CanvasProps): JSX.Element {
  const root = useRef<HTMLDivElement | null>(null);
  usePublishedRoot(root, rootRef, onRoot);
  useFrameGroundClick(root, onSelect);
  const hover = useCanvasHover(
    dragHandlers?.onPointerMove,
    drag?.draggingBlockName != null
  );

  const { marked, pointer, pointerDown } = useSelectionPointer({
    selectedIds,
    selectedId,
    onSelect,
    onDoubleClick,
    onListSortField,
    dragPointerDown: dragHandlers?.onPointerDown,
  });

  const surface = siteSurface(render, siteStyles);
  useSiteSurfaceMarks(root, surface?.opaqueGround === true);
  // The scale the page is painted at, for chrome drawn inside it to undo.
  const canvasScale = useCanvasFrame().scale;

  const environment = useCanvasEnvironment(root);
  // The page as the conditions leave it while they are applied for the
  // previewed entry (a hidden block as its marker), else the page itself.
  const shownDocument = conditionsApplied?.document ?? document;
  // A template draws its previewed entry's own blocks in its Entry content
  // block; only the drawn page carries them, never the document edited.
  // Composed once: by the host where it hands the page as drawn
  // (`composed`), else here.
  const entryDrawing = useEntryContentDrawing(document, render, composed);
  // The page as composed, before any conditions are applied: what its
  // conditioned blocks, the entry's among them, are badged on.
  const composedPage = entryDrawing.document;
  // Conditions applied, the page as they leave it, the entry composed into
  // it here unless the host handed the page as composed.
  const appliedDrawing = useAppliedDrawing(
    conditionsApplied?.document,
    composed,
    render
  );
  // The blocks the page hides on the device shown, drawn anyway and striped;
  // none while the page is shown as a visitor gets it.
  const deviceHidden = useDeviceHiddenDrawing(
    appliedDrawing ?? composedPage,
    drawnBreakpoints(render, siteStyles),
    conditionsApplied === undefined
  );
  const { drawn, page } = useDrawnPage({
    regions,
    rendered: entryDrawing.render,
    sheet: siteStyles,
    document: deviceHidden.document,
    environment,
    applied: conditionsApplied,
    addressed: regionUse.editingRegion === undefined,
  });

  /*
   * The locked nodes, collected in ONE traversal per document rather than asked
   * per element inside the marker walk, which re-runs on every change to the
   * rendered tree: `own` for a block locked itself, `inherited` for one inside
   * a locked block, which the lock covers too.
   */
  const lockedIds = useEditedLockMarks(regionUse.editingRegion, document);
  const conditionMarks = useMemo(
    () =>
      conditionMarksOf(
        composedPage,
        conditionsUnchecked,
        {
          ...(render?.definitions === undefined
            ? {}
            : { definitions: render.definitions }),
          ...(render?.limits === undefined ? {} : { limits: render.limits }),
        },
        conditionsApplied
      ),
    [
      composedPage,
      conditionsUnchecked,
      render?.definitions,
      render?.limits,
      conditionsApplied,
    ]
  );

  // Each Entry content block's words, named by the template's collection:
  // of the blocks drawn, so one the conditions hide, drawn as its marker,
  // says only that it is hidden, as a hidden block's badge does.
  const previewedCollection = usePreviewedCollection();
  const entryContentMarks = useMemo(
    () =>
      entryContentMarksOf(
        shownDocument,
        previewedCollection,
        render?.limits?.maxNodes
      ),
    [shownDocument, previewedCollection, render?.limits]
  );

  useCanvasMarkers(
    root,
    marked,
    selectedId,
    page,
    forcedState,
    drag,
    lockedIds,
    conditionMarks,
    entryContentMarks,
    deviceHidden.marks
  );

  // The refusal the cursor shows, asked of the same rule the notice draws by.
  const refusalDrawn = drawnRefusal(drag);

  return (
    <div
      ref={root}
      className={cn(CANVAS_ROOT_CLASS, className)}
      // On the canvas ROOT rather than an inner wrapper, because the overlays
      // are positioned in this element's own content coordinates: a box inside
      // it would size the page while leaving the drop indicator and the
      // selection chrome measuring the region instead.
      style={withCanvasScale(surface?.style, canvasScale)}
      // The id the canvas believes is current, for a caller that wants the
      // answer without walking the tree. Named apart from the per-element
      // marker deliberately: one carries an id and the other is a boolean, and
      // a single name meaning both is the kind of thing that reads correctly
      // right up until someone writes a selector against the wrong one.
      data-nx-selected-id={selectedId ?? undefined}
      /*
       * Whether the site's dark values include a dark ground. They apply with
       * the device, or under a dark marker, exactly as the site sheet applies
       * them, and the stylesheet pairs this with both to switch the SCHEME:
       * Canvas, CanvasText and native controls. Absent when the dark values
       * keep a light ground, or the host serves no site sheet.
       */
      data-nx-site-dark-ground={surface?.darkGround === true ? "" : undefined}
      /*
       * `data-nx-site-theme`, the mode the nearest theme marker above names,
       * is written onto this element by `useNearestThemeMarker` before paint,
       * not rendered here: see that hook.
       */
      /*
       * `data-nx-site-ground-opaque`, whether the site's ground is fully
       * opaque, is written onto this element by `useSiteSurfaceMarks` from the
       * colour it resolves to, not rendered here: see that hook.
       */
      /*
       * What the pointer means, for the cursor.
       *
       * On the ROOT rather than per block, because a cursor during a drag is a
       * property of the gesture and not of whatever happens to be under the
       * pointer — and pointer capture means the events keep arriving here
       * however far the hand travels.
       *
       * Absent when nothing is dragging, so the hover cursor on a block is not
       * competing with a state that does not exist.
       */
      data-nx-dragging={
        drag?.draggingBlockName == null
          ? undefined
          : refusalDrawn === null
            ? ""
            : "refused"
      }
      onClick={pointer.onClick}
      onDoubleClick={pointer.onDoubleClick}
      onContextMenu={pointer.onContextMenu}
      // Spread whole, because the set cannot be partially applied — then the
      // one member this component also has something to say about is composed
      // over the top, drag first so its behaviour is exactly what it was.
      {...dragHandlers}
      onPointerDown={pointerDown}
      // A picture or a link pressed and moved would start the browser's own
      // drag of it, which cancels the pointer the canvas's block drag follows,
      // so a picture in a gallery could not be dragged to a new place.
      onDragStart={refuseNativeDrag}
      onPointerMove={hover.onPointerMove}
      onPointerLeave={hover.onPointerLeave}
    >
      <RegionsAround
        drawn={drawn}
        rendered={render}
        environment={environment}
        selection={regionUse}
        editing={regionUse.editingRegion}
      >
        {page}
      </RegionsAround>
      {overlay}
    </div>
  );
}
