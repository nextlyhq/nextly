/**
 * What the canvas TELLS an author whose drop was refused (spec §9).
 *
 * The drop rules already know which rule stopped a drag; this turns that into the sentence shown
 * beside the cursor. Separate from `dropRules` because the two answer different questions — one
 * decides, one explains — and the wording changes far more often than the rules do.
 *
 * ## Why a Record and not a switch
 *
 * A `switch` with a `default` arm absorbs a reason nobody has written a sentence for: the author
 * is told something generic about a rule that had a specific thing to say, and nothing fails. An
 * exhaustive `Record` over the union makes the compiler demand a sentence for every member, so a
 * rule added to `DropReason` cannot reach the canvas unexplained.
 *
 * ## Why these words
 *
 * Addressed to the author, about what is on the screen. "Slot", "allowlist" and "parent
 * restriction" are what the registry calls these things; an author sees a container, a block, and
 * a place a block will not go. Each sentence names the block or the container rather than the
 * mechanism, because the author's next action is to aim somewhere else and the sentence has to
 * tell them where not to.
 *
 * Pure → unit-tested.
 */
import type { DropRefusal } from "./dropPlan";

const MESSAGES: Record<DropRefusal, string> = {
  // The container's own type is not one this editor can resolve, so it draws as an unknown-block
  // placeholder with no slots. Phrased as the container being unavailable rather than as a rule,
  // because there is no rule the author could satisfy.
  "unknown-parent": "This container isn’t available in the editor.",
  "not-a-container": "This block can’t hold other blocks.",
  // The zone names a slot the container does not declare, which an author cannot act on. Said as a
  // stale target rather than as a refusal they could avoid.
  "unknown-slot": "This drop area is no longer part of the layout.",
  "not-allowed-in-slot": "This container doesn’t accept this kind of block.",
  "wrong-parent": "This block can only go inside certain containers.",
  "into-itself": "A block can’t be moved inside itself.",
};

/** The sentence for a refusal. Total over `DropRefusal`, so there is no unexplained refusal. */
export function dropRefusalMessage(reason: DropRefusal): string {
  return MESSAGES[reason];
}

/**
 * Every reason this module can explain, exported so a test can enumerate the union at runtime.
 *
 * A type cannot be iterated, so exhaustiveness over `DropRefusal` is only checkable against the
 * keys the compiler already forced to be complete. Derived from `MESSAGES` rather than written out
 * again — a second list is the drift this package has a rule about.
 */
export const DROP_REFUSALS = Object.keys(MESSAGES) as DropRefusal[];
