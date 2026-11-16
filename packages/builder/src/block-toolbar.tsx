"use client";

/**
 * The floating toolbar: the structural verbs, at the block they act on.
 *
 * Every action here already existed and was reachable only by keystroke —
 * alt+Arrow to move, mod+D to duplicate, Delete to remove. An author who has
 * not read a shortcut list has no way to discover that this editor can
 * duplicate a block at all, so for most of the people using it those verbs were
 * effectively absent. This is B-16's pointer half; the breadcrumb in the bottom
 * bar is the other.
 *
 * ## It presses the SAME verbs the keys do
 *
 * The callbacks come from `useBlockActionsContext`, which is the set
 * `BlockKeyboardActions` binds. Nothing here applies an op. A toolbar with its
 * own ops would be a second answer to "what does duplicate do", and the two
 * would drift — the author meets that as a button and a keystroke that disagree,
 * long after either was written. It is also why the announcements are right
 * without this module containing one: the verbs announce into the single live
 * region that component owns.
 *
 * ## Why it is drawn in the canvas overlay
 *
 * The bar is positioned in the canvas's own CONTENT coordinates, which means
 * scrolling the canvas carries it along with the block at no cost — there is no
 * scroll listener here, and there is no frame on which the bar and the block it
 * names disagree. That is the same reason the drop indicator lives there.
 *
 * ## Disabled, not hidden; and still focusable
 *
 * A bar whose buttons come and go changes width and order as the selection
 * moves, so the control an author is aiming at has moved by the time they
 * arrive. Unavailable actions stay in place, dimmed.
 *
 * They also stay REACHABLE, through `aria-disabled` rather than the `disabled`
 * attribute. A disabled button is removed from the tab sequence, and the reason
 * it is disabled — "Caption inside this block is locked" — is precisely what a
 * keyboard or screen-reader author needs and would then never receive. The
 * press is refused in the handler instead.
 *
 * @module block-toolbar
 */

import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import {
  ArrowDown,
  ArrowUp,
  Component,
  Copy,
  CopyPlus,
  CornerLeftUp,
  Ellipsis,
  LayoutTemplate,
  Lock,
  LockOpen,
  Palette,
  RefreshCw,
  SquarePen,
  Trash2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { blockActionRunners } from "./builder-commands";
import {
  CANVAS_ROOT_CLASS,
  CHROME_ATTRIBUTE,
  outermostElementsOf,
} from "./canvas";
import { nodeAddressOf } from "./canvas-addressing";
import { BLOCK_TOOLBAR_CLASS } from "./canvas-chrome";
import { useCanvasFrame, type CanvasFrame } from "./canvas-frame-context";
import { watchScreenBand } from "./canvas-geometry-watch";
import { useTabPost } from "./canvas-tab-places";
import { isHTMLElement } from "./dom-kind";
import type { EditorState } from "./editor-state";
import type { Rect } from "./geometry";
import {
  canvasContentRect,
  canvasScroller,
  drawnBoxes,
  onScreenOf,
  overlaySpaceOf,
} from "./geometry-dom";
import { useHoveredBlock } from "./hovered-block";
import {
  layersLockChangeable,
  lockOp,
  lockStatusOf,
  lockViewOf,
} from "./inspector";
import {
  useBlockActionsContext,
  useToolbarFocusSlot,
} from "./keyboard-actions";
import { layerLabel, pathTo } from "./layers";
import { lockBlockingEdit } from "./locking";
import { clearanceWith } from "./scroll-clearance";
import { useSelectionActions } from "./selection-actions";
import {
  TOOLBAR_GAP_PX,
  type ToolbarAction,
  type ToolbarActionId,
  toolbarPlacement,
  type ToolbarPlacement,
  type ToolbarScreen,
  unionRect,
} from "./toolbar-actions";
import { EDITING_ATTRIBUTE } from "./use-inline-text";

/** A rectangle on screen as the top and bottom a toolbar keeps to. */
function screenBand(rect: Rect): ToolbarScreen {
  return {
    top: rect.y,
    bottom: rect.y + rect.height,
    left: rect.x,
    right: rect.x + rect.width,
  };
}

/**
 * The bar's stops: the lock, where one holds the block, leads the bar (on a
 * locked block it is what an author meets first), then the buttons, then
 * "More" where it holds any verbs.
 */
function barStopsOf(
  lock: BarLock | undefined,
  buttons: number,
  menu: number
): { lock: BarLock | undefined; lead: number; stops: number } {
  const lead = lock === undefined ? 0 : 1;
  return { lock, lead, stops: lead + buttons + (menu > 0 ? 1 : 0) };
}

/** The bar's stepped-aside marker: present while it steps aside for typing. */
function typingMark(aside: boolean): { "data-typing"?: "" } {
  return aside ? { "data-typing": "" } : {};
}

/**
 * The bar's fade marker: present while the pointer is over a block that is
 * not selected.
 *
 * Not over a block inside the selection when the bar is drawn inside it:
 * there the bar sits over what it names, and pointing under it is pointing
 * at the selected block's own content, so it stays, and stays pressable.
 */
function fadedAside(
  hovered: string | null,
  selectedIds: readonly string[],
  over: { inside: boolean; document: EditorState["document"] }
): { "data-faded"?: "" } {
  if (hovered === null || selectedIds.includes(hovered)) return {};
  const within =
    over.inside &&
    pathTo(over.document, hovered).some(node => selectedIds.includes(node.id));
  return within ? {} : { "data-faded": "" };
}

/**
 * `scroll-padding-top` on the canvas's scroller, the bar's height and gap,
 * while the bar is drawn: a block scrolled or focused into view then stops
 * below the bar rather than under it (WCAG 2.4.11), or the scroller's own
 * clearance where that is larger. In the root's coordinates,
 * the scroller's, the bar being drawn at its own size over a frame painted at
 * another. The scroller's own value comes back after.
 */
/**
 * The elements the bar is placed against for the selected blocks: every
 * outermost element each one draws, not its first — a placement whose
 * definition draws a headline and an intro is both, and a bar placed under the
 * headline alone would sit over the intro's line. Only those that draw a box
 * (`drawnBoxes`), so a part hidden on this device adds no zero rectangle at
 * the canvas origin; a block none of whose elements draws one keeps its
 * elements, as it had before. One list for the measurement and for what is
 * watched for a change of size, so the two cannot disagree.
 */
function measuredPartsOf(
  root: HTMLElement,
  selectedIds: readonly string[]
): Element[] {
  const parts: Element[] = [];
  for (const elements of outermostElementsOf(
    root,
    new Set(selectedIds)
  ).values()) {
    const drawn = elements.flatMap(drawnBoxes);
    parts.push(...(drawn.length > 0 ? drawn : elements));
  }
  return parts;
}

function useScrollClearance(
  bar: React.RefObject<HTMLDivElement | null>,
  hidden: boolean,
  placement: ToolbarPlacement | null,
  canvasFrame: CanvasFrame
): void {
  const drawn = !hidden && placement !== null;
  React.useEffect(() => {
    const element = bar.current;
    if (!drawn || element === null) return;
    const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) return;
    const scroller = canvasScroller(space.root, space.frame !== null);
    if (!isHTMLElement(scroller)) return;
    const height = space.sizeOf(element).height / space.scale + TOOLBAR_GAP_PX;
    const before = scroller.style.scrollPaddingTop;
    // The larger of the bar's and what the scroller already keeps clear: a
    // site keeping focused blocks below its sticky header sets its own, and
    // the bar must not shrink that to the bar alone.
    scroller.style.scrollPaddingTop = clearanceWith(
      scroller.ownerDocument.defaultView?.getComputedStyle(scroller)
        .scrollPaddingTop ?? "",
      height
    );
    return () => {
      scroller.style.scrollPaddingTop = before;
    };
  }, [bar, drawn, canvasFrame]);
}

/**
 * The selected block's Layers lock, its own or one around it, as the bar says
 * it: the canvas draws nothing else that tells a locked block from any other,
 * and the dimmed buttons only say why one at a time. Nothing for a set of
 * blocks, or a block no lock holds.
 *
 * - `unlock`: the block's own lock, which whoever edits the page may lift, so
 *   the bar offers to lift it where the author is looking.
 * - `held`: its own lock, pinned where it sits (a `contentOnly` area fixes it
 *   with the block's design), so the bar says Locked and why.
 * - `around`: the lock of a block it sits inside. Unlock acts on a block's own
 *   lock only, so the bar names that block and offers to select it, where its
 *   own bar offers Unlock.
 */
type BarLock =
  | { readonly kind: "unlock"; readonly id: string }
  | { readonly kind: "held"; readonly reason: string }
  | { readonly kind: "around"; readonly id: string; readonly name: string };

/** What a pinned lock says where the area it sits in gives no reason. */
const HELD_REASON = "The area it sits in fixes this.";

function barLockOf(
  editor: EditorState,
  selectedId: string | null,
  selectedIds: readonly string[]
): BarLock | undefined {
  if (selectedId === null || selectedIds.length > 1) return undefined;
  const holder = lockBlockingEdit(editor.document, selectedId);
  if (holder === undefined) return undefined;
  if (holder.id !== selectedId) {
    return { kind: "around", id: holder.id, name: layerLabel(holder) };
  }
  // Asked only of a block locked itself, so a click on any other block reads
  // no slot locks.
  const status = lockStatusOf(editor.document, selectedId, lockViewOf(editor));
  return layersLockChangeable(status)
    ? { kind: "unlock", id: selectedId }
    : { kind: "held", reason: status.slot?.reason ?? HELD_REASON };
}

/**
 * Hidden while the author types in the selected block, where the bar is drawn
 * inside it: there it sits over the block's first line, which is what is
 * being typed. Back as soon as the pointer moves, the editing ends, or focus
 * comes to the bar (Alt+F10 from the text being edited).
 */
function useTypingAside(
  bar: React.RefObject<HTMLDivElement | null>,
  inside: boolean,
  selectedIds: readonly string[],
  canvasFrame: CanvasFrame,
  /**
   * Whether the bar is drawn. A bar hidden for a drag is drawn again as a new
   * element, which the listeners have to move to.
   */
  drawn: boolean
): boolean {
  const [aside, setAside] = React.useState(false);
  // Keyed on the ids, not the array, which a render may hand over afresh:
  // re-listening would bring the bar back mid-word.
  const selected = selectedIds.join("\n");
  // The canvas's document, held by the frame's provider: a frame that loads
  // another page replaces it, and the listeners move to the new one.
  const canvas = canvasFrame.document;
  React.useEffect(() => {
    setAside(false);
    const element = bar.current;
    if (!inside || !drawn || element === null) return;
    return listenForTyping(
      canvas ?? element.ownerDocument,
      element,
      selected.split("\n"),
      setAside
    );
  }, [bar, inside, selected, canvas, drawn]);
  return aside;
}

/**
 * Whether a key press writes into the text: a character, or a key that
 * removes one or breaks the line. Not a shortcut held with a modifier, nor a
 * key such as F10 or Escape, so Alt+F10 still reaches the bar.
 */
function writesText(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  return (
    event.key.length === 1 ||
    event.key === "Backspace" ||
    event.key === "Delete" ||
    event.key === "Enter"
  );
}

/**
 * Listen for typing in the selected blocks' text, telling `aside` when the
 * bar should step aside and when it should come back; returns the way to stop.
 *
 * The typing is heard in the canvas's own document, the pointer in both that
 * one and the bar's, which differ when the canvas is in a frame. The end of
 * the editing is the element being typed into losing its editing mark, so
 * that element is watched, and the watch moves with the typing.
 */
function listenForTyping(
  canvas: Document,
  bar: HTMLElement,
  ids: readonly string[],
  aside: (value: boolean) => void
): () => void {
  const documents = new Set([canvas, bar.ownerDocument]);
  let watched: { element: Element; observer: MutationObserver } | null = null;
  const back = (): void => {
    watched?.observer.disconnect();
    watched = null;
    aside(false);
  };
  const watch = (typing: Element): void => {
    if (watched?.element === typing) return;
    watched?.observer.disconnect();
    watched = null;
    const Watch = canvas.defaultView?.MutationObserver;
    if (typeof Watch !== "function") return;
    const observer = new Watch(() => {
      if (!typing.hasAttribute(EDITING_ATTRIBUTE)) back();
    });
    observer.observe(typing, { attributeFilter: [EDITING_ATTRIBUTE] });
    watched = { element: typing, observer };
  };
  // A key that writes, or text put in some other way: an input method's
  // composition or a software keyboard sends `beforeinput` with no key a
  // `keydown` names.
  const typed = (event: Event): void => {
    if (event.type === "keydown" && !writesText(event as KeyboardEvent)) {
      return;
    }
    // The root as it is now, which a page loaded into the frame replaces.
    const root = overlaySpaceOf(bar, CANVAS_ROOT_CLASS)?.root;
    if (root === undefined) return;
    const typing = typingIn(event.target, root, ids);
    if (typing === null) return;
    aside(true);
    watch(typing);
  };
  canvas.addEventListener("keydown", typed, true);
  canvas.addEventListener("beforeinput", typed, true);
  bar.addEventListener("focusin", back);
  for (const each of documents) each.addEventListener("pointermove", back);
  return () => {
    watched?.observer.disconnect();
    canvas.removeEventListener("keydown", typed, true);
    canvas.removeEventListener("beforeinput", typed, true);
    bar.removeEventListener("focusin", back);
    for (const each of documents) each.removeEventListener("pointermove", back);
  };
}

/**
 * The element being typed into inside one of the selected blocks, or `null`
 * when the key was pressed anywhere else.
 */
function typingIn(
  target: EventTarget | null,
  root: HTMLElement,
  selectedIds: readonly string[]
): Element | null {
  if (!isHTMLElement(target) || !root.contains(target)) return null;
  const editing = target.closest(`[${EDITING_ATTRIBUTE}]`);
  const owner = editing?.closest(`[${NODE_ID_ATTRIBUTE}]`);
  // The canvas's address of the element: a component's text answers with
  // its placement, which is what is selected.
  const id = owner == null ? null : nodeAddressOf(owner);
  return editing !== null && id !== null && selectedIds.includes(id)
    ? editing
    : null;
}

const ICONS: Record<ToolbarActionId, LucideIcon> = {
  "select-parent": CornerLeftUp,
  "move-up": ArrowUp,
  "move-down": ArrowDown,
  duplicate: Copy,
  // A page outline rather than a bookmark or a star: what is stored is a piece
  // of layout, and the same glyph names the Patterns tier in the insert panel.
  "save-as-pattern": LayoutTemplate,
  // A palette: what is saved is a look, which other blocks can wear.
  "save-as-shared-style": Palette,
  // A pen on a square, the editing glyph: the component opens to be edited.
  "edit-component": SquarePen,
  // The component mark: the selection becomes one.
  "turn-into-component": Component,
  "detach-component": Unlink,
  "duplicate-component": CopyPlus,
  "update-pattern": RefreshCw,
  delete: Trash2,
};

/**
 * The roving stop kept on the focused button when the bar gains or loses its
 * lock control around it: a keyboard press of Select parent onto a locked
 * block keeps focus on that button while every index after the lock moves
 * by one.
 */
function useStopFollowsFocus(
  bar: React.RefObject<HTMLDivElement | null>,
  lead: number,
  stops: number,
  setActiveIndex: (index: number) => void
): void {
  React.useEffect(() => {
    const element = bar.current;
    if (element === null) return;
    const focused = element.ownerDocument.activeElement;
    const index = [...element.querySelectorAll("button")].findIndex(
      button => button === focused
    );
    if (index >= 0) setActiveIndex(index);
  }, [bar, lead, stops, setActiveIndex]);
}

export interface BlockToolbarProps {
  /** The editor whose selection this acts on. */
  editor: EditorState;
  /**
   * Suppress the bar, for a host that is mid-gesture.
   *
   * A drag is the case this exists for: the bar would sit over the canvas while
   * the author is aiming at it, and it names a block that is in the middle of
   * moving. Rendering nothing is right rather than hiding with CSS, because a
   * hidden bar would still be in the tab order.
   */
  hidden?: boolean;
}

export function BlockToolbar({
  editor,
  hidden = false,
}: BlockToolbarProps): React.JSX.Element | null {
  const verbs = useBlockActionsContext();
  const bar = React.useRef<HTMLDivElement | null>(null);

  /*
   * Alt+F10's way to the bar, put in this editor's slot while it is mounted:
   * the bar's tab stop, the one button of its roving set that holds
   * `tabindex="0"`, or `null` while no bar is drawn. Through the editor's own
   * slot rather than a search of the document, which may hold another
   * editor's bar first.
   */
  const focusSlot = useToolbarFocusSlot();
  React.useEffect(() => {
    if (focusSlot === null) return;
    const stop = (): HTMLElement | null =>
      bar.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? null;
    focusSlot.current = stop;
    return () => {
      if (focusSlot.current === stop) focusSlot.current = null;
    };
  }, [focusSlot]);
  const [placement, setPlacement] = React.useState<ToolbarPlacement | null>(
    null
  );
  // Where the bar is drawn, posted to the board the canvas's tabs are placed
  // by (`canvas-tab-places.ts`): a tab or badge on the selected block's top
  // edge, or a neighbour's, takes its next place rather than sit under the
  // bar. The bar keeps its place; the tabs move.
  const postBox = useTabPost("toolbar");

  // Still read directly: the bar MEASURES against these and re-measures when
  // the document changes, which is a different use from deciding which verbs to
  // offer. `document` in particular has to stay bound — dropping it does not
  // fail, it silently resolves to the window's own.
  const { document, selectedId } = editor;
  const selectedIds = editor.selection.ids;
  const actions = useSelectionActions(editor);
  // The verbs drawn as buttons, and those kept behind "More". One stop in the
  // bar's roving order stands for the whole menu.
  const buttons = React.useMemo(
    () => actions.filter(action => action.inMenu !== true),
    [actions]
  );
  const menu = React.useMemo(
    () => actions.filter(action => action.inMenu === true),
    [actions]
  );
  const { lock, lead, stops } = barStopsOf(
    barLockOf(editor, selectedId, selectedIds),
    buttons.length,
    menu.length
  );

  /*
   * Which button holds the tab stop, per the WAI-ARIA toolbar pattern: one stop
   * for the whole bar, arrows to move within it.
   *
   * Held as an index rather than an id so it survives a selection change to a
   * block whose actions differ, and reset below when the selection moves —
   * otherwise the stop would sit on whichever button happened to be there for
   * the last block.
   */
  const [activeIndex, setActiveIndex] = React.useState(0);
  React.useEffect(() => {
    /*
     * Only when focus is elsewhere.
     *
     * Duplicate and Select parent both CHANGE the selection, and an author who
     * pressed one of them with the keyboard still has focus on that button.
     * Resetting the stop to 0 there would leave the roving index and the caret
     * on different buttons, so the next arrow press would jump backwards from
     * where the author is looking. When the bar holds focus, `onFocus` has
     * already put the index where the caret is.
     */
    const element = bar.current;
    // Asked of the bar's OWN document, which is the one whose focused element
    // it can contain: the window's would report an iframe around the bar
    // whenever the bar is drawn inside a frame.
    if (
      element !== null &&
      element.contains(element.ownerDocument.activeElement)
    ) {
      return;
    }
    setActiveIndex(0);
  }, [selectedId]);
  useStopFollowsFocus(bar, lead, stops, setActiveIndex);
  // Kept inside the bar when it loses a stop, as when Unlock leaves it with
  // the stop on its last button: an index past the end holds no tab stop,
  // and the bar would be out of reach.
  const stop = Math.min(activeIndex, Math.max(stops - 1, 0));

  /*
   * Measure after the DOM has the block but before the browser paints, so the
   * bar never appears at a stale position first.
   *
   * Re-run on the document as well as the selection: an edit can resize the
   * selected block — that is most of what the inspector does — and a bar keyed
   * on the selection alone would stay where the block used to end.
   */
  const measure = React.useCallback(() => {
    const element = bar.current;
    if (element === null || selectedId === null) {
      postBox(null);
      setPlacement(null);
      return;
    }
    /*
     * The canvas the bar is drawn over, and the space it is drawn in: inside
     * the root when the canvas shares the editor's document, or in the layer
     * over the canvas's frame, where the root's coordinates are scaled to the
     * frame's zoom and the bar keeps its own size.
     */
    const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) {
      postBox(null);
      setPlacement(null);
      return;
    }
    const { root } = space;
    /*
     * Anchored to the UNION of everything selected, not to the primary.
     *
     * With two blocks selected at opposite ends of a page, a bar drawn at one
     * of them describes an action about to happen to the other, which the
     * author cannot see. The union is the shape the selection occupies.
     */
    const rects = measuredPartsOf(root, selectedIds).map(part =>
      space.place(canvasContentRect(part, root))
    );
    const block = unionRect(rects);
    if (block === undefined) {
      postBox(null);
      setPlacement(null);
      return;
    }
    // The bar's own size, through the same measurement the block goes through.
    // Its position is discarded — what is wanted is width and height — but a
    // second way of reading a rectangle is exactly what `geometry-dom` exists
    // to prevent, and a bar measured one way against a block measured another
    // is a disagreement that only shows up at a scroll offset.
    const size = space.sizeOf(element);
    const placed = toolbarPlacement(
      block,
      size,
      // The root's own box rather than its scroll extent. `scrollWidth` and
      // `scrollHeight` are the CONTENT's size, so a long page would report a
      // height of several thousand and the clamp would let the bar sit far
      // outside what the author can see.
      space.place(canvasContentRect(root, root)),
      TOOLBAR_GAP_PX,
      // Kept to what is on screen: room above is room above on screen, and
      // a tall block scrolled past its top keeps its bar in view.
      screenBand(onScreenOf(space)),
      // Each selected block, so the bar is kept to the screen sideways only
      // where one of them is on it.
      rects
    );
    postBox(root, {
      tabs: [],
      taken: [{ x: placed.x, y: placed.y, ...size }],
    });
    setPlacement(placed);
  }, [selectedId, selectedIds, postBox]);

  /*
   * The frame's reading as well — its scale, page and viewport: a zoom moves
   * every block on screen while nothing inside the frame changes size, and a
   * page that has just loaded into the frame is a root the bar has not
   * measured against.
   */
  const canvasFrame = useCanvasFrame();
  React.useLayoutEffect(() => {
    // Hidden, the bar is not drawn, so no tab keeps clear of it.
    if (hidden) {
      postBox(null);
      return;
    }
    measure();
  }, [measure, hidden, document, actions, canvasFrame, postBox]);

  /*
   * Re-measure when the block changes size for a reason no render reports — an
   * image finishing, a webfont swapping, the panels being resized around the
   * canvas. Without this the bar sits at the position the block had while it
   * was still loading, which is the state most pages spend their first second
   * in.
   */
  React.useEffect(() => {
    if (hidden || selectedId === null) return;
    const element = bar.current;
    const root =
      element === null
        ? null
        : (overlaySpaceOf(element, CANVAS_ROOT_CLASS)?.root ?? null);
    if (root === null) return;
    // Absent in jsdom unless a test supplies one, and absent in older browsers.
    // A missing observer costs a re-measure, not correctness — every render
    // path above still measures. Built from the canvas root's window, the
    // realm of the blocks it observes, which is a frame's when the canvas is in
    // one.
    const Sizes = root.ownerDocument.defaultView?.ResizeObserver;
    if (typeof Sizes !== "function") return;
    const observer = new Sizes(() => measure());

    /*
     * EVERY selected block, not only the primary.
     *
     * The bar is anchored to the union of them all, so any one of them changing
     * size moves where it belongs. Watching the primary alone would leave the
     * bar stale whenever a secondary block reflowed — which is most of what
     * happens while an image loads or a webfont swaps.
     */
    // The very elements the bar is placed against, so a placement's later
    // part resizing on its own (an image arriving, a font swapping) is heard.
    for (const part of measuredPartsOf(root, selectedIds)) {
      observer.observe(part);
    }
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure, hidden, selectedId, selectedIds, document, canvasFrame]);

  /*
   * And when the canvas scrolls, or the part of it on screen resizes. The
   * block does not move in the canvas's own coordinates, but what of it is on
   * screen does, and the bar keeps to that: a tall block scrolled past its top
   * takes its bar to the screen's top, and a window made too short for the
   * bar under a block moves it there too. The scrolls heard are the ones the
   * screen band is read from (`watchScreenBand`), the host's scroller
   * around a zoomed frame among them, so what is heard and what is measured
   * cannot be two different sets.
   */
  React.useEffect(() => {
    if (hidden || selectedId === null) return;
    const element = bar.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) return;
    return watchScreenBand(space.root, space.frame, measure);
  }, [measure, hidden, selectedId, canvasFrame]);

  const hovered = useHoveredBlock();

  useScrollClearance(bar, hidden, placement, canvasFrame);
  const typingAside = useTypingAside(
    bar,
    placement?.side === "inside",
    selectedIds,
    canvasFrame,
    !hidden && actions.length > 0
  );

  /*
   * After a press that takes its own button away (Unlock, Select it), focus
   * goes to the bar's stop rather than to nothing, so a keyboard author keeps
   * their place in the bar.
   */
  const keepFocus = React.useCallback(() => {
    const element = bar.current;
    if (element === null) return;
    if (!element.contains(element.ownerDocument.activeElement)) return;
    element.ownerDocument.defaultView?.requestAnimationFrame(() => {
      bar.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    });
  }, []);
  const unlock = React.useCallback(
    (id: string) => {
      keepFocus();
      // The op Layers' padlock applies, through the store's one apply, so it
      // is one edit undo takes back.
      editor.apply(lockOp(id, false));
    },
    [editor, keepFocus]
  );
  const selectHolder = React.useCallback(
    (id: string) => {
      keepFocus();
      editor.select(id);
    },
    [editor, keepFocus]
  );

  const focusAt = React.useCallback((index: number) => {
    setActiveIndex(index);
    const buttons = bar.current?.querySelectorAll("button");
    const target = buttons?.[index];
    if (isHTMLElement(target)) target.focus();
  }, []);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const count = stops;
      if (count === 0) return;
      // Wrapping, which the toolbar pattern lists as the common choice: the bar
      // is five buttons, and stopping at the ends makes reaching Delete from
      // Select parent four presses instead of one.
      if (event.key === "ArrowRight") {
        focusAt((stop + 1) % count);
      } else if (event.key === "ArrowLeft") {
        focusAt((stop - 1 + count) % count);
      } else if (event.key === "Home") {
        focusAt(0);
      } else if (event.key === "End") {
        focusAt(count - 1);
      } else {
        return;
      }
      // Only for the keys handled above. Returning first leaves Tab, Escape and
      // every shortcut the shell binds to reach their own handlers.
      event.preventDefault();
    },
    [stops, stop, focusAt]
  );

  /*
   * A press is passed on WHATEVER the action's availability says.
   *
   * Every verb already refuses what it cannot do — a first block will not move
   * up, a locked one will not be deleted — so a guard here would refuse a
   * second time and could only ever disagree with the first. It would also cost
   * something real: a lock refusal ANNOUNCES itself, so a dimmed Delete pressed
   * by a keyboard author says "Caption is locked. Unlock it to delete it."
   * rather than nothing at all. That sentence is the reason the button stays
   * pressable, and swallowing the press here would take it away.
   */
  // The SHARED runner map, not a second one.
  //
  // 🔴 The dispatch here was a chain of `else if` ending in a bare `else
  // verbs.delete()`, so a verb added to `ToolbarActionId` and not wired did not
  // fail to compile — it fell through and DELETED the block the author had
  // selected. Measured: adding an id makes `ICONS` fail with TS2741 and left
  // the dispatch silent, so the compiler pointed at the icon, a developer
  // supplied one, and the new button then deleted things.
  //
  // Taken from `blockActionRunners` rather than written again here. A second
  // exhaustive record makes the compiler demand an entry in BOTH and prove
  // nothing about the two agreeing — this bar could be wired to a different
  // verb than the palette and the context menu, which is the drift the
  // exhaustiveness was added to prevent, one level up.
  const perform = React.useMemo(() => blockActionRunners(verbs), [verbs]);

  const run = React.useCallback(
    (action: ToolbarAction) => {
      perform[action.id]();
    },
    [perform]
  );

  if (hidden || actions.length === 0) return null;

  // Faded while the pointer is over another block: the bar sits over the
  // block above the selection, which would otherwise be covered while the
  // author points at it. Faded, not removed, so a pointer heading for the bar
  // still reaches its buttons, and reaching them is pointing at chrome, which
  // lets the hovered block go.
  const faded = fadedAside(hovered, selectedIds, {
    inside: placement?.side === "inside",
    document,
  });

  return (
    <div
      ref={bar}
      className={BLOCK_TOOLBAR_CLASS}
      // Marked as chrome so a press here is not read as a click on the page
      // background, which would clear the very selection this bar acts on.
      {...{ [CHROME_ATTRIBUTE]: "" }}
      role="toolbar"
      aria-orientation="horizontal"
      aria-label="Block actions"
      data-side={placement?.side}
      {...faded}
      {...typingMark(typingAside)}
      // Kept out of sight rather than unmounted until the first measurement.
      // The bar has to be in the DOM to be measured at all, and mounting it at
      // a default position would show it in the wrong place for one frame.
      style={
        placement === null
          ? { visibility: "hidden" }
          : { left: placement.x, top: placement.y }
      }
      onKeyDown={onKeyDown}
    >
      <BarLockControl
        lock={lock}
        active={stop === 0}
        onFocus={() => setActiveIndex(0)}
        onUnlock={unlock}
        onSelect={selectHolder}
      />
      {buttons.map((action, index) => {
        const Icon = ICONS[action.id];
        const describedBy =
          action.reason === undefined
            ? undefined
            : `nx-toolbar-reason-${action.id}`;
        return (
          <button
            key={action.id}
            type="button"
            className="nx-block-toolbar__button"
            // The name is the verb alone. Voice control activates a control by
            // its name, so folding the reason into it would make "click delete"
            // stop matching the button called Delete.
            aria-label={action.label}
            aria-disabled={action.enabled ? undefined : true}
            aria-describedby={describedBy}
            /*
             * The description twice over: `title` for a pointer, and a hidden
             * span for anything that reads the accessible description. `title`
             * alone never reaches a keyboard author, who is exactly the person
             * the reason is for.
             *
             * No keystroke hint here yet. A binding spelled `mod` resolves to
             * Command on Apple platforms and Control everywhere else, so any
             * fixed string is wrong on one of them and "Ctrl+D" on a Mac
             * teaches a keystroke that does nothing.
             *
             * That is answerable now — `detectApplePlatform` is on
             * `@nextlyhq/ui`'s public entry, and `key-hint.ts` spells a binding
             * for the platform in hand. What is missing is the other half: the
             * bar knows an action id, and the id alone does not say which
             * binding runs it. The moves come from one table and the rest from
             * the keystroke registrations, so a hint here needs those joined
             * without writing a third list that can disagree with both.
             */
            title={action.reason ?? action.label}
            tabIndex={lead + index === stop ? 0 : -1}
            onFocus={() => setActiveIndex(lead + index)}
            onClick={() => run(action)}
          >
            <Icon size={16} aria-hidden="true" />
            {describedBy === undefined ? null : (
              <span id={describedBy} className="nx-sr-only">
                {action.reason}
              </span>
            )}
          </button>
        );
      })}
      {menu.length === 0 ? null : (
        <MoreMenu
          editor={editor}
          actions={menu}
          index={lead + buttons.length}
          activeIndex={stop}
          onFocus={setActiveIndex}
          run={run}
        />
      )}
    </div>
  );
}

/**
 * The bar's first stop on a locked block: Unlock where the author may lift
 * the lock; Locked, dimmed with the reason, where they may not; and for a
 * block inside a locked one, the block that holds it with "Select it".
 */
function BarLockControl({
  lock,
  active,
  onFocus,
  onUnlock,
  onSelect,
}: {
  lock: BarLock | undefined;
  active: boolean;
  onFocus: () => void;
  onUnlock: (id: string) => void;
  onSelect: (id: string) => void;
}): React.JSX.Element | null {
  const stop = { tabIndex: active ? 0 : -1, onFocus };
  // One editor's reason apart from another's, where two are on one page.
  const reasonId = React.useId();
  if (lock === undefined) return null;
  if (lock.kind === "unlock") {
    return (
      <button
        type="button"
        className="nx-block-toolbar__lock-button"
        {...stop}
        onClick={() => onUnlock(lock.id)}
      >
        <LockOpen size={14} aria-hidden="true" />
        Unlock
      </button>
    );
  }
  if (lock.kind === "held") {
    // Dimmed but reachable, as the bar's other unavailable verbs are, so the
    // reason reaches a keyboard author as well as a pointer.
    return (
      <button
        type="button"
        className="nx-block-toolbar__lock-button"
        // The name is the word alone, as the other buttons' are; the reason
        // is the description.
        aria-label="Locked"
        aria-disabled={true}
        aria-describedby={reasonId}
        title={lock.reason}
        {...stop}
      >
        <Lock size={14} aria-hidden="true" />
        Locked
        <span id={reasonId} className="nx-sr-only">
          {lock.reason}
        </span>
      </button>
    );
  }
  return (
    <span className="nx-block-toolbar__lock" data-lock-note="">
      <Lock size={12} aria-hidden="true" />
      Locked by {lock.name}
      {" · "}
      <button
        type="button"
        className="nx-block-toolbar__lock-select"
        title={`Select ${lock.name}`}
        {...stop}
        onClick={() => onSelect(lock.id)}
      >
        Select it
      </button>
    </span>
  );
}

/**
 * The bar's last stop: the verbs kept behind "More", each with its reason
 * when it may not run. The reason is visible text, as in the context menu,
 * since a disabled menu item takes no focus and a tooltip would reach nobody.
 *
 * `actions` are the bar's, which ask the locks nothing; the items are drawn
 * from the same verbs with the locks asked, once the menu opens.
 */
function MoreMenu({
  editor,
  actions,
  index,
  activeIndex,
  onFocus,
  run,
}: {
  editor: EditorState;
  actions: readonly ToolbarAction[];
  index: number;
  activeIndex: number;
  onFocus: (index: number) => void;
  run: (action: ToolbarAction) => void;
}): React.JSX.Element {
  return (
    // Not modal, as the block's other menus: a modal menu marks the editor
    // around it aria-hidden while its controls stay focusable.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-block-toolbar__button"
          aria-label="More actions"
          title="More actions"
          tabIndex={index === activeIndex ? 0 : -1}
          onFocus={() => onFocus(index)}
        >
          <Ellipsis size={16} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="nx-block-toolbar__menu"
        // Chrome, so a press inside is not read as a click on the page.
        {...{ [CHROME_ATTRIBUTE]: "" }}
      >
        <MoreMenuItems editor={editor} shown={actions} run={run} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The "More" menu's items, drawn only while it is open: each of the bar's
 * menu verbs as the locks answer it, so a lock is asked when the author can
 * act on its answer and not on every selection.
 */
function MoreMenuItems({
  editor,
  shown,
  run,
}: {
  editor: EditorState;
  shown: readonly ToolbarAction[];
  run: (action: ToolbarAction) => void;
}): React.JSX.Element {
  const asked = useSelectionActions(editor, true);
  const items = React.useMemo(
    () => asked.filter(action => shown.some(each => each.id === action.id)),
    [asked, shown]
  );
  return (
    <>
      {items.map(action => {
        const Icon = ICONS[action.id];
        return (
          <DropdownMenuItem
            key={action.id}
            disabled={!action.enabled}
            className="nx-block-toolbar__menu-item"
            onSelect={() => run(action)}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="nx-block-toolbar__menu-text">
              <span>{action.label}</span>
              {action.reason === undefined ? null : (
                <span className="nx-block-toolbar__menu-reason">
                  {action.reason}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
