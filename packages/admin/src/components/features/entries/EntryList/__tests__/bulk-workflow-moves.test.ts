/**
 * What a bulk workflow move says when it is done (R-11): how many moved, and each refusal named with
 * its reason ("3 moved; 2 refused: no permission to submit Pricing FAQ").
 */
import { describe, expect, it } from "vitest";

import { bulkMoveSummary, bulkMoveSteps } from "../bulk-workflow-moves";

describe("bulkMoveSummary", () => {
  it("counts what moved and names each refusal with its reason", () => {
    expect(
      bulkMoveSummary("submit", {
        moved: 3,
        refused: [
          { title: "Pricing FAQ", reason: "no permission to submit" },
          { title: "Launch notes", reason: "already in review" },
        ],
      })
    ).toEqual({
      head: "3 moved; 2 refused.",
      refusals: [
        "Pricing FAQ: no permission to submit.",
        "Launch notes: already in review.",
      ],
    });
  });

  it("says assigned and sent back for those moves, and nothing refused when none was", () => {
    expect(bulkMoveSummary("assign", { moved: 2, refused: [] })).toEqual({
      head: "2 assigned.",
      refusals: [],
    });
    expect(bulkMoveSummary("sendBack", { moved: 1, refused: [] })).toEqual({
      head: "1 sent back.",
      refusals: [],
    });
  });
});

describe("bulkMoveSteps", () => {
  const step = (
    name: string,
    kind: "submit" | "approve" | "request-changes" | "move"
  ) => ({
    name,
    label: name,
    kind,
  });

  it("names the one step of each kind a list may take in bulk, never an approval", () => {
    expect(
      bulkMoveSteps([
        step("submit", "submit"),
        step("clear", "approve"),
        step("send-back", "request-changes"),
      ])
    ).toEqual({ submit: "submit", sendBack: "send-back" });
  });

  it("leaves a kind to each document where the workflow has more than one step of it", () => {
    expect(
      bulkMoveSteps([
        step("submit-legal", "submit"),
        step("submit-copy", "submit"),
        step("send-back", "request-changes"),
      ])
    ).toEqual({ sendBack: "send-back" });
  });

  it("offers no step move where the workflow has none of either kind", () => {
    expect(bulkMoveSteps([step("clear", "approve")])).toEqual({});
  });
});
