/**
 * "Approve all languages": which parts a reviewer approves together, how the
 * one step names them and what it says it saw, and how the parts it leaves
 * are said.
 *
 * The parts listed are those waiting for this person's approval: each holds
 * the same approval step, and may take it. The step names `"all"` where every
 * part that step leaves from is listed, so the server names the parts it
 * leaves (`left`); where some part in that stage is not this person's to
 * approve, it names the listed parts alone, which the server takes as named.
 * Either way `seen` is each listed part's revision and version as the dialog
 * showed it, and the server refuses the whole step where any of them moved.
 *
 * @module components/features/entries/review/approve-all
 */

import { isApiError } from "@admin/lib/api/parseApiError";
import type {
  LeftPart,
  PartReview,
  ReviewStep,
  TakeStepPayload,
  TakeStepResult,
} from "@admin/types/workflows";

import { waitingForWords } from "./review-words";

/** The parts one approval moves together, and those it leaves out. */
export interface ApproveAll {
  /** The approval step the listed parts take together. */
  step: ReviewStep;
  /** The parts waiting for this person's approval, each shown with its changes. */
  listed: PartReview[];
  /** Every other part of the document, named in the dialog as left out. */
  out: PartReview[];
  /** The parts the step names. */
  parts: TakeStepPayload["parts"];
}

/** Whether `part` holds the step `name` and this person may take it there. */
function mayApprove(part: PartReview, name: string): boolean {
  return (
    part.version !== null &&
    part.steps.some(step => step.name === name && step.mayTake)
  );
}

/**
 * The approval of every part waiting for this person, where at least two
 * wait: one part alone is approved from the header. Undefined otherwise.
 */
export function approveAllOf(
  parts: readonly PartReview[]
): ApproveAll | undefined {
  const approvals = parts.flatMap(part =>
    part.steps.filter(
      step => step.kind === "approve" && step.mayTake && part.version !== null
    )
  );
  // The approval most parts may take: a workflow names one per stage, so
  // this is the review stage's approval wherever several parts wait in it.
  const counts = new Map<string, number>();
  for (const step of approvals) {
    counts.set(step.name, (counts.get(step.name) ?? 0) + 1);
  }
  let chosen: ReviewStep | undefined;
  for (const step of approvals) {
    if ((counts.get(step.name) ?? 0) > (counts.get(chosen?.name ?? "") ?? 0)) {
      chosen = step;
    }
  }
  if (chosen === undefined || (counts.get(chosen.name) ?? 0) < 2) {
    return undefined;
  }
  const name = chosen.name;
  const listed = parts.filter(part => mayApprove(part, name));
  const out = parts.filter(part => !mayApprove(part, name));
  const inItsStage = parts.filter(part =>
    part.steps.some(step => step.name === name)
  );
  return {
    step: chosen,
    listed,
    out,
    parts:
      listed.length === inItsStage.length
        ? "all"
        : listed.map(part => part.part),
  };
}

/** What the step says it saw of each listed part: what the dialog shows. */
export function seenOf(listed: readonly PartReview[]): TakeStepPayload["seen"] {
  return listed.flatMap(part =>
    part.version === null
      ? []
      : [{ part: part.part, revision: part.revision, version: part.version }]
  );
}

/** Why a part is left out of the approval, said before it is taken. */
export function outWords(
  part: PartReview,
  name: string,
  stepName: string
): string {
  if (part.stage === null) return `${name}: nothing waiting for review`;
  if (part.publishable) return `${name} is already approved`;
  if (part.steps.some(step => step.name === stepName)) {
    const waiting = waitingForWords(part.waitingFor);
    return waiting === null
      ? `${name} is not yours to approve`
      : `${name} waits for ${waiting}`;
  }
  return `${name} is in ${part.stageLabel ?? part.stage}`;
}

/**
 * The parts a taken step left, as the server names them, said with what the
 * review state knows of each: "Arabic is already approved", "French stays in
 * Drafting".
 */
export function leftWords(
  left: readonly LeftPart[],
  parts: readonly PartReview[],
  nameOf: (part: string | null) => string
): string[] {
  return left.map(each => {
    const review = parts.find(part => part.part === each.part);
    const name = nameOf(each.part);
    if (review?.stage === each.stage && review.publishable) {
      return `${name} is already approved`;
    }
    const label =
      review?.stage === each.stage
        ? (review.stageLabel ?? each.stage)
        : each.stage;
    return `${name} stays in ${label}`;
  });
}

/** The parts a step's answer says it left, read off its `item`; none where it names none. */
export function leftOf(item: unknown): TakeStepResult["left"] {
  if (typeof item !== "object" || item === null || !("left" in item)) {
    return [];
  }
  const { left } = item;
  if (!Array.isArray(left)) return [];
  return left.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const part: unknown = "part" in entry ? entry.part : undefined;
    const stage: unknown = "stage" in entry ? entry.stage : undefined;
    return (typeof part === "string" || part === null) &&
      typeof stage === "string"
      ? [{ part, stage }]
      : [];
  });
}

/**
 * The parts a step was refused for because they moved since the person saw
 * them; undefined where the refusal is of another kind.
 */
export function staleParts(reason: unknown): (string | null)[] | undefined {
  if (!isApiError(reason) || reason.data?.reason !== "stale") return undefined;
  const parts = reason.data.parts;
  if (!Array.isArray(parts)) return [];
  return parts.filter(
    (part: unknown): part is string | null =>
      typeof part === "string" || part === null
  );
}

/** Names as a sentence's list: "English, shared fields and Spanish". */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
