/**
 * The notices a workflow gives the people it names: assigned, approved and changes requested.
 *
 * Registered with the notices service, before any step or assignment can be taken, so every move
 * that names a person can tell them: the steps service records these kinds in the move's own
 * transaction, and a kind that is not registered could not be written. Their email job is
 * registered with the other jobs (`register-jobs`).
 *
 * @module di/registrations/register-workflow-notices
 */
import { registerNoticeKind } from "../../domains/notices/notice-kinds";
import { WORKFLOW_NOTICE_KINDS } from "../../domains/workflows/workflow-notices";

export function registerWorkflowNoticeKinds(): void {
  for (const kind of WORKFLOW_NOTICE_KINDS) registerNoticeKind(kind);
}
