"use client";

/**
 * A two-pane split that generates NO BOXES while it is closed.
 *
 * The editor lives at ONE position in the tree whether the preview is open or
 * shut, and that is the whole reason this exists rather than a
 * `ResizablePanelGroup`. React preserves component state by position, so a pane
 * that wrapped the editor only when open unmounted the entire editor on every
 * toggle — losing anything a field held that had not reached the form. A field
 * keeping a temporarily invalid value locally, exactly so it does NOT publish
 * nonsense to the form, is the case that hurts: the work looks saved and is
 * silently discarded by clicking Preview.
 *
 * The panel library cannot do this. It writes `display: flex`, `overflow:
 * hidden` and the flex sizing as INLINE styles, so a panel wrapping the editor
 * while closed would clip it and move scrolling off the page — and no class can
 * override an inline style. These are plain elements, so `display: contents`
 * works: closed, they contribute nothing to layout and the editor is laid out
 * by whatever encloses the pane, exactly as it was before. That is the same
 * mechanism `MeasuredPageFrame` already uses to release the page measure.
 *
 * @module components/features/entries/PreviewMode/PreviewSplit
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { GripVertical } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

/**
 * How much of the width the EDITOR may take, as a percentage.
 *
 * The bounds are the pane's, not a preference: below the minimum the editor's
 * own two-column layout has nowhere to put the document rail, and above the
 * maximum the preview is too narrow to show a page as a visitor would see it —
 * which is the only reason to have it on screen.
 */
const MIN_EDITOR_PERCENT = 35;
const MAX_EDITOR_PERCENT = 75;
const DEFAULT_EDITOR_PERCENT = 55;

/** How far one arrow-key press moves the divider. */
const KEYBOARD_STEP_PERCENT = 2;

function clamp(percent: number): number {
  return Math.min(
    MAX_EDITOR_PERCENT,
    Math.max(MIN_EDITOR_PERCENT, Math.round(percent))
  );
}

export interface PreviewSplitProps {
  /** Whether the preview side is shown. Closed, this renders nothing of its own. */
  open: boolean;
  /** The editor. Mounted at the same position in both states. */
  children: React.ReactNode;
  /** The preview side, rendered only while open. */
  preview: React.ReactNode;
  /** Names the divider for assistive technology. */
  label: string;
  /**
   * A viewport width the preview would like room for, or `null` for none.
   *
   * The split does not size the frame — it only stops standing in the way. When
   * a width is asked for, the preview takes as much of the split as the minimum
   * editor allows; whatever still does not fit is the frame's to scale. Giving
   * the room first is what keeps the scaling as small as it can be, and on a
   * wide enough window removes it entirely.
   */
  preferPreviewWidth?: number | null;
}

export function PreviewSplit({
  open,
  children,
  preview,
  label,
  preferPreviewWidth = null,
}: PreviewSplitProps) {
  /*
   * Generated rather than fixed: the id is what `aria-controls` points at, and
   * two splits on one page sharing a literal would aim both separators at the
   * first pane.
   */
  const editorPaneId = useId();
  const [editorPercent, setEditorPercent] = useState(DEFAULT_EDITOR_PERCENT);
  const container = useRef<HTMLDivElement>(null);
  /*
   * WHICH pointer is dragging, not whether one is.
   *
   * A boolean is set by every pointer and cleared by every release, so a
   * right-click resizes while opening a context menu, and during multi-touch a
   * second finger steers the divider and its release ends the first finger's
   * drag.
   */
  const dragPointer = useRef<number | null>(null);

  const moveTo = useCallback((clientX: number) => {
    const element = container.current;
    if (element === null) return;
    const bounds = element.getBoundingClientRect();
    // A zero-width container yields Infinity rather than a percentage, which
    // would clamp to the maximum and jump the divider on the first pointer move
    // after a layout that has not settled.
    if (bounds.width === 0) return;
    setEditorPercent(clamp(((clientX - bounds.left) / bounds.width) * 100));
  }, []);

  /*
   * Listeners on the WINDOW rather than the divider, and only while dragging.
   *
   * A pointer that leaves the divider mid-drag — which it does immediately, the
   * divider being one pixel wide — would otherwise stop delivering moves and
   * strand the split under the cursor. Bound on drag start and removed on
   * release, so nothing listens while nobody is dragging.
   */
  useEffect(() => {
    if (!open) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== dragPointer.current) return;
      // The drag owns the pointer while it lasts: without this the browser
      // selects text across the editor as the divider passes over it.
      event.preventDefault();
      moveTo(event.clientX);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== dragPointer.current) return;
      dragPointer.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      /*
       * The owner is released with the listeners that would have released it.
       * This component stays mounted while closed, so a pane closed mid-gesture
       * — a second touch on the frame's close control, an entry switching into
       * translation mode — otherwise leaves the ref holding a pointer whose
       * `pointerup` nothing is listening for any more, and the guard in
       * `onPointerDown` then refuses every press for the life of the editor.
       */
      dragPointer.current = null;
    };
  }, [open, moveTo]);

  /*
   * Asking for a width takes the room the split can give before anything is
   * scaled. Clamped to the minimum EDITOR rather than to zero: the editor is
   * what the author is typing into, and a preview that swallowed it would trade
   * one unusable pane for another.
   *
   * Deliberately not restored when the request clears. Returning to the default
   * split would undo a divider the author may have dragged since, and the split
   * is theirs — this only ever moves it on an explicit request.
   */
  useEffect(() => {
    if (preferPreviewWidth === null) return;
    setEditorPercent(MIN_EDITOR_PERCENT);
  }, [preferPreviewWidth]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step =
      event.key === "ArrowLeft"
        ? -KEYBOARD_STEP_PERCENT
        : event.key === "ArrowRight"
          ? KEYBOARD_STEP_PERCENT
          : event.key === "Home"
            ? MIN_EDITOR_PERCENT - editorPercent
            : event.key === "End"
              ? MAX_EDITOR_PERCENT - editorPercent
              : undefined;

    // `undefined` is the only pass-through, and the distinction is the point:
    // Tab and the shortcuts the editor registers must survive a focused
    // divider, while a key this DOES handle is cancelled even when it moves
    // nothing. Home at the minimum computes a zero step, and letting that reach
    // the browser scrolls the page from a control advertising itself as the
    // resizer — at exactly the position where pressing it again is most likely.
    if (step === undefined) return;
    event.preventDefault();
    if (step === 0) return;
    setEditorPercent(current => clamp(current + step));
  };

  return (
    /*
     * Staying in the tree while closed is the load-bearing part: the element is
     * what keeps the editor mounted across a toggle.
     *
     * It keeps a BOX while closed, and that is not incidental. This is a direct
     * child of `.nx-page-shell`, whose `> *` rule places children in the
     * content column; a `display: contents` child generates no box for that
     * rule to apply to and promotes ITS children into the grid, where they match
     * no selector and auto-place from the gutter. `PageShell` warns about this
     * exact shape and states the remedy — give the child a box, or move
     * `display: contents` inside it. Both are done: the box is here and the
     * boxlessness is one level down.
     *
     * A bare block box is layout-neutral here. The shell declares no row gap,
     * so the editor's own children flowing inside one grid item occupy the same
     * space they did as several.
     *
     * Open, `h-full` is what the panel group used to supply. The page frame is
     * suppressed then, so `PageShell` is itself `display: contents` and this
     * root is a block child of the dashboard's `<main>` rather than a flex
     * item — `flex-1` has nothing to grow against, and without a definite
     * height the split grows to the editor's content, `overflow-y-auto` never
     * becomes a pane scroller, and the preview toolbar scrolls away with the
     * page.
     */
    <div
      ref={container}
      className={cn(open && "flex h-full min-h-0 flex-1")}
      data-preview-split={open ? "open" : "closed"}
    >
      <div
        id={editorPaneId}
        className={cn(
          open
            ? "@container/content min-w-0 overflow-y-auto"
            : // Same reason as the parent: no box, no effect on the page.
              "contents"
        )}
        style={open ? { width: `${editorPercent}%` } : undefined}
      >
        {/* The pane stands in for `PageContainer`, so it owes the same
            horizontal inset — and stops owing it where the editor's own columns
            go edge to edge. On an INNER element because a container cannot
            query itself. */}
        <div
          className={cn(
            open
              ? "px-4 @sm/content:px-6 @2xl/content:px-8 @4xl/content:px-0"
              : "contents"
          )}
        >
          {children}
        </div>
      </div>

      {open && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            /*
             * The name and the value describe the SAME pane. `aria-valuenow`
             * on a window splitter reports the primary pane — the editor, here
             * — so a name mentioning only the preview announced 55% for a pane
             * occupying 45%, and made ArrowRight read as growing the pane it
             * shrinks. `aria-valuetext` gives both figures so neither number
             * can be attached to the wrong side.
             */
            aria-label={`Resize the editor and ${label} panes`}
            // Names the region the value measures. Without it the separator
            // exposes a changing number and no way to tell what it is about.
            aria-controls={editorPaneId}
            aria-valuenow={editorPercent}
            aria-valuetext={`Editor ${Math.round(editorPercent)}%, ${label} ${Math.round(100 - editorPercent)}%`}
            aria-valuemin={MIN_EDITOR_PERCENT}
            aria-valuemax={MAX_EDITOR_PERCENT}
            tabIndex={0}
            onPointerDown={event => {
              // The primary button only, and only while no drag owns the
              // divider: a right-click must open its menu without resizing,
              // and a second finger must not take the split from the first.
              if (event.button !== 0 || dragPointer.current !== null) return;
              dragPointer.current = event.pointerId;
              // Captured so the drag survives the pointer leaving a one-pixel
              // target, which it does on the first move.
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              // The drawn line is 1px; the element around it is wider and
              // transparent, so the pointer target is comfortably larger than
              // what it appears to grab (WCAG 2.5.8).
              // `touch-none` reserves the gesture. Pointer capture and
              // `preventDefault` in `pointermove` do not: the browser may
              // claim a horizontal drag as panning and answer with
              // `pointercancel` before the split has moved.
              "relative flex w-px shrink-0 touch-none cursor-col-resize items-center justify-center bg-border",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "after:absolute after:inset-0 after:-inset-x-1"
            )}
          >
            <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-border">
              <GripVertical
                className="h-2.5 w-2.5 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </div>

          {/* `min-w-0` lets this flex item shrink; it does not clip what is
              inside it. At the narrowest allowed width the toolbar's buttons
              are wider than the pane, and without this they paint across the
              divider or widen the page's own scroller. Only the OPEN pane — the
              closed wrappers generate no box to clip against. */}
          <div className="min-w-0 flex-1 overflow-hidden">{preview}</div>
        </>
      )}
    </div>
  );
}
