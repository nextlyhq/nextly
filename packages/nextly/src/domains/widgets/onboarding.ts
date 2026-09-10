/**
 * How far through setting up this install the reader has got.
 *
 * ONE definition, read by two callers that must never disagree: the
 * `onboarding:incomplete` condition, which decides whether the checklist card
 * is offered at all, and the endpoint that draws the card's rows. Computed
 * twice they would drift — a card showing every row ticked while the condition
 * still holds is a card that cannot be dismissed by finishing the work.
 *
 * ## What a step is, and what it is not
 *
 * A step is DETECTED, never self-reported. The reader does not tick anything;
 * the install is asked. That is the whole mechanism — a checklist that asks the
 * reader to confirm their own progress measures honesty rather than setup, and
 * it goes stale the moment someone deletes what they made.
 *
 * ## Why the first step is already done
 *
 * `account` is complete for everyone who can see it, and it is a real
 * observation rather than a courtesy: reaching this code at all means an
 * authenticated reader, so the account exists and they made it. That is the
 * endowed-progress head start — a checklist that opens above zero is finished
 * far more often than one that opens empty — taken from something TRUE rather
 * than from a fabricated tick. The distinction matters: a step labelled with a
 * task the reader never performed, shown ticked, reads as a bug in the
 * checklist, and the one honest reading of it is that the list is not to be
 * trusted.
 *
 * ## Which steps are here, and which are missing
 *
 * Only steps answerable about THIS READER are included. `media` and `apiKeys`
 * are the two obvious absentees and they are deliberate: the counts that exist
 * for them (`countTable("media")`, `countActiveApiKeys()`) take no caller and
 * are bare totals over the whole install. A condition is evaluated once per
 * NAME and shared by every widget declaring it, so answering it from an
 * install-wide total would tell a limited editor how much media exists
 * elsewhere — the exact disclosure `content:empty` is scoped to avoid. They
 * arrive when a reader-scoped count does.
 *
 * @module domains/widgets/onboarding
 */

import type { ReadCaller } from "../../services/dashboard/readable-resources";

import { readableCollectionSlugs, readerHasContent } from "./reader-content";

/**
 * The steps this release detects, in the order they are worked through.
 *
 * A closed set rather than a contributed one, for the moment. Nothing outside
 * core declares a step, and a surface with no consumer is one whose shape gets
 * decided by guesswork; this list grows by adding a member and its detection
 * together.
 */
export const ONBOARDING_STEPS = ["account", "collection", "entry"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

/**
 * One step, as the host answers it.
 *
 * Deliberately no label, description or href. Those are admin concerns: the
 * copy is UI text and the target is an admin route, neither of which core owns
 * or can render. Core answers WHICH steps exist and WHETHER each is done; the
 * admin maps an id to its presentation through an exhaustive record, so a step
 * added here is a compile error there rather than a blank row on the card.
 */
export interface OnboardingStep {
  id: OnboardingStepId;
  complete: boolean;
}

/**
 * Every step, with the reader's progress through it.
 *
 * The two detected steps share one read of the readable collections: asking
 * separately would resolve the same permission set twice for one answer.
 *
 * `entry` is answered by {@link readerHasContent} rather than by a count of its
 * own, which is what keeps this and the `content:empty` condition one
 * implementation. They ask the same question of the same rows through the same
 * guard, so a reader who is told the install has content cannot also be told
 * the first-entry step is outstanding.
 */
export async function onboardingSteps(
  caller: ReadCaller
): Promise<OnboardingStep[]> {
  const slugs = await readableCollectionSlugs(caller);
  // Short-circuits inside, and skipped entirely where no collection exists:
  // with nothing to read there is no row to find, and the walk would be a
  // guaranteed-empty pass over an empty list.
  const hasContent = slugs.length > 0 && (await readerHasContent(caller));

  return [
    // True by construction: an unauthenticated caller never reaches this.
    { id: "account", complete: true },
    { id: "collection", complete: slugs.length > 0 },
    { id: "entry", complete: hasContent },
  ];
}

/**
 * Whether this reader still has onboarding left to do.
 *
 * DERIVED from the steps rather than computed beside them. A separate
 * "is onboarding done" query would be a second implementation of the same
 * question, and the two would disagree exactly when it mattered: the condition
 * dropping the card while a row on it was still unticked, or keeping a card
 * whose every row is done.
 *
 * Note that this does not short-circuit, and could: the first incomplete step
 * settles it. Left exhaustive because the same call draws the card, and the two
 * paths sharing one implementation is worth more than one skipped count on a
 * request that is about to make the same one.
 */
export async function onboardingIsIncomplete(
  caller: ReadCaller
): Promise<boolean> {
  const steps = await onboardingSteps(caller);
  return steps.some(step => !step.complete);
}
