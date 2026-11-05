/**
 * The comparisons a review shows, as history baselines: "since submitted", from the version a
 * part last entered review at, and "since approved", from the version its last approval named.
 *
 * Each reads the slot workflows pins for the part (`entered-review:<part>`, `approved:<part>`;
 * `workflow-pins`), so the history's comparison resolves them without knowing workflows. A part
 * with no such pin (never submitted or approved since a publish released them) is refused with
 * its reason, as core's baselines refuse one they cannot resolve.
 *
 * @module domains/workflows/review-baselines
 * @experimental
 */
import { getService } from "../../di";
import {
  comparisonBaselineNames,
  registerComparisonBaseline,
  type BaselineContext,
  type BaselineRefusal,
  type ComparisonBaseline,
} from "../versions/comparison-baselines";

import { approvedSlot, enteredReviewSlot, workflowPins } from "./workflow-pins";

/** What one review baseline reads, and how it says it has nothing to compare with. */
interface ReviewBaseline {
  name: string;
  label: string;
  slot: (part: string | null) => string;
  /** Why there is no version, when the part's slot is empty. */
  none: string;
  /** Why there is nothing to compare, when the target is the pinned version itself. */
  same: string;
}

const REVIEW_BASELINES: readonly ReviewBaseline[] = [
  {
    name: "since-submitted",
    label: "Since submitted",
    slot: enteredReviewSlot,
    none: "This part has not been submitted for review since it was last published, so there is no version to compare with.",
    same: "This is the version submitted for review, so nothing has changed since.",
  },
  {
    name: "since-approved",
    label: "Since approved",
    slot: approvedSlot,
    none: "This part has not been approved since it was last published, so there is no approved version to compare with.",
    same: "This is the version approved, so nothing has changed since.",
  },
];

/**
 * The version `baseline`'s slot points at for the compared part, or a refusal saying why there is
 * none. A pin always names one of the part's own versions; one that does not is refused rather
 * than compared across parts.
 */
async function resolvePinned(
  baseline: ReviewBaseline,
  { ref, part, versions }: BaselineContext
): Promise<number | BaselineRefusal> {
  const slots = await workflowPins.list(getService("adapter"), ref);
  const pinned = slots.find(each => each.slot === baseline.slot(part));
  if (pinned === undefined) return { unavailable: baseline.none };
  if (!versions.some(v => v.versionNo === pinned.versionNo)) {
    return { unavailable: baseline.none };
  }
  return pinned.versionNo;
}

/** `baseline` as the history registers it. */
function comparisonBaselineOf(baseline: ReviewBaseline): ComparisonBaseline {
  return {
    name: baseline.name,
    label: baseline.label,
    resolve: context => resolvePinned(baseline, context),
    // Only reached with the pinned version in hand that is the target itself; every other
    // refusal came from `resolve`, with the reason it read.
    unavailable: () => baseline.same,
  };
}

/**
 * Registers "since submitted" and "since approved" with the history's comparison baselines, each
 * not registered yet, so a boot that runs again in the same process registers nothing twice.
 *
 * @experimental
 */
export function registerWorkflowBaselines(): void {
  const known = new Set(comparisonBaselineNames());
  for (const baseline of REVIEW_BASELINES) {
    if (!known.has(baseline.name)) {
      registerComparisonBaseline(comparisonBaselineOf(baseline));
    }
  }
}
