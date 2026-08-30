/**
 * Which release controls to OFFER, from the engine's own transition rules.
 *
 * The lists come from `nextly/releases-lifecycle`, which is the same module the
 * repository fences its conditional UPDATEs with. Restating them here would be a
 * second implementation of one question, and the failure is not symmetrical: a
 * narrower UI matrix silently removes product — an editor unable to move a
 * schedule they set, or to abandon a draft — while looking like caution, and
 * nothing fails to make it visible.
 *
 * Authority is a SEPARATE question and stays separate. A move is offered only
 * when the state permits it AND the caller holds the grant; the engine decides
 * the first, `useCan` the second, and combining them into one list here would
 * make a permission change look like a lifecycle change.
 *
 * @module components/features/releases/release-lifecycle
 */

import {
  RELEASE_ASSEMBLABLE_FROM,
  RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM,
  RELEASE_CANCELLABLE_FROM,
  RELEASE_SCHEDULABLE_FROM,
} from "nextly/releases-lifecycle";

import type { ReleaseState } from "@admin/types/releases";

/** Whether an instant can be set or moved from this state. */
export function canSchedule(state: ReleaseState): boolean {
  return RELEASE_SCHEDULABLE_FROM.includes(state);
}

/** Whether this release can be called off — which is also how a draft is abandoned. */
export function canCancel(state: ReleaseState): boolean {
  return RELEASE_CANCELLABLE_FROM.includes(state);
}

/**
 * Whether membership can change, and what that costs.
 *
 * Three outcomes rather than a boolean, because the middle one is a different
 * sentence to an editor: a scheduled release is editable, but only by someone
 * who could have scheduled it — the drain reads membership AT the instant, so
 * changing it changes what a publisher already committed to.
 */
export function membershipEditability(
  state: ReleaseState
): "free" | "needs-publish" | "closed" {
  if (RELEASE_ASSEMBLABLE_FROM.includes(state)) return "free";
  if (RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM.includes(state)) {
    return "needs-publish";
  }
  return "closed";
}

/**
 * What scheduling this release would MEAN, given where it stands.
 *
 * The verb changes the sentence an editor needs: setting a first instant,
 * moving one already committed to, and bringing back a launch that was called
 * off are three different acts on the same control.
 */
export function scheduleIntent(
  state: ReleaseState
): "set" | "move" | "reinstate" {
  if (state === "scheduled") return "move";
  if (state === "cancelled") return "reinstate";
  return "set";
}
