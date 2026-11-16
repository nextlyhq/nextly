/**
 * What the pointer does on the canvas: a click selects, a context gesture
 * selects and finds the block a menu acts on, a list note's buttons do their
 * own thing, a move points the hovered block, and a click on the frame around
 * the page lets go of the selection. Chrome drawn over the canvas is never
 * the page.
 *
 * @module canvas-pointer
 */

import {
  LIST_ACTION_ATTRIBUTE,
  LIST_REF_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
} from "@nextlyhq/blocks-react";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import { useCallback, useEffect, useRef } from "react";

import { nodeAddressOf, nodeIdFromEvent } from "./canvas-addressing";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { useCanvasFrame } from "./canvas-frame-context";
import type { CanvasProps } from "./canvas-props";
import { isElement } from "./dom-kind";
import { useHoveredBlockSetter } from "./hovered-block";
import { selectionModeFor, type SelectionMode } from "./selection";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/**
 * The block a context gesture is aimed at, or `null` when it is aimed at
 * nothing a block menu could act on.
 *
 * Published because a context menu can be opened TWO ways and they arrive by
 * different events. A secondary click arrives as `contextmenu`, which the
 * canvas sees; a touch or pen long-press is opened by Radix from its own timer
 * on `pointerdown`, and never produces a `contextmenu` event at all. A menu
 * that filtered one path and not the other would offer a block's verbs for a
 * press aimed at chrome, or — worse — offer the PREVIOUS selection's verbs,
 * with Delete among them, for a press on a block that was never selected.
 *
 * So the decision lives here once and both callers ask it, rather than each
 * spelling out three rejections and drifting.
 */
export function contextMenuTargetOf(
  target: EventTarget | null,
  root: Element
): string | null {
  if (isEditableTarget(target) || isChrome(target)) return null;
  // By node kind rather than `instanceof Element`: a press inside a canvas
  // mounted in an iframe targets an element that window built.
  if (!isElement(target)) return null;
  const owner = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
  if (owner === null) return null;
  /*
   * Owned by THIS canvas, not merely by A canvas.
   *
   * `nodeIdFromEvent` asks the weaker question — its own comment claims this
   * one, and it checks only that some canvas is an ancestor. That is enough
   * for selection, where a foreign id is ignored and nothing happens. It is
   * not enough here: a canvas rendered inside a block of another canvas sends
   * its events up through the outer one, which would then let a menu open
   * while the outer selection stayed where it was — and its verbs would act on
   * a block nobody was pointing at.
   */
  if (owner.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return null;
  // The same address the click path resolves. Returning the raw attribute here
  // hands the menu a re-minted id the stored document does not contain, so
  // `applySelection` keeps the PREVIOUS selection — and a destructive verb then
  // acts on a block nobody pointed at.
  return nodeAddressOf(owner);
}

/**
 * Whether the gesture landed in text the author is editing.
 *
 * Asked apart from {@link isChrome} because the answer is the same and the
 * reason is not: chrome is not the page, while this IS the page and is being
 * typed into. The browser's own menu carries spelling, selection and clipboard
 * for a caret, and none of that has a replacement here — taking it away mid
 * sentence to offer "Move up" is a straight loss.
 *
 * `contenteditable="false"` is excluded explicitly: it marks a region the
 * editor has deliberately made uneditable INSIDE an editable one, which is a
 * block again rather than text.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  const editable = target.closest("[contenteditable]");
  return (
    editable !== null && editable.getAttribute("contenteditable") !== "false"
  );
}

function isChrome(target: EventTarget | null): boolean {
  return isElement(target) && target.closest(`[${CHROME_ATTRIBUTE}]`) !== null;
}

/** How long a list note's Copy ref says "Copied" once pressed. */
const COPIED_FOR_MS = 2000;

/**
 * A list note's Copy ref, when a press landed on it: the log reference it
 * names goes to the clipboard, and the button says so for a moment. Answers
 * whether it was one, so the press does nothing else.
 */
function copyNoteReference(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  const button = target.closest(`[${LIST_ACTION_ATTRIBUTE}="copy-ref"]`);
  const ref = button?.getAttribute(LIST_REF_ATTRIBUTE);
  if (
    button === null ||
    button === undefined ||
    ref === null ||
    ref === undefined
  ) {
    return false;
  }
  // The editor's own clipboard, not the canvas frame's: a frame may not be
  // allowed to write to it.
  const clipboard: Clipboard | undefined =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;
  void clipboard?.writeText(ref).then(
    () => {
      button.setAttribute("data-nx-list-copied", "");
      setTimeout(
        () => button.removeAttribute("data-nx-list-copied"),
        COPIED_FOR_MS
      );
    },
    // A clipboard the page may not write to leaves the reference selectable
    // in the note, where it is set apart to be copied by hand.
    () => undefined
  );
  return true;
}

/** The action a list's note offers, when a press landed on it. */
function listActionOf(target: EventTarget | null): string | null {
  if (!isElement(target)) return null;
  return (
    target
      .closest(`[${LIST_ACTION_ATTRIBUTE}]`)
      ?.getAttribute(LIST_ACTION_ATTRIBUTE) ?? null
  );
}

/**
 * Which ids to mark, given what the host supplied.
 *
 * The primary alone when a host has not adopted the set yet, which keeps every
 * existing caller correct without a change. `[]` rather than `[null]` for an
 * empty selection: the marker is applied by id, and a null in the set would
 * match the elements carrying no id at all.
 */
export function markedIds(
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
export function useCanvasPointer(
  onSelect: ((id: string | null, mode: SelectionMode) => void) | undefined,
  onDoubleClick:
    | ((event: React.MouseEvent<HTMLDivElement>) => void)
    | undefined,
  marked: readonly string[],
  onListSortField?: (id: string) => void
): {
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const click = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (onSelect === undefined || isChrome(event.target)) return;
      const id = nodeIdFromEvent(event.target);
      // A failed list's Copy ref copies the reference and stays on the
      // list: the author is about to paste it to a developer, not edit.
      if (copyNoteReference(event.target)) {
        if (id !== null) onSelect(id, "replace");
        return;
      }
      // A list note's "Choose a field", pressed or activated from the
      // keyboard: the host selects the list and takes the author to its sort,
      // in place of the plain selection a click inside the list makes.
      if (
        id !== null &&
        onListSortField !== undefined &&
        listActionOf(event.target) === "choose-sort-field"
      ) {
        onListSortField(id);
        return;
      }
      // A click on the canvas background resolves to null, which CLEARS the
      // selection rather than being ignored. Ignoring it leaves an inspector
      // showing a node the author believes they have deselected.
      onSelect(id, selectionModeFor(event));
    },
    [onSelect, onListSortField]
  );
  const doubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isChrome(event.target)) return;
      onDoubleClick?.(event);
    },
    [onDoubleClick]
  );
  /*
   * The secondary button selects, and says whether anything above this has a
   * block to act on.
   *
   * Selecting FIRST is the whole point. A menu opened over one block while the
   * selection sits on another acts on the other one, and the author is looking
   * at the block they aimed at — so the destructive verbs on it would be aimed
   * somewhere they cannot see.
   *
   * A block already in the selection is left alone rather than replacing it.
   * Right-clicking one of several chosen blocks to act on all of them is what
   * every comparable editor does, and re-selecting would silently drop the rest
   * of the author's selection at the moment they went looking for a verb.
   *
   * Over the canvas BACKGROUND the event is stopped instead. There is no node,
   * so a menu of block verbs would have no subject; stopping it here rather
   * than opening an empty one keeps that decision next to the hit test that
   * establishes it.
   */
  const contextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      /*
       * Three ways to have no block to act on, stopped the same way and for
       * separate reasons — see each predicate. Stopping rather than merely
       * returning is what matters: a menu mounted ABOVE the canvas sees
       * whatever this lets past, and the chrome and the appenders are drawn
       * INSIDE the canvas root, so a bare return offers the selected block's
       * verbs for a gesture aimed at a button that is not a block.
       *
       * `preventDefault` is deliberately not called, so the browser's own menu
       * still appears wherever this one does not.
       */
      const id = contextMenuTargetOf(event.target, event.currentTarget);
      if (id === null) {
        event.stopPropagation();
        return;
      }
      if (onSelect === undefined || marked.includes(id)) return;
      onSelect(id, "replace");
    },
    [marked, onSelect]
  );
  /*
   * The same withholding, for the gesture that carries no context event.
   *
   * A menu mounted above the canvas can open a touch or pen LONG PRESS from a
   * timer of its own, started on this event — no `contextmenu` is ever
   * dispatched, so the rule above never runs and every rejection it makes is
   * skipped. Withholding the press from anything above keeps one decision
   * governing both ways in.
   *
   * `stopPropagation` and NOT `preventDefault`, which is the whole point of
   * doing it here. This fires at the start of every contact, long before
   * anything knows whether it will become a long press, and cancelling the
   * default that early takes caret placement and text selection away from an
   * author who was only tapping into a sentence.
   */
  const pointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (contextMenuTargetOf(event.target, event.currentTarget) === null)
        event.stopPropagation();
    },
    []
  );
  return {
    onClick: click,
    onDoubleClick: doubleClick,
    onContextMenu: contextMenu,
    onPointerDown: pointerDown,
  };
}

/**
 * Point the editor's hovered block at the deepest block under the pointer, so
 * the canvas outlines it as a Layers row does, and at nothing when the
 * pointer leaves the canvas or is over its background.
 *
 * Nothing while a block is dragged: the drag's own marks say where it will
 * land, and an outline under the moving pointer would compete with them. The
 * drag's own move handler runs first, so the gesture behaves exactly as it
 * did; a move over the editor's chrome points at nothing new.
 */
export function useCanvasHover(
  dragMove: React.PointerEventHandler<HTMLElement> | undefined,
  dragging: boolean
): {
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
} {
  const setHovered = useHoveredBlockSetter();
  // In the layout phase, so the frame that first draws the drag never also
  // draws the hovered outline its marks replace: a passive effect runs after
  // that paint.
  useIsomorphicLayoutEffect(() => {
    if (dragging) setHovered(null);
  }, [dragging, setHovered]);
  // Nothing stays pointed at once the canvas goes.
  useEffect(() => () => setHovered(null), [setHovered]);
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragMove?.(event);
      if (dragging) return;
      const { target } = event;
      // Chrome over a block is inside the canvas, so moving onto it fires no
      // `pointerleave`: the block is let go here instead.
      if (isChrome(target)) {
        setHovered(null);
        return;
      }
      // A canvas a block renders is another document, with its own addresses:
      // its moves bubble here and are left to it.
      if (
        !isElement(target) ||
        target.closest(`.${CANVAS_ROOT_CLASS}`) !== event.currentTarget
      ) {
        return;
      }
      setHovered(nodeIdFromEvent(target));
    },
    [dragMove, dragging, setHovered]
  );
  const onPointerLeave = useCallback(() => setHovered(null), [setHovered]);
  return { onPointerMove, onPointerLeave };
}

/**
 * A click on the page around the canvas, inside its frame, answered as a
 * click on the canvas's own ground: the selection is cleared.
 *
 * On a page the site serves, the site's layout decides how tall the canvas
 * is, so below a short page the frame shows the site's own page rather than
 * the canvas, and the click an author makes there to let go of a block lands
 * outside the canvas root. Only inside a frame: where the canvas shares the
 * editor's document, everything outside it is the editor's own panels.
 */
export function useFrameGroundClick(
  root: React.RefObject<HTMLDivElement | null>,
  onSelect: CanvasProps["onSelect"]
): void {
  const framed = useCanvasFrame().frame !== null;
  const latest = useRef(onSelect);
  useEffect(() => {
    latest.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    const element = root.current;
    if (!framed || element === null) return;
    const doc = element.ownerDocument;
    const ground = (event: MouseEvent): void => {
      const { target } = event;
      // The canvas answers its own clicks, and chrome is not the page.
      if (isElement(target) && element.contains(target)) return;
      if (isChrome(target)) return;
      latest.current?.(null, selectionModeFor(event));
    };
    doc.addEventListener("click", ground);
    return () => doc.removeEventListener("click", ground);
  }, [framed, root]);
}
