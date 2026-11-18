"use client";

/**
 * The handles at the canvas frame's two edges that preview the page at any
 * width, the ruler of breakpoint starts above it, the line saying which
 * device is still being edited, and the announcement once a width settles.
 *
 * Drawn inside the frame's box (`canvas-frame.tsx`), so the handles sit at
 * its edges as it grows and shrinks, and in the well beside a frame narrower
 * than the region.
 *
 * **No render of the page per pixel.** A drag writes the width straight to
 * the frame's box and its page, once per animation frame, at the scale the
 * drag started at; the page re-lays itself out in its frame while nothing in
 * React runs. The host hears the width once, on release, and only then lays
 * the frame out at it and fits it to the region again.
 *
 * **Never a device.** The width is the host's session state and goes back to
 * the device's own on Reset, a device press or a page switch. Every edit
 * still goes to the device being edited, which the line under the frame and
 * the announcement name.
 *
 * @module canvas-preview-width-edges
 */

import type { BreakpointId, BreakpointSet } from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  deviceLabelOf,
  draggedPaintedWidth,
  keyedPreviewWidth,
  previewAnnouncement,
  previewNotice,
  previewValueText,
  rulerMarks,
  snappedPreviewWidth,
} from "./canvas-preview-width";
import { clampPreviewWidth, previewWidthRange } from "./canvas-width";
import { CANVAS_FRAME_BOX_ATTRIBUTE } from "./geometry-dom";

/**
 * What the host gives the frame to preview widths with: the site's
 * breakpoints, the device being edited and its own width, the width the
 * author previews at (`null` for the device's own), and where a new one goes.
 *
 * @experimental
 */
export interface PreviewWidthControl {
  readonly breakpoints: BreakpointSet | undefined;
  /** The breakpoint every edit goes to, whatever the width shown. */
  readonly edited: BreakpointId;
  /** The width the device being edited is laid out at. */
  readonly deviceWidth: number;
  /** The width previewed instead, or `null` for the device's own. */
  readonly override: number | null;
  /** Told a settled width, `null` once it is the device's own again. */
  readonly onChange: (width: number | null) => void;
}

/** How long after the last key the settled width is announced. */
export const ANNOUNCE_AFTER_KEYS_MS = 500;

/**
 * The room beside the frame the handles need to sit in the well, clear of the
 * panels' dividers at the region's edges; with less, as on a Desktop frame
 * that fills the region, they sit just inside its edges and show on hover or
 * focus.
 */
const HANDLE_ROOM = 24;

/** The page's element in the frame's box, which a drag lays out directly. */
const FRAME_PAGE_SELECTOR = ".nx-canvas-frame__page";

/** A drag in progress, held outside React so moving it renders nothing. */
interface Drag {
  readonly pointerId: number;
  /** +1 for the right handle, -1 for the left, which widens moving left. */
  readonly side: 1 | -1;
  readonly startX: number;
  readonly startWidth: number;
  /** The scale the frame is painted at, held for the whole drag. */
  readonly scale: number;
  /** The region's width the frame is centred in, or 0 unmeasured. */
  readonly region: number;
  readonly box: HTMLElement | null;
  readonly page: HTMLElement | null;
  /**
   * The widths the host last drew the box and its page at, put back as the
   * drag ends: the host draws the settled width over them where it differs,
   * and a fitted box the same width before and after is not drawn again.
   */
  readonly drawn: { readonly box: string; readonly page: string };
  width: number;
  frameRequest: number | null;
}

/** The box and its page as the host drew them, before a drag wrote over them. */
function giveBack(held: Drag): void {
  if (held.box !== null) held.box.style.width = held.drawn.box;
  if (held.page !== null) {
    held.page.style.width = held.drawn.page;
    held.page.style.pointerEvents = "";
  }
}

/**
 * Whether the well beside the frame has room for the handles, written to the
 * edges' root as an attribute the stylesheet places them by.
 */
function placeHandles(root: HTMLElement | null): void {
  const box = root?.closest<HTMLElement>(`[${CANVAS_FRAME_BOX_ATTRIBUTE}]`);
  const stage = box?.parentElement;
  if (root == null || box == null || stage == null) return;
  // The frame is centred in the stage by its auto margins, so the room on
  // each side is half of what it leaves. Layout sizes, not rectangles: this
  // is a question about the editor's own document, never across the frame.
  const beside = (stage.clientWidth - box.offsetWidth) / 2;
  root.setAttribute(
    "data-handles",
    beside >= HANDLE_ROOM ? "beside" : "inside"
  );
}

/**
 * The handles, the ruler, the line under the frame and the live region, for
 * a frame laid out at `width` and painted at `scale`; nothing where the host
 * previews no other width.
 *
 * @experimental
 */
export function PreviewWidthEdges({
  control,
  width,
  scale,
  onDragging,
}: {
  control: PreviewWidthControl | undefined;
  width: number;
  scale: number;
  /**
   * Told when a drag starts and ends, so the frame holds back what it reads
   * off the page's resizing until the width settles.
   */
  onDragging?: (active: boolean) => void;
}): React.JSX.Element | null {
  if (control === undefined) return null;
  return (
    <Edges
      control={control}
      width={width}
      scale={scale}
      onDragging={onDragging}
    />
  );
}

/** {@link PreviewWidthEdges}, for a host that previews other widths. */
function Edges({
  control,
  width,
  scale,
  onDragging,
}: {
  control: PreviewWidthControl;
  width: number;
  scale: number;
  onDragging: ((active: boolean) => void) | undefined;
}): React.JSX.Element {
  const { breakpoints, edited, deviceWidth, override, onChange } = control;
  const marks = React.useMemo(() => rulerMarks(breakpoints), [breakpoints]);
  const range = React.useMemo(
    () => previewWidthRange(breakpoints),
    [breakpoints]
  );
  const device = deviceLabelOf(breakpoints, edited);
  const root = React.useRef<HTMLDivElement | null>(null);
  const readout = React.useRef<HTMLSpanElement | null>(null);
  const drag = React.useRef<Drag | null>(null);
  const keyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [announced, setAnnounced] = React.useState("");

  // Where the handles sit, again whenever the frame or the region resizes.
  React.useLayoutEffect(() => {
    const element = root.current;
    placeHandles(element);
    const box = element?.closest(`[${CANVAS_FRAME_BOX_ATTRIBUTE}]`);
    const view = element?.ownerDocument.defaultView;
    if (
      box == null ||
      view == null ||
      typeof view.ResizeObserver !== "function"
    ) {
      return;
    }
    const sizes = new view.ResizeObserver(() => placeHandles(element));
    sizes.observe(box);
    if (box.parentElement !== null) sizes.observe(box.parentElement);
    return () => sizes.disconnect();
  }, []);

  // A width keyed in for one device is not announced once another is edited.
  React.useEffect(
    () => () => {
      if (keyTimer.current !== null) clearTimeout(keyTimer.current);
      keyTimer.current = null;
    },
    [edited]
  );

  // The frame's latest listener, for a drag the handles' going cuts short.
  const draggingSeen = React.useRef(onDragging);
  draggingSeen.current = onDragging;
  // Nothing left waiting once the handles go, and a drag cut short gives
  // the page its pointer back and the frame its reads.
  React.useEffect(
    () => () => {
      if (keyTimer.current !== null) clearTimeout(keyTimer.current);
      const held = drag.current;
      drag.current = null;
      if (held === null) return;
      if (held.frameRequest !== null) {
        held.box?.ownerDocument.defaultView?.cancelAnimationFrame(
          held.frameRequest
        );
      }
      giveBack(held);
      draggingSeen.current?.(false);
    },
    []
  );

  /** Tells the host a width, as `null` where it is the device's own. */
  const settle = (next: number): number => {
    const settled = clampPreviewWidth(next, range);
    onChange(settled === deviceWidth ? null : settled);
    return settled;
  };

  /** Lays the frame out at a dragged width, straight to its elements. */
  const show = (held: Drag): void => {
    const shown = held.width;
    if (held.box !== null) {
      held.box.style.width = `${String(shown * held.scale)}px`;
    }
    if (held.page !== null) held.page.style.width = `${String(shown)}px`;
    root.current
      ?.querySelectorAll<HTMLElement>('[role="slider"]')
      .forEach(slider => {
        slider.setAttribute("aria-valuenow", String(shown));
        slider.setAttribute(
          "aria-valuetext",
          previewValueText(breakpoints, shown)
        );
      });
    if (readout.current !== null) {
      readout.current.textContent = `${String(shown)}px`;
      readout.current.style.left = `calc(50% + ${String((shown * held.scale) / 2)}px)`;
    }
    placeHandles(root.current);
  };

  const onPointerDown = (
    side: 1 | -1,
    event: React.PointerEvent<HTMLElement>
  ): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    // A drag overtakes a keyed width still waiting to be announced.
    if (keyTimer.current !== null) clearTimeout(keyTimer.current);
    keyTimer.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    const box =
      root.current?.closest<HTMLElement>(`[${CANVAS_FRAME_BOX_ATTRIBUTE}]`) ??
      null;
    const page = box?.querySelector<HTMLElement>(FRAME_PAGE_SELECTOR) ?? null;
    // The page takes no pointer while the handle is dragged across it.
    if (page !== null) page.style.pointerEvents = "none";
    drag.current = {
      pointerId: event.pointerId,
      side,
      startX: event.clientX,
      startWidth: width,
      scale,
      // The well's own width: the stage grows past it with a frame wider
      // than it, so the canvas region around it is what the frame centres
      // in. The stage's where the frame is drawn outside the shell.
      region:
        (box?.closest(".nx-canvas-scroller") ?? box?.parentElement)
          ?.clientWidth ?? 0,
      box,
      page,
      width,
      drawn: { box: box?.style.width ?? "", page: page?.style.width ?? "" },
      frameRequest: null,
    };
    setDragging(true);
    onDragging?.(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const held = drag.current;
    if (held === null || held.pointerId !== event.pointerId) return;
    // The edge dragged follows the pointer, both edges moving together while
    // the frame is centred, in the page's own pixels.
    const dragged =
      draggedPaintedWidth({
        side: held.side,
        start: held.startWidth * held.scale,
        region: held.region,
        travel: event.clientX - held.startX,
      }) / held.scale;
    held.width = snappedPreviewWidth(
      clampPreviewWidth(dragged, range),
      marks,
      held.scale
    );
    const view = root.current?.ownerDocument.defaultView;
    if (held.frameRequest !== null || view == null) return;
    held.frameRequest = view.requestAnimationFrame(() => {
      held.frameRequest = null;
      show(held);
    });
  };

  // Released, cancelled, or the capture lost without either: the drag
  // settles where it is.
  const onPointerEnd = (event: React.PointerEvent<HTMLElement>): void => {
    const held = drag.current;
    if (held === null || held.pointerId !== event.pointerId) return;
    drag.current = null;
    if (held.frameRequest !== null) {
      root.current?.ownerDocument.defaultView?.cancelAnimationFrame(
        held.frameRequest
      );
    }
    // The handles' values at the settled width, then the box and page back
    // to the host, which draws the settled width where it differs.
    show(held);
    giveBack(held);
    setDragging(false);
    // Before the width settles, so the frame reads the settled one.
    onDragging?.(false);
    if (keyTimer.current !== null) clearTimeout(keyTimer.current);
    setAnnounced(previewAnnouncement(settle(held.width), device));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    const next = keyedPreviewWidth(event, width, marks, range);
    if (next === undefined) return;
    event.preventDefault();
    const settled = settle(next);
    // Said once the keys stop, not on every press.
    if (keyTimer.current !== null) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => {
      keyTimer.current = null;
      setAnnounced(previewAnnouncement(settled, device));
    }, ANNOUNCE_AFTER_KEYS_MS);
  };

  const handle = (side: 1 | -1): React.JSX.Element => (
    <div
      role="slider"
      aria-label="Preview width"
      aria-orientation="horizontal"
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={width}
      aria-valuetext={previewValueText(breakpoints, width)}
      tabIndex={0}
      data-side={side === 1 ? "right" : "left"}
      className="nx-preview-width__handle"
      onPointerDown={event => onPointerDown(side, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      <span className="nx-preview-width__grip" aria-hidden="true" />
    </div>
  );

  return (
    <div
      ref={root}
      className="nx-preview-width"
      data-handles="inside"
      {...(dragging ? { "data-dragging": "" } : {})}
    >
      {dragging || override !== null ? (
        <PreviewRuler
          marks={marks}
          scale={scale}
          readout={readout}
          dragging={dragging}
        />
      ) : null}
      {handle(-1)}
      {handle(1)}
      {override === null ? null : (
        <p className="nx-preview-width__notice">
          {previewNotice(override, device)}
        </p>
      )}
      <span
        className="nx-sr-only"
        aria-live="polite"
        data-nx-preview-width-announcer=""
      >
        {announced}
      </span>
    </div>
  );
}

/**
 * The ruler over the top of the well: a tick at each breakpoint's start on
 * both sides of the frame's centre, where an edge at that width would be,
 * labelled on the right ("768 Tablet"). While dragging, the width dragged to
 * follows the right edge, written by the drag rather than rendered.
 */
function PreviewRuler({
  marks,
  scale,
  readout,
  dragging,
}: {
  marks: readonly { width: number; label: string }[];
  scale: number;
  readout: React.RefObject<HTMLSpanElement | null>;
  dragging: boolean;
}): React.JSX.Element {
  return (
    <div
      className="nx-preview-width__ruler"
      data-nx-preview-ruler=""
      aria-hidden="true"
    >
      {marks.map(mark => {
        const offset = (mark.width * scale) / 2;
        return (
          <React.Fragment key={mark.width}>
            <span
              className="nx-preview-width__tick"
              style={{ left: `calc(50% - ${String(offset)}px)` }}
            />
            <span
              className="nx-preview-width__tick"
              data-labelled=""
              style={{ left: `calc(50% + ${String(offset)}px)` }}
            >
              {`${String(mark.width)} ${mark.label}`}
            </span>
          </React.Fragment>
        );
      })}
      {dragging ? (
        <span ref={readout} className="nx-preview-width__readout" />
      ) : null}
    </div>
  );
}
