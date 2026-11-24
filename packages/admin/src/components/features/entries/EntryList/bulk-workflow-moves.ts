/**
 * The workflow moves a list offers over several documents (R-11): Submit for review, Assign… and
 * Send back…, never Approve, and what each says once done: how many moved, and each refusal named
 * with its reason, as the server answered it.
 *
 * @module components/entries/EntryList/bulk-workflow-moves
 * @experimental
 */

import type { BulkMoveAnswer } from "@admin/types/workflows";

/** A workflow move over several documents. */
export type BulkWorkflowMove = "submit" | "assign" | "sendBack";

/** One document a move refused, by the title the list shows, and why. */
export interface BulkMoveRefusalNamed {
  title: string;
  reason: string;
}

/** What a move did: how many moved, and each refusal. */
export interface BulkMoveOutcome {
  moved: number;
  refused: readonly BulkMoveRefusalNamed[];
}

const DONE: Record<BulkWorkflowMove, string> = {
  submit: "moved",
  assign: "assigned",
  sendBack: "sent back",
};

/**
 * What a bulk move says when it is done: "3 moved; 2 refused." and one line per refusal, "Pricing
 * FAQ: no permission to submit.", so each one that did not move is named with its reason.
 */
export function bulkMoveSummary(
  move: BulkWorkflowMove,
  outcome: BulkMoveOutcome
): { head: string; refusals: string[] } {
  const refused = outcome.refused.length;
  return {
    head: `${outcome.moved} ${DONE[move]}${refused > 0 ? `; ${refused} refused` : ""}.`,
    refusals: outcome.refused.map(each => `${each.title}: ${each.reason}.`),
  };
}

/** A workflow's step, as its summary names it. */
export interface BulkMoveStepCandidate {
  name: string;
  label: string;
  kind: "submit" | "approve" | "request-changes" | "move";
}

/**
 * The step a list takes in bulk for Submit for review and for Send back…: the workflow's one step of
 * that kind. Where it has several of a kind, which applies depends on each document's stage, so that
 * move is left to each document. An approval is never one: each is given from that document's review.
 */
export function bulkMoveSteps(steps: readonly BulkMoveStepCandidate[]): {
  submit?: string;
  sendBack?: string;
} {
  const only = (kind: BulkMoveStepCandidate["kind"]) => {
    const ofKind = steps.filter(step => step.kind === kind);
    return ofKind.length === 1 ? ofKind[0].name : undefined;
  };
  const submit = only("submit");
  const sendBack = only("request-changes");
  return {
    ...(submit === undefined ? {} : { submit }),
    ...(sendBack === undefined ? {} : { sendBack }),
  };
}

/** Documents one move request takes at most (`POST /workflows/steps/bulk`). */
export const DOCUMENTS_PER_MOVE = 200;
/** Assignments one request takes at most (`POST /workflows/assignments/bulk`). */
export const ASSIGNMENTS_PER_REQUEST = 500;

/**
 * `items` sent in requests of `size` at most, one after another, their answers joined: a
 * selection carried across pages may hold more than one request takes, and each document is
 * still moved or refused on its own.
 */
export async function inBatches<T>(
  items: readonly T[],
  size: number,
  send: (batch: T[]) => Promise<BulkMoveAnswer>
): Promise<BulkMoveAnswer> {
  const joined: BulkMoveAnswer = { items: [], errors: [] };
  for (let at = 0; at < items.length; at += size) {
    const answer = await send(items.slice(at, at + size));
    joined.items.push(...answer.items);
    joined.errors.push(...answer.errors);
  }
  return joined;
}
