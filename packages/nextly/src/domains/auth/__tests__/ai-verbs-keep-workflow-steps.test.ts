/**
 * The AI permissions store two verbs no other built-in permission uses,
 * `use` and `run`, on their own rows only. The list of verbs a custom
 * permission may take, which also says which workflow-step actions are
 * already seeded, is unchanged: a workflow step that asks for `run` or `use`
 * still has its own per-collection permission seeded, as before.
 */
import { describe, expect, it } from "vitest";

import { PermissionActionSchema } from "../../../schemas/_zod/rbac";
import { AI_PERMISSIONS } from "../../ai/ai-contract";
import { defineWorkflow } from "../../workflows/define-workflow";
import {
  PUBLISH_WITHOUT_REVIEW,
  workflowPermissionActions,
} from "../../workflows/permissions";

/** A workflow whose approve step asks for `permission`. */
function approvedBy(permission: string) {
  return defineWorkflow({
    slug: "custom",
    label: "Custom",
    stages: [
      { name: "drafting", label: "Drafting" },
      { name: "inReview", label: "In review" },
      { name: "approved", label: "Approved", allowsPublish: true },
    ],
    steps: [
      {
        name: "submit",
        label: "Submit",
        kind: "submit",
        from: "drafting",
        to: "inReview",
      },
      {
        name: "approve",
        label: "Approve",
        kind: "approve",
        from: "inReview",
        to: "approved",
        permission,
      },
    ],
    onEdit: { to: "inReview" },
    afterPublish: "drafting",
  });
}

describe("the AI permissions' verbs", () => {
  it("are stored on the AI permissions as use, run and manage", () => {
    expect(Object.values(AI_PERMISSIONS)).toEqual([
      { action: "use", resource: "ai", slug: "use-ai" },
      { action: "run", resource: "bulk-ai-jobs", slug: "run-bulk-ai-jobs" },
      { action: "manage", resource: "ai-settings", slug: "manage-ai-settings" },
    ]);
  });

  it("leave the verbs a custom permission may take as they were", () => {
    expect(PermissionActionSchema.options).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "publish",
      "unpublish",
      "manage",
    ]);
  });

  it.each(["run", "use"])(
    "still seed a workflow step's own %s permission",
    action => {
      expect(workflowPermissionActions(approvedBy(action))).toEqual([
        action,
        PUBLISH_WITHOUT_REVIEW,
      ]);
    }
  );
});
