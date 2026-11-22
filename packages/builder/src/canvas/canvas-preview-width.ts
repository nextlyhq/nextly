/**
 * Previewing the page at a width other than the device's own: the ruler's
 * marks and how a dragged handle snaps to them, what each key does to the
 * width, and the words the canvas says about it.
 *
 * The preview width is the canvas's session state, held by the host beside
 * the device being edited and never stored. While there is one, the frame
 * lays the page out at it in place of the device's own width, and that is
 * all it changes: nothing about where an edit goes: the device the author chose keeps receiving every edit,
 * which is why every sentence here names that device rather than one read off
 * the width.
 *
 * @module canvas-preview-width
 */

import {
  BASE_BREAKPOINT,
  type BreakpointId,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";

import { deviceLabel } from "../shell/breakpoint-switcher";

import {
  baseWidth,
  clampPreviewWidth,
  editedBreakpointAtWidth,
  NARROWEST_PREVIEW_WIDTH,
  offeredTiers,
  type PreviewWidthRange,
} from "./canvas-width";

/** A mark on the ruler: where a breakpoint starts, and its name. */
export interface RulerMark {
  readonly width: number;
  readonly label: string;
}

/**
 * How near, in screen pixels, a dragged handle comes to a mark before the
 * width becomes the mark's.
 */
const SNAP_DISTANCE = 6;

/** What an arrow key moves the width by, and with Shift held. */
const ARROW_STEP = 10;
const FINE_STEP = 1;

/**
 * The name the device switcher gives a breakpoint, read from the switcher's
 * own answer so every surface names a device as its button does; the id
 * itself for one the switcher does not offer.
 *
 * @experimental
 */
export function deviceLabelOf(
  set: BreakpointSet | undefined,
  id: BreakpointId
): string {
  return deviceLabel(set, id) ?? id;
}

/**
 * Where each breakpoint starts, narrowest first: one pixel past the bound of
 * the next narrower one, and Desktop one pixel past the widest bound. The
 * narrowest breakpoint starts at no width at all, and a start below the
 * narrowest preview width is not on the ruler.
 *
 * Read from the tiers the compiler emits, as the device buttons are, so the
 * ruler marks the same breakpoints the buttons offer.
 *
 * @experimental
 */
export function rulerMarks(set: BreakpointSet | undefined): RulerMark[] {
  // Widest first, so each tier's next narrower one is the one after it.
  const tiers = offeredTiers(set);
  const marks: RulerMark[] = [];
  const desktop = baseWidth(set);
  if (desktop !== undefined) {
    marks.push({ width: desktop, label: deviceLabelOf(set, BASE_BREAKPOINT) });
  }
  tiers.forEach((tier, index) => {
    const narrower = tiers[index + 1];
    if (narrower === undefined) return;
    marks.push({
      width: narrower.maxWidth + 1,
      label: deviceLabelOf(set, tier.id),
    });
  });
  return marks
    .filter(mark => mark.width >= NARROWEST_PREVIEW_WIDTH)
    .sort((a, b) => a.width - b.width);
}

/**
 * The width a dragged handle settles on: a mark's, when the handle is within
 * {@link SNAP_DISTANCE} screen pixels of it, else the width as dragged.
 *
 * Both edges move together, so a handle travels half the width's change, at
 * the frame's scale: the screen distance to a mark is half the difference in
 * width, scaled.
 *
 * @experimental
 */
export function snappedPreviewWidth(
  width: number,
  marks: readonly RulerMark[],
  scale: number
): number {
  let nearest: { width: number; distance: number } | undefined;
  for (const mark of marks) {
    const distance = (Math.abs(width - mark.width) * scale) / 2;
    if (distance > SNAP_DISTANCE) continue;
    if (nearest === undefined || distance < nearest.distance) {
      nearest = { width: mark.width, distance };
    }
  }
  return nearest?.width ?? width;
}

/**
 * The painted width that puts the dragged edge where the pointer has moved
 * it, in screen pixels, from the painted width the drag `start`ed at, the
 * `region`'s width and the pointer's `travel` since.
 *
 * The frame is centred in its stage, so both edges move together and the
 * width changes by twice the travel. The stage is the region, or the width
 * the frame started at where that is wider: an overflowing frame's stage is
 * held at that width for the drag (`canvas-preview-width-edges.tsx`), so the
 * region's scroll is never clamped under the pointer. Past that width the
 * stage grows with the frame from its left edge, and the right edge moves by
 * the travel alone. A region not measured is taken as roomy enough.
 *
 * @experimental
 */
export function draggedPaintedWidth({
  side,
  start,
  region,
  travel,
}: {
  /** +1 for the right edge, -1 for the left. */
  readonly side: 1 | -1;
  readonly start: number;
  readonly region: number;
  readonly travel: number;
}): number {
  if (!(region > 0)) return start + side * 2 * travel;
  const stage = Math.max(region, start);
  if (side === 1) {
    const edge = (stage + start) / 2 + travel;
    return edge >= stage ? edge : 2 * edge - stage;
  }
  const edge = (stage - start) / 2 + travel;
  return stage - 2 * edge;
}

/**
 * The width a key on a handle moves to: the arrows by 10px (1px with Shift),
 * Page Up and Page Down to the next and previous mark (the range's ends past
 * the last), Home and End to the narrowest and widest. `undefined` for a key
 * that is not the slider's.
 *
 * @experimental
 */
export function keyedPreviewWidth(
  event: { readonly key: string; readonly shiftKey: boolean },
  width: number,
  marks: readonly RulerMark[],
  range: PreviewWidthRange
): number | undefined {
  const step = event.shiftKey ? FINE_STEP : ARROW_STEP;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      return clampPreviewWidth(width + step, range);
    case "ArrowLeft":
    case "ArrowDown":
      return clampPreviewWidth(width - step, range);
    case "PageUp":
      return (
        marks.find(mark => mark.width > width && mark.width <= range.max)
          ?.width ?? range.max
      );
    case "PageDown":
      return (
        marks.findLast(mark => mark.width < width && mark.width >= range.min)
          ?.width ?? range.min
      );
    case "Home":
      return range.min;
    case "End":
      return range.max;
    default:
      return undefined;
  }
}

/**
 * The slider's value in words: the width and the breakpoint whose range it is
 * in, "900 pixels, Tablet range".
 *
 * @experimental
 */
export function previewValueText(
  set: BreakpointSet | undefined,
  width: number
): string {
  const range = deviceLabelOf(set, editedBreakpointAtWidth(set, width));
  return `${width} pixels, ${range} range`;
}

/**
 * The line under the frame while the page is previewed at a width of its own,
 * naming the device every edit still goes to.
 *
 * @experimental
 */
export function previewNotice(width: number, device: string): string {
  return `Previewing at ${width}px · still editing ${device} styles`;
}

/** What a screen reader hears once the width settles. @experimental */
export function previewAnnouncement(width: number, device: string): string {
  return `Previewing at ${width} pixels, still editing ${device} styles`;
}
