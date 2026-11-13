/**
 * The comparison baselines a workflow's review shows, "since submitted" and "since approved",
 * registered with the history's comparison baselines as the workflow notices are registered with
 * the notices service: at registration, before any comparison can name them. Each resolves from
 * the versions the workflow pins for a part (`domains/workflows/review-baselines`).
 *
 * @module di/registrations/register-workflow-baselines
 */
import { registerWorkflowBaselines } from "../../domains/workflows/review-baselines";

export function registerWorkflowComparisonBaselines(): void {
  registerWorkflowBaselines();
}
