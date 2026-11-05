"use client";

/**
 * The interactive half of the spacing overlay.
 *
 * Stage 1 draws bands that report. This turns each one into something an author
 * can move: a handle on the edge that grows, a scrub preview while the pointer
 * is down, and ONE op when it comes up.
 *
 * ## Why this is not inside `spacing-overlay.tsx`
 *
 * The bands are `aria-hidden`, deliberately — the same numbers are in the
 * inspector with real labels, and announcing eight of them on every arrow-key
 * move through the layer tree would bury that surface. A handle is the exact
 * opposite: it is focusable, and a focusable element inside an `aria-hidden`
 * subtree is a defect in every audit tool that exists, because a keyboard user
 * can reach something a screen reader is told is not there. So the bands keep
 * their `aria-hidden` and the handles sit beside them rather than within.
 *
 * ## One gesture, one entry in the history
 *
 * The document is written exactly once per gesture, on release. Everything
 * during the drag is a stylesheet this component mounts and throws away, which
 * is what `style-scrub.ts` was built for and what makes fifty pointer moves
 * cost one undo rather than fifty. The multi-side cases go through
 * `styleWriteOps`, which folds them into a single op — four `styleWriteOp`
 * calls would each carry a whole `styles` envelope and the last would win.
 *
 * ## The keyboard and the pointer are the SAME edit
 *
 * WCAG 2.5.7 asks for a non-drag path to anything reachable by dragging, and a
 * second implementation of "what does this gesture write" would satisfy the
 * letter of that while drifting from the pointer within a release. So both
 * paths call one `commit`, and both derive their direction from
 * `spacingDelta` — an arrow key is a one-pixel pointer movement, run through
 * the same sign table. The modifiers mean the same thing on both, which is why
 * the coarse keyboard step is on `PageUp`/`PageDown` rather than on `Shift`.
 *
 * ## A side showing nothing has no handle, and that is not a 2.5.7 gap
 *
 * `spacingBands` draws no band for a side that reports `0`, so there is nothing
 * to put a handle on. Such a side cannot be dragged either, so there is no drag
 * path needing an equivalent; the inspector's own fields are how a value starts
 * from nothing, and they are the click path this row's acceptance names.
 *
 * ## The preview's known edge, stated rather than hidden
 *
 * `scrubPreviewCss` warns that a rule mounted after the WHOLE compiled sheet
 * outranks the interaction states as well as the base one. This mounts after
 * the sheet, so while a BASE-state drag is in flight on a node that also
 * declares the same property for `hover`, hovering the block shows the scrubbed
 * base value instead of the hover value. It lasts only as long as the gesture,
 * the commit is unaffected, and placing the element beside the rules for its
 * own state needs the provenance trace the host does not pass here.
 *
 * @module spacing-handles
 */

import {
  getBlock,
  nodeClassNames,
  stylePropertiesForSupports,
  walkNodes,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import * as React from "react";
import { createPortal } from "react-dom";

import { CANVAS_ROOT_CLASS, CHROME_ATTRIBUTE } from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import type { EditorState } from "./editor-state";
import type { Rect } from "./geometry";
import { canvasPointerPoints, overlaySpaceOf } from "./geometry-dom";
import {
  followScrub,
  scrubModifiersOf,
  type ScrubSession,
  type ScrubTravel,
} from "./scrub-gesture";
import type { SideOrientation } from "./side-orientation";
import type {
  EdgeLengths,
  SpacingBand,
  SpacingBox,
  SpacingSide,
} from "./spacing-bands";
import {
  logicalSideFor,
  spacingAddress,
  spacingCssValue,
  spacingDelta,
  spacingBandDrawnOutward,
  spacingKeyDelta,
  spacingSidesFor,
  spacingStart,
  spacingValue,
  type SpacingModifiers,
  type SpacingScales,
} from "./spacing-drag";
import {
  scrubCommitOps,
  scrubPreviewCss,
  type ScrubTarget,
} from "./style-scrub";
import {
  readStyleValue,
  type StyleAddress,
  type StyleWrite,
} from "./style-values";

/** Everything about the measured block a gesture needs, taken once. */
export interface SpacingSubject {
  readonly nodeId: string;
  /** The used margins, in unscaled CSS pixels, as the bands report them. */
  readonly margin: EdgeLengths;
  /** The used paddings, in unscaled CSS pixels. */
  readonly padding: EdgeLengths;
  readonly scales: SpacingScales;
  /**
   * How the element runs, or `undefined` when it could not be read.
   *
   * Absent means NO handles. See `spacing-drag.ts`: a physical edge cannot be
   * turned into a logical address without it, and guessing left-to-right edits
   * the opposite side of every right-to-left block.
   */
  readonly orientation: SideOrientation | undefined;
  /**
   * Whether each band thickens AWAY from the block, per box and side.
   *
   * MEASURED rather than assumed, for both boxes. Which edge moves depends on
   * the layout: a block whose height fits its content grows its border edge
   * outward when its padding grows, one with a fixed height moves the content
   * edge inward — and a `margin-top` in normal flow moves the border edge down
   * while its outer edge stays pinned by whatever precedes it, which is the
   * opposite of what `margin-bottom` does. See `spacing-response.ts`. A handle
   * placed on the wrong edge sits still while the block moves away from it, and
   * the drag runs backwards.
   */
  readonly outward: Readonly<
    Record<SpacingBox, Readonly<Record<SpacingSide, boolean>>>
  >;
}

/** The tier a scrub writes to, and what the canvas compiled it with. */
export interface SpacingScrubContext {
  readonly address: Pick<StyleAddress, "state" | "breakpoint">;
  readonly breakpoints?: ScrubTarget["breakpoints"];
  readonly previewContainer?: string;
  readonly tokenPrefix?: string;
  readonly policy?: ScrubTarget["policy"];
  readonly scope?: string;
}

export interface SpacingHandlesProps {
  readonly editor: EditorState;
  readonly bands: readonly SpacingBand[];
  readonly subject: SpacingSubject;
  readonly context: SpacingScrubContext;
  /**
   * Re-measure the bands, because a preview has changed what they describe.
   *
   * Asked for EXPLICITLY rather than left to the overlay's own observers, and
   * the reason is in `canvas-geometry-watch.ts`: the style mutation watcher
   * ignores every record inside the overlay's own layer, so that drawing the
   * bands cannot schedule the next measurement. The scrub preview is a `<style>`
   * inside that layer, so it is invisible to the watcher by the same rule — and
   * `ResizeObserver` reports size, never position, so a margin preview that
   * moves a fixed-size block reports nothing either. Without this the block
   * slides under a band and a value chip that stay where the gesture started.
   */
  readonly onPreviewChange?: () => void;
  /**
   * Whether a gesture is in flight, so the host can keep this mounted.
   *
   * A preview can make its own block undescribable, and the measurement that
   * follows then has nothing to draw. Unmounting on that removes the control the
   * pointer is holding: the listeners detach, the preview goes, and the drag
   * ends without committing and without a word. The host keeps the subject
   * alive while this is true.
   */
  readonly onGestureChange?: (held: boolean) => void;
}

/**
 * How thick a handle's hit area is, in the author's pixels: 24, the minimum
 * target WCAG 2.2 asks of a pointer control, where its band has the room.
 */
const HANDLE_SCREEN_PX = 24;

/**
 * The least a handle's hit area is, in the author's pixels, on a band thinner
 * than this: centred on the band, so it reaches past it by a few pixels at
 * most. The Style panel's spacing fields edit the same values at full size.
 */
const HANDLE_FLOOR_PX = 9;

/** A gesture in flight. */
interface Gesture {
  readonly band: SpacingBand;
  /**
   * Which way the value grows, frozen at the press.
   *
   * A drag must not reverse under the hand. The answer is MEASURED, so it can
   * change while the pointer is down — the drag's own preview resizes the block,
   * and a block that gains a settled width answers the opposite way — and a
   * gesture that read it fresh would send the pointer one way and the number the
   * other, mid-stroke. Frozen for the same reason as the scale and the starting
   * values above it: these are properties OF the gesture.
   */
  readonly valueOutward: boolean;
  /** Every side of this box that has a usable starting value. */
  readonly starts: ReadonlyMap<SpacingSide, number>;
  /** Why each remaining side has none. See `commit`. */
  readonly refusals: ReadonlyMap<SpacingSide, string>;
  /** The pointer's part: threshold, capture and listeners. See `onPointerDown`. */
  readonly session: ScrubSession;
  /**
   * The modifiers the last preview was drawn with.
   *
   * The commit reads THIS rather than the release event. Letting go of Shift
   * before letting go of the button is an ordinary way to end a gesture, and
   * the two events then disagree: the canvas last showed four sides moving and
   * the release would write one. Whatever the author last SAW is what they
   * asked for.
   */
  shown: SpacingModifiers;
}

/**
 * A band that has been measured away, at the edge it collapsed to.
 *
 * `spacingBands` omits a side reporting `0`, and the band is only missing
 * because the drag took it there — so the honest picture is not the geometry it
 * had when the gesture began. Kept at its starting rectangle the handle sits
 * wherever the old value put it, which for a large padding is visibly far from
 * the pointer, and reports that old number to assistive technology for the rest
 * of the drag.
 *
 * The FIXED edge is the one that does not move: a band collapses onto it. Which
 * that is follows from the same table `handleRect` uses, read the other way
 * round.
 */
function collapsed(band: SpacingBand, outward: boolean): SpacingBand {
  const { rect, side } = band;
  const far = side === "bottom" || side === "right";
  const atMax = far === outward;
  const vertical = side === "top" || side === "bottom";
  // The moving edge has met the fixed one, so the band has no extent left.
  const anchored = atMax
    ? { ...rect, ...(vertical ? { height: 0 } : { width: 0 }) }
    : {
        ...rect,
        ...(vertical
          ? { y: rect.y + rect.height, height: 0 }
          : { x: rect.x + rect.width, width: 0 }),
      };
  return { ...band, rect: anchored, label: "0" };
}

/**
 * Apply a settled write, answering with the reason it did not land.
 *
 * The two `null`s here mean opposite things and only one of them is a refusal.
 * From the VALUE layer, `op: null` says the document already holds this — the
 * ordinary end of a drag that came back to where it started. From
 * `editor.apply`, `null` says the op was REJECTED, a document limit being the
 * likely cause, and nothing moved. Announcing the new value there tells a
 * screen-reader user an edit landed while the canvas snaps back to what it was.
 */
function applied(editor: EditorState, result: StyleWrite): string | undefined {
  if (!result.ok) {
    return (
      result.issues[0]?.message ?? "That spacing value cannot be used here."
    );
  }
  if (result.op === null) return undefined;
  return editor.apply(result.op) === null
    ? "That spacing change was not applied."
    : undefined;
}

/** Whether two rectangles share any pixels. */
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * Where every band's handle sits, in the bands' order.
 *
 * Each is placed alone first, and a handle whose strip would overlap another
 * on its side is placed again, splitting the stretch the two share. Both
 * passes at the one `scale`: at a zoom the least size grows in the bands'
 * units, so two strips that clear each other at 100% can overlap at 50%, and
 * a check made at another scale than the placement would miss it.
 *
 * @param edgeOf - whether a band's moving edge is its outward one
 * @param scale - the canvas's painted zoom, 1 outside a frame
 * @internal
 */
export function placeHandles(
  bands: readonly SpacingBand[],
  edgeOf: (band: SpacingBand) => boolean,
  scale: number
): Rect[] {
  const alone = bands.map(band =>
    handleRect(band, edgeOf(band), undefined, scale)
  );
  return bands.map((band, index) => {
    const own = alone[index];
    if (own === undefined) throw new Error("a band without a handle");
    const partner = bands.findIndex((other, at) => {
      const theirs = alone[at];
      return (
        at !== index &&
        other.side === band.side &&
        theirs !== undefined &&
        overlaps(own, theirs)
      );
    });
    const other = bands[partner];
    return other === undefined
      ? own
      : handleRect(band, edgeOf(band), shareWith(band, other), scale);
  });
}

/**
 * The stretch two overlapping handles split between them: the union of their
 * bands along the side's axis, and which half this one takes.
 */
interface HandleShare {
  readonly low: number;
  readonly room: number;
  /** This handle takes the half at the block's outside: the margin's. */
  readonly outer: boolean;
}

/** The share of `band`'s handle beside `other`'s, which it overlaps. */
function shareWith(band: SpacingBand, other: SpacingBand): HandleShare {
  const across = band.side === "top" || band.side === "bottom";
  const from = (rect: Rect) => (across ? rect.y : rect.x);
  const to = (rect: Rect) =>
    across ? rect.y + rect.height : rect.x + rect.width;
  const low = Math.min(from(band.rect), from(other.rect));
  const high = Math.max(to(band.rect), to(other.rect));
  return { low, room: high - low, outer: band.box === "margin" };
}

/**
 * Where a handle's strip sits on its band.
 *
 * INSIDE the band, flush with the edge that moves. The band is the one place a
 * press can only mean this control: past its outer edge is the neighbour the
 * margin spaces the block from, and past its inner edge are the block's own
 * children, and a press on either has to select what is there. A centred
 * strip reached half its thickness into both.
 *
 * A band thinner than the strip is the strip, all of it; one thinner than
 * {@link HANDLE_FLOOR_PX} gets that much, centred on it.
 *
 * `share` splits the stretch two handles would overlap on. A negative
 * margin's band is laid inside the border edge, where padding's is, so the two
 * start at one edge; the padding's, drawn later, would otherwise take every
 * press there. The margin takes the half at the block's outside and the
 * padding the half inside it, the order the two boxes have, so both strips
 * take pointer events.
 */
function handleRect(
  band: SpacingBand,
  outward: boolean,
  share?: HandleShare,
  scale = 1
): Rect {
  const { rect, side } = band;
  const across = side === "top" || side === "bottom";
  const far = side === "bottom" || side === "right";
  const size = HANDLE_SCREEN_PX / scale;
  const floor = HANDLE_FLOOR_PX / scale;
  const at = (from: number, thickness: number): Rect =>
    across
      ? { x: rect.x, y: from, width: rect.width, height: thickness }
      : { x: from, y: rect.y, width: thickness, height: rect.height };

  if (share !== undefined) {
    const { low, room } = share;
    const thickness = Math.max(Math.min(size, room / 2), floor);
    // Centred as a pair where the two need more room than there is.
    const centring = thickness * 2 > room ? (room - thickness * 2) / 2 : 0;
    // The block's outside is the low end on the top and left, the high end on
    // the bottom and right.
    const offset = centring + (share.outer ? 0 : thickness);
    return at(far ? low + room - offset - thickness : low + offset, thickness);
  }

  /*
   * The edge that MOVES when the value grows, which is where the control
   * belongs. `outward` says which one that is, and it is a property of neither
   * the box nor the side: both boxes depend on the block's sizing model, so both
   * are measured. See `spacingBandDrawnOutward` and `spacing-response.ts`.
   */
  const atMax = far === outward;
  const low = across ? rect.y : rect.x;
  const room = across ? rect.height : rect.width;
  const thickness = Math.max(Math.min(size, room), floor);
  // A band thinner than the floor: the strip centred on it.
  const inset = thickness > room ? (room - thickness) / 2 : 0;
  return at(atMax ? low + room - inset - thickness : low + inset, thickness);
}

/** The words an author reads for one side of one box. */
function handleLabel(band: SpacingBand): string {
  return `${band.side} ${band.box}`;
}

/** One side's settled value, as both the preview and the commit read it. */
interface SpacingWrite {
  readonly address: StyleAddress;
  readonly value: string;
  readonly side: SpacingSide;
  readonly px: number;
}

/**
 * What the live region says once a gesture has landed.
 *
 * A single side names itself, because that is what the author grabbed. A
 * multi-side gesture names the BOX and lists the values rather than repeating
 * four side names, which is a sentence nobody finishes listening to.
 */
function committedMessage(
  band: SpacingBand,
  writes: readonly SpacingWrite[]
): string {
  const [only] = writes;
  if (writes.length === 1 && only !== undefined) {
    return `${handleLabel(band)} ${String(only.px)} pixels`;
  }
  return `${band.box} ${writes.map(write => String(write.px)).join(", ")} pixels`;
}

/**
 * Only the sides this gesture actually MOVED.
 *
 * A drag that wanders and comes back, or one whose travel rounds to no pixels,
 * would otherwise write every side the value it already has — which the value
 * layer turns into a real op wherever the node held nothing of its own, because
 * `undefined` and `10px` are a genuine difference to it. The author's reward for
 * a gesture they abandoned would be an undo entry and four explicit overrides
 * they never asked for.
 *
 * Filtered per SIDE rather than on the delta as a whole, so a Shift drag that
 * pushes one padding against its floor still writes the three that moved.
 */
function movedWrites(
  writes: readonly SpacingWrite[],
  starts: ReadonlyMap<SpacingSide, number>
): readonly SpacingWrite[] {
  return writes.filter(write => write.px !== starts.get(write.side));
}

/**
 * Why this gesture cannot be written, or `undefined` when it can.
 *
 * A side the gesture ASKED for and cannot write refuses the whole thing. Shift
 * and Alt promise every side, or the pair across; writing only the subset that
 * happens to be plain pixels would honour that promise partially and silently —
 * an author holding Shift over a box whose left margin is a token would get
 * three sides moved and nothing to say the fourth stayed put.
 *
 * Asked per COMMIT rather than at the press, because the modifier is read live:
 * which sides are being requested changes under the hand, so which refusals
 * matter changes with it.
 */
function blockingRefusal(
  band: SpacingBand,
  refusals: ReadonlyMap<SpacingSide, string>,
  modifiers: SpacingModifiers
): string | undefined {
  for (const side of spacingSidesFor(band.side, modifiers)) {
    const reason = refusals.get(side);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

export function SpacingHandles({
  editor,
  bands,
  subject,
  context,
  onPreviewChange,
  onGestureChange,
}: SpacingHandlesProps): React.JSX.Element | null {
  const gesture = React.useRef<Gesture | null>(null);
  /**
   * What the current render knows, readable from a listener installed earlier.
   *
   * A gesture's document listeners are created once, at the press, and close
   * over the values of that render. Most of them are properties OF the gesture
   * and are right to freeze — the scale it is measured in, the values it
   * started from. The node's styles are not: the document can move while the
   * pointer is down, and a whole-envelope patch built from a stale snapshot
   * un-does whatever happened in between. The canvas keeps a `latest` ref for
   * the same reason.
   */
  const latest = React.useRef<{
    styles: BlockNode["styles"];
    nodeId: string;
    /** The tier the surface is editing, so a gesture can notice it moved. */
    tier: string;
    /** The canvas scale it is painted at, for the same reason. */
    scale: string;
  }>({ styles: undefined, nodeId: "", tier: "", scale: "" });
  const [preview, setPreview] = React.useState<string | null>(null);
  /*
   * Over a frame the handles are drawn in the editor's document, scaled with
   * the page, while the preview has to reach the page in the frame's.
   */
  const canvas = useCanvasFrame();
  const handleScale = canvas.frame === null ? 1 : canvas.scale;
  const previewHost =
    canvas.frame === null ? null : (canvas.document?.head ?? null);
  /**
   * The band a gesture is holding, kept alive for the gesture's lifetime.
   *
   * `spacingBands` draws nothing for a side reporting `0`, so dragging a
   * padding down to its floor makes the preview re-measure, drops that band,
   * and unmounts the very handle the pointer is captured on. The browser then
   * releases capture and the gesture is stranded: preview live, nothing
   * committed, no listener able to clean it up. Held in STATE rather than read
   * off the gesture ref, because keeping an element mounted is a rendering
   * decision and has to survive the re-render the measurement causes.
   */
  const [held, setHeld] = React.useState<SpacingBand | null>(null);
  /**
   * The MEASURED response a pointer gesture began with, before any mirroring.
   *
   * Unmirrored on purpose. Which edge of the drawn rectangle carries the handle
   * depends on the band's sign as well, and a drag can change that sign by
   * carrying a margin through zero — so the sign is applied where the handle is
   * placed rather than baked in here.
   *
   * `null` whenever no pointer gesture is live, which includes a band merely
   * held by focus: each key press is an edit of its own and reads the current
   * measurement, so freezing there would pin the handle to an answer the block
   * has stopped giving.
   */
  const [draggedResponse, setDraggedResponse] = React.useState<boolean | null>(
    null
  );
  const [message, setMessage] = React.useState("");

  const { document: doc } = editor;
  const { nodeId, orientation } = subject;

  /*
   * The class the compiler emitted for this node, read from the WHOLE document.
   * `nodeClassName` on the id alone cannot see a hash collision, and on a
   * document where the compiler had already disambiguated one the preview would
   * be written against another node's class — so the drag would move a
   * different block, or nothing at all.
   */
  const nodeClass = React.useMemo(() => {
    const ids: string[] = [];
    walkNodes(doc.nodes, node => ids.push(node.id));
    return nodeClassNames(ids).get(nodeId);
  }, [doc, nodeId]);

  /** The node as the document currently holds it. */
  const node = React.useMemo(() => {
    let found: (typeof doc.nodes)[number] | undefined;
    walkNodes(doc.nodes, one => {
      if (one.id === nodeId) found = one;
    });
    return found;
  }, [doc, nodeId]);

  /**
   * Which spacing boxes this block's author allows to be written.
   *
   * ASKED of the engine, exactly as `style-inspector.ts` asks it. `supports` is
   * a capability declaration whose meaning belongs to the registry, and a
   * handle that ignored it would offer an edit the Style panel deliberately
   * withholds — a block that renders a heading's native margin without opting
   * into margin support would gain a writable control on the canvas and none in
   * the inspector.
   *
   * A block the registry does not know offers nothing, which is the same answer
   * the panel gives: it can still CLEAR what is stored, and clearing is not
   * something a drag does.
   */
  const writable = React.useMemo(() => {
    const type = node?.type;
    const definition = type === undefined ? undefined : getBlock(type);
    if (definition === undefined) return new Set<string>();
    return new Set(
      stylePropertiesForSupports(definition.supports).map(
        entry => entry.property
      )
    );
  }, [node?.type]);

  /** The tier this render is editing, as one comparable value. */
  const tier = `${context.address.state}\u0000${context.address.breakpoint}`;

  /** The scale this render measures in, as one comparable value. */
  const scaleKey = `${String(subject.scales.scale.x)},${String(
    subject.scales.scale.y
  )},${String(subject.scales.marginScale.x)},${String(
    subject.scales.marginScale.y
  )}`;

  // Refreshed on every render, so a listener from an earlier one reads today's
  // document rather than the one the gesture began in.
  latest.current.styles = node?.styles;
  latest.current.nodeId = nodeId;
  latest.current.tier = `${context.address.state}\u0000${context.address.breakpoint}`;
  latest.current.scale = scaleKey;

  /**
   * Which edge of the drawn band carries its handle, and ONLY that.
   *
   * Not the direction a drag grows the value: `valueOutwardOf` below answers
   * that, unmirrored, and the two disagree for a negative band — which is drawn
   * reflected across the border edge while the edge the layout moves stays
   * where it was. Reading placement as direction runs those drags backwards.
   *
   * MEASURED for both boxes, a margin no less than a padding. The reasoning that
   * makes a margin look structural — that it lies outside the border box and so
   * cannot move it — is one the element disagrees with: growing `margin-top`
   * drives the border edge down while the outer edge stays pinned by whatever
   * precedes it. See `spacing-response.ts`, which asks rather than assumes.
   */
  const drawnOutwardOf = React.useCallback(
    (band: SpacingBand): boolean =>
      spacingBandDrawnOutward(
        band.negative,
        subject.outward[band.box][band.side]
      ),
    [subject.outward]
  );

  /**
   * Which way the VALUE grows, which is a different question from where the
   * handle sits.
   *
   * The measured answer, taken unmirrored. A negative band is drawn reflected
   * across the border edge, so its rectangle's far edge swaps — but the
   * physical edge that responds does not, and neither does the arithmetic:
   * raising a `margin-top` from `-20px` to `-10px` moves the border edge down,
   * exactly as raising a positive one does. Feeding the mirrored answer to
   * `spacingDelta` made a drag on the correctly placed handle commit `-30px`
   * and run the block away from the pointer.
   */
  const valueOutwardOf = React.useCallback(
    (band: SpacingBand): boolean => subject.outward[band.box][band.side],
    [subject.outward]
  );

  /**
   * Where this band's handle sits, holding still for the band being dragged.
   *
   * Everything else takes the current measurement. The band under a pointer
   * takes the one its gesture began with, because the alternative is a handle
   * that jumps to the opposite edge of its own band mid-stroke: the drag's
   * preview resizes the block, a block that gains a settled width answers the
   * other way, and the arithmetic is frozen at the press regardless. Reading the
   * two from different moments is what puts the pointer and the number in
   * disagreement.
   */
  const drawnEdgeOf = React.useCallback(
    (band: SpacingBand): boolean => {
      const dragging =
        held !== null && held.box === band.box && held.side === band.side;
      /*
       * Mirrored against the band as it is drawn NOW, not as it was drawn at
       * the press. A drag can carry a margin through zero, and `spacingBands`
       * reflects a negative one across the border edge — so the rectangle's far
       * edge swaps while the measurement that decides which edge responds does
       * not. Freezing the mirrored answer would leave the handle on the edge the
       * old sign put it, and it would stop following the pointer there.
       */
      return dragging && draggedResponse !== null
        ? spacingBandDrawnOutward(band.negative, draggedResponse)
        : drawnOutwardOf(band);
    },
    [draggedResponse, drawnOutwardOf, held]
  );

  const targetFor = React.useCallback(
    (address: StyleAddress): ScrubTarget | undefined =>
      nodeClass === undefined
        ? undefined
        : {
            nodeId,
            nodeClass,
            address,
            ...(context.breakpoints === undefined
              ? {}
              : { breakpoints: context.breakpoints }),
            ...(context.previewContainer === undefined
              ? {}
              : { previewContainer: context.previewContainer }),
            ...(context.tokenPrefix === undefined
              ? {}
              : { tokenPrefix: context.tokenPrefix }),
            ...(context.policy === undefined ? {} : { policy: context.policy }),
            ...(context.scope === undefined ? {} : { scope: context.scope }),
            /*
             * What else this node declares, so a preview for one state does not
             * outrank another. See `ScrubTarget.styles`: every state compiles at
             * equal specificity and later wins on order, so a base-state drag
             * would otherwise repaint the block's hover value for as long as the
             * pointer was over it.
             */
            ...(node?.styles === undefined ? {} : { styles: node.styles }),
          },
    [context, node?.styles, nodeClass, nodeId]
  );

  /**
   * The address one physical side of this box writes to.
   *
   * `undefined` when the element's orientation could not be read, which is the
   * refusal the whole feature inherits rather than a case to paper over.
   */
  const addressFor = React.useCallback(
    (band: SpacingBand, side: SpacingSide): StyleAddress | undefined =>
      orientation === undefined
        ? undefined
        : spacingAddress(band.box, logicalSideFor(side, orientation), {
            state: context.address.state,
            breakpoint: context.address.breakpoint,
          }),
    [context.address.breakpoint, context.address.state, orientation]
  );

  /**
   * Where every side of this box would start from, and why one cannot.
   *
   * Taken once at the START of a gesture rather than per move, so that holding
   * Shift halfway through a drag picks up the other sides from where they were
   * when the hand went down — not from wherever the preview has since implied.
   */
  const startsFor = React.useCallback(
    (
      band: SpacingBand
    ): {
      starts: Map<SpacingSide, number>;
      refusals: Map<SpacingSide, string>;
    } => {
      const used = band.box === "margin" ? subject.margin : subject.padding;
      const starts = new Map<SpacingSide, number>();
      const refusals = new Map<SpacingSide, string>();
      for (const side of ["top", "right", "bottom", "left"] as const) {
        const address = addressFor(band, side);
        if (address === undefined) continue;
        const stored =
          node === undefined ? undefined : readStyleValue(node.styles, address);
        const start = spacingStart(stored, used[side]);
        if (start.ok) starts.set(side, start.px);
        else refusals.set(side, start.reason);
      }
      return { starts, refusals };
    },
    [addressFor, node, subject.margin, subject.padding]
  );

  /**
   * The values one gesture would write, keyed by side.
   *
   * Shared by the preview and the commit so the two cannot disagree about what
   * the drag means: a preview computed one way and a commit another is exactly
   * the snap-back on release that `style-scrub` warns about.
   */
  const valuesFor = React.useCallback(
    (
      band: SpacingBand,
      starts: ReadonlyMap<SpacingSide, number>,
      delta: number,
      modifiers: SpacingModifiers
    ): SpacingWrite[] =>
      spacingSidesFor(band.side, modifiers).flatMap(side => {
        const start = starts.get(side);
        const address = addressFor(band, side);
        if (start === undefined || address === undefined) return [];
        const px = spacingValue(start, delta, band.box);
        return [{ address, value: spacingCssValue(px), side, px }];
      }),
    [addressFor]
  );

  /** Write the gesture's result to the document, as ONE op. */

  const commit = React.useCallback(
    (
      band: SpacingBand,
      starts: ReadonlyMap<SpacingSide, number>,
      refusals: ReadonlyMap<SpacingSide, string>,
      delta: number,
      modifiers: SpacingModifiers
    ): void => {
      const blocked = blockingRefusal(band, refusals, modifiers);
      if (blocked !== undefined) {
        setMessage(blocked);
        return;
      }
      /*
       * Only the sides this gesture actually MOVED.
       *
       * A drag that wanders and comes back, or one whose travel rounds to no
       * pixels, would otherwise write every side its value already has — which
       * the value layer turns into an op wherever the node held nothing of its
       * own, because `undefined` and `10px` are a real difference to it. The
       * author's reward for a gesture they abandoned is an undo entry and four
       * explicit overrides they never asked for.
       *
       * Filtered per SIDE rather than on the delta as a whole, so a Shift drag
       * that pushes one padding against its floor still writes the three sides
       * that moved.
       */
      const writes = movedWrites(
        valuesFor(band, starts, delta, modifiers),
        starts
      );
      const first = writes[0];
      if (first === undefined) return;
      const target = targetFor(first.address);
      if (target === undefined) return;
      /*
       * The gesture must still be about the block it started on.
       *
       * This component is not keyed on the node, so selecting another block
       * mid-drag — from the Layers panel, say — re-renders it in place with a
       * new subject while the listeners installed at the press keep running.
       * The styles read above would then be the NEW block's whole envelope, and
       * the op names the OLD one: releasing would copy one block's styling over
       * another's. A gesture whose subject moved is abandoned, not committed.
       */
      if (latest.current.nodeId !== nodeId) return;
      /*
       * And it must still be about the tier it started in.
       *
       * The state switcher and the canvas width are outside this component, so
       * either can move while the pointer is down — a second pointer on the
       * switcher, or a panel resize that changes the edited breakpoint. The
       * addresses this gesture carries were built at the press and name the OLD
       * tier, so releasing would commit into a tier the canvas and the inspector
       * have both stopped showing: an edit an author cannot see landing
       * somewhere they are not looking.
       */
      if (latest.current.tier !== tier) return;
      /*
       * And the canvas must still be painted at the scale the gesture began in.
       *
       * A shell panel resizing, or the window changing, can alter fit zoom
       * without crossing a breakpoint — so the tier guard above does not see it.
       * The origin was converted to content coordinates at the OLD scale while
       * every later point is converted at the new one, so their subtraction
       * reports a large movement for a pointer that never moved, and the result
       * is then divided by the frozen old scale before it is committed.
       */
      if (latest.current.scale !== scaleKey) return;
      const result = scrubCommitOps(
        target,
        /*
         * Read NOW, not closed over at the press.
         *
         * A style op patches the whole envelope, and the document can move
         * while the pointer is down — the editor's own undo shortcut is enough.
         * Built from the snapshot the gesture began with, the patch would carry
         * every declaration that snapshot held, so releasing would restore an
         * undone value or erase an edit made mid-drag. The gesture's own sides
         * are folded into whatever the node holds at the moment of release.
         */
        latest.current.styles,
        writes.map(write => ({ address: write.address, value: write.value }))
      );
      setMessage(applied(editor, result) ?? committedMessage(band, writes));
    },
    // `node.styles` is deliberately absent: the commit reads the LATEST styles
    // through a ref, so rebuilding this callback per edit would only replace the
    // listeners of a gesture already in flight.
    [editor, nodeId, scaleKey, targetFor, tier, valuesFor]
  );

  /** Draw the gesture's result without touching the document. */
  const showPreview = React.useCallback(
    (
      band: SpacingBand,
      starts: ReadonlyMap<SpacingSide, number>,
      refusals: ReadonlyMap<SpacingSide, string>,
      delta: number,
      modifiers: SpacingModifiers
    ): void => {
      /*
       * The SAME gate the commit applies. Without it, holding Shift over a box
       * whose left margin is a token previews the three sides that can move and
       * then refuses everything on release — the canvas showing an edit that
       * was never available, and taking it back at the moment the author let
       * go. A refusal the preview does not honour is a promise the commit
       * breaks.
       */
      if (blockingRefusal(band, refusals, modifiers) !== undefined) {
        setPreview(null);
        return;
      }
      const rules: string[] = [];
      for (const write of valuesFor(band, starts, delta, modifiers)) {
        const target = targetFor(write.address);
        if (target === undefined) continue;
        const css = scrubPreviewCss(target, write.value);
        // A refused value draws nothing rather than drawing the last accepted
        // one: a preview that lags the pointer reads as the drag having stuck.
        if (css.ok) rules.push(css.css);
      }
      setPreview(rules.length === 0 ? null : rules.join("\n"));
    },
    [targetFor, valuesFor]
  );

  const endGesture = React.useCallback((): void => {
    const live = gesture.current;
    gesture.current = null;
    setPreview(null);
    setHeld(null);
    setDraggedResponse(null);
    // Ends the session too; a session ending itself comes back here, once.
    live?.session.end();
  }, []);

  /**
   * Begin a gesture, and follow it on the DOCUMENT rather than on the handle.
   *
   * The handle is a nine-pixel strip, and the activation threshold is four: a
   * pointer that has travelled far enough to mean a drag has usually left the
   * strip already. Listening on the handle alone therefore cannot work, and it
   * fails by DEADLOCK rather than by dropping the occasional event — capture is
   * what keeps later moves coming back to the element, capture waits for
   * activation, and activation needs the very moves that stopped arriving. The
   * gesture simply never starts, and the handle reads as inert.
   *
   * Measured in a browser, which is the only place it shows: a test that fires
   * `pointermove` AT the handle delivers events the real DOM would have sent to
   * whatever the pointer is over, and passes against exactly this.
   *
   * The handlers close over the gesture's own inputs at the moment of the press.
   * That is the intended reading rather than a limitation: the scale a drag is
   * measured in and the styles it starts from are properties of when the hand
   * went down, and nothing writes the document until it comes up.
   */
  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>, band: SpacingBand): void => {
      // Only the primary button starts an edit; a context-menu press must not.
      if (event.button !== 0) return;
      /*
       * One gesture at a time. A second finger, or a pen alongside a touch,
       * also arrives with `button === 0`: accepted, it would replace the live
       * gesture's band and starts while the first pointer's document listeners
       * stayed installed, so the first pointer would go on driving — writing
       * the second gesture's side — and one listener set would leak.
       */
      if (gesture.current !== null) return;
      const { starts, refusals } = startsFor(band);
      const refusal = refusals.get(band.side);
      if (refusal !== undefined) {
        setMessage(refusal);
        return;
      }
      if (!starts.has(band.side)) return;
      event.preventDefault();

      const host = event.currentTarget;
      const originX = event.clientX;
      const originY = event.clientY;

      /*
       * The canvas root, so pointer travel can be expressed in the SAME space
       * the bands were measured in.
       */
      const space = overlaySpaceOf(host, CANVAS_ROOT_CLASS);
      const root = space?.root ?? null;
      /*
       * A pointer on a handle drawn over a frame is reported in the EDITOR's
       * client coordinates, and the root's rectangles are read in the frame's:
       * carried across first, through the one mapping every gesture uses.
       */
      const inCanvas = (x: number, y: number): { x: number; y: number } =>
        space === null ? { x, y } : space.pointInCanvas({ x, y });
      const pressed = inCanvas(originX, originY);
      const origin =
        root === null ? null : canvasPointerPoints(pressed.x, pressed.y, root);

      /**
       * How far the pointer has moved in the root's own CONTENT space, which is
       * what the VALUE comes from. The activation threshold is the shared
       * gesture's, in client pixels: whether a press was meant as a drag is a
       * property of the hand, and measured in canvas pixels it would shrink
       * with the zoom.
       *
       * The two differ by the root's painted scale, which `renderedScale`
       * deliberately stops below — the bands are children of the root and are
       * drawn through its transform already, so their rectangles need no such
       * factor. A pointer does: its coordinates come from the screen with the
       * root's zoom baked in. Left unconverted, a canvas painted at half size
       * moves the value half as far as the handle under the hand — and it is
       * invisible at 100%, which is where a drag is usually tried.
       *
       * Converted through `canvasPointerPoints`, which is what `canvas-drag`
       * aims with. A subtraction of its own here would be a second mapping,
       * free to disagree with the one every other gesture on this canvas uses.
       */
      const travelled = (
        moved: PointerEvent,
        hand: ScrubTravel
      ): { readonly dx: number; readonly dy: number } => {
        if (root === null || origin === null) return hand;
        const at = inCanvas(moved.clientX, moved.clientY);
        const now = canvasPointerPoints(at.x, at.y, root);
        return {
          dx: now.content.x - origin.content.x,
          dy: now.content.y - origin.content.y,
        };
      };

      /*
       * The press, its threshold, capture, Escape and the document listeners
       * are the shared scrub gesture's, which the inspector's labels use too:
       * see `scrub-gesture.ts` for why each is where it is.
       */
      const session = followScrub(
        {
          pointerId: event.pointerId,
          clientX: originX,
          clientY: originY,
          host,
        },
        {
          onMove: (moved, hand) => {
            const live = gesture.current;
            if (live === null) return;
            const delta = spacingDelta(
              live.band.box,
              live.band.side,
              travelled(moved, hand),
              subject.scales,
              live.valueOutward
            );
            if (delta === undefined) return;
            const shown = scrubModifiersOf(moved);
            live.shown = shown;
            showPreview(live.band, live.starts, live.refusals, delta, shown);
          },
          onRelease: (lifted, hand) => {
            const live = gesture.current;
            if (live === null) return;
            const delta = spacingDelta(
              live.band.box,
              live.band.side,
              travelled(lifted, hand),
              subject.scales,
              live.valueOutward
            );
            if (delta === undefined) return;
            /*
             * `live.shown`, not the release event's modifiers. See `shown`:
             * releasing Shift before the button is ordinary, and reading the
             * release would commit a different edit from the one on screen.
             */
            commit(live.band, live.starts, live.refusals, delta, live.shown);
          },
          onEscape: () => setMessage("Spacing drag cancelled."),
          onEnd: endGesture,
        }
      );

      setHeld(band);
      /*
       * Frozen together, from one reading, so the edge the handle sits on and
       * the direction the number moves cannot come from different measurements.
       */
      setDraggedResponse(valueOutwardOf(band));
      gesture.current = {
        band,
        valueOutward: valueOutwardOf(band),
        starts,
        refusals,
        shown: scrubModifiersOf(event),
        session,
      };
    },
    [commit, endGesture, showPreview, startsFor, subject.scales, valueOutwardOf]
  );

  /*
   * After the browser has applied the preview, ask for a fresh measurement.
   *
   * A LAYOUT effect, so the bands are re-read before the frame is painted and
   * never appear a step behind the block they describe. Keyed on the preview
   * text: an unchanged preview re-measures nothing, and clearing it on release
   * measures once more against the committed document.
   */
  React.useLayoutEffect(() => {
    onPreviewChange?.();
  }, [onPreviewChange, preview]);

  // Reported from `held`, which is set for a pointer gesture and for a focused
  // keyboard one alike — both need the control to outlive a vanished band.
  React.useEffect(() => {
    onGestureChange?.(held !== null);
  }, [held, onGestureChange]);

  /*
   * A gesture does not outlive the handles. The overlay unmounts them whenever
   * the selection changes or a canvas drag starts, and listeners left on the
   * document would then commit against a node nobody is editing — or leak one
   * pair per press for the life of the editor.
   */
  React.useEffect(() => () => gesture.current?.session.end(), []);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>, band: SpacingBand): void => {
      /*
       * Escape is handled on the document for the life of a gesture, not here:
       * a drag started on an unfocused handle never gives this element the key.
       */
      /*
       * The direction lives in `spacing-drag.ts` and runs through the same sign
       * table the pointer does, so the two paths cannot come to disagree about
       * which way a key grows a value. A key this band does not answer to is
       * left alone rather than swallowed.
       */
      const delta = spacingKeyDelta(
        event.key,
        band.box,
        band.side,
        valueOutwardOf(band)
      );
      if (delta === undefined) return;
      /*
       * A pointer gesture owns the value until it is released.
       *
       * The handle can hold focus while a drag is in flight, so an arrow key
       * pressed mid-drag would commit immediately — and the release, built from
       * the starts taken at the PRESS, would then overwrite it. The author's key
       * edit disappears and the history keeps an entry for it, which is the
       * worst of both. Escape is already filtered this way on the document
       * listener; this is the same rule for the keys that write.
       */
      if (gesture.current !== null) return;

      event.preventDefault();
      const { starts, refusals } = startsFor(band);
      /*
       * The band this key is about is held for as long as the handle has focus.
       *
       * Stepping a 1px padding down to zero makes `spacingBands` stop drawing
       * it, and the focused control would unmount underneath the author — focus
       * falls back to the body, and the next press goes nowhere. A margin can
       * legitimately continue through zero into negative values, so losing the
       * handle there loses half the range as well.
       */
      setHeld(band);
      commit(band, starts, refusals, delta, scrubModifiersOf(event));
    },
    [commit, startsFor, valueOutwardOf]
  );

  /*
   * The live region is ALWAYS mounted and only its text changes. A polite
   * region inserted already carrying its message is not reliably announced, so
   * a keyboard author would miss the value they just set — the same reason
   * `BuilderNoticeRegion` keeps its container permanently.
   */
  const region = (
    <div
      className="nx-spacing-handles__status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );

  /**
   * The bands that get a handle: the measured ones, plus the one being held.
   *
   * A gesture outlives its own band whenever the value it is dragging reaches
   * zero, and the handle has to outlive it too — see `held`. Matched by box and
   * side rather than by identity, since every measurement builds fresh objects.
   */
  const drawn =
    held === null ||
    bands.some(band => band.box === held.box && band.side === held.side)
      ? bands
      : [...bands, collapsed(held, drawnEdgeOf(held))];

  if (orientation === undefined || nodeClass === undefined) {
    /*
     * No handles at all. Without an orientation a physical edge cannot be
     * turned into a logical address, and without the emitted class a preview
     * cannot be aimed — both are cases where the honest thing is to offer
     * nothing rather than to edit a side the author did not grab.
     */
    return region;
  }

  /*
   * Split with another handle where the two would overlap.
   *
   * A negative margin's band is laid inside the border edge, where padding's
   * is — so `margin-top: -16px` beside `padding-top: 20px` gives two bands
   * from one edge. Padding is drawn later, so its handle would take every
   * press there and the margin's control would be advertised and unreachable.
   */
  /*
   * No handle where the block's author did not offer the property. The band
   * still draws — it reports what the page renders, which is true either way —
   * but a control that wrote it would bypass a capability declaration the
   * Style panel honours. Left out BEFORE the handles are placed, so a handle
   * with no partner drawn beside it keeps its whole band.
   */
  const handled = drawn.filter(band => writable.has(band.box));
  const placed = placeHandles(handled, drawnEdgeOf, handleScale);

  return (
    <>
      {handled.map((band, index) => {
        const rect = placed[index];
        if (rect === undefined) return null;
        return (
          <div
            key={`${band.box}-${band.side}`}
            className="nx-spacing-handles__handle"
            data-box={band.box}
            data-side={band.side}
            /*
             * Marked as chrome so the canvas does not resolve a press on it to
             * the block underneath. The bands themselves are not marked, and
             * must not be: they take no pointer events at all.
             */
            {...{ [CHROME_ATTRIBUTE]: "" }}
            /*
             * Deliberately NOT `role="slider"`.
             *
             * A slider's `aria-valuemin` and `aria-valuemax` default to 0 and
             * 100 when omitted, so the role asserts a range whether or not one
             * is given. This control has no such range: the catalog lets a
             * margin go negative and neither box has a ceiling, so every
             * negative margin and every value above 100 would be reported to
             * assistive technology as outside its own control's bounds. Stating
             * bounds instead would mean inventing two numbers the catalog does
             * not have, which misreports the control in the other direction.
             *
             * So the value goes in the NAME, where it needs no range to be
             * meaningful and is read on focus, and every change is announced
             * through the live region below. A focusable element with an
             * accurate name and a spoken result describes this control honestly;
             * a slider with a fabricated range does not.
             */
            /*
             * `spinbutton`, not `slider` and not a bare `div`.
             *
             * A `div` keeps the generic role, and naming a generic role is
             * prohibited — so `aria-label` on one is not exposed, and a
             * keyboard user reaches an unnamed element with nothing to say that
             * arrows adjust it. `slider` names itself but defaults
             * `aria-valuemin`/`aria-valuemax` to 0 and 100 when they are
             * omitted, which would report every negative margin and every value
             * over a hundred as outside its own range, and there are no honest
             * bounds to state instead.
             *
             * A spinbutton is the adjustable-number role whose bounds are
             * OPTIONAL: absent, it simply has none, which is the truth here.
             * Arrow keys are its native interaction, which is what this is.
             */
            role="spinbutton"
            tabIndex={0}
            aria-label={handleLabel(band)}
            aria-valuenow={Number(band.label)}
            aria-valuetext={`${band.label} pixels`}
            /*
             * Only the press is bound here. Everything after it is followed on
             * the document, because a pointer that has travelled far enough to
             * mean a drag has already left this nine-pixel strip.
             */
            onPointerDown={event => onPointerDown(event, band)}
            onKeyDown={event => onKeyDown(event, band)}
            /*
             * The keyboard's claim on a band ends when focus does. A pointer
             * gesture still in flight keeps its own claim: it is the one that
             * has to survive to its release.
             */
            onBlur={() => {
              if (gesture.current === null) setHeld(null);
            }}
            style={{
              left: `${String(rect.x)}px`,
              top: `${String(rect.y)}px`,
              width: `${String(rect.width)}px`,
              height: `${String(rect.height)}px`,
            }}
          />
        );
      })}
      {preview === null ? null : previewHost === null ? (
        <style>{preview}</style>
      ) : (
        createPortal(<style>{preview}</style>, previewHost)
      )}
      {region}
    </>
  );
}
