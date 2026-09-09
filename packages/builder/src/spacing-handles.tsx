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

import { CANVAS_ROOT_CLASS, CHROME_ATTRIBUTE } from "./canvas";
import type { EditorState } from "./editor-state";
import type { Rect } from "./geometry";
import { canvasPointerPoints, canvasRootFrom } from "./geometry-dom";
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
  spacingGrowsOutward,
  spacingKeyDelta,
  spacingSidesFor,
  spacingStart,
  spacingValue,
  SPACING_ACTIVATION_PX,
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

/** How thick a handle's hit area is, in canvas pixels. */
const HANDLE_PX = 9;

/** A gesture in flight. */
interface Gesture {
  readonly band: SpacingBand;
  /** Every side of this box that has a usable starting value. */
  readonly starts: ReadonlyMap<SpacingSide, number>;
  /** Why each remaining side has none. See `commit`. */
  readonly refusals: ReadonlyMap<SpacingSide, string>;
  readonly originX: number;
  readonly originY: number;
  active: boolean;
  readonly pointerId: number;
  readonly host: HTMLElement;
  /** Take the document listeners back off. See `onPointerDown`. */
  readonly detach: () => void;
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

/** Whether two bands would put their handles on the very same pixels. */
function sameEdge(
  one: SpacingBand,
  other: SpacingBand,
  outwardOf: (band: SpacingBand) => boolean
): boolean {
  if (one.side !== other.side) return false;
  const a = handleRect(one, outwardOf(one));
  const b = handleRect(other, outwardOf(other));
  return a.x === b.x && a.y === b.y;
}

/**
 * Where a handle's strip sits on its band.
 *
 * `nudged` shifts it clear of another handle occupying the same pixels, by one
 * thickness INTO the band — never out of it, so the control stays over the
 * space it edits.
 */
function handleRect(band: SpacingBand, outward: boolean, nudged = false): Rect {
  const { rect, side } = band;
  const far = side === "bottom" || side === "right";
  /*
   * The edge that MOVES when the value grows, which is where the control
   * belongs. `outward` says which one that is, and it is not a property of the
   * box alone: a margin always thickens away from the block and a negative one
   * always inward, but a padding depends on the block's sizing model and is
   * measured. See `spacingGrowsOutward` and `padding-response.ts`.
   */
  const atMax = far === outward;
  const half = HANDLE_PX / 2;
  // Into the band, which is the direction away from its moving edge.
  const shift = nudged ? (atMax ? -HANDLE_PX : HANDLE_PX) : 0;
  if (side === "top" || side === "bottom") {
    const edge = atMax ? rect.y + rect.height : rect.y;
    return {
      x: rect.x,
      y: edge - half + shift,
      width: rect.width,
      height: HANDLE_PX,
    };
  }
  const edge = atMax ? rect.x + rect.width : rect.x;
  return {
    x: edge - half + shift,
    y: rect.y,
    width: HANDLE_PX,
    height: rect.height,
  };
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

/** What is held down, from whichever event is in hand. */
function modifiersOf(event: {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): SpacingModifiers {
  return { shift: event.shiftKey, alt: event.altKey };
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
   * Which way each band thickens, and therefore which edge carries its handle
   * and which way a drag on it grows the value.
   *
   * Structural for a margin — it lies outside the border box and never moves
   * it. MEASURED for a padding, because it depends on whether the block's size
   * along that axis is settled by its content: see `padding-response.ts`.
   */
  const outwardOf = React.useCallback(
    (band: SpacingBand): boolean =>
      spacingGrowsOutward(
        band.box,
        band.negative,
        subject.outward[band.box][band.side]
      ),
    [subject.outward]
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
    if (live === null) return;
    live.detach();
    if (live.active && live.host.hasPointerCapture?.(live.pointerId) === true) {
      live.host.releasePointerCapture(live.pointerId);
    }
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
      const owner = host.ownerDocument;
      const pointerId = event.pointerId;
      const originX = event.clientX;
      const originY = event.clientY;

      /*
       * The canvas root, so pointer travel can be expressed in the SAME space
       * the bands were measured in.
       */
      const root = canvasRootFrom(host, CANVAS_ROOT_CLASS);
      const origin =
        root === null ? null : canvasPointerPoints(originX, originY, root);

      /**
       * How far the pointer has moved, in both spaces, because the two answer
       * different questions.
       *
       * `hand` is CLIENT pixels and decides the activation threshold: whether a
       * press was meant as a drag is a property of the hand, and measured in
       * canvas pixels it would shrink with the zoom.
       *
       * `canvas` is the root's own CONTENT space and is what the VALUE comes
       * from. The two differ by the root's painted scale, which `renderedScale`
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
        moved: PointerEvent
      ): {
        readonly hand: { dx: number; dy: number };
        readonly canvas: { dx: number; dy: number };
      } => {
        const hand = {
          dx: moved.clientX - originX,
          dy: moved.clientY - originY,
        };
        if (root === null || origin === null) return { hand, canvas: hand };
        const now = canvasPointerPoints(moved.clientX, moved.clientY, root);
        return {
          hand,
          canvas: {
            dx: now.content.x - origin.content.x,
            dy: now.content.y - origin.content.y,
          },
        };
      };

      const onMove = (moved: PointerEvent): void => {
        const live = gesture.current;
        if (live === null || moved.pointerId !== pointerId) return;
        const { hand, canvas } = travelled(moved);
        const { dx, dy } = hand;
        if (!live.active) {
          /*
           * CLIENT pixels, matching the canvas: the threshold separates a click
           * from an intent to move, which is a property of the hand rather than
           * of the canvas's zoom. Measured in content pixels it would shrink
           * with the canvas, and a zoomed-out editor would start drags on a
           * click.
           */
          if (Math.hypot(dx, dy) < SPACING_ACTIVATION_PX) return;
          live.active = true;
          /*
           * Captured HERE rather than on the press, for the canvas's reason: the
           * browser derives a click's target from where the press and the
           * release landed, so capturing on `pointerdown` would make every press
           * on a handle report the handle as the target of a click the author
           * may have meant for the block underneath.
           *
           * Delivery no longer depends on it — the listeners above are on the
           * document — so this is what keeps the cursor and the hover states of
           * everything under the pointer still for the rest of the drag.
           */
          host.setPointerCapture?.(pointerId);
        }
        const delta = spacingDelta(
          live.band.box,
          live.band.side,
          canvas,
          subject.scales,
          outwardOf(live.band)
        );
        if (delta === undefined) return;
        const shown = modifiersOf(moved);
        live.shown = shown;
        showPreview(live.band, live.starts, live.refusals, delta, shown);
      };

      const onUp = (lifted: PointerEvent): void => {
        const live = gesture.current;
        if (live === null || lifted.pointerId !== pointerId) return;
        if (live.active) {
          const delta = spacingDelta(
            live.band.box,
            live.band.side,
            travelled(lifted).canvas,
            subject.scales,
            outwardOf(live.band)
          );
          if (delta !== undefined) {
            /*
             * `live.shown`, not the release event's modifiers. See `shown`:
             * releasing Shift before the button is ordinary, and reading the
             * release would commit a different edit from the one on screen.
             */
            commit(live.band, live.starts, live.refusals, delta, live.shown);
          }
        }
        endGesture();
      };

      const onCancel = (cancelled: PointerEvent): void => {
        /*
         * Filtered like `onMove` and `onUp`. A second touch or pen being
         * cancelled says nothing about the pointer driving this gesture, and
         * ending on it erases the preview and leaves the real release with
         * nothing to commit.
         */
        if (cancelled.pointerId !== pointerId) return;
        endGesture();
      };

      /*
       * Escape, on the DOCUMENT, for the life of the gesture.
       *
       * The handle's own `onKeyDown` cannot be relied on to see it: the press
       * calls `preventDefault`, which suppresses the browser's focus action, so
       * a drag begun on a handle that was not already focused leaves focus
       * wherever it was. Escape then goes to that element, the gesture is never
       * cancelled, and releasing still commits the edit the author was trying
       * to abandon.
       */
      const onEscape = (pressed: KeyboardEvent): void => {
        if (pressed.key !== "Escape" || gesture.current === null) return;
        pressed.preventDefault();
        endGesture();
        setMessage("Spacing drag cancelled.");
      };

      const detach = (): void => {
        owner.removeEventListener("pointermove", onMove);
        owner.removeEventListener("pointerup", onUp);
        owner.removeEventListener("pointercancel", onCancel);
        owner.removeEventListener("keydown", onEscape);
      };

      setHeld(band);
      gesture.current = {
        band,
        starts,
        refusals,
        shown: modifiersOf(event),
        originX,
        originY,
        active: false,
        pointerId,
        host,
        detach,
      };
      owner.addEventListener("pointermove", onMove);
      owner.addEventListener("pointerup", onUp);
      owner.addEventListener("pointercancel", onCancel);
      owner.addEventListener("keydown", onEscape);
    },
    [commit, endGesture, outwardOf, showPreview, startsFor, subject.scales]
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
  React.useEffect(() => () => gesture.current?.detach(), []);

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
        outwardOf(band)
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
      commit(band, starts, refusals, delta, modifiersOf(event));
    },
    [commit, outwardOf, startsFor]
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
      : [...bands, collapsed(held, outwardOf(held))];

  if (orientation === undefined || nodeClass === undefined) {
    /*
     * No handles at all. Without an orientation a physical edge cannot be
     * turned into a logical address, and without the emitted class a preview
     * cannot be aimed — both are cases where the honest thing is to offer
     * nothing rather than to edit a side the author did not grab.
     */
    return region;
  }

  return (
    <>
      {drawn.map((band, index) => {
        /*
         * No handle where the block's author did not offer the property. The
         * band still draws — it reports what the page renders, which is true
         * either way — but a control that wrote it would bypass a capability
         * declaration the Style panel honours.
         */
        if (!writable.has(band.box)) return null;
        /*
         * Nudged aside where two handles would land on the same pixels.
         *
         * A negative margin's band is laid inside the border edge, exactly where
         * padding's is — so `margin-top: -16px` with `padding-top: 16px` gives
         * two bands with identical rectangles and therefore two identical
         * handles. Same stacking, and padding is drawn later, so it takes every
         * press and the margin's control is advertised and unreachable.
         *
         * The EARLIER band moves, by its own thickness, into the band both of
         * them occupy. Both strips then take pointer events and neither leaves
         * the space it describes.
         */
        const outward = outwardOf(band);
        const rect = handleRect(
          band,
          outward,
          drawn.slice(index + 1).some(later => sameEdge(band, later, outwardOf))
        );
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
      {preview === null ? null : <style>{preview}</style>}
      {region}
    </>
  );
}
