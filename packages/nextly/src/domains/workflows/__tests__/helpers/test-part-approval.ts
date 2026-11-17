/**
 * A stand-in for the publish path's per-part decision (`partApproval`), for the release tests:
 * the decision itself belongs to the publish path, and these tests are about what a release does
 * with its answer, so they register one that holds a part exactly where a current approval is
 * missing.
 *
 * It approves a part in a stage that allows publishing, holding an approval given under the
 * definition the workflow has now, and, for a Single's part, whose digest still names the content
 * the part shows. Every other part is held.
 */
import { container } from "../../../../di/container";
import { stillApproved } from "../../approval-digest";
import type { PartApproval, PartApprovalQuestion } from "../../part-approval";

/** Whether the part holds a current approval, as described above. */
async function approvedNow(question: PartApprovalQuestion): Promise<boolean> {
  const { registered, state } = question;
  const stage = registered.workflow.stages.find(
    candidate => candidate.name === question.stage
  );
  if (stage?.allowsPublish !== true) return false;
  if (state === null || state.approval === null) return false;
  if (state.definitionHash !== registered.definitionHash) return false;
  if (question.shownVersion === undefined) return true;
  const shown = await question.shownVersion();
  return (
    shown !== undefined &&
    stillApproved(
      state.approval.digest,
      shown.snapshot,
      "single",
      registered.workflow.onEdit.exemptFields
    )
  );
}

/** Registers the stand-in on the booted instance's container. */
export function registerTestPartApproval(): void {
  container.registerSingleton<PartApproval>("partApproval", () => ({
    approved: approvedNow,
  }));
}
