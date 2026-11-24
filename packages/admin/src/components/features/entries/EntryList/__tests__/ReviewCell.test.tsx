/**
 * The Review column's cell: each part with a stage as its stage's pill, a language part naming
 * its language; whom the first waits for and when it is due; a document with nothing to review
 * says so. And the column itself is offered only for a collection a workflow holds.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { RowPartReview } from "@admin/types/workflows";

import { getAvailableColumns } from "../EntryTableColumns";
import { ReviewCell, rowReviewParts } from "../ReviewCell";

function part(overrides: Partial<RowPartReview>): RowPartReview {
  return {
    part: null,
    stage: null,
    stageLabel: null,
    stageColour: null,
    publishable: false,
    enteredAt: null,
    assignee: null,
    dueAt: null,
    waitingFor: null,
    revision: 0,
    version: null,
    ...overrides,
  };
}

describe("ReviewCell", () => {
  it("draws each part with a stage, naming a language part's language, and whom it waits for", () => {
    render(
      <ReviewCell
        parts={[
          part({
            part: "es",
            stage: "legal",
            stageLabel: "Legal check",
            waitingFor: {
              kind: "roles",
              roles: [{ id: "r1", name: "Legal desk" }],
            },
          }),
          part({ part: null, stage: "draft", stageLabel: "Draft" }),
          part({ part: "en", stage: null }),
        ]}
      />
    );
    expect(screen.getByText("Legal check (ES)")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Waiting for Legal desk")).toBeInTheDocument();
  });

  it("says a document with nothing waiting to go live has nothing to review", () => {
    render(<ReviewCell parts={[part({ stage: null })]} />);
    expect(screen.getByText("Nothing to review")).toBeInTheDocument();
  });

  it("reads a row's parts from its review state, and none from a row without one", () => {
    const parts = [part({ stage: "draft" })];
    expect(rowReviewParts({ id: "1", _review: { parts } })).toEqual(parts);
    expect(rowReviewParts({ id: "1" })).toEqual([]);
  });
});

describe("the Review column", () => {
  it("is offered only for a collection a workflow holds", () => {
    const base = { slug: "posts", fields: [] };
    expect(getAvailableColumns(base)).not.toContain("review");
    expect(
      getAvailableColumns({
        ...base,
        workflow: { slug: "review", label: "Review" },
      })
    ).toContain("review");
  });
});
