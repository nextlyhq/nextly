/**
 * How a radio group moves under the arrow keys, in one definition.
 *
 * Two controls in this package are radio groups with a roving tab stop — the
 * canvas width switcher and the interaction-state switcher — and both have to
 * agree about which keys move a selection and in which direction. Written out
 * twice they agree on the day they are written: a later change teaching one of
 * them Home and End, or correcting a direction under a right-to-left writing
 * mode, silently leaves the other answering the old way, and nothing about
 * either file looks wrong.
 *
 * Both axes, deliberately. The APG's radio-group pattern maps the vertical
 * arrows onto the same movement as the horizontal ones whatever the visual
 * orientation, so a control laid out in a row still answers to Down — which is
 * what a screen-reader user pressing it expects, and what a control handling
 * only its own axis fails to do.
 *
 * @module roving-radios
 */

/**
 * Which way an arrow key moves within a radio group, or `null` for a key that
 * is not one of them.
 *
 * `null` rather than `0` so a caller cannot accidentally treat "not an arrow
 * key" as a move of no distance: the two need different handling, since only
 * the first must leave the event alone for whatever else is listening.
 */
export function radioGroupStep(key: string): -1 | 1 | null {
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  return null;
}
