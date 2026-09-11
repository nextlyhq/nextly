/**
 * WHICH setup steps exist, as a vocabulary anything may name.
 *
 * Its own module, with no imports, for the same reason `lifecycle.ts` is
 * separate from `conditions.ts`: the admin has to name these ids to draw a row
 * for each, and the code that ANSWERS them reaches the Direct API. A single
 * module would drag that whole graph into every consumer of the names — and
 * into `nextly/config`, which exists to keep it out.
 *
 * 🔴 The admin derives its presentation map from this union rather than
 * restating it. Restated, the two agree on the day they are written and part
 * company the moment a step is added here: the admin still compiles, the
 * server sends an id its map has no entry for, and the row is drawn from
 * `undefined`. A union spelled twice is not a contract, it is a coincidence
 * that has not expired yet.
 *
 * @module domains/widgets/onboarding-steps
 */

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

const STEP_SET: ReadonlySet<string> = new Set(ONBOARDING_STEPS);

/**
 * Whether a value names a step this release knows.
 *
 * Published because the admin needs it at the boundary: the response is JSON,
 * so nothing the compiler knows survives the wire, and a shared TYPE alone
 * still leaves a newer server able to send an id an older admin cannot draw.
 * The type stops the two DEFINITIONS drifting; this stops the drift becoming a
 * crash.
 */
export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && STEP_SET.has(value);
}

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
