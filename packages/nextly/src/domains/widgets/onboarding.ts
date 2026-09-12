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

/** A step no permission gates, as a predicate the walk below can call alike. */
const ALWAYS = (): Promise<boolean> => Promise.resolve(true);

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
  probe: ConditionProbe
): Promise<OnboardingStep[]> {
  const slugs = await probe.readableSlugs();
  // Short-circuits inside, and skipped entirely where no collection exists:
  // with nothing to read there is no row to find, and the walk would be a
  // guaranteed-empty pass over an empty list.
  const hasContent = slugs.length > 0 && (await probe.hasContent());

  const candidates: Array<
    OnboardingStep & { offered: () => Promise<boolean> }
  > = [
    // True by construction: an unauthenticated caller never reaches this,
    // and no permission gates having made the account one is already using.
    { id: "account", complete: true, offered: ALWAYS },
    {
      id: "collection",
      complete: slugs.length > 0,
      offered: () => probe.mayCreateCollection(),
    },
    {
      id: "entry",
      complete: hasContent,
      offered: () => probe.mayCreateEntry(),
    },
  ];

  const offered: OnboardingStep[] = [];
  for (const { offered: mayPerform, ...step } of candidates) {
    // 🔴 Asked only of an INCOMPLETE step, and the asymmetry is the design
    // rather than an optimisation that leaked into the semantics. A finished
    // step is a fact about the install's history, and history is not an offer:
    // withholding it would shorten a reader's list by the very rows that show
    // them how far the install has come. An UNFINISHED step is an offer, and
    // an offer the reader cannot accept is the defect -- the link lands on a
    // surface that refuses them, and `onboardingIsIncomplete` below stays true
    // for as long as their account exists, pinning the card to their dashboard
    // permanently.
    //
    // It is also what keeps a settled install off this path entirely: with
    // every step complete no permission decision is taken at all, so the
    // steady state costs nothing.
    if (step.complete || (await mayPerform())) offered.push(step);
  }
  return offered;
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
 *
 * Reader-scoped through the steps themselves, which is what `onboardingSteps`
 * filtering buys: a step this reader cannot perform is not in the list, so it
 * cannot hold the condition true. Scoped any other way -- an aggregate taken
 * over every step that EXISTS -- a reader who may read a collection and create
 * nothing in it would have this answer true for the life of their account,
 * with the card pinned to their dashboard offering an action that always
 * fails. That is the opposite of what the lifecycle was built for.
 */
export async function onboardingIsIncomplete(
  probe: ConditionProbe
): Promise<boolean> {
  const steps = await onboardingSteps(probe);
  return steps.some(step => !step.complete);
}
