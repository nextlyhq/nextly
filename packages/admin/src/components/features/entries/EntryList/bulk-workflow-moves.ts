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

/** What a move did: how many moved, each refusal, and how many were never sent, and why. */
export interface BulkMoveOutcome {
  moved: number;
  refused: readonly BulkMoveRefusalNamed[];
  /** Where a request went unanswered: the items it and those after it held, and the reason. */
  unsent?: { count: number; reason: string };
}

const DONE: Record<BulkWorkflowMove, string> = {
  submit: "moved",
  assign: "assigned",
  sendBack: "sent back",
};

/**
 * What a bulk move says when it is done: "3 moved; 2 refused." and one line per refusal, "Pricing
 * FAQ: no permission to submit.", so each one that did not move is named with its reason. Where a
 * request went unanswered, what moved before it is still said, with how many were never sent and
 * why: "200 moved; 250 not sent." and "Not sent: <reason>.".
 */
export function bulkMoveSummary(
  move: BulkWorkflowMove,
  outcome: BulkMoveOutcome
): { head: string; refusals: string[] } {
  const refused = outcome.refused.length;
  const head = [
    `${outcome.moved} ${DONE[move]}`,
    ...(refused > 0 ? [`${refused} refused`] : []),
    ...(outcome.unsent ? [`${outcome.unsent.count} not sent`] : []),
  ].join("; ");
  return {
    head: `${head}.`,
    refusals: [
      ...outcome.refused.map(each => `${each.title}: ${each.reason}.`),
      ...(outcome.unsent ? [`Not sent: ${outcome.unsent.reason}.`] : []),
    ],
  };
}

/** A workflow's step, as its summary names it. */
export interface BulkMoveStepCandidate {
  name: string;
  label: string;
  kind: "submit" | "approve" | "request-changes" | "move";
  /** Whether the step needs a comment, as its definition says; a summary without it needs none. */
  commentRequired?: boolean;
}

/**
 * The step a list takes in bulk for Submit for review and for Send back…: the workflow's one step of
 * that kind. Where it has several of a kind, which applies depends on each document's stage, so that
 * move is left to each document. An approval is never one: each is given from that document's review.
 * A submit step that needs a comment is said to (`submitNeedsComment`), so the list asks for it
 * before sending rather than having every document refused without one. Send back always asks.
 */
export function bulkMoveSteps(steps: readonly BulkMoveStepCandidate[]): {
  submit?: string;
  submitNeedsComment?: true;
  sendBack?: string;
} {
  const only = (kind: BulkMoveStepCandidate["kind"]) => {
    const ofKind = steps.filter(step => step.kind === kind);
    return ofKind.length === 1 ? ofKind[0] : undefined;
  };
  const submit = only("submit");
  const sendBack = only("request-changes");
  return {
    ...(submit === undefined ? {} : { submit: submit.name }),
    ...(submit?.commentRequired === true ? { submitNeedsComment: true } : {}),
    ...(sendBack === undefined ? {} : { sendBack: sendBack.name }),
  };
}

/** Documents one move request takes at most (`POST /workflows/steps/bulk`). */
export const DOCUMENTS_PER_MOVE = 200;
/** Assignments one request takes at most (`POST /workflows/assignments/bulk`). */
export const ASSIGNMENTS_PER_REQUEST = 500;

/** The joined answers of a move sent in several requests, and where it stopped, if it did. */
export interface BatchedMoveAnswer extends BulkMoveAnswer {
  /**
   * Set where a request was not answered (the network, an expired session): why, and how many
   * items it and every request after it held, none of which was sent.
   */
  stopped?: { reason: unknown; unsent: number };
}

/**
 * `items` sent in requests of `size` at most, one after another, their answers joined: a
 * selection carried across pages may hold more than one request takes, and each document is
 * still moved or refused on its own. A request that fails stops the rest, but what the earlier
 * ones moved has moved: their answers are kept and returned beside where it stopped, so the list
 * reports them rather than a failure that hides them.
 */
export async function inBatches<T>(
  items: readonly T[],
  size: number,
  send: (batch: T[]) => Promise<BulkMoveAnswer>
): Promise<BatchedMoveAnswer> {
  const joined: BatchedMoveAnswer = { items: [], errors: [] };
  for (let at = 0; at < items.length; at += size) {
    let answer: BulkMoveAnswer;
    try {
      answer = await send(items.slice(at, at + size));
    } catch (reason) {
      joined.stopped = { reason, unsent: items.length - at };
      return joined;
    }
    joined.items.push(...answer.items);
    joined.errors.push(...answer.errors);
  }
  return joined;
}
