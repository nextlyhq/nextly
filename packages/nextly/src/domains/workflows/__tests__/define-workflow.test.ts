/**
 * Declaring a workflow: the kind rules, primary steps, self-approval, review
 * stages, the preset, the definition hash, and each refusal a definition can
 * meet, each naming its place and the names it could have meant.
 */
import { describe, expect, it } from "vitest";

import {
  allowsSelfApproval,
  defineWorkflow,
  entersReview,
  isReviewStage,
  MAX_WORKFLOW_NAME_LENGTH,
  primaryStep,
} from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import { reviewWorkflow } from "../preset";
import type { WorkflowInput } from "../types";

/** A sound three-stage workflow, as a base for each case to break. */
function base(): WorkflowInput {
  return {
    slug: "editorial",
    label: "Editorial",
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
        primary: true,
      },
      {
        name: "requestChanges",
        label: "Request changes",
        kind: "request-changes",
        from: "inReview",
        to: "drafting",
      },
    ],
  };
}

/** The problems a definition is refused with, as `path: message` lines. */
function problemsOf(input: WorkflowInput): string[] {
  try {
    defineWorkflow(input);
  } catch (error) {
    const data = (
      error as { publicData?: { errors?: { path: string; message: string }[] } }
    ).publicData;
    return (data?.errors ?? []).map(e => `${e.path}: ${e.message}`);
  }
  return [];
}

describe("defineWorkflow", () => {
  it("accepts a sound definition and decides its defaults", () => {
    const workflow = defineWorkflow(base());
    expect(workflow.kind).toBe("nextly-workflow");
    expect(workflow.firstStage).toBe("drafting");
    expect(workflow.afterPublish).toBe("drafting");
    expect(workflow.approvalsWithdrawnTo).toBe("drafting");
    // An edit to approved content goes back to the first review stage.
    expect(workflow.onEdit).toEqual({ to: "inReview", exemptFields: [] });
    expect(workflow.keepApprovals).toBe(false);
    // A request for changes always asks for a comment, even unsaid.
    expect(
      workflow.steps.find(s => s.name === "requestChanges")?.commentRequired
    ).toBe(true);
    expect(workflow.steps.find(s => s.name === "submit")?.commentRequired).toBe(
      false
    );
    expect(Object.isFrozen(workflow)).toBe(true);
  });

  it("cannot be changed after it is validated, down to its steps", () => {
    const workflow = defineWorkflow(base());
    expect(() => {
      (workflow.steps[1] as { to: string }).to = "drafting";
    }).toThrow(TypeError);
    expect(() => {
      (workflow.stages as unknown as { name: string }[]).push({
        name: "extra",
      });
    }).toThrow(TypeError);
    expect(() => {
      (workflow.steps[2]!.from as unknown as string[]).push("approved");
    }).toThrow(TypeError);
    expect(workflow.steps[1]?.to).toBe("approved");
  });

  describe("kind rules", () => {
    it("refuses a step into a publishable stage that is not of kind approve", () => {
      const input = base();
      input.steps = [
        ...input.steps,
        {
          name: "shortcut",
          label: "Shortcut",
          kind: "move",
          from: "drafting",
          to: "approved",
        },
      ];
      input.steps = input.steps.map(s =>
        s.name === "submit" ? { ...s, primary: true } : s
      );
      expect(problemsOf(input)).toContain(
        "steps[3].kind: `shortcut` leads into `approved`, which allows publishing, so it must be of kind `approve`."
      );
    });

    it("refuses a step of kind approve that leads into a stage that does not allow publishing", () => {
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "submit" ? { ...s, kind: "approve" as const } : s
      );
      expect(problemsOf(input)).toContain(
        "steps[0].to: `submit` is of kind `approve`, so it must lead into a stage that allows publishing; `inReview` does not."
      );
    });

    it("refuses a request for changes whose comment is optional", () => {
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "requestChanges" ? { ...s, commentRequired: false } : s
      );
      expect(problemsOf(input)).toContain(
        "steps[2].commentRequired: `requestChanges` asks for changes, which always needs a comment; leave `commentRequired` out or set it to `true`."
      );
    });

    it("refuses an unknown kind, naming the known ones", () => {
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "submit" ? { ...s, kind: "sumbit" as never } : s
      );
      expect(problemsOf(input)).toContain(
        "steps[0].kind: `sumbit` is not a kind of step. Known kinds: submit, approve, request-changes, move."
      );
    });
  });

  describe("primary steps", () => {
    it("refuses a stage with several outgoing steps and no primary", () => {
      const input = base();
      input.steps = input.steps.map(s => ({ ...s, primary: false }));
      expect(problemsOf(input)).toContain(
        "stages[1]: `inReview` has 2 steps out of it (approve, requestChanges); mark exactly one with `primary: true`. It has 0."
      );
    });

    it("refuses two primaries on one stage", () => {
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "requestChanges" ? { ...s, primary: true } : s
      );
      expect(problemsOf(input)).toContain(
        "stages[1]: `inReview` has 2 steps out of it (approve, requestChanges); mark exactly one with `primary: true`. It has 2."
      );
    });

    it("answers a stage's primary step: the marked one, or its only one", () => {
      const workflow = defineWorkflow(base());
      expect(primaryStep(workflow, "inReview")?.name).toBe("approve");
      expect(primaryStep(workflow, "drafting")?.name).toBe("submit");
      expect(primaryStep(workflow, "approved")).toBeUndefined();
    });
  });

  describe("self-approval", () => {
    it("is allowed by default", () => {
      const step = defineWorkflow(base()).steps.find(
        s => s.name === "approve"
      )!;
      expect(allowsSelfApproval(step)).toBe(true);
    });

    it("is refused by a step that says so", () => {
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "approve" ? { ...s, refusesSelfApproval: true } : s
      );
      const step = defineWorkflow(input).steps.find(s => s.name === "approve")!;
      expect(allowsSelfApproval(step)).toBe(false);
    });
  });

  describe("review stages", () => {
    it("knows a review stage by its outgoing approve step", () => {
      const workflow = defineWorkflow(base());
      expect(isReviewStage(workflow, "inReview")).toBe(true);
      expect(isReviewStage(workflow, "drafting")).toBe(false);
      expect(isReviewStage(workflow, "approved")).toBe(false);
    });

    it("enters review through a step of kind move, as through submit", () => {
      const input = base();
      input.stages = [
        ...input.stages.slice(0, 1),
        { name: "legal", label: "Legal" },
        ...input.stages.slice(1),
      ];
      input.steps = [
        {
          name: "toLegal",
          label: "To legal",
          kind: "submit",
          from: "drafting",
          to: "legal",
          primary: true,
        },
        {
          name: "cleared",
          label: "Cleared",
          kind: "move",
          from: "legal",
          to: "inReview",
        },
        ...input.steps,
      ];
      const workflow = defineWorkflow(input);
      expect(entersReview(workflow, "legal", "inReview")).toBe(true);
      expect(entersReview(workflow, "drafting", "legal")).toBe(false);
      // Moving within review does not open another cycle.
      expect(entersReview(workflow, "inReview", "inReview")).toBe(false);
    });
  });

  describe("refusals, each naming its place and the known names", () => {
    it("refuses a step to an unknown stage", () => {
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "approve" ? { ...s, to: "aproved" } : s
      );
      expect(problemsOf(input)).toContain(
        "steps[1].to: `aproved` is not a stage. Known stages: drafting, inReview, approved."
      );
    });

    it("refuses a step from an unknown stage, at its index in the list", () => {
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "requestChanges"
          ? { ...s, from: ["inReview", "aproved"] }
          : s
      );
      expect(problemsOf(input)).toContain(
        "steps[2].from[1]: `aproved` is not a stage. Known stages: drafting, inReview, approved."
      );
    });

    it("refuses duplicate stage and step names", () => {
      const input = base();
      input.stages = [...input.stages, { name: "drafting", label: "Again" }];
      input.steps = [...input.steps, { ...input.steps[0]!, primary: false }];
      const problems = problemsOf(input);
      expect(problems).toContain(
        "stages[3].name: `drafting` is already a stage of this workflow; each stage needs its own name."
      );
      expect(problems).toContain(
        "steps[3].name: `submit` is already a step of this workflow; each step needs its own name."
      );
    });

    it("refuses a workflow with no stage that allows publishing", () => {
      const input = base();
      input.stages = input.stages.map(s => ({ ...s, allowsPublish: false }));
      input.steps = input.steps.filter(s => s.kind !== "approve");
      expect(problemsOf(input)).toContain(
        "stages: No stage allows publishing: mark one with `allowsPublish: true`."
      );
    });

    it("refuses a name too long to store", () => {
      const long = "a".repeat(MAX_WORKFLOW_NAME_LENGTH + 1);
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "submit" ? { ...s, name: long } : s
      );
      expect(problemsOf(input)).toContain(
        `steps[0].name: \`${long}\` is ${long.length} characters; a step name may have at most ${MAX_WORKFLOW_NAME_LENGTH}.`
      );
    });

    it("refuses a permission that is not a kebab-case action name", () => {
      const input = base();
      input.steps = input.steps.map(s =>
        s.name === "approve" ? { ...s, permission: "posts:approve" } : s
      );
      expect(problemsOf(input)).toContain(
        "steps[1].permission: `posts:approve` is not an action name: use kebab-case, such as `approve`."
      );
    });

    it("refuses a graph where the first stage leads both to approval and to a stage with no way out", () => {
      const input = base();
      input.stages = [...input.stages, { name: "parked", label: "Parked" }];
      input.steps = [
        ...input.steps.map(s =>
          s.name === "submit" ? { ...s, primary: true } : s
        ),
        {
          name: "park",
          label: "Park",
          kind: "move",
          from: "drafting",
          to: "parked",
        },
      ];
      expect(problemsOf(input)).toEqual([
        "stages[3]: `parked` can be reached (from the first stage), but no path of steps leads from it to a stage that allows publishing.",
      ]);
    });

    it("refuses a first stage that allows publishing, whatever afterPublish says", () => {
      const input = base();
      input.stages = [
        { name: "open", label: "Open", allowsPublish: true },
        ...input.stages,
      ];
      input.steps = [
        ...input.steps,
        {
          name: "start",
          label: "Start",
          kind: "move",
          from: "open",
          to: "drafting",
        },
      ];
      expect(problemsOf({ ...input, afterPublish: "drafting" })).toContain(
        "stages[0]: `open` is where every part starts, so it cannot allow publishing; content would be publishable before any approval."
      );
    });

    it("refuses an after-publish stage that itself allows publishing", () => {
      expect(problemsOf({ ...base(), afterPublish: "approved" })).toContain(
        "afterPublish: `approved` allows publishing, so a new draft would start already approved; name a stage before review."
      );
    });

    it("refuses withdrawing approvals into a stage that allows publishing", () => {
      expect(
        problemsOf({ ...base(), approvalsWithdrawnTo: "approved" })
      ).toEqual([
        "approvalsWithdrawnTo: `approved` allows publishing, so a part whose approval was withdrawn would stay publishable; name a stage before review.",
      ]);
      // A stage before review is accepted.
      expect(
        problemsOf({ ...base(), approvalsWithdrawnTo: "inReview" })
      ).toEqual([]);
    });

    it("refuses an edit-after-approval stage with no way out", () => {
      const input = base();
      input.stages = [...input.stages, { name: "frozen", label: "Frozen" }];
      expect(problemsOf({ ...input, onEdit: { to: "frozen" } })).toEqual([
        "stages[3]: `frozen` can be reached (from `onEdit.to`), but no path of steps leads from it to a stage that allows publishing.",
      ]);
    });

    it("refuses a dead end reached from withdrawn approvals or a removed stage", () => {
      const input = base();
      input.stages = [...input.stages, { name: "limbo", label: "Limbo" }];
      expect(problemsOf({ ...input, approvalsWithdrawnTo: "limbo" })).toEqual([
        "stages[3]: `limbo` can be reached (from `approvalsWithdrawnTo`), but no path of steps leads from it to a stage that allows publishing.",
      ]);
      expect(
        problemsOf({ ...input, removedStages: { legal: "limbo" } })
      ).toEqual([
        "stages[3]: `limbo` can be reached (from `removedStages.legal`), but no path of steps leads from it to a stage that allows publishing.",
      ]);
    });

    it("refuses mapping a stage that still exists as removed", () => {
      expect(
        problemsOf({ ...base(), removedStages: { drafting: "inReview" } })
      ).toContain(
        "removedStages.drafting: `drafting` is still a stage of this workflow, so it cannot also be removed."
      );
    });

    it("lists every problem at once", () => {
      const input = base();
      input.slug = "Editorial";
      input.steps = input.steps.map(s =>
        s.name === "approve" ? { ...s, to: "aproved" } : s
      );
      expect(problemsOf(input)).toHaveLength(2);
    });
  });
});

describe("reviewWorkflow", () => {
  it("expands to Drafting, In review and Approved, where the submitter may approve", () => {
    const preset = reviewWorkflow();
    expect(preset.slug).toBe("review");
    expect(preset.stages.map(s => [s.name, s.allowsPublish])).toEqual([
      ["drafting", false],
      ["inReview", false],
      ["approved", true],
    ]);
    expect(preset.steps.map(s => [s.name, s.kind, [...s.from], s.to])).toEqual([
      ["submit", "submit", ["drafting"], "inReview"],
      ["approve", "approve", ["inReview"], "approved"],
      [
        "requestChanges",
        "request-changes",
        ["inReview", "approved"],
        "drafting",
      ],
    ]);
    const approve = preset.steps.find(s => s.name === "approve")!;
    expect(allowsSelfApproval(approve)).toBe(true);
    expect(primaryStep(preset, "inReview")?.name).toBe("approve");
    expect(preset.onEdit.to).toBe("inReview");
    expect(preset.afterPublish).toBe("drafting");
  });

  it("takes its own slug and label", () => {
    expect(
      reviewWorkflow({ slug: "blog-review", label: "Blog review" })
    ).toMatchObject({
      slug: "blog-review",
      label: "Blog review",
    });
  });
});

describe("workflowDefinitionHash", () => {
  it("is a sha256 hex digest that changes with the structure", () => {
    const hash = workflowDefinitionHash(defineWorkflow(base()));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const input = base();
    input.steps = input.steps.map(s =>
      s.name === "approve" ? { ...s, refusesSelfApproval: true } : s
    );
    expect(workflowDefinitionHash(defineWorkflow(input))).not.toBe(hash);
  });

  it("does not change when only a label does, or when a step's from is reordered", () => {
    const hash = workflowDefinitionHash(defineWorkflow(base()));
    const relabelled = base();
    relabelled.label = "Editorial review";
    relabelled.stages = relabelled.stages.map(s => ({
      ...s,
      label: `${s.label}!`,
    }));
    relabelled.steps = relabelled.steps.map(s => ({
      ...s,
      label: `${s.label}!`,
    }));
    expect(workflowDefinitionHash(defineWorkflow(relabelled))).toBe(hash);

    const a = workflowDefinitionHash(reviewWorkflow());
    const reordered = reviewWorkflow();
    const swapped = defineWorkflow({
      ...reordered,
      stages: [...reordered.stages],
      steps: reordered.steps.map(s => ({
        ...s,
        from: [...s.from].reverse(),
        permission: s.permission ?? undefined,
      })),
    });
    expect(workflowDefinitionHash(swapped)).toBe(a);
  });
});
