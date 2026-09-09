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

import { nodeClassNames, walkNodes } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { CHROME_ATTRIBUTE } from "./canvas";
import type { EditorState } from "./editor-state";
import type { Rect } from "./geometry";
import type { SideOrientation } from "./side-orientation";
import type { EdgeLengths, SpacingBand, SpacingSide } from "./spacing-bands";
import {
  logicalSideFor,
  spacingAddress,
  spacingCssValue,
  spacingDelta,
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
import { readStyleValue, type StyleAddress } from "./style-values";

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
}

/** How thick a handle's hit area is, in canvas pixels. */
const HANDLE_PX = 9;

/** A gesture in flight. */
interface Gesture {
  readonly band: SpacingBand;
  /** Every side of this box that has a usable starting value. */
  readonly starts: ReadonlyMap<SpacingSide, number>;
  readonly originX: number;
  readonly originY: number;
  active: boolean;
  readonly pointerId: number;
  readonly host: HTMLElement;
  /** Take the document listeners back off. See `onPointerDown`. */
  readonly detach: () => void;
}

/** Where a handle's strip sits on its band. */
function handleRect(band: SpacingBand): Rect {
  const { rect, side, box } = band;
  const far = side === "bottom" || side === "right";
  // The edge that moves when the value grows: away from the block for a margin,
  // toward its middle for a padding. See `spacingDelta` for the same table.
  const atMax = far === (box === "margin");
  const half = HANDLE_PX / 2;
  if (side === "top" || side === "bottom") {
    const edge = atMax ? rect.y + rect.height : rect.y;
    return { x: rect.x, y: edge - half, width: rect.width, height: HANDLE_PX };
  }
  const edge = atMax ? rect.x + rect.width : rect.x;
  return { x: edge - half, y: rect.y, width: HANDLE_PX, height: rect.height };
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
}: SpacingHandlesProps): React.JSX.Element | null {
  const gesture = React.useRef<Gesture | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
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
          },
    [context, nodeClass, nodeId]
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
    ): { starts: Map<SpacingSide, number>; refusal?: string } => {
      const used = band.box === "margin" ? subject.margin : subject.padding;
      const starts = new Map<SpacingSide, number>();
      let refusal: string | undefined;
      for (const side of ["top", "right", "bottom", "left"] as const) {
        const address = addressFor(band, side);
        if (address === undefined) continue;
        const stored =
          node === undefined ? undefined : readStyleValue(node.styles, address);
        const start = spacingStart(stored, used[side]);
        if (start.ok) starts.set(side, start.px);
        else if (side === band.side) refusal = start.reason;
      }
      return refusal === undefined ? { starts } : { starts, refusal };
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
      delta: number,
      modifiers: SpacingModifiers
    ): void => {
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
      const writes = valuesFor(band, starts, delta, modifiers).filter(
        write => write.px !== starts.get(write.side)
      );
      if (writes.length === 0) return;
      const first = writes[0];
      if (first === undefined) return;
      const target = targetFor(first.address);
      if (target === undefined) return;
      const result = scrubCommitOps(
        target,
        node?.styles,
        writes.map(write => ({ address: write.address, value: write.value }))
      );
      if (!result.ok) {
        setMessage(
          result.issues[0]?.message ?? "That spacing value cannot be used here."
        );
        return;
      }
      // `null` is the value layer saying the document already holds this, which
      // is an ordinary end to a drag that came back to where it started.
      if (result.op !== null) editor.apply(result.op);
      setMessage(committedMessage(band, writes));
    },
    [editor, node?.styles, targetFor, valuesFor]
  );

  /** Draw the gesture's result without touching the document. */
  const showPreview = React.useCallback(
    (
      band: SpacingBand,
      starts: ReadonlyMap<SpacingSide, number>,
      delta: number,
      modifiers: SpacingModifiers
    ): void => {
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
      const { starts, refusal } = startsFor(band);
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

      const travelled = (moved: PointerEvent): { dx: number; dy: number } => ({
        dx: moved.clientX - originX,
        dy: moved.clientY - originY,
      });

      const onMove = (moved: PointerEvent): void => {
        const live = gesture.current;
        if (live === null || moved.pointerId !== pointerId) return;
        const { dx, dy } = travelled(moved);
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
          { dx, dy },
          subject.scales
        );
        if (delta === undefined) return;
        showPreview(live.band, live.starts, delta, modifiersOf(moved));
      };

      const onUp = (lifted: PointerEvent): void => {
        const live = gesture.current;
        if (live === null || lifted.pointerId !== pointerId) return;
        if (live.active) {
          const delta = spacingDelta(
            live.band.box,
            live.band.side,
            travelled(lifted),
            subject.scales
          );
          if (delta !== undefined) {
            commit(live.band, live.starts, delta, modifiersOf(lifted));
          }
        }
        endGesture();
      };

      const onCancel = (): void => {
        endGesture();
      };

      const detach = (): void => {
        owner.removeEventListener("pointermove", onMove);
        owner.removeEventListener("pointerup", onUp);
        owner.removeEventListener("pointercancel", onCancel);
      };

      gesture.current = {
        band,
        starts,
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
    },
    [commit, endGesture, showPreview, startsFor, subject.scales]
  );

  /*
   * A gesture does not outlive the handles. The overlay unmounts them whenever
   * the selection changes or a canvas drag starts, and listeners left on the
   * document would then commit against a node nobody is editing — or leak one
   * pair per press for the life of the editor.
   */
  React.useEffect(() => () => gesture.current?.detach(), []);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>, band: SpacingBand): void => {
      // Escape abandons a drag in flight, leaving the document untouched.
      if (event.key === "Escape" && gesture.current !== null) {
        event.preventDefault();
        endGesture();
        setMessage("Spacing drag cancelled.");
        return;
      }
      /*
       * The direction lives in `spacing-drag.ts` and runs through the same sign
       * table the pointer does, so the two paths cannot come to disagree about
       * which way a key grows a value. A key this band does not answer to is
       * left alone rather than swallowed.
       */
      const delta = spacingKeyDelta(event.key, band.box, band.side);
      if (delta === undefined) return;

      event.preventDefault();
      const { starts, refusal } = startsFor(band);
      if (refusal !== undefined) {
        setMessage(refusal);
        return;
      }
      commit(band, starts, delta, modifiersOf(event));
    },
    [commit, endGesture, startsFor]
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
      {bands.map(band => {
        const rect = handleRect(band);
        const used = band.box === "margin" ? subject.margin : subject.padding;
        const vertical = band.side === "top" || band.side === "bottom";
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
            role="slider"
            tabIndex={0}
            aria-label={handleLabel(band)}
            aria-orientation={vertical ? "vertical" : "horizontal"}
            aria-valuenow={used[band.side]}
            aria-valuetext={`${band.label} pixels`}
            /*
             * Padding has a floor and a margin does not, so only one of them can
             * honestly state a minimum. No maximum is stated for either: any
             * number put here would be invented, and a slider claiming a ceiling
             * the catalog does not have misreports the control's own range.
             */
            {...(band.box === "padding" ? { "aria-valuemin": 0 } : {})}
            /*
             * Only the press is bound here. Everything after it is followed on
             * the document, because a pointer that has travelled far enough to
             * mean a drag has already left this nine-pixel strip.
             */
            onPointerDown={event => onPointerDown(event, band)}
            onKeyDown={event => onKeyDown(event, band)}
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
