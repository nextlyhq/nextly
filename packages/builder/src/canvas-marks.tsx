"use client";

/**
 * The marks drawn over blocks: the selection, the editable parts of a selected
 * component placement, the block a Layers row points at, and during a drag the
 * container a drop would land in or the one refusing it.
 *
 * The canvas decides WHICH elements are marked and says so with attributes on
 * them (`useCanvasMarkers` in `canvas.tsx`): every rendering of a selected
 * node, the outermost element of a component placement, the drop container.
 * This draws a box over each of those elements, in the editor's chrome rather
 * than as a style of the element, so the site's CSS cannot restyle or hide the
 * mark and the mark keeps its width at any zoom. Reading the attributes rather
 * than resolving the ids again keeps one answer to "what is marked".
 *
 * @module canvas-marks
 */

import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { INSTANCE_ATTRIBUTE, NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import * as React from "react";

import {
  outsetCornerRadii,
  scaleCornerRadii,
  SQUARE_CORNERS,
  type CornerRadii,
} from "./border-radii";
import { deviceLabel } from "./breakpoint-switcher";
import {
  CANVAS_ROOT_CLASS,
  DROP_PARENT_ATTRIBUTE,
  DROP_REFUSED_ATTRIBUTE,
  isOutermostForAddress,
  LOCKED_ATTRIBUTE,
  nodeAddressOf,
  SELECTED_ATTRIBUTE,
} from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import {
  OVERLAY_OUTPUT_ATTRIBUTE,
  watchCanvasFor,
  watchScreenBand,
} from "./canvas-geometry-watch";
import { EXPOSED_ATTRIBUTE } from "./exposed-outline";
import type { Rect } from "./geometry";
import {
  canvasContentRect,
  CHROME_BLEED,
  clippedByAncestor,
  onScreenOf,
  overlaySpaceOf,
  renderedScale,
  usedRadiiOf,
  visiblePartOf,
  type OverlaySpace,
} from "./geometry-dom";
import { useHoveredBlock } from "./hovered-block";
import { UNNAMED_COMPONENT } from "./layers";
import { LOOK_REACH_ATTRIBUTE } from "./look-reach";
import { TOOLBAR_GAP_PX, toolbarPlacement } from "./toolbar-actions";
import { EDITING_ATTRIBUTE } from "./use-inline-text";

/**
 * The marks that are the marked element's outline and nothing more, by the
 * attribute that asks for each: a block an edit to the look being edited
 * reaches, and a drop's parent and refused target.
 */
const OUTLINE_MARKS = [
  [LOOK_REACH_ATTRIBUTE, "look-reach"],
  [DROP_PARENT_ATTRIBUTE, "drop-parent"],
  [DROP_REFUSED_ATTRIBUTE, "drop-refused"],
] as const;

/** The outline-only marks an element asks for, drawn as `box`. */
function outlineMarksOf(marked: Element, box: Omit<Mark, "kind">): Mark[] {
  return OUTLINE_MARKS.filter(([attribute]) =>
    marked.hasAttribute(attribute)
  ).map(([, kind]) => ({ ...box, kind }));
}

/** One box to draw, in the chrome's coordinates. */
interface Mark {
  readonly kind:
    | "selected"
    | "hovered"
    | "exposed"
    | "look-reach"
    | "drop-parent"
    | "drop-refused";
  /** The rest of a multi-block selection, drawn thinner than the primary. */
  readonly secondary: boolean;
  /** A component placement, drawn in the component colour. */
  readonly component: boolean;
  /** A block locked in Layers, by its own lock or one around it: dashed. */
  readonly locked: boolean;
  /**
   * An exposed part being edited in place on the canvas: a solid ring, so the
   * passage the caret is in reads apart from the placement's other parts.
   */
  readonly editing?: boolean;
  /** Another exposed part of a placement while one of its parts is edited. */
  readonly dimmed?: boolean;
  /**
   * A selected block the page hides on the device shown, drawn because it is
   * selected: hatched, and tagged as hidden.
   */
  readonly hidden: boolean;
  /**
   * Where a hidden block's tag sits: below the ring, above it when the ring
   * ends at the bottom of what is on screen, where the canvas would cut a tag
   * below it off, or inside it when neither fits, as on a block that fills
   * the screen.
   */
  readonly tag: "below" | "above" | "inside";
  /**
   * For a tag inside the ring, how far in from the ring's bottom and side
   * edges it sits, so it stays on screen when the ring runs past the screen.
   */
  readonly tagInset: { readonly bottom: number; readonly side: number };
  /**
   * Which of the ring's edges the tag lines up with: its right edge, so the
   * tag runs leftwards, or its left edge when there is no room on screen for
   * it to the left of the ring's right edge.
   */
  readonly tagEdge: "right" | "left";
  /** Cut to the part a clipping ancestor leaves visible, with no halo band. */
  readonly clipped: boolean;
  /**
   * Around a block its own `clip-path` shapes: no halo band, the ring still
   * outside the box.
   */
  readonly shaped?: boolean;
  /** The placement a component frame is drawn around, by its address. */
  readonly placement?: string;
  /**
   * A placement's tag is drawn inside its frame: the frame's top is too
   * close to the top of what is on screen for a tag above it to show.
   */
  readonly placementTagInside?: boolean;
  /** The block a hovered mark points at, by its address, for its name tag. */
  readonly hoveredAddress?: string;
  /**
   * A hovered block's tag is drawn inside its outline: the outline's top is
   * too close to the top of what is on screen for a tag above it to show.
   */
  readonly hoverTagInside?: boolean;
  readonly rect: Rect;
  /** The block's own corners, in the chrome's coordinates, as `border-radius`. */
  readonly radius: string;
}

const NO_MARKS: readonly Mark[] = [];

const NO_IDS: readonly string[] = [];

/** The height a hidden block's tag takes outside its ring, with its gap. */
const TAG_ROOM = 24;

/** The gap between a tag inside the ring and the ring's edges. */
const TAG_GAP = 4;

const NO_INSET = { bottom: TAG_GAP, side: TAG_GAP } as const;

/**
 * About how wide a tag of `label` is drawn: its 11px face runs under 7px a
 * character, plus its padding. An estimate erring wide, since a tag judged to
 * fit that does not is the one the canvas cuts off.
 */
function tagWidthOf(label: string): number {
  return label.length * 7 + 12;
}

/** @experimental */
export interface CanvasMarksProps {
  /**
   * Selected blocks the page hides on the device being shown, which the
   * canvas draws anyway while they are selected. Their ring is hatched and
   * tagged, so a block a visitor will not see is never mistaken for one they
   * will.
   */
  readonly revealed?: readonly string[];
  /**
   * The site's breakpoints and the device being shown, which names the tag
   * on such a ring: "Hidden on Mobile".
   */
  readonly device?: { breakpoints: BreakpointSet | undefined; id: string };
  /**
   * A block's name by its address, for the tag on a component placement's
   * frame: the name its author gave it, or its component's. A placement it
   * does not name is tagged as a component.
   */
  readonly nameOf?: (address: string) => string | undefined;
}

/**
 * How far outside a block its selection ring is drawn: the ring and the halo
 * band inside it, each 2px. Outside, so the ring never covers the block's own
 * content, the first glyph of a heading set flush with its box. The layer
 * reaches as far past the frame (`CHROME_BLEED`), so the ring of a block
 * flush with the page's edge is drawn too.
 */
const RING_OUTSIDE = CHROME_BLEED;

/**
 * The height of a mark's tag (a placement's, a hovered block's), drawn above
 * its outline. An outline closer than
 * this to the top of what is on screen has its tag drawn inside instead,
 * where it still shows.
 */
const MARK_TAG_HEIGHT = 18;

/** Everything that decides how a mark is drawn, as one comparable value. */
function markKey(mark: Mark): string {
  const {
    kind,
    secondary,
    component,
    locked,
    hidden,
    tag,
    tagEdge,
    tagInset,
    clipped,
    shaped,
    editing,
    dimmed,
    placement,
    placementTagInside,
    hoveredAddress,
    hoverTagInside,
    radius,
    rect,
  } = mark;
  return JSON.stringify([
    kind,
    secondary,
    component,
    locked,
    hidden,
    tag,
    tagEdge,
    tagInset.bottom,
    tagInset.side,
    clipped,
    shaped === true,
    editing === true,
    dimmed === true,
    placement,
    placementTagInside,
    hoveredAddress,
    hoverTagInside,
    radius,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  ]);
}

/** Whether two lists of marks would draw the same boxes. */
function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark, index) => {
    const other = b[index];
    return other !== undefined && markKey(mark) === markKey(other);
  });
}

/**
 * A mark's box, and for a tag inside the ring the insets the stylesheet places
 * it by: custom properties, read only under `data-tag="inside"`.
 */
function markStyle(mark: Mark): React.CSSProperties {
  const box: React.CSSProperties = {
    left: mark.rect.x,
    top: mark.rect.y,
    width: mark.rect.width,
    height: mark.rect.height,
    borderRadius: mark.radius,
  };
  if (mark.kind === "hovered") {
    // The hovered block's name tag moves in from the side the screen cuts.
    return {
      ...box,
      "--nx-tag-inset-side": `${String(mark.tagInset.side)}px`,
    } as React.CSSProperties;
  }
  if (!mark.hidden) return box;
  return {
    ...box,
    // Every tag moves in from the side the screen cuts; only a tag inside the
    // ring is placed from the bottom.
    "--nx-tag-inset-side": `${String(mark.tagInset.side)}px`,
    ...(mark.tag === "inside"
      ? { "--nx-tag-inset-bottom": `${String(mark.tagInset.bottom)}px` }
      : {}),
  } as React.CSSProperties;
}

/** Corner radii as the `border-radius` shorthand writes them, both axes. */
function borderRadiusOf(radii: CornerRadii): string {
  const { topLeft, topRight, bottomRight, bottomLeft } = radii;
  const px = (value: number): string => `${String(value)}px`;
  return (
    `${px(topLeft.x)} ${px(topRight.x)} ${px(bottomRight.x)} ${px(bottomLeft.x)} / ` +
    `${px(topLeft.y)} ${px(topRight.y)} ${px(bottomRight.y)} ${px(bottomLeft.y)}`
  );
}

/** A marked element's box and corners, in the chrome's coordinates. */
interface Outline {
  readonly rect: Rect;
  /** The corners as `border-radius`. */
  readonly radius: string;
  readonly radii: CornerRadii;
  readonly clipped: boolean;
  /** Shaped by the block's own `clip-path`: no halo band, ring outside. */
  readonly shaped?: boolean;
}

/**
 * A marked element's box and corners, in the chrome's coordinates.
 *
 * The corners follow the block's own curve, so the ring and its halo hug a
 * rounded card rather than squaring its corners off. Square where the corners
 * cannot be read — a block transformed out of its axes, or radii a computed
 * style leaves unresolved: over a frame the mark is the only ring the block
 * has, so a block whose shape cannot be described keeps a square one rather
 * than none.
 *
 * A block an ancestor clips (`overflow: hidden` or `clip`) is marked over the
 * part left visible, square and `clipped`: the page draws nothing of it past
 * the clip, and a ring drawn there would mark what the reader cannot see.
 * A block the clip hides entirely has no outline (`null`), and where the clip
 * cannot be described, the whole box keeps a square ring.
 */
function outlineOf(
  marked: Element,
  root: HTMLElement,
  space: OverlaySpace
): Outline | null {
  const own = canvasContentRect(marked, root);
  const style = marked.ownerDocument.defaultView?.getComputedStyle(marked);
  const scale = renderedScale(marked, root);
  const radii =
    style === undefined || !scale.describable
      ? undefined
      : usedRadiiOf(style, own, scale);
  // In the root's coordinates, where the clip is asked about.
  const inRoot =
    radii === undefined
      ? SQUARE_CORNERS
      : scaleCornerRadii(radii, { x: scale.x, y: scale.y });
  if (clippedByAncestor(marked, root, inRoot)) {
    const visible = visiblePartOf(marked, root) ?? own;
    if (visible === "hidden") return null;
    return {
      rect: space.place(visible),
      radius: borderRadiusOf(SQUARE_CORNERS),
      radii: SQUARE_CORNERS,
      clipped: true,
    };
  }
  /*
   * A block its OWN `clip-path` shapes — a circle cut from a square box —
   * draws nothing of the box outside that shape. A halo band hugging the box
   * would frame corners that show the page behind, so the ring is drawn
   * square around the box with no band. Unlike an ancestor's clip, the
   * block's own shape does not cut the overlay, so the ring stays OUTSIDE
   * the box, where it covers nothing the shape shows.
   */
  const shape = style?.clipPath;
  if (shape !== undefined && shape !== "" && shape !== "none") {
    return {
      rect: space.place(own),
      radius: borderRadiusOf(SQUARE_CORNERS),
      radii: SQUARE_CORNERS,
      clipped: false,
      shaped: true,
    };
  }
  const drawn = scaleCornerRadii(inRoot, { x: space.scale, y: space.scale });
  return {
    rect: space.place(own),
    radius: borderRadiusOf(drawn),
    radii: drawn,
    clipped: false,
  };
}

/**
 * Where a selection ring is drawn for an outline: outside the block by
 * {@link RING_OUTSIDE}, with its rounded corners grown to stay concentric.
 * The layer reaches as far past the frame, so a block flush with the page's
 * edge keeps its ring there too.
 *
 * A clipped outline is drawn where it is: the page shows nothing past the
 * clip, so a ring outside it would ring what the reader cannot see.
 */
function ringOf(outline: Outline): Outline {
  if (outline.clipped) return outline;
  const { x, y, width, height } = outline.rect;
  const radii = outsetCornerRadii(outline.radii, RING_OUTSIDE);
  return {
    rect: {
      x: x - RING_OUTSIDE,
      y: y - RING_OUTSIDE,
      width: width + 2 * RING_OUTSIDE,
      height: height + 2 * RING_OUTSIDE,
    },
    radius: borderRadiusOf(radii),
    radii,
    clipped: false,
    ...(outline.shaped === true ? { shaped: true } : {}),
  };
}

/** The smallest rectangle holding every one given. */
function unionOf(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map(rect => rect.x));
  const top = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.width));
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The outline around every part of one placement: their union, square unless
 * there is one part, whose corners it keeps, and cut by a clip where any part
 * is.
 */
function placementOutline(parts: readonly Outline[]): Outline {
  const [only] = parts;
  if (parts.length === 1 && only !== undefined) return only;
  return {
    rect: unionOf(parts.map(part => part.rect)),
    radius: borderRadiusOf(SQUARE_CORNERS),
    radii: SQUARE_CORNERS,
    clipped: parts.some(part => part.clipped),
    ...(parts.some(part => part.shaped === true) ? { shaped: true } : {}),
  };
}

/** A selected placement's parts, gathered to draw one frame around them. */
interface SelectedPlacement {
  /** The placement's address, which its tag names. */
  readonly placement: string;
  readonly parts: Outline[];
  readonly secondary: boolean;
  readonly locked: boolean;
  readonly hidden: boolean;
}

/** How a selected ring is drawn, decided by its element. */
interface RingLook {
  readonly secondary: boolean;
  readonly locked: boolean;
  readonly hidden: boolean;
}

/** Where a hidden block's tag goes on a ring, decided by `marksOf`. */
type TagPlacer = (
  rect: Rect,
  primary: boolean
) => Pick<Mark, "tag" | "tagEdge" | "tagInset">;

/** A selected block's mark, drawn over its ring; a placement's carries it. */
function selectedMark(
  ring: Outline,
  look: RingLook,
  placeTag: TagPlacer,
  placement?: string
): Mark {
  return {
    rect: ring.rect,
    radius: ring.radius,
    clipped: ring.clipped,
    ...(ring.shaped === true ? { shaped: true } : {}),
    kind: "selected",
    component: placement !== undefined,
    ...look,
    ...placeTag(ring.rect, !look.secondary),
    ...(placement === undefined ? {} : { placement }),
  };
}

/**
 * Add one selected part to its placement's gathered parts.
 *
 * Gathered per rendered COPY as well as per placement: a block that renders
 * its slot more than once, as a loop does once per entry, draws a placement's
 * parts once in each copy, all with the placement's address. A copy's parts
 * are siblings, so their parent tells the copies apart; one frame around every
 * copy would ring whatever lies between them.
 */
function gatherPlacement(
  placements: Map<string, SelectedPlacement>,
  copies: Map<Element | null, number>,
  marked: Element,
  placement: string,
  part: Outline,
  look: RingLook
): void {
  const parent = marked.parentElement;
  let copy = copies.get(parent);
  if (copy === undefined) {
    copy = copies.size;
    copies.set(parent, copy);
  }
  const key = `${String(copy)}\u0000${placement}`;
  const gathered = placements.get(key);
  if (gathered === undefined) {
    placements.set(key, { placement, parts: [part], ...look });
  } else gathered.parts.push(part);
}

/** The tag on a placement's frame: a component's mark and its name. */
function placementTag(
  placement: string,
  nameOf: CanvasMarksProps["nameOf"]
): string {
  const name = nameOf?.(placement)?.trim();
  return `◇ ${name === undefined || name === "" ? UNNAMED_COMPONENT : name}`;
}

/**
 * Whether the block toolbar takes the place above a block: above it, or
 * pinned over its top at the top of the screen, where a tag above would
 * collide with it either way.
 */
function takesTheTop(side: "above" | "below" | "pinned"): boolean {
  return side !== "below";
}

/** What the marks are drawn for besides what the canvas marks on the page. */
interface MarkInputs {
  /** The block a Layers row points at, or `null`. */
  readonly hovered: string | null;
  /**
   * Selected blocks shown although the page hides them on this device, as a
   * set: asked once per marked element, and a selection can hold thousands.
   */
  readonly revealed: ReadonlySet<string>;
  /** About how wide a hidden block's tag is drawn, in the chrome's pixels. */
  readonly tagWidth: number;
}

/** The marked elements of a canvas root, as the boxes to draw over them. */
function marksOf(element: HTMLElement, inputs: MarkInputs): readonly Mark[] {
  const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
  if (space === null) return NO_MARKS;
  const { root } = space;
  const onScreen = onScreenOf(space);
  const screenBottom = onScreen.y + onScreen.height;
  const screenRight = onScreen.x + onScreen.width;
  // From the ring's right edge as far as the screen shows it.
  const roomLeft = (rect: Rect): boolean =>
    Math.min(rect.x + rect.width, screenRight) - inputs.tagWidth >= onScreen.x;
  // The block toolbar, drawn beside these marks over the same canvas, which
  // takes the place above the primary block when it sits there.
  const toolbar =
    element.parentElement?.querySelector<HTMLElement>(".nx-block-toolbar");
  const pageBox = space.place(canvasContentRect(root, root));
  const toolbarAbove = (rect: Rect): boolean =>
    toolbar !== null &&
    toolbar !== undefined &&
    takesTheTop(
      toolbarPlacement(rect, space.sizeOf(toolbar), pageBox, TOOLBAR_GAP_PX, {
        top: onScreen.y,
        bottom: onScreen.y + onScreen.height,
      }).side
    );
  // Below if it fits on screen, above if that does and the toolbar is not
  // there, and otherwise inside the ring, which is always on screen.
  const tagSide = (rect: Rect, primary: boolean): Mark["tag"] => {
    if (rect.y + rect.height + TAG_ROOM <= screenBottom) return "below";
    if (rect.y - TAG_ROOM >= onScreen.y && !(primary && toolbarAbove(rect))) {
      return "above";
    }
    return "inside";
  };
  // A tag moves in as far as the ring runs past the screen, so it is never
  // drawn where the canvas cuts it off; inside the ring it also keeps a small
  // gap from the ring's edges.
  const insetOf = (
    rect: Rect,
    edge: Mark["tagEdge"],
    tag: Mark["tag"]
  ): Mark["tagInset"] => {
    const gap = tag === "inside" ? TAG_GAP : 0;
    return {
      bottom: gap + Math.max(0, rect.y + rect.height - screenBottom),
      side:
        gap +
        (edge === "right"
          ? Math.max(0, rect.x + rect.width - screenRight)
          : Math.max(0, onScreen.x - rect.x)),
    };
  };
  const placedTag = (
    rect: Rect,
    primary: boolean
  ): Pick<Mark, "tag" | "tagEdge" | "tagInset"> => {
    const tagEdge = roomLeft(rect) ? "right" : "left";
    const tag = tagSide(rect, primary);
    return { tag, tagEdge, tagInset: insetOf(rect, tagEdge, tag) };
  };
  const found: Mark[] = [];
  // In the order their first part is met, which is document order.
  const placements = new Map<string, SelectedPlacement>();
  const copies = new Map<Element | null, number>();
  root
    .querySelectorAll(
      `[${SELECTED_ATTRIBUTE}], [${EXPOSED_ATTRIBUTE}], [${LOOK_REACH_ATTRIBUTE}], [${DROP_PARENT_ATTRIBUTE}], [${DROP_REFUSED_ATTRIBUTE}]`
    )
    .forEach(marked => {
      // A canvas rendered inside a block of this one marks its own elements.
      if (marked.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return;
      const outline = outlineOf(marked, root, space);
      // Wholly cut away by a clipping ancestor: the page shows none of it.
      if (outline === null) return;
      const plain = {
        secondary: false,
        component: false,
        locked: false,
        hidden: false,
        tag: "below" as const,
        tagEdge: "right" as const,
        tagInset: NO_INSET,
      };
      const selected = marked.getAttribute(SELECTED_ATTRIBUTE);
      // A part of a placement, by the placement's address: the canvas marks
      // only the outermost elements, so each of these is one whole part, and
      // a selected placement is drawn as one frame around them all.
      const placement = marked.getAttribute(INSTANCE_ATTRIBUTE) ?? "";
      if (selected !== null) {
        const address = nodeAddressOf(marked);
        const look = {
          secondary: selected !== "primary",
          locked: marked.hasAttribute(LOCKED_ATTRIBUTE),
          hidden: address !== null && inputs.revealed.has(address),
        };
        if (placement !== "") {
          gatherPlacement(placements, copies, marked, placement, outline, look);
        } else {
          found.push(selectedMark(ringOf(outline), look, placedTag));
        }
      }
      // An exposed part keeps its dash inside its placement's frame. A block
      // that is itself ringed keeps its ring alone: one element draws one
      // outline, and the ring says more there.
      if (
        marked.hasAttribute(EXPOSED_ATTRIBUTE) &&
        (selected === null || placement !== "")
      ) {
        found.push({
          ...outline,
          ...plain,
          kind: "exposed",
          ...(marked.hasAttribute(EDITING_ATTRIBUTE) ? { editing: true } : {}),
        });
      }
      // The marks drawn as the element's outline alone, one per attribute.
      found.push(...outlineMarksOf(marked, { ...outline, ...plain }));
    });
  placements.forEach(({ placement, parts, ...look }) => {
    const ring = ringOf(placementOutline(parts));
    found.push({
      ...selectedMark(ring, look, placedTag, placement),
      // Measured from the top of what is on screen rather than of the page:
      // a placement scrolled to the top keeps its tag in view.
      placementTagInside: ring.rect.y - onScreen.y < MARK_TAG_HEIGHT,
    });
  });
  const { hovered } = inputs;
  if (hovered !== null) {
    /*
     * Every rendering of the hovered block, found by its ADDRESS and the
     * outermost element standing for it, as the selection is: a placement's
     * component draws no element of its own, and a block drawn twice is
     * pointed at twice. A block already selected keeps its ring alone.
     */
    root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(candidate => {
      if (candidate.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return;
      if (candidate.hasAttribute(SELECTED_ATTRIBUTE)) return;
      if (nodeAddressOf(candidate) !== hovered) return;
      if (!isOutermostForAddress(candidate, hovered, root)) return;
      const outline = outlineOf(candidate, root, space);
      if (outline === null) return;
      found.push({
        ...outline,
        kind: "hovered",
        secondary: false,
        component: candidate.hasAttribute(INSTANCE_ATTRIBUTE),
        locked: false,
        hidden: false,
        tag: "below",
        tagEdge: "left",
        // In from the screen's left edge as far as the outline runs past it,
        // so a block scrolled partly off the side keeps its name in view. Not
        // for one wholly off it: there is nothing on screen to tag.
        tagInset: {
          bottom: 0,
          side:
            outline.rect.x + outline.rect.width > onScreen.x
              ? Math.max(0, onScreen.x - outline.rect.x)
              : 0,
        },
        hoveredAddress: hovered,
        // From the top of what is on screen, as the placement's tag is.
        hoverTagInside: outline.rect.y - onScreen.y < MARK_TAG_HEIGHT,
      });
    });
  }
  return dimmedBesideEditing(found);
}

/** An exposed part's editing state, as the stylesheet reads it. */
function editingAttributes(mark: Mark): Record<string, string> {
  return {
    ...(mark.editing === true ? { "data-editing": "" } : {}),
    ...(mark.dimmed === true ? { "data-dimmed": "" } : {}),
  };
}

/**
 * The marks with every other exposed part dimmed while one is being edited,
 * so the passage the caret is in is the one that stands out.
 */
function dimmedBesideEditing(marks: Mark[]): Mark[] {
  if (!marks.some(mark => mark.editing === true)) return marks;
  return marks.map(mark =>
    mark.kind === "exposed" && mark.editing !== true
      ? { ...mark, dimmed: true }
      : mark
  );
}

/**
 * The marks over the canvas's blocks.
 *
 * Re-measured whenever the canvas may have moved or been re-marked —
 * `watchCanvasFor` hears the attributes change as well as the layout — and
 * when the frame's zoom or page changes, which moves every block on screen
 * while nothing inside the frame changes size.
 *
 * @experimental
 */
export function CanvasMarks({
  revealed = NO_IDS,
  device,
  nameOf,
}: CanvasMarksProps = {}): React.JSX.Element {
  const shownOn =
    device === undefined
      ? undefined
      : deviceLabel(device.breakpoints, device.id);
  const hiddenLabel = shownOn === undefined ? "Hidden" : `Hidden on ${shownOn}`;
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [marks, setMarks] = React.useState<readonly Mark[]>(NO_MARKS);
  const canvasFrame = useCanvasFrame();
  const hovered = useHoveredBlock();
  // Keyed by value, so a host handing a new array of the same ids on every
  // render does not re-measure every block. JSON, which spells any id
  // unambiguously.
  const revealedKey = JSON.stringify(revealed);

  const measure = React.useCallback(() => {
    const element = layer.current;
    const next =
      element === null
        ? NO_MARKS
        : marksOf(element, {
            hovered,
            revealed: new Set(JSON.parse(revealedKey) as string[]),
            tagWidth: tagWidthOf(hiddenLabel),
          });
    setMarks(current => (sameMarks(current, next) ? current : next));
  }, [hovered, revealedKey, hiddenLabel]);

  React.useLayoutEffect(() => {
    measure();
  }, [measure, canvasFrame]);

  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure, canvasFrame]
  );

  // And the scrolls that move what of the canvas is on screen, which the tags
  // keep to: the host's scroller around a zoomed frame among them, which no
  // listener in the frame hears.
  React.useEffect(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) return;
    return watchScreenBand(space.root, space.frame, measure);
  }, [measure, canvasFrame]);

  return (
    // Hidden from assistive technology: the selection is announced by the
    // editor's live region and named in the inspector, and a box says nothing.
    <div
      ref={layer}
      className="nx-canvas-marks"
      aria-hidden="true"
      // Drawn over the page and moving nothing in it, so no overlay's watch
      // re-measures for a mark being drawn.
      {...{ [OVERLAY_OUTPUT_ATTRIBUTE]: "" }}
    >
      {marks.map((mark, index) => (
        <div
          // Position in the list is the identity: the boxes carry no state.
          key={index}
          className="nx-canvas-mark"
          data-mark={mark.kind}
          data-secondary={mark.secondary ? "" : undefined}
          data-component={mark.component ? "" : undefined}
          data-locked={mark.locked ? "" : undefined}
          {...editingAttributes(mark)}
          data-hidden={mark.hidden ? "" : undefined}
          // The tag a hidden block's ring carries, drawn by the stylesheet
          // from this attribute; the layer is hidden from assistive
          // technology, and Layers and the inspector say it in words.
          data-label={mark.hidden ? hiddenLabel : undefined}
          data-tag={mark.hidden ? mark.tag : undefined}
          data-tag-edge={mark.hidden ? mark.tagEdge : undefined}
          data-clipped={mark.clipped ? "" : undefined}
          data-shaped={mark.shaped === true ? "" : undefined}
          // The tag a placement's frame carries, drawn by the stylesheet from
          // this attribute: the layer is hidden from assistive technology,
          // and the inspector names the placement in words.
          data-placement-label={
            mark.placement === undefined
              ? undefined
              : placementTag(mark.placement, nameOf)
          }
          data-placement-tag-inside={
            mark.placementTagInside === true ? "" : undefined
          }
          // The hovered block's name, drawn by the stylesheet as a small tag
          // over its outline's corner, as the editor's design draws it.
          data-hover-label={
            mark.hoveredAddress === undefined
              ? undefined
              : nameOf?.(mark.hoveredAddress)?.trim() || undefined
          }
          data-hover-tag-inside={mark.hoverTagInside === true ? "" : undefined}
          style={markStyle(mark)}
        />
      ))}
    </div>
  );
}
