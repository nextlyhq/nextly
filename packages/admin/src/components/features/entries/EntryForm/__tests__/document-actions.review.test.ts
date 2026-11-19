/**
 * The header's next step where a workflow holds publishing: one main action
 * per person and stage.
 *
 * Each case is a person (writer, reviewer, publisher) in a stage (drafting,
 * in review, approved, and a live page whose changes wait in review), told as
 * the facts the editor knows: which steps leave the stage and which of them
 * the person holds, and whether they may publish.
 */
import { describe, expect, it } from "vitest";

import {
  actionsAt,
  documentActions,
  type DocumentActionState,
  type ReviewActionState,
} from "../document-actions";

/** An edit-mode draft; each case names only what it changes. */
function state(over: Partial<DocumentActionState> = {}): DocumentActionState {
  return {
    mode: "edit",
    hasStatus: true,
    draftsEnabled: true,
    status: "draft",
    hasWorkingDraft: false,
    readingHistory: false,
    canEdit: true,
    canPublish: true,
    canUnpublish: true,
    canDelete: true,
    isDirty: false,
    canDuplicate: true,
    ...over,
  };
}

const SUBMIT = {
  name: "submit",
  label: "Submit for review",
  kind: "submit",
  primary: true,
};
const APPROVE = {
  name: "approve",
  label: "Approve",
  kind: "approve",
  primary: true,
};
const REQUEST = {
  name: "requestChanges",
  label: "Request changes",
  kind: "request-changes",
  primary: false,
};

/** The preset's three stages, with which steps the person holds. */
function drafting(holdsSubmit: boolean): ReviewActionState {
  return {
    stageLabel: "Drafting",
    publishable: false,
    steps: [{ ...SUBMIT, kind: "submit", held: holdsSubmit }],
    waitingFor: null,
  };
}

function inReview(holdsApprove: boolean): ReviewActionState {
  return {
    stageLabel: "In review",
    publishable: false,
    steps: [
      { ...APPROVE, kind: "approve", held: holdsApprove },
      { ...REQUEST, kind: "request-changes", held: holdsApprove },
    ],
    waitingFor: "Editors",
  };
}

function approved(holdsApprove: boolean): ReviewActionState {
  return {
    stageLabel: "Approved",
    publishable: true,
    steps: [{ ...REQUEST, kind: "request-changes", held: holdsApprove }],
    waitingFor: "Editors",
  };
}

const writer = { canEdit: true, canPublish: false, canUnpublish: false };
const reviewer = { canEdit: false, canPublish: false, canUnpublish: false };
const publisher = { canEdit: true, canPublish: true, canUnpublish: true };

const lead = (s: DocumentActionState) =>
  actionsAt(documentActions(s), "primary");
const labels = (s: DocumentActionState, placement: "toolbar" | "menu") =>
  actionsAt(documentActions(s), placement).map(action => action.label);

describe("the next step, per person and stage", () => {
  it("a writer in drafting submits for review, with saving beside it", () => {
    const s = state({ ...writer, review: drafting(true) });
    expect(lead(s)).toEqual([
      expect.objectContaining({
        id: "review-step:submit",
        label: "Submit for review",
      }),
    ]);
    expect(lead(s)[0]?.disabledReason).toBeUndefined();
    expect(labels(s, "toolbar")).toEqual(["Save draft"]);
  });

  it("a writer in review keeps saving, and is offered no approval", () => {
    const s = state({ ...writer, review: inReview(false) });
    expect(lead(s)).toEqual([
      expect.objectContaining({ id: "save", label: "Save draft" }),
    ]);
    expect(documentActions(s).map(action => action.id)).not.toContain(
      "review-step:approve"
    );
  });

  it("a reviewer in review approves, with Request changes beside it", () => {
    const s = state({ ...reviewer, review: inReview(true) });
    expect(lead(s)).toEqual([
      expect.objectContaining({ id: "review-step:approve", label: "Approve" }),
    ]);
    expect(labels(s, "toolbar")).toEqual(["Request changes"]);
  });

  it("a reviewer in drafting, who may not edit, is offered nothing to lead", () => {
    const s = state({ ...reviewer, review: drafting(false) });
    expect(lead(s)).toEqual([]);
  });

  it("a reviewer in approved may still request changes, from the menu", () => {
    const s = state({ ...reviewer, review: approved(true) });
    expect(labels(s, "menu")).toContain("Request changes");
    expect(labels(s, "toolbar")).not.toContain("Request changes");
  });

  it("a publisher in drafting submits, and Publish is drawn held with why", () => {
    const s = state({ ...publisher, review: drafting(true) });
    expect(lead(s)[0]).toMatchObject({ id: "review-step:submit" });
    const publish = documentActions(s).find(action => action.id === "publish");
    expect(publish).toMatchObject({
      placement: "toolbar",
      disabledReason: "Needs approval: Drafting",
    });
    expect(labels(s, "toolbar")).toEqual(["Save draft", "Publish"]);
  });

  it("a publisher in review leads with Publish, held until it is approved", () => {
    const s = state({ ...publisher, review: inReview(false) });
    expect(lead(s)).toEqual([
      expect.objectContaining({
        id: "publish",
        label: "Publish",
        disabledReason: "Needs approval: In review, waiting for Editors",
      }),
    ]);
  });

  it("a publisher in approved publishes as today", () => {
    const withReview = state({ ...publisher, review: approved(false) });
    const without = state({ ...publisher });
    expect(lead(withReview)).toEqual(lead(without));
    expect(lead(withReview)[0]?.disabledReason).toBeUndefined();
  });

  it("a live page whose changes wait in review holds Publish changes", () => {
    const s = state({
      ...publisher,
      status: "published",
      hasWorkingDraft: true,
      review: inReview(false),
    });
    expect(lead(s)).toEqual([
      expect.objectContaining({
        id: "publish",
        label: "Publish changes",
        disabledReason: "Needs approval: In review, waiting for Editors",
      }),
    ]);
  });

  it("a writer on a live page whose changes are drafting submits them, still able to save", () => {
    const s = state({
      ...writer,
      status: "published",
      hasWorkingDraft: true,
      isDirty: true,
      review: drafting(true),
    });
    expect(lead(s)[0]).toMatchObject({ id: "review-step:submit" });
    expect(labels(s, "toolbar")).toEqual(["Save"]);
  });

  it("holds a step with the reason the editor gives, and every step on a past version", () => {
    const held = state({
      ...writer,
      review: { ...drafting(true), stepReason: "Save your changes first." },
    });
    expect(lead(held)[0]?.disabledReason).toBe("Save your changes first.");
    const history = state({
      ...reviewer,
      readingHistory: true,
      review: inReview(true),
    });
    for (const action of documentActions(history)) {
      if (action.id.startsWith("review-step:")) {
        expect(action.disabledReason).toMatch(/past version/);
      }
    }
  });

  it("offers no step where every write is refused", () => {
    const s = state({
      ...publisher,
      writesRefused: true,
      review: inReview(true),
    });
    expect(
      documentActions(s).some(action => action.id.startsWith("review-step:"))
    ).toBe(false);
  });

  it("leads with the stage's primary step, whatever its kind", () => {
    const s = state({
      ...reviewer,
      review: {
        ...inReview(true),
        steps: [
          { ...APPROVE, kind: "approve", primary: false, held: true },
          {
            name: "legal",
            label: "Send to legal",
            kind: "move",
            primary: true,
            held: true,
          },
        ],
      },
    });
    expect(lead(s)[0]).toMatchObject({ id: "review-step:legal" });
    expect(labels(s, "toolbar")).toEqual(["Approve"]);
  });

  it("falls back to approve, then submit, then move where no step is primary", () => {
    const s = state({
      ...reviewer,
      review: {
        ...inReview(true),
        steps: [
          {
            name: "legal",
            label: "Send to legal",
            kind: "move",
            primary: false,
            held: true,
          },
          { ...APPROVE, kind: "approve", primary: false, held: true },
        ],
      },
    });
    expect(lead(s)[0]).toMatchObject({ id: "review-step:approve" });
  });

  it("keeps exactly one action leading, and no id twice, in every review case", () => {
    const people = [writer, reviewer, publisher];
    const stages = [
      drafting(true),
      drafting(false),
      inReview(true),
      inReview(false),
      approved(true),
      approved(false),
    ];
    let cases = 0;
    for (const person of people) {
      for (const review of stages) {
        for (const status of ["draft", "published"] as const) {
          const s = state({ ...person, status, hasWorkingDraft: true, review });
          const actions = documentActions(s);
          expect(actionsAt(actions, "primary").length).toBeLessThanOrEqual(1);
          const ids = actions.map(action => action.id);
          expect(new Set(ids).size).toBe(ids.length);
          cases += 1;
        }
      }
    }
    expect(cases).toBe(36);
  });

  describe("creating a document in a collection a workflow holds", () => {
    it("leads with Save draft and offers no Publish: the gate refuses a create as published", () => {
      const actions = documentActions(
        state({ mode: "create", status: "draft", workflowAttached: true })
      );

      expect(actions[0]).toMatchObject({
        id: "save",
        label: "Save draft",
        placement: "primary",
      });
      expect(actions.filter(action => action.id === "save")).toHaveLength(1);
      expect(actions.some(action => action.id === "publish")).toBe(false);
    });

    it("leads with Publish where no workflow is attached, which is the control", () => {
      const actions = documentActions(
        state({ mode: "create", status: "draft" })
      );

      expect(actions[0]).toMatchObject({ id: "publish", placement: "primary" });
      expect(
        actionsAt(actions, "toolbar").map(action => action.label)
      ).toContain("Save draft");
    });
  });
});
