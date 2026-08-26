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

import { useCallback, useEffect, useRef, useState } from "react";

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
}

export function PreviewSplit({
  open,
  children,
  preview,
  label,
}: PreviewSplitProps) {
  const [editorPercent, setEditorPercent] = useState(DEFAULT_EDITOR_PERCENT);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

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
      if (!dragging.current) return;
      // The drag owns the pointer while it lasts: without this the browser
      // selects text across the editor as the divider passes over it.
      event.preventDefault();
      moveTo(event.clientX);
    };
    const onUp = () => {
      dragging.current = false;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [open, moveTo]);

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
              : 0;
    if (step === 0) return;
    // Only once a key is one this handles: otherwise Tab and the shortcuts the
    // editor registers would be swallowed by a divider that happens to be
    // focused.
    event.preventDefault();
    setEditorPercent(current => clamp(current + step));
  };

  return (
    /*
     * `contents` while closed is the load-bearing part. The element stays in
     * the tree — which is what keeps the editor mounted — and generates no box,
     * so the page lays out exactly as it does with no pane at all.
     */
    <div
      ref={container}
      className={cn(open ? "flex min-h-0 flex-1" : "contents")}
      data-preview-split={open ? "open" : "closed"}
    >
      <div
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
            aria-label={`Resize the ${label} pane`}
            aria-valuenow={editorPercent}
            aria-valuemin={MIN_EDITOR_PERCENT}
            aria-valuemax={MAX_EDITOR_PERCENT}
            tabIndex={0}
            onPointerDown={event => {
              dragging.current = true;
              // Captured so the drag survives the pointer leaving a one-pixel
              // target, which it does on the first move.
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              // The drawn line is 1px; the element around it is wider and
              // transparent, so the pointer target is comfortably larger than
              // what it appears to grab (WCAG 2.5.8).
              "relative flex w-px shrink-0 cursor-col-resize items-center justify-center bg-border",
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

          <div className="min-w-0 flex-1">{preview}</div>
        </>
      )}
    </div>
  );
}
