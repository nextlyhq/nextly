/**
 * The canvas's props.
 *
 * @module canvas-props
 */

import type {
  BlockDocument,
  DefinitionsById,
  RegionArea,
  StyleState,
} from "@nextlyhq/blocks-engine";
import type { PageRendererProps } from "@nextlyhq/blocks-react";

import type { AppliedConditions } from "../conditions/applied-conditions";
import type { SelectionMode } from "../selection";

import type { CanvasDragHandlers, CanvasDragState } from "./canvas-drag";
import type { CanvasRegion } from "./canvas-regions";

export interface CanvasProps {
  /** The document being edited. */
  document: BlockDocument;
  /**
   * Receives the canvas root element, for a caller that needs to measure
   * against it.
   *
   * A drag that begins OUTSIDE the canvas — from a palette row — has no event
   * whose `currentTarget` is this element, and it must resolve a drop position
   * against the same box every other reader uses. This canvas owns that
   * element, so handing it over is more honest than a caller finding it by
   * class name: a query would be a second place that decides which element the
   * canvas root is.
   *
   * READ IT IN A HANDLER, NOT AN EFFECT, and that is a property of the call
   * site rather than of this prop — so it travels with nothing and has to be
   * said here. A ref answers "where is the canvas now" at press time, long
   * after mount. An effect asking the same ref reads `null` on its first run
   * and is never told otherwise, because assigning `.current` changes no
   * dependency and this canvas mounts only once styles have loaded. Anything
   * that must REACT to the canvas arriving takes {@link CanvasProps.onRoot}.
   */
  rootRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * The interaction state the panel is editing, forced on the primary
   * selection so an author can SEE what they are editing.
   *
   * A page cannot force a pseudo-class on itself — there is no CSS or DOM way
   * to make an element match `:hover` without a pointer. So the sheet has to be
   * compiled with `previewStates`, which gives each state a class alternative
   * beside its pseudo-class, and this canvas puts that class on one element.
   * Passed a state without that compile, nothing happens and nothing breaks:
   * the class is simply in no selector.
   *
   * `base` forces nothing. It is what applies when no state does.
   */
  forcedState?: StyleState;
  /**
   * The same element, published as a VALUE so a caller can react to it
   * appearing.
   *
   * A ref is not reactive. This canvas mounts only once styles have loaded
   * while the surfaces beside it stay mounted throughout, so a reader that
   * captured `rootRef` on its first render sees `null` and is never told
   * otherwise — assigning `.current` changes no dependency, so an effect
   * listing the ref never looks again.
   *
   * `rootRef` stays for the readers that only ever ask "where is it now" during
   * a gesture, where a ref is exactly right.
   */
  onRoot?: (root: HTMLDivElement | null) => void;
  /**
   * The site sheet, the same value the published route passes. Required — see
   * the module docblock for why this one is not optional.
   */
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>;
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
   * Raised with a collection list's id when its note's "Choose a field" is
   * pressed, for the host to select the list and take the author to its
   * sort. Absent, the press selects the list as any click inside it does.
   */
  onListSortField?: (id: string) => void;
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
   * What the pointer currently means, or absent when nothing is being dragged.
   *
   * ONE object rather than separate `draggingId`, `target` and `refusal` props,
   * for the reason {@link CanvasProps.dragHandlers} and
   * {@link CanvasProps.preview} are each one: a set spread across several
   * optional props can be PARTIALLY wired, and every partial wiring here fails
   * silently. A host passing the refusal without the moving id explains a
   * refusal while dimming nothing; one passing the id without the refusal is
   * precisely the state this prop exists to end.
   *
   * It is the shape `useCanvasDrag` already returns, so a host forwards what it
   * holds and restates none of it. Deriving a narrower view here would be a
   * second answer to a question the hook has already answered.
   *
   * Drawing only. Nothing here decides where a block may land — `resolveDrop`
   * does that, and this canvas draws whatever it was told.
   */
  drag?: CanvasDragState;
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
   * Editor chrome drawn ABOVE the page, for a canvas sharing the editor's
   * document.
   *
   * Inside the root rather than beside it, because the overlay is positioned in
   * the canvas's own content coordinates and the root is what establishes them.
   * Rendered after the page so it paints on top without needing a stacking
   * context of its own.
   *
   * A canvas in a `CanvasFrame` takes no overlay here: its chrome is the
   * frame's `overlay`, drawn in the editor's document over the frame, where
   * the site's CSS cannot reach it.
   */
  overlay?: React.ReactNode;
  /**
   * The regions of the page's Layout, drawn locked around the page: a header
   * before it, a footer after it, as a visitor gets them.
   *
   * Drawn inside the canvas root, as part of what the canvas renders, so any
   * surface the canvas is mounted on carries them with the page. They share
   * the page's one site sheet and its previewed breakpoints, each compiled
   * under a scope of its own (`layoutPartSheets`), so the canvas shows the
   * cascade the published route serves. Absent or empty, the canvas draws the
   * page exactly as it always has.
   */
  regions?: readonly CanvasRegion[];
  /**
   * Which of `regions` is selected, or `null`: the canvas's second kind of
   * selection, which the host holds beside the block selection
   * (`useRegionSelection`). The selected region wears its outline and name.
   */
  selectedRegion?: RegionArea | null;
  /**
   * Select a region, from a click or from Enter or Space on its Tab stop.
   * Absent, a region selects nothing.
   */
  onSelectRegion?: (area: RegionArea) => void;
  /**
   * Ask to edit a region in place: a double-click on it, or Enter on its Tab
   * stop while it is already selected (Enter selects it first). The host
   * decides whether the author may, and enters it. Absent, a region is only
   * ever selected.
   * @experimental Settles with editing a header or footer in place.
   */
  onEditRegion?: (area: RegionArea) => void;
  /**
   * The region being edited in place, while one is: drawn from this LIVE
   * document (the editor state the host edits it with) with its blocks
   * addressed, so hover, selection, inline editing and drag work in it as on
   * a page. Meanwhile `document`, the page, stays drawn as it was, but `inert`,
   * hidden from assistive technology and with no block addressed, as is the
   * other region; the host's dim over them is drawn in the chrome layer, so
   * nothing here changes the page's own colours. `selectedId`, `selectedIds`
   * and `onSelect` are the region's then. Absent, the page is edited.
   * @experimental Settles with editing a header or footer in place.
   */
  editingRegion?: CanvasEditingRegion;
  /**
   * The blocks whose visibility conditions the page can't check, which the
   * canvas marks in red: visitors never see them. Judged by the host, which
   * knows the collections' fields. Absent, every conditioned block is marked
   * only as conditional.
   */
  conditionsUnchecked?: ReadonlySet<string>;
  /**
   * The page with its visibility conditions applied for the entry it is
   * previewed with (`appliedConditionsOf`): a block hidden for that entry is
   * drawn as a one-line marker in its place, and one shown is badged so.
   * Absent, every conditioned block is drawn and marked as conditional.
   *
   * Applied to the page as drawn: a template's with the previewed entry's
   * own blocks already composed into its Entry content (`composed`), so the
   * entry's blocks are judged with the template's and the canvas draws this
   * document as it is, composing nothing of its own.
   */
  conditionsApplied?: AppliedConditions;
  /**
   * `document` with the previewed entry's own blocks composed into its Entry
   * content block (`useComposedEntryContent`), where the host composed it
   * for the conditions it applies: the canvas draws it rather than composing
   * its own, so the page has one composition. Absent, the canvas composes
   * `document` with the entry the seam names.
   */
  composed?: BlockDocument;
  /**
   * Words drawn in a grey box in the page's place, between `regions`, for a
   * document view with no page of its own (a header and footer shown around
   * where any page goes). `document` is still drawn, so the site's styles
   * reach the regions as on a page; a host passing this passes an empty one.
   * Absent, the page is drawn alone, as it always is.
   * @experimental Settles with the header & footer set view.
   */
  placeholder?: string;
}

/** A region of the page's layout as the canvas draws it while it is edited. */
export interface CanvasEditingRegion {
  /** Which region of `regions` is edited. */
  readonly area: RegionArea;
  /** Its document as it stands, edit by edit. */
  readonly document: BlockDocument;
  /** The definitions its component placements are drawn from. */
  readonly definitions?: DefinitionsById;
}
