/**
 * Playing one block's "Animation when it appears" once on the canvas.
 *
 * The canvas shows every block in its final state: the frame's sheet closes
 * both of the page's gates on every page root, so no block waits hidden for a
 * scroll or a load while it is being edited. Playing one block opens the gates
 * on that block alone, for as long as one run of its animation lasts, and
 * closes them again once it ends.
 *
 * ## Nothing here knows what the animation is
 *
 * The block plays the keyframes the page's own sheet compiled for it, with its
 * own duration, delay and effect, so the canvas shows exactly what the
 * published page plays. Reduced motion wins here as it does there: the
 * keyframes exist only where the window asks for motion, so a block played
 * there finds no animation to run. The play is not even started then, as
 * `reveal-node` jumps rather than scrolls.
 *
 * ## By time, whatever its start
 *
 * "When scrolled into view" follows the block's view timeline on the page,
 * which on the canvas would leave a block already in view at its end, never
 * moving. Played here, the block runs on the document's timeline instead, as
 * "When the page loads" does, so a press shows the motion whichever start is
 * chosen.
 *
 * ## Only that block
 *
 * A gate is inherited, so opening it on a block would open it for every block
 * inside, and a section played would play all of its children too. The
 * block's descendants keep the gates closed.
 *
 * @module appear-replay
 */
import { APPEAR_LOAD_GATE, APPEAR_SCROLL_GATE } from "@nextlyhq/blocks-engine";

import { CANVAS_ROOT_CLASS } from "../shell-state";

import { nodeElement } from "./canvas-addressing";
import { prefersReducedMotion } from "./reduced-motion";

/**
 * The attribute on a block whose animation is playing, for as long as it
 * plays.
 *
 * @internal
 */
export const APPEAR_PLAYING_ATTRIBUTE = "data-nx-appear-playing";

const PLAYING = `.${CANVAS_ROOT_CLASS} .nx-pb-page [${APPEAR_PLAYING_ATTRIBUTE}]`;

/**
 * The frame sheet's rules for a block playing: its gates open, its timeline
 * the document's, and every block inside it still. `initial` leaves a gate
 * unset, which is what lets the animation run, as on the published page.
 *
 * The timeline is set over the block's own, which its compiled rule sets at
 * whatever weight its selector has, hence the important flag; it holds only
 * while the block plays.
 *
 * @internal
 */
export const APPEAR_REPLAY_RULES: string = `${PLAYING} {
  ${APPEAR_SCROLL_GATE}: initial;
  ${APPEAR_LOAD_GATE}: initial;
  animation-timeline: auto !important;
}
${PLAYING} :not([${APPEAR_PLAYING_ATTRIBUTE}]) {
  ${APPEAR_SCROLL_GATE}: none;
  ${APPEAR_LOAD_GATE}: none;
}`;

/** Each playing block's current play, so an earlier one ending leaves a later one be. */
const plays = new WeakMap<Element, object>();

/** The canvas's root inside `root`, which holds every block it draws. */
function canvasScope(root: Document | HTMLElement): HTMLElement {
  if (!("documentElement" in root)) return root;
  return (
    root.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`) ??
    root.documentElement
  );
}

/** The block's gates closed again, and its play forgotten. */
function stop(element: Element): void {
  plays.delete(element);
  element.removeAttribute(APPEAR_PLAYING_ATTRIBUTE);
}

/**
 * Play the block `id`'s animation once, from its start, on the canvas inside
 * `root`. A play already running on it starts again.
 *
 * @param root - the canvas: its root element, or the document of the frame it
 *   draws in
 * @param id - the block's id, as the document stores it
 * @returns whether an animation started; `false` for a block not drawn, one
 *   with no animation, and wherever the window asks for reduced motion
 */
export function playAppear(root: Document | HTMLElement, id: string): boolean {
  const element = nodeElement(canvasScope(root), id);
  if (element === null) return false;
  stop(element);
  if (
    prefersReducedMotion(element) ||
    typeof element.getAnimations !== "function"
  ) {
    return false;
  }
  // Asking for the animations brings the block's style up to date first, so
  // a run an earlier play left going ends here and the next one starts over.
  const before = new Set(element.getAnimations());
  element.setAttribute(APPEAR_PLAYING_ATTRIBUTE, "");
  const started = element
    .getAnimations()
    .filter(animation => !before.has(animation));
  if (started.length === 0) {
    stop(element);
    return false;
  }
  const play = {};
  plays.set(element, play);
  // Settled, not only finished: a run cut short (the block redrawn, its
  // effect changed) closes the gates too.
  void Promise.allSettled(started.map(animation => animation.finished)).then(
    () => {
      if (plays.get(element) === play) stop(element);
    }
  );
  return true;
}
