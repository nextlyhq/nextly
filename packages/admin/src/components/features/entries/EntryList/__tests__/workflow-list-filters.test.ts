/**
 * The review filters a collection's list offers: none without a workflow; by stage, from the
 * workflow's stages; and by review, each option's `where` a top-level key the server reads.
 */
import { describe, expect, it } from "vitest";

import {
  REVIEW_FILTER,
  STAGE_FILTER,
  workflowListFilters,
} from "../workflow-list-filters";

describe("workflowListFilters", () => {
  it("offers nothing for a collection no workflow holds", () => {
    expect(workflowListFilters(null)).toEqual([]);
    expect(workflowListFilters(undefined)).toEqual([]);
  });

  it("offers each stage, and the three review choices, each by its server key", () => {
    const filters = workflowListFilters({
      stages: [
        { name: "draft", label: "Draft" },
        { name: "review", label: "In review" },
      ],
    });
    expect(filters.map(filter => filter.name)).toEqual([
      STAGE_FILTER,
      REVIEW_FILTER,
    ]);
    expect(filters[0].options).toEqual([
      { value: "draft", label: "Draft", where: { _stage: "draft" } },
      { value: "review", label: "In review", where: { _stage: "review" } },
    ]);
    expect(
      filters[1].options.map(option => [option.label, option.where])
    ).toEqual([
      ["Assigned to me", { _assignedToMe: true }],
      ["Waiting for my review", { _waitingForMe: true }],
      ["Changed since approved", { _changedSinceApproved: true }],
    ]);
  });

  it("leaves the stage filter out where the stages are not known", () => {
    expect(workflowListFilters({}).map(filter => filter.name)).toEqual([
      REVIEW_FILTER,
    ]);
  });
});
