/**
 * The workflow moves a list offers over several documents (R-11): Submit for review, Assign… and
 * Send back…, never Approve, and what each says once done: how many moved, and each refusal named
 * with its reason, as the server answered it.
 *
 * @module components/entries/EntryList/bulk-workflow-moves
 * @experimental
 */

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
