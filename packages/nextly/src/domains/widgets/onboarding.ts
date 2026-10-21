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
 * The vocabulary itself lives in `onboarding-steps.ts`, which imports
 * nothing: the admin has to name these ids and must not pull this module's
 * Direct API graph in to do it.
 *
 * @module domains/widgets/onboarding
 */

import type { ConditionProbe } from "./condition-probe";
import type { OnboardingStep } from "./onboarding-steps";

/**
 * Every step this checklist draws, with the reader's progress through it.
 *
 * DERIVED from the Get started answer (`getStartedSteps`), not computed beside
 * it: the two would otherwise agree on the day they were written and drift
 * after. That answer offers each step only to a reader who could finish it,
 * and answers "entry" from the same counted read the `content:empty`
 * condition takes, so a reader told the install has content cannot also be
 * told the first-entry step is outstanding.
 *
 * Only the steps this list names. A step whose state is not known is not
 * complete here: this list has no way to say "not known", and drawing it done
 * would be the worse error.
 */
export async function onboardingSteps(
  probe: ConditionProbe
): Promise<OnboardingStep[]> {
  const answer = await probe.getStarted();
  // True by construction: an unauthenticated caller never reaches this, and
  // no permission gates having made the account one is already using.
  const steps: OnboardingStep[] = [{ id: "account", complete: true }];
  for (const id of ["collection", "entry"] as const) {
    const offered = answer.steps.find(candidate => candidate.kind === id);
    if (offered) steps.push({ id, complete: offered.status === "done" });
  }
  return steps;
}

/**
 * Whether this reader still has onboarding left to do.
 *
 * DERIVED from the steps rather than computed beside them, so the condition
 * cannot drop the card while a row on it is still unticked, or keep a card
 * whose every row is done.
 *
 * 🔴 True when setup is NOT KNOWN. The install's collections or Singles could
 * not be listed, so whether anything is left cannot be said, and a card that
 * vanished on that basis would hide the one place that tells the reader so.
 * "Not known" must never read as "finished".
 *
 * Reader-scoped through the steps themselves: a step this reader cannot
 * perform is not in the list, so it cannot hold the condition true.
 */
export async function onboardingIsIncomplete(
  probe: ConditionProbe
): Promise<boolean> {
  const answer = await probe.getStarted();
  if (answer.unknown) return true;
  const steps = await onboardingSteps(probe);
  return steps.some(step => !step.complete);
}
