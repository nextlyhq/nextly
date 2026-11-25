/**
 * Why the panel could not write a prop, and what a field says about it.
 *
 * A field told only that its write was refused can do no better than guess,
 * and a guess of "perhaps the page is at its size limit" on a page that is
 * nowhere near it sends the author looking for a problem that is not there.
 * So the panel, which made the write, says why, and the field words that.
 *
 * @module prop-refusal
 */

import * as React from "react";

/**
 * Why a write of a prop was refused:
 *
 * - `size-limit`: the page would pass the size it may be stored at;
 * - `locked`: the prop can no longer be changed here (a lock, or a part of
 *   the page that takes only its content);
 * - `refused`: anything else, or a reason not known.
 */
export type PropRefusal = "size-limit" | "locked" | "refused";

/**
 * Why the write of `value` to the selected block's prop `name` was refused,
 * asked once the panel has refused it. Provided by the panel that writes the
 * props; without it the reason is not known.
 */
export const PropRefusalContext: React.Context<
  ((name: string, value: unknown) => PropRefusal) | undefined
> = React.createContext<
  ((name: string, value: unknown) => PropRefusal) | undefined
>(undefined);

/**
 * What a passage held open after a refused write says, for its reason.
 *
 * @param discard - the key or button that lets the words go
 */
export function refusalWords(
  reason: PropRefusal | undefined,
  discard: "Escape" | "Cancel"
): string {
  if (reason === "size-limit") {
    return `This change could not be saved because the page is at its size limit. Shorten it, or press ${discard} to discard it.`;
  }
  if (reason === "locked") {
    return `This text can no longer be changed here, so this change could not be saved. Press ${discard} to discard it.`;
  }
  return `This change could not be saved. Press ${discard} to discard it.`;
}
