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

import {
  ArrowDown,
  ArrowUp,
  Copy,
  CornerLeftUp,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { CANVAS_ROOT_CLASS, CHROME_ATTRIBUTE, nodeElement } from "./canvas";
import type { EditorState } from "./editor-state";
import type { Rect } from "./geometry";
import { canvasContentRect } from "./geometry-dom";
import { useBlockActionsContext } from "./keyboard-actions";
import {
  toolbarActions,
  toolbarPlacement,
  unionRect,
  type ToolbarAction,
  type ToolbarActionId,
  type ToolbarPlacement,
} from "./toolbar-actions";

const ICONS: Record<ToolbarActionId, LucideIcon> = {
  "select-parent": CornerLeftUp,
  "move-up": ArrowUp,
  "move-down": ArrowDown,
  duplicate: Copy,
  delete: Trash2,
};

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
  const [placement, setPlacement] = React.useState<ToolbarPlacement | null>(
    null
  );

  const { document, selectedId } = editor;
  const selectedIds = editor.selection.ids;
  const actions = React.useMemo(
    () => toolbarActions(document, selectedId, selectedIds),
    [document, selectedId, selectedIds]
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
    if (element !== null && element.contains(window.document.activeElement)) {
      return;
    }
    setActiveIndex(0);
  }, [selectedId]);

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
      setPlacement(null);
      return;
    }
    const root = element.closest(`.${CANVAS_ROOT_CLASS}`);
    if (!(root instanceof HTMLElement)) {
      setPlacement(null);
      return;
    }
    /*
     * Anchored to the UNION of everything selected, not to the primary.
     *
     * With two blocks selected at opposite ends of a page, a bar drawn at one
     * of them describes an action about to happen to the other, which the
     * author cannot see. The union is the shape the selection occupies.
     */
    const rects: Rect[] = [];
    for (const id of selectedIds) {
      const element = nodeElement(root, id);
      if (element !== null) rects.push(canvasContentRect(element, root));
    }
    const block = unionRect(rects);
    if (block === undefined) {
      setPlacement(null);
      return;
    }
    // The bar's own size, through the same measurement the block goes through.
    // Its position is discarded — what is wanted is width and height — but a
    // second way of reading a rectangle is exactly what `geometry-dom` exists
    // to prevent, and a bar measured one way against a block measured another
    // is a disagreement that only shows up at a scroll offset.
    const size = canvasContentRect(element, root);
    setPlacement(
      toolbarPlacement(
        block,
        { width: size.width, height: size.height },
        // The root's own box rather than its scroll extent. `scrollWidth` and
        // `scrollHeight` are the CONTENT's size, so a long page would report a
        // height of several thousand and the clamp would let the bar sit far
        // outside what the author can see.
        canvasContentRect(root, root)
      )
    );
  }, [selectedId, selectedIds]);

  React.useLayoutEffect(() => {
    if (hidden) return;
    measure();
  }, [measure, hidden, document, actions]);

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
    const root = element?.closest(`.${CANVAS_ROOT_CLASS}`);
    if (!(root instanceof HTMLElement)) return;
    // Absent in jsdom unless a test supplies one, and absent in older browsers.
    // A missing observer costs a re-measure, not correctness — every render
    // path above still measures.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());

    /*
     * EVERY selected block, not only the primary.
     *
     * The bar is anchored to the union of them all, so any one of them changing
     * size moves where it belongs. Watching the primary alone would leave the
     * bar stale whenever a secondary block reflowed — which is most of what
     * happens while an image loads or a webfont swaps.
     */
    for (const id of selectedIds) {
      const block = nodeElement(root, id);
      if (block !== null) observer.observe(block);
    }
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure, hidden, selectedId, selectedIds, document]);

  const focusAt = React.useCallback((index: number) => {
    setActiveIndex(index);
    const buttons = bar.current?.querySelectorAll("button");
    const target = buttons?.[index];
    if (target instanceof HTMLElement) target.focus();
  }, []);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const count = actions.length;
      if (count === 0) return;
      // Wrapping, which the toolbar pattern lists as the common choice: the bar
      // is five buttons, and stopping at the ends makes reaching Delete from
      // Select parent four presses instead of one.
      if (event.key === "ArrowRight") {
        focusAt((activeIndex + 1) % count);
      } else if (event.key === "ArrowLeft") {
        focusAt((activeIndex - 1 + count) % count);
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
    [actions.length, activeIndex, focusAt]
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
  const run = React.useCallback(
    (action: ToolbarAction) => {
      if (action.id === "select-parent") verbs.selectParent();
      else if (action.id === "move-up") verbs.move("up");
      else if (action.id === "move-down") verbs.move("down");
      else if (action.id === "duplicate") verbs.duplicate();
      else verbs.delete();
    },
    [verbs]
  );

  if (hidden || actions.length === 0) return null;

  return (
    <div
      ref={bar}
      className="nx-block-toolbar"
      // Marked as chrome so a press here is not read as a click on the page
      // background, which would clear the very selection this bar acts on.
      {...{ [CHROME_ATTRIBUTE]: "" }}
      role="toolbar"
      aria-orientation="horizontal"
      aria-label="Block actions"
      data-side={placement?.side}
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
      {actions.map((action, index) => {
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
             * No keystroke hint, deliberately. Every binding here is spelled
             * `mod`, which the shortcut manager resolves to Command on Apple
             * platforms and Control everywhere else — so any fixed string is
             * wrong on one of them, and "Ctrl+D" on a Mac teaches a keystroke
             * that does nothing. The manager's own `detectApplePlatform` is the
             * one rule that answers this, and it is not on `@nextlyhq/ui`'s
             * public entry; spelling the platform a second time here would let
             * a tooltip disagree with the binding it describes. The hint
             * returns when that export does.
             */
            title={action.reason ?? action.label}
            tabIndex={index === activeIndex ? 0 : -1}
            onFocus={() => setActiveIndex(index)}
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
    </div>
  );
}
