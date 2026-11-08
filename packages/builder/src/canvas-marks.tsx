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
import { AlertCircle, CircleCheck, Split } from "lucide-react";
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
  CONDITIONED_ATTRIBUTE,
  ENTRY_CONTENT_ATTRIBUTE,
  CONDITIONED_OWN_ATTRIBUTE,
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
import {
  tabBoardOf,
  useTabPost,
  type TabAt,
  type TabDraft,
  type TabPlacement,
} from "./canvas-tab-places";
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
    | "drop-refused"
    | "at-rest";
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
  /**
   * An at-rest mark's condition tab: a conditioned block's, conditional,
   * with conditions it can't check, or, while conditions are applied, shown
   * for the previewed entry.
   */
  readonly condition?: ConditionMarkKind;
  /**
   * An at-rest mark's Entry content tab, by its words: an Entry content
   * block's, naming the field it draws ("Entry content · Body").
   */
  readonly entryContent?: string;
  /** Where an at-rest mark's tabs go: above the block, below it, or inside its top. */
  readonly tabsAt?: TabAt;
  /** Whether the block is selected, so its ring stands for the outline. */
  readonly atRestSelected?: boolean;
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

/** The room a condition tab's icon and its gap take beside the words. */
const CONDITION_ICON_ROOM = 16;

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
  /**
   * What a block shown for the previewed entry is badged with while
   * conditions are applied: "Shown for this post".
   */
  readonly shownLabel?: string;
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
    condition,
    entryContent,
    tabsAt,
    atRestSelected,
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
    condition,
    entryContent,
    tabsAt,
    atRestSelected === true,
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
  if (mark.kind === "hovered" || mark.kind === "at-rest") {
    // The hovered block's name tag, and an at-rest mark's tabs, move in
    // from the side the screen cuts.
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
  const key = `${String(copyOf(copies, marked))}\u0000${placement}`;
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

/** What a conditioned block's badge says about who sees it. */
type ConditionMarkKind = "conditional" | "unchecked" | "shown";

/** Whether a conditioned block's attribute names a kind its tab can say. */
function isConditionMarkKind(value: string | null): value is ConditionMarkKind {
  return value === "conditional" || value === "unchecked" || value === "shown";
}

/** The words on a conditioned block's badge. */
function conditionWords(
  condition: ConditionMarkKind,
  shownLabel: string
): string {
  if (condition === "unchecked") return "Can’t be checked";
  return condition === "shown" ? shownLabel : "Conditional";
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
  /** What a shown block's badge says while conditions are applied. */
  readonly shownLabel: string;
}

/**
 * What a measure of the canvas finds: the marks drawn as measured, and the
 * at-rest marks, whose tabs the board places with every other layer's
 * (`placedAtRest`), over the canvas drawn at `root`.
 */
interface Measured {
  readonly root: HTMLElement | null;
  readonly marks: readonly Mark[];
  readonly atRest: readonly AtRestDraft[];
}

const NOTHING_MEASURED: Measured = { root: null, marks: NO_MARKS, atRest: [] };

/** The marked elements of a canvas root, as the boxes to draw over them. */
function marksOf(element: HTMLElement, inputs: MarkInputs): Measured {
  const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
  if (space === null) return NOTHING_MEASURED;
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
  return {
    root,
    marks: dimmedBesideEditing(found),
    atRest: atRestMarks(root, space, onScreen, toolbarAbove, inputs.shownLabel),
  };
}

/** What an element asks an at-rest mark to say, read off its attributes. */
interface AtRestTabs {
  readonly condition?: ConditionMarkKind;
  readonly entryContent?: string;
}

/**
 * The at-rest tabs an element asks for: a conditioned block's condition, and
 * an Entry content block's words. Nothing where it asks for neither.
 */
function atRestTabsOf(element: Element): AtRestTabs | undefined {
  const condition = element.getAttribute(CONDITIONED_ATTRIBUTE);
  const entry = element.getAttribute(ENTRY_CONTENT_ATTRIBUTE);
  const tabs: AtRestTabs = {
    ...(isConditionMarkKind(condition) ? { condition } : {}),
    ...(entry !== null && entry !== "" ? { entryContent: entry } : {}),
  };
  return tabs.condition === undefined && tabs.entryContent === undefined
    ? undefined
    : tabs;
}

/**
 * The at-rest mark on every block the canvas says something about whether or
 * not it is selected: a conditioned block, which the canvas draws whoever the
 * page would show it to, and an Entry content block, which draws the entry's
 * own content rather than the template's. One faint dashed outline round the
 * block with its tabs on the outline's edge, a block that is both carrying
 * both tabs on the one outline. Placed outside the block, above it where
 * there's room and below it where there isn't, so the tabs never cover what
 * the block draws; where they go apart from every other tab drawn over the
 * canvas is the board's to say (`placedAtRest`).
 */
function atRestMarks(
  root: HTMLElement,
  space: OverlaySpace,
  onScreen: Rect,
  toolbarAbove: (rect: Rect) => boolean,
  shownLabel: string
): AtRestDraft[] {
  const badges = new Map<string, ConditionBadge>();
  const copies = new Map<Element | null, number>();
  root
    .querySelectorAll(
      `[${CONDITIONED_ATTRIBUTE}], [${ENTRY_CONTENT_ATTRIBUTE}]`
    )
    .forEach(element => {
      if (element.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return;
      const tabs = atRestTabsOf(element);
      if (tabs === undefined) return;
      const outline = outlineOf(element, root, space);
      if (outline === null) return;
      const key = badgeKey(element, copies, badges.size);
      const selected = element.getAttribute(SELECTED_ATTRIBUTE);
      const gathered = badges.get(key);
      if (gathered === undefined) {
        badges.set(key, {
          tabs,
          parts: [outline],
          selected: selected !== null,
          primary: selected === "primary",
          placement: (element.getAttribute(INSTANCE_ATTRIBUTE) ?? "") !== "",
        });
      } else {
        gathered.parts.push(outline);
        gathered.selected ||= selected !== null;
        gathered.primary ||= selected === "primary";
      }
    });
  return [...badges.values()].map(badge =>
    atRestMark(badge, onScreen, toolbarAbove, shownLabel)
  );
}

/** A marked block's parts, gathered to draw one outline and its tabs. */
interface ConditionBadge {
  readonly tabs: AtRestTabs;
  readonly parts: Outline[];
  selected: boolean;
  primary: boolean;
  readonly placement: boolean;
}

/**
 * Which badge an element's outline joins: a block of a placed component's
 * definition its own, by its composed id within one drawn copy; the roots of one copy of a
 * conditioned placement one together, as one frame is drawn round a selected
 * one; any other block its own.
 */
function badgeKey(
  element: Element,
  copies: Map<Element | null, number>,
  index: number
): string {
  if (element.hasAttribute(CONDITIONED_OWN_ATTRIBUTE)) {
    // By copy as well: a list drawing the component once per entry draws
    // the block once per entry, each with the same composed id.
    // The roots of one placement nested in a component share its badge, as
    // a page placement's roots share theirs.
    const nested = element.getAttribute(CONDITIONED_OWN_ATTRIBUTE) ?? "";
    const id =
      nested === ""
        ? (element.getAttribute(NODE_ID_ATTRIBUTE) ?? String(index))
        : `placed\u0000${nested}`;
    return `own\u0000${String(copyOf(copies, element))}\u0000${id}`;
  }
  const placement = element.getAttribute(INSTANCE_ATTRIBUTE) ?? "";
  return placement === ""
    ? `block\u0000${String(index)}`
    : `${String(copyOf(copies, element))}\u0000${placement}`;
}

/**
 * One marked block's at-rest mark before its tabs are placed: the mark, and
 * its tabs as the board places them (`canvas-tab-places.ts`).
 */
interface AtRestDraft {
  readonly mark: Mark;
  readonly tab: TabDraft;
}

/** One marked block's at-rest mark: its outline and where its tabs may go. */
function atRestMark(
  badge: ConditionBadge,
  onScreen: Rect,
  toolbarAbove: (rect: Rect) => boolean,
  shownLabel: string
): AtRestDraft {
  const outline = placementOutline(badge.parts);
  // The top is taken by a selected placement's name, or by the block
  // toolbar above the primary block: the tab then takes the bottom edge.
  const topTaken =
    (badge.selected && badge.placement) ||
    (badge.primary && toolbarAbove(outline.rect));
  const places = tabPlacesOf(outline.rect, onScreen, topTaken);
  const side = tabInset(outline.rect, onScreen, badge.tabs, shownLabel);
  return {
    mark: {
      ...outline,
      kind: "at-rest",
      secondary: false,
      component: false,
      locked: false,
      hidden: false,
      tag: "below",
      tagEdge: "right",
      tagInset: { bottom: 0, side },
      ...badge.tabs,
      tabsAt: places[0] ?? "inside",
      ...(badge.selected ? { atRestSelected: true } : {}),
    },
    tab: {
      block: outline.rect,
      edge: outline.rect,
      places,
      side,
      // No wider than the outline, as the stylesheet keeps them.
      width: Math.min(tabsWidthOf(badge.tabs, shownLabel), outline.rect.width),
      height: AT_REST_TAB_HEIGHT,
      // Measured from the edge they stand on: their foot shares the dash.
      foot: 0,
    },
  };
}

/**
 * The height an at-rest mark's tabs take, as the stylesheet draws them: a
 * 16px line, with 1px of padding and a 1px border above and below it.
 */
const AT_REST_TAB_HEIGHT = 20;

/**
 * The at-rest marks with their tabs where the board places them: apart from
 * each other, from the "Visitors won't see this" badges and from the block
 * toolbar, all placed by the one pass (`tabsApart` in `canvas-tab-places.ts`).
 * With no board (no canvas), each keeps its tabs where they go alone.
 */
function placedAtRest(
  drafts: readonly AtRestDraft[],
  placements: readonly TabPlacement[]
): Mark[] {
  return drafts.map(({ mark, tab }, index) => {
    const { at, side } = placements[index] ?? {
      at: tab.places[0] ?? "inside",
      side: tab.side,
    };
    return { ...mark, tabsAt: at, tagInset: { ...mark.tagInset, side } };
  });
}

/**
 * How far the right-anchored tab moves in from the block's right edge so it
 * is on screen: in by what the screen cuts off the right, or out past the
 * edge, a negative inset, when the screen cuts the block's left so little of
 * it shows that the tab would run off the left.
 */
function tabInset(
  rect: Rect,
  onScreen: Rect,
  tabs: AtRestTabs,
  shownLabel: string
): number {
  const right = rect.x + rect.width;
  // A block wholly off the screen to either side keeps its tab with it,
  // rather than leaving one stranded at the screen's edge.
  if (right <= onScreen.x || rect.x >= onScreen.x + onScreen.width) return 0;
  const cutRight = Math.max(0, right - (onScreen.x + onScreen.width));
  const width = tabsWidthOf(tabs, shownLabel);
  const fitsLeft = right - onScreen.x - width;
  return Math.min(cutRight, fitsLeft);
}

/** About how wide an at-rest mark's tabs are drawn, side by side. */
function tabsWidthOf(
  { condition, entryContent }: AtRestTabs,
  shownLabel: string
): number {
  const conditionWidth =
    condition === undefined
      ? 0
      : tagWidthOf(conditionWords(condition, shownLabel)) + CONDITION_ICON_ROOM;
  const entryWidth = entryContent === undefined ? 0 : tagWidthOf(entryContent);
  return conditionWidth + entryWidth;
}

/** Which copy of a placement an element is part of: its parent, numbered. */
function copyOf(copies: Map<Element | null, number>, element: Element): number {
  const parent = element.parentElement;
  let copy = copies.get(parent);
  if (copy === undefined) {
    copy = copies.size;
    copies.set(parent, copy);
  }
  return copy;
}

/**
 * Where an at-rest mark's tabs may go, in order of preference: above the
 * block where there's room on screen and nothing else takes that corner,
 * below it where there's room, and inside its top edge, which is always on
 * screen. The first is where they go alone, so a block taller than what's on
 * screen carries them inside; `tabsApart` takes a later one where another
 * block's tabs, a visitor badge or the block toolbar are in the way.
 */
function tabPlacesOf(
  rect: Rect,
  onScreen: Rect,
  topTaken: boolean
): readonly TabAt[] {
  const above = !topTaken && rect.y - onScreen.y >= MARK_TAG_HEIGHT;
  const below =
    rect.y + rect.height + MARK_TAG_HEIGHT <= onScreen.y + onScreen.height;
  return [
    ...(above ? (["above"] as const) : []),
    ...(below ? (["below"] as const) : []),
    "inside",
  ];
}

/**
 * An at-rest mark's tabs, side by side on the outline's edge: what the canvas
 * says about the block, the Entry content block's words before a condition's.
 * A block shown for the previewed entry while conditions are applied says so
 * (`shownLabel`) with a tick.
 */
function AtRestTabsView({
  mark,
  shownLabel,
}: {
  mark: Mark;
  shownLabel: string;
}): React.JSX.Element {
  const { condition, entryContent } = mark;
  const Icon =
    condition === "unchecked"
      ? AlertCircle
      : condition === "shown"
        ? CircleCheck
        : Split;
  return (
    <span className="nx-canvas-mark__tabs">
      {entryContent === undefined ? null : (
        <span className="nx-canvas-mark__tab" data-tab="entry-content">
          {entryContent}
        </span>
      )}
      {condition === undefined ? null : (
        <span className="nx-canvas-mark__tab" data-tab={condition}>
          <Icon aria-hidden="true" size={12} />
          {conditionWords(condition, shownLabel)}
        </span>
      )}
    </span>
  );
}

/** An at-rest mark's state, as the stylesheet reads it. */
function atRestAttributes(mark: Mark): Record<string, string> {
  return {
    ...(mark.condition === undefined
      ? {}
      : { "data-condition": mark.condition }),
    ...(mark.tabsAt === undefined ? {} : { "data-tab-at": mark.tabsAt }),
    ...(mark.atRestSelected === true ? { "data-at-rest-selected": "" } : {}),
  };
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
  shownLabel = "Shown for this entry",
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

  // The last measure, which placing the at-rest tabs again reads: another
  // layer's post moves where they go, not what the canvas marks.
  const measured = React.useRef<Measured>(NOTHING_MEASURED);

  // The marks as last measured, the at-rest tabs where the board puts them
  // now: placed again whenever another layer's post changes the board.
  const placeTabs = React.useCallback(() => {
    const { root, marks: drawn, atRest } = measured.current;
    const next = [
      ...drawn,
      ...placedAtRest(
        atRest,
        root === null ? [] : tabBoardOf(root).placesOf("at-rest")
      ),
    ];
    setMarks(current => (sameMarks(current, next) ? current : next));
  }, []);
  const postTabs = useTabPost("at-rest", placeTabs);

  const measure = React.useCallback(() => {
    const element = layer.current;
    measured.current =
      element === null
        ? NOTHING_MEASURED
        : marksOf(element, {
            hovered,
            revealed: new Set(JSON.parse(revealedKey) as string[]),
            tagWidth: tagWidthOf(hiddenLabel),
            shownLabel,
          });
    const { root, atRest } = measured.current;
    postTabs(root, { tabs: atRest.map(({ tab }) => tab), taken: [] });
    placeTabs();
  }, [hovered, revealedKey, hiddenLabel, shownLabel, postTabs, placeTabs]);

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
          {...atRestAttributes(mark)}
          style={markStyle(mark)}
        >
          {mark.kind === "at-rest" ? (
            <AtRestTabsView mark={mark} shownLabel={shownLabel} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
