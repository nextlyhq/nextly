/**
 * The steps service's pure rules: the permission a step needs, which steps only a person may
 * take, the permission an assignee and an assigner need in a stage, and the event kind a step is
 * recorded as. Read from the definitions the integration tests use, so a rule pinned here is the
 * one those cases exercise.
 */
import { describe, expect, it } from "vitest";

import { defineWorkflow } from "../define-workflow";
import { reviewWorkflow } from "../preset";
import {
  assigneePermission,
  assignerPermissions,
  stepNeedsPerson,
  stepPermission,
  workflowEventKind,
} from "../steps";
import type { Workflow } from "../types";

import { editorial, handover } from "./helpers/step-workflows";

const stepOf = (workflow: Workflow, name: string) => {
  const found = workflow.steps.find(step => step.name === name);
  if (!found) throw new Error(`no step ${name}`);
  return found;
};

describe("stepPermission", () => {
  it("is the step's named action on the collection or Single", () => {
    expect(stepPermission(editorial, stepOf(editorial, "clear"), "posts")).toBe(
      "sign-off-posts"
    );
    expect(stepPermission(editorial, stepOf(editorial, "clear"), "pages")).toBe(
      "sign-off-pages"
    );
    // A request for changes out of a publishable stage keeps its own action.
    expect(
      stepPermission(editorial, stepOf(editorial, "bounce"), "posts")
    ).toBe("sign-off-posts");
  });

  it("is publish-<slug> for a step naming no action into a stage that allows publishing", () => {
    expect(
      stepPermission(editorial, stepOf(editorial, "fastTrack"), "posts")
    ).toBe("publish-posts");
  });

  it("is update-<slug> for a step naming no action into any other stage", () => {
    for (const name of ["send", "park", "resume"]) {
      expect(stepPermission(editorial, stepOf(editorial, name), "posts")).toBe(
        "update-posts"
      );
    }
    expect(
      stepPermission(handover, stepOf(handover, "handOver"), "memos")
    ).toBe("update-memos");
  });

  it("keeps a named action over the publish default, even a built-in one", () => {
    // Named into the publishable stage: the name wins over `publish-<slug>`.
    expect(
      stepPermission(
        reviewWorkflow(),
        stepOf(reviewWorkflow(), "approve"),
        "notes"
      )
    ).toBe("approve-notes");
    const builtIn = defineWorkflow({
      slug: "built-in",
      label: "Built in",
      stages: [
        { name: "a", label: "A" },
        { name: "b", label: "B", allowsPublish: true },
      ],
      steps: [
        {
          name: "go",
          label: "Go",
          kind: "approve",
          from: "a",
          to: "b",
          permission: "update",
        },
        { name: "back", label: "Back", kind: "move", from: "b", to: "a" },
      ],
    });
    expect(stepPermission(builtIn, stepOf(builtIn, "go"), "posts")).toBe(
      "update-posts"
    );
  });
});

describe("stepNeedsPerson", () => {
  it("is true for steps of kind approve and request-changes, whatever they are named", () => {
    expect(stepNeedsPerson(stepOf(editorial, "clear"))).toBe(true);
    expect(stepNeedsPerson(stepOf(editorial, "bounce"))).toBe(true);
    // An approval naming no action, needing only `publish-<slug>`, is still an approval.
    expect(stepNeedsPerson(stepOf(editorial, "fastTrack"))).toBe(true);
    expect(stepNeedsPerson(stepOf(handover, "signOff"))).toBe(true);
    expect(stepNeedsPerson(stepOf(handover, "sendBack"))).toBe(true);
  });

  it("is false for submits and moves, even one that requires a comment", () => {
    for (const name of ["send", "park", "resume"]) {
      expect(stepNeedsPerson(stepOf(editorial, name)), name).toBe(false);
    }
    expect(stepNeedsPerson(stepOf(handover, "handOver"))).toBe(false);
  });
});

describe("assigneePermission", () => {
  it("is the permission of the stage's primary step", () => {
    // Legal check has three steps out; Clear is marked primary.
    expect(assigneePermission(editorial, "legal", "posts")).toBe(
      "sign-off-posts"
    );
    // Writing's primary step, Send, names no action.
    expect(assigneePermission(editorial, "writing", "posts")).toBe(
      "update-posts"
    );
    // Cleared's only step out is Bounce.
    expect(assigneePermission(editorial, "cleared", "posts")).toBe(
      "sign-off-posts"
    );
    expect(assigneePermission(handover, "review", "memos")).toBe(
      "sign-off-memos"
    );
  });
});

describe("assignerPermissions", () => {
  it("is update-<slug> and the stage's primary step's permission, each once", () => {
    expect(assignerPermissions(editorial, "legal", "posts")).toEqual([
      "update-posts",
      "sign-off-posts",
    ]);
    expect(assignerPermissions(editorial, "writing", "posts")).toEqual([
      "update-posts",
    ]);
  });
});

describe("workflowEventKind", () => {
  it("names each step kind, and an assignment, as a kebab-case workflow kind", () => {
    expect(workflowEventKind("submit")).toBe("workflow-submit");
    expect(workflowEventKind("approve")).toBe("workflow-approve");
    expect(workflowEventKind("request-changes")).toBe(
      "workflow-request-changes"
    );
    expect(workflowEventKind("move")).toBe("workflow-move");
    expect(workflowEventKind("assign")).toBe("workflow-assign");
  });
});
