/**
 * The workflow client: how a document is named to each route, and that a
 * document with no workflow attached is an answer rather than a failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseApiError } from "../../lib/api/parseApiError";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));

vi.mock("../../lib/api/fetcher", () => ({ fetcher: fetcherSpy }));

import {
  assignWorkflowParts,
  fetchReviewState,
  takeWorkflowStep,
  workflowDocument,
} from "../workflowApi";

/** The refusal the review-state read answers a document with no workflow with. */
function refusal(code: string, status = 400) {
  return parseApiError(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input.",
        requestId: "r1",
        data: { errors: [{ path: "document", code, message: "No workflow." }] },
      },
    },
    status
  );
}

const review = {
  workflow: { slug: "review", label: "Review" },
  parts: [],
  mayPublishWithoutReview: false,
};

describe("workflowApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names a collection entry and a Single as the routes do", () => {
    expect(
      workflowDocument({
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: "e1",
      })
    ).toEqual({ collection: "posts", id: "e1" });
    expect(
      workflowDocument({
        scopeKind: "single",
        scopeSlug: "home",
        entryId: "s1",
      })
    ).toEqual({ single: "home" });
  });

  it("reads a collection entry's review state by collection and id", async () => {
    fetcherSpy.mockResolvedValue(review);
    const answer = await fetchReviewState({ collection: "posts", id: "e 1" });
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/workflows/review-state?collection=posts&id=e+1",
      {},
      true
    );
    expect(answer).toEqual({ attached: true, review });
  });

  it("reads a Single's review state by its slug", async () => {
    fetcherSpy.mockResolvedValue(review);
    await fetchReviewState({ single: "home" });
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/workflows/review-state?single=home",
      {},
      true
    );
  });

  it("answers a document with no workflow attached as not attached", async () => {
    // The route answers 200 with no workflow, so no failed request is shown.
    fetcherSpy.mockResolvedValue({
      workflow: null,
      parts: [],
      mayPublishWithoutReview: false,
    });
    await expect(
      fetchReviewState({ collection: "posts", id: "e1" })
    ).resolves.toEqual({ attached: false });
  });

  it("throws every refusal", async () => {
    fetcherSpy.mockRejectedValue(refusal("REQUIRED"));
    await expect(
      fetchReviewState({ collection: "posts", id: "e1" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("posts a step and an assignment as the routes take them", async () => {
    fetcherSpy.mockResolvedValue({ message: "ok", item: {} });
    const step = {
      document: { collection: "posts", id: "e1" },
      step: "submit",
      parts: [null],
      seen: [{ part: null, revision: 2, version: "v2" }],
    };
    await takeWorkflowStep(step);
    expect(fetcherSpy).toHaveBeenCalledWith(
      "/workflows/steps",
      { method: "POST", body: JSON.stringify(step) },
      true
    );
    const assignment = {
      document: { single: "home" },
      part: null,
      revision: 1,
      assignee: { kind: "user" as const, id: "u1" },
    };
    await assignWorkflowParts([assignment]);
    expect(fetcherSpy).toHaveBeenLastCalledWith(
      "/workflows/assignments",
      {
        method: "POST",
        body: JSON.stringify({ assignments: [assignment] }),
      },
      true
    );
  });
});
