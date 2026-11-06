/**
 * One drag gesture that changes a number, shared by every surface that scrubs.
 *
 * The canvas's spacing handles and the inspector's field labels are the same
 * gesture: a press that becomes a drag only once the hand has travelled, a
 * value shown live while the pointer is down, one write on release, and Escape
 * to abandon it. What differs is what the modifiers MEAN — on a handle Shift
 * moves every side and Alt the opposite pair, in a field they change the size
 * of a step — so this module owns the gesture and the reading of the keys, and
 * each surface decides what a held key does.
 *
 * ## The pointer is followed on the DOCUMENT, not on the element pressed
 *
 * A handle is a strip a few pixels thick and a label is a word: a pointer that
 * has travelled far enough to mean a drag has usually left either one. Capture
 * keeps later moves coming back, but capture waits for activation, and
 * activation needs the very moves that stopped arriving — listening on the
 * element alone deadlocks and the control reads as inert. So the listeners are
 * the document's for the life of the gesture, and capture is taken at
 * activation only to hold the cursor and the hover states still.
 *
 * Captured at activation rather than at the press because the browser derives
 * a click's target from where the press and the release landed: capturing on
 * `pointerdown` would make every press report the pressed element as the
 * target of a click the author may have meant for something else.
 *
 * Deliberately free of React, so the lifecycle is one implementation whatever
 * draws the control, and the step arithmetic below is testable without a DOM.
 *
 * @module scrub-gesture
 */

import { DEFAULT_ACTIVATION_PX } from "./canvas-drag";

/**
 * How far the pointer travels before a press becomes a drag.
 *
 * The canvas's own figure: two thresholds in one editor are two answers to
 * "did the hand mean to move", and an author who learned one on the canvas
 * would meet a different one an inch away in the inspector. Below it, a press
 * on a label is a click, which focuses the field.
 */
export const SCRUB_ACTIVATION_PX: typeof DEFAULT_ACTIVATION_PX =
  DEFAULT_ACTIVATION_PX;

/** The keys that only steer a drag, which it leaves to reach the page. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Alt",
  "Control",
  "Meta",
]);

/** What the author is holding down while dragging or pressing a key. */
export interface ScrubModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
}

/** What is held down, from whichever event is in hand. */
export function scrubModifiersOf(event: {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): ScrubModifiers {
  return { shift: event.shiftKey, alt: event.altKey };
}

/** How far the pointer has moved since the press, in client pixels. */
export interface ScrubTravel {
  readonly dx: number;
  readonly dy: number;
}

/** The press a gesture starts from. */
export interface ScrubPress {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  /** The element pressed, which takes capture once the drag starts. */
  readonly host: HTMLElement;
}

/** What a surface does at each point of the gesture. */
export interface ScrubHandlers {
  /** Each move once the pointer has passed the threshold. */
  readonly onMove: (moved: PointerEvent, travel: ScrubTravel) => void;
  /** The release of a press that became a drag: the one place to write. */
  readonly onRelease: (lifted: PointerEvent, travel: ScrubTravel) => void;
  /** Escape during the gesture, which then ends without a release. */
  readonly onEscape?: (pressed: KeyboardEvent) => void;
  /** The gesture is over, however it ended. Called exactly once. */
  readonly onEnd: () => void;
}

/** A gesture in flight. */
export interface ScrubSession {
  /** Whether the press has become a drag. */
  readonly active: boolean;
  /** End it now, without a release. Safe to call more than once. */
  readonly end: () => void;
}

/**
 * Follow a press until it is released, cancelled or abandoned with Escape.
 *
 * Every pointer event is filtered by the pressing pointer's id: a second touch
 * or a pen beside the mouse says nothing about this gesture, and ending on its
 * cancel would erase the preview and leave the real release nothing to commit.
 *
 * The keyboard is heard on the document as well, in the capture phase, for
 * the life of the gesture. A surface that keeps focus where it was — a press
 * that prevents the default so text is not selected — would otherwise send a
 * key to whatever had focus: Escape there would not abandon the drag, and an
 * arrow or Enter on a focused field would write while the pointer still owns
 * the value. So Escape ends the gesture, the modifiers pass, and no other key
 * reaches anything until the gesture is over.
 */
export function followScrub(
  press: ScrubPress,
  handlers: ScrubHandlers
): ScrubSession {
  const { host, pointerId } = press;
  const owner = host.ownerDocument;
  let active = false;
  let ended = false;

  const travelOf = (event: PointerEvent): ScrubTravel => ({
    dx: event.clientX - press.clientX,
    dy: event.clientY - press.clientY,
  });

  const end = (): void => {
    if (ended) return;
    ended = true;
    owner.removeEventListener("pointermove", onMove);
    owner.removeEventListener("pointerup", onUp);
    owner.removeEventListener("pointercancel", onCancel);
    owner.removeEventListener("keydown", onKey, true);
    if (active && host.hasPointerCapture?.(pointerId) === true) {
      host.releasePointerCapture(pointerId);
    }
    handlers.onEnd();
  };

  function onMove(moved: PointerEvent): void {
    if (moved.pointerId !== pointerId) return;
    const travel = travelOf(moved);
    if (!active) {
      // Client pixels: whether a press was meant as a drag is a property of
      // the hand, and measured in a zoomed canvas's pixels it would shrink.
      if (Math.hypot(travel.dx, travel.dy) < SCRUB_ACTIVATION_PX) return;
      active = true;
      host.setPointerCapture?.(pointerId);
    }
    handlers.onMove(moved, travel);
  }

  function onUp(lifted: PointerEvent): void {
    if (lifted.pointerId !== pointerId) return;
    if (active) handlers.onRelease(lifted, travelOf(lifted));
    end();
  }

  function onCancel(cancelled: PointerEvent): void {
    if (cancelled.pointerId !== pointerId) return;
    end();
  }

  function onKey(pressed: KeyboardEvent): void {
    // A modifier is how the drag is steered, and its state reaches the
    // gesture on the pointer events, so its own key is left alone. A Control
    // or Meta chord is the editor's (Undo among them), which a surface folds
    // into its release, and never a keystroke a focused field would type.
    if (MODIFIER_KEYS.has(pressed.key)) return;
    if (pressed.key !== "Escape" && (pressed.ctrlKey || pressed.metaKey)) {
      return;
    }
    // Every other key is stopped here, in the capture phase, before anything
    // else hears it. The pointer owns the value until it is released: an
    // arrow or Enter on a focused field would write mid-drag, and the
    // editor's own Escape moves the selection up, which would take the value
    // being dragged off screen along with the edit it abandons.
    pressed.preventDefault();
    pressed.stopPropagation();
    if (pressed.key !== "Escape") return;
    handlers.onEscape?.(pressed);
    end();
  }

  owner.addEventListener("pointermove", onMove);
  owner.addEventListener("pointerup", onUp);
  owner.addEventListener("pointercancel", onCancel);
  owner.addEventListener("keydown", onKey, true);

  return {
    get active() {
      return active;
    },
    end,
  };
}

/**
 * How far the pointer travels for one step of a field's value, in client
 * pixels. One, as in Figma and Webflow: a value moves with the hand.
 */
const FIELD_SCRUB_PX_PER_STEP = 1;

/**
 * The size of one step in a number field, from what is held.
 *
 * Shift ×10 and Alt ×0.1, the same on the arrow keys and on a drag, so a
 * modifier learned on one is right on the other. Shift wins when both are
 * held, as it does on the canvas handles: it is the larger of the two.
 */
export function fieldStep(modifiers: ScrubModifiers): number {
  if (modifiers.shift) return 10;
  if (modifiers.alt) return 0.1;
  return 1;
}

/** A field drag's progress: how far it has moved the value, and at what precision. */
export interface FieldScrub {
  /** The pointer's horizontal travel at the last move. */
  readonly dx: number;
  /** The change so far, unrounded. */
  readonly amount: number;
  /** The decimals the change is shown at; widened once a fine step is taken. */
  readonly decimals: number;
  /** The change to the value it now stands for, at those decimals. */
  readonly delta: number;
}

/** A drag that has not moved yet. */
export const FIELD_SCRUB_START: FieldScrub = {
  dx: 0,
  amount: 0,
  decimals: 0,
  delta: 0,
};

/**
 * The drag after one more move, and the change to the value it now stands for.
 *
 * Accumulated move by move with the modifiers held AT that move, rather than
 * recomputed from the whole travel: pressing Shift halfway through then speeds
 * up the rest of the drag instead of multiplying what was already done, so the
 * value never jumps under the hand.
 *
 * The precision only widens. A drag that took a fine step keeps its tenth when
 * Alt is let go, where rounding back to a whole number would undo the fine
 * adjustment the author just made.
 */
export function fieldScrubMove(
  state: FieldScrub,
  dx: number,
  modifiers: ScrubModifiers
): FieldScrub {
  const step = fieldStep(modifiers);
  const decimals = Math.max(state.decimals, step < 1 ? 1 : 0);
  // A precision that widens continues from the change ON SCREEN, not from the
  // unrounded amount under it: a fraction of a pixel rounded away at whole
  // steps would otherwise appear as the drag steps back.
  const from = decimals > state.decimals ? state.delta : state.amount;
  const amount = from + ((dx - state.dx) / FIELD_SCRUB_PX_PER_STEP) * step;
  const rounded = Number(amount.toFixed(decimals));
  // `-0` normalised: it passes every comparison and then prints as a value
  // nobody wrote.
  return { dx, amount, decimals, delta: rounded === 0 ? 0 : rounded };
}
