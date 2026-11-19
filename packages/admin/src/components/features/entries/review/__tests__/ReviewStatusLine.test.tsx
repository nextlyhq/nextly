/**
 * The line under the title that says where the document stands in its
 * workflow, and the strip a live page shows while its changes wait in review.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { PartReview } from "@admin/types/workflows";

import { ReviewStatusLine } from "../ReviewStatusLine";

function part(over: Partial<PartReview> = {}): PartReview {
  return {
    part: null,
    stage: "inReview",
    stageLabel: "In review",
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 1,
    version: "v1",
    steps: [],
    waitingFor: { kind: "roles", roles: [{ id: "r1", name: "Editors" }] },
    lastMove: null,
    ...over,
  };
}

const LIVE_STRIP =
  "Readers see the published version until these changes are approved and published.";

describe("ReviewStatusLine", () => {
  it("takes the editor's column inset, so it starts where the title does", () => {
    render(
      <ReviewStatusLine
        status="draft"
        hasWorkingDraft={false}
        part={part()}
        className="px-4"
      />
    );
    expect(screen.getByTestId("review-status-line").parentElement).toHaveClass(
      "px-4"
    );
  });

  it("says a live page's changes are in review, and who they wait for", () => {
    render(
      <ReviewStatusLine status="published" hasWorkingDraft part={part()} />
    );
    expect(screen.getByTestId("review-status-line")).toHaveTextContent(
      "Published · Changes in review · waiting for Editors"
    );
    expect(screen.getByRole("note")).toHaveTextContent(LIVE_STRIP);
  });

  it("says a draft's stage, with no strip: nothing is live", () => {
    render(
      <ReviewStatusLine
        status="draft"
        hasWorkingDraft={false}
        part={part({
          stage: "legal",
          stageLabel: "Legal check",
          waitingFor: { kind: "user", id: "rita", name: "Rita" },
        })}
      />
    );
    expect(screen.getByTestId("review-status-line")).toHaveTextContent(
      "Draft · Legal check · waiting for Rita"
    );
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("names no one to wait for once approved, and drops the strip", () => {
    render(
      <ReviewStatusLine
        status="published"
        hasWorkingDraft
        part={part({
          stage: "approved",
          stageLabel: "Approved",
          publishable: true,
        })}
      />
    );
    expect(screen.getByTestId("review-status-line")).toHaveTextContent(
      "Published · Changes approved"
    );
    expect(screen.getByTestId("review-status-line")).not.toHaveTextContent(
      "waiting for"
    );
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("draws nothing where no workflow holds the part", () => {
    const { container } = render(
      <ReviewStatusLine
        status="draft"
        hasWorkingDraft={false}
        part={undefined}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [
      "drafting",
      part({ stage: "drafting", stageLabel: "Drafting", steps: [SUBMIT] }),
    ],
    ["in-review", part({ steps: [APPROVE] })],
    [
      "approved",
      part({ stage: "approved", stageLabel: "Approved", publishable: true }),
    ],
    [
      "changes-requested",
      part({
        stage: "drafting",
        stageLabel: "Drafting",
        steps: [SUBMIT],
        lastMove: {
          kind: "workflow-request-changes",
          actor: { kind: "person", id: "rita", name: "Rita" },
          at: "2026-11-17T09:00:00.000Z",
          from: "inReview",
          to: "drafting",
          comment: "Shorten the intro.",
        },
      }),
    ],
    // A stage the workflow no longer has: the review state names no label for it.
    ["removed", part({ stage: "legal", stageLabel: null })],
  ])(
    "draws the %s stage as words with its shape, never as a button",
    (shape, given) => {
      render(
        <ReviewStatusLine status="draft" hasWorkingDraft={false} part={given} />
      );
      const line = screen.getByTestId("review-status-line");
      const stage = line.querySelector("[data-stage-shape]");
      expect(stage).toHaveAttribute("data-stage-shape", shape);
      expect(stage).toHaveTextContent(given.stageLabel ?? given.stage ?? "");
      // The shape is drawn for the eye; the words are what is read.
      expect(stage?.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true"
      );
      expect(line.querySelector("button")).toBeNull();
    }
  );
});

const SUBMIT: PartReview["steps"][number] = {
  name: "submit",
  label: "Submit for review",
  kind: "submit",
  to: "inReview",
  mayTake: true,
  primary: true,
  commentRequired: false,
};

const APPROVE: PartReview["steps"][number] = {
  name: "approve",
  label: "Approve",
  kind: "approve",
  to: "approved",
  mayTake: true,
  primary: true,
  commentRequired: false,
};
