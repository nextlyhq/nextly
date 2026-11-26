/**
 * Where a builder popup is placed, decided once when it opens.
 *
 * The general popover moves itself every time its own size changes: it flips
 * to the other side and slides along its side to stay inside the window. In
 * an editor that is a popup jumping under the pointer the moment a row
 * appears in it. The builder's popups instead choose their side and their
 * place along it once, here, from the room around what opened them, and the
 * popover is then told exactly that and nothing else (`builder-popover`).
 *
 * What is held is the popup's top-left corner, whichever side it opened on,
 * because that is where its controls are measured from: a row appearing
 * further down leaves every control above it where the author's pointer is.
 * A popup opened above its anchor therefore grows downward, over the anchor,
 * rather than upward under the pointer.
 *
 * Plain arithmetic over boxes in window coordinates, so it is tested at every
 * edge without a browser.
 *
 * @module popups/popup-placement
 */

/** A box in window coordinates. */
export interface PopupBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The side of its anchor a popup opens on. */
export type PopupSide = "top" | "right" | "bottom" | "left";

/** Where along that side a popup starts, against its anchor. */
export type PopupAlign = "start" | "center" | "end";

/** How far a popup keeps from each window edge (the top bar's included). */
export interface PopupInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The place a popup holds: its side, and how far its start edge sits along
 * that side from its anchor's start edge. With the popover's start alignment,
 * this is all the popover needs to put it back in the same place.
 */
export interface PopupPlan {
  side: PopupSide;
  alignOffset: number;
}

/**
 * How the popover is told to hold a planned popup: beside its anchor's
 * bottom or right edge, at a side offset that may be negative, start-aligned.
 * Both offsets then measure the popup's top-left corner from the anchor's,
 * so a change in the popup's own size cannot move that corner. The side the
 * popup was planned on is kept separately.
 */
export interface PopupHold {
  side: "bottom" | "right";
  sideOffset: number;
  alignOffset: number;
}

/**
 * The hold that puts a popup where `plan` places it, `size` as it is now. A
 * popup above or left of its anchor and larger than the room there starts at
 * the window's inset, and its content scrolls inside.
 */
export function holdFor(
  plan: PopupPlan,
  anchor: PopupBox,
  size: { width: number; height: number },
  sideOffset: number,
  insets: PopupInsets
): PopupHold {
  const { alignOffset } = plan;
  const above = Math.min(size.height, anchor.top - sideOffset - insets.top);
  const before = Math.min(size.width, anchor.left - sideOffset - insets.left);
  switch (plan.side) {
    case "bottom":
      return { side: "bottom", sideOffset, alignOffset };
    case "right":
      return { side: "right", sideOffset, alignOffset };
    case "top":
      // Its top, measured from the anchor's bottom edge.
      return {
        side: "bottom",
        sideOffset: Math.round(-(sideOffset + above + anchor.height)),
        alignOffset,
      };
    case "left":
      return {
        side: "right",
        sideOffset: Math.round(-(sideOffset + before + anchor.width)),
        alignOffset,
      };
  }
}

const OPPOSITE: Record<PopupSide, PopupSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/** Whether a side stacks the popup above or below its anchor. */
function stacksVertically(side: PopupSide): boolean {
  return side === "top" || side === "bottom";
}

/** The room on one side of the anchor, inside the insets. */
function roomOn(
  side: PopupSide,
  anchor: PopupBox,
  viewport: { width: number; height: number },
  insets: PopupInsets,
  sideOffset: number
): number {
  switch (side) {
    case "bottom":
      return (
        viewport.height -
        insets.bottom -
        (anchor.top + anchor.height) -
        sideOffset
      );
    case "top":
      return anchor.top - sideOffset - insets.top;
    case "right":
      return (
        viewport.width -
        insets.right -
        (anchor.left + anchor.width) -
        sideOffset
      );
    case "left":
      return anchor.left - sideOffset - insets.left;
  }
}

/**
 * The side and place a popup opens at.
 *
 * The side asked for when the popup fits there, else the opposite side when
 * it fits there, else whichever of the two has more room, where its content
 * scrolls inside; or the side asked for whatever its room, with `keepSide`.
 * Along the side it starts where its alignment puts it, moved
 * only as far as it must to stay inside the window; one taller or wider than
 * the window starts at the top or left inset.
 */
export function planPopup(input: {
  anchor: PopupBox;
  /** The popup's own size, uncapped by the room it is given. */
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  insets: PopupInsets;
  side: PopupSide;
  align: PopupAlign;
  sideOffset: number;
  /** Kept on the side asked for even without room, as some popups ask. */
  keepSide?: boolean;
  /**
   * The caller's own shift along the side, read as the popover reads it:
   * toward the end for a start alignment, toward the start for an end one,
   * and not at all for a centered popup.
   */
  alignOffset?: number;
}): PopupPlan {
  const { anchor, size, viewport, insets, align, sideOffset } = input;
  const room = (side: PopupSide): number =>
    roomOn(side, anchor, viewport, insets, sideOffset);
  const need = (side: PopupSide): number =>
    stacksVertically(side) ? size.height : size.width;

  const asked = input.side;
  const other = OPPOSITE[asked];
  const side =
    input.keepSide === true || room(asked) >= need(asked)
      ? asked
      : room(other) >= need(other) || room(other) > room(asked)
        ? other
        : asked;

  // Along the side: x for a popup above or below, y for one beside.
  const vertical = stacksVertically(side);
  const start = vertical ? anchor.left : anchor.top;
  const anchorLength = vertical ? anchor.width : anchor.height;
  const length = vertical ? size.width : size.height;
  const min = vertical ? insets.left : insets.top;
  const max = vertical
    ? viewport.width - insets.right
    : viewport.height - insets.bottom;

  const shift = input.alignOffset ?? 0;
  const wanted =
    align === "start"
      ? start + shift
      : align === "center"
        ? start + anchorLength / 2 - length / 2
        : start + anchorLength - length - shift;
  const at =
    length >= max - min ? min : Math.min(Math.max(wanted, min), max - length);

  // Whole pixels, so the popup's edges stay sharp and its place exact.
  return { side, alignOffset: Math.round(at - start) };
}

/**
 * The anchor's box, read back from where the popover put a popup held at a
 * plan: the popover keeps the anchor itself, so this is how the builder
 * learns where it is. `anchorSize` is the one the popover reports.
 */
export function anchorOf(
  placed: PopupBox,
  held: PopupPlan & { sideOffset: number },
  anchorSize: { width: number; height: number }
): PopupBox {
  const { side, alignOffset, sideOffset } = held;
  const { width, height } = anchorSize;
  switch (side) {
    case "bottom":
      return {
        left: placed.left - alignOffset,
        top: placed.top - sideOffset - height,
        width,
        height,
      };
    case "top":
      return {
        left: placed.left - alignOffset,
        top: placed.top + placed.height + sideOffset,
        width,
        height,
      };
    case "right":
      return {
        left: placed.left - sideOffset - width,
        top: placed.top - alignOffset,
        width,
        height,
      };
    case "left":
      return {
        left: placed.left + placed.width + sideOffset,
        top: placed.top - alignOffset,
        width,
        height,
      };
  }
}
