"use client";

/**
 * The order the Get started card draws its steps in, so the steps it folds behind "Show N more"
 * (`useRowFold`) are those already finished.
 *
 * @module components/features/dashboard/get-started/fold
 */

import type { GetStartedStep } from "nextly/config";

/**
 * The steps in the order the card draws them: those still to do first, then those done or
 * skipped, each in the server's own order.
 *
 * 🔴 The card draws as many steps as its rows hold and folds the rest, so the room goes to what
 * the person still has to do. In the server's order a folded card showed steps already done while
 * open ones sat behind "Show N more"; the progress line already says how many are done. A step
 * whose status is not known is not finished, so it stays with the steps to do.
 */
export function stepsToDoFirst(
  steps: readonly GetStartedStep[]
): GetStartedStep[] {
  const finished = (step: GetStartedStep) =>
    step.status === "done" || step.status === "skipped";
  return [...steps.filter(step => !finished(step)), ...steps.filter(finished)];
}
