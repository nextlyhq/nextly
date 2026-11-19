/**
 * A refused step says why where it was taken, from what the server's refusal
 * carries: the side panel's Review section keeps the reason under its steps,
 * and the comment dialog a request for changes was sent from keeps it there,
 * with the comment, for a retry.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { PartReview, ReviewStep } from "@admin/types/workflows";

import { ReviewSection } from "../ReviewSection";

const { fetchSpy, stepSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  stepSpy: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
  takeWorkflowStep: stepSpy,
}));
vi.mock("@admin/hooks/useHasPermission", () => ({
  useHasPermission: () => () => false,
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));
vi.mock("@admin/hooks/useAdminDateFormatter", () => ({
  useAdminDateFormatter: () => ({ formatDate: (value: string) => value }),
}));

const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

const approve: ReviewStep = {
  name: "approve",
  label: "Approve",
  kind: "approve",
  to: "approved",
  mayTake: true,
  primary: true,
  commentRequired: false,
};
const sendBack: ReviewStep = {
  name: "send-back",
  label: "Request changes",
  kind: "request-changes",
  to: "drafting",
  mayTake: true,
  primary: false,
  commentRequired: true,
};

const inReview: PartReview = {
  part: null,
  stage: "inReview",
  stageLabel: "In review",
  publishable: false,
  enteredAt: null,
  enteredBy: null,
  assignee: null,
  dueAt: null,
  approval: null,
  revision: 4,
  version: "v4",
  steps: [approve, sendBack],
  waitingFor: null,
  lastMove: null,
};

/** A refusal as `fetcher` throws it: the parsed `{ error }` envelope. */
function refused(
  status: number,
  message: string,
  data: Record<string, unknown>
): Error {
  return Object.assign(new Error(message), {
    status,
    code: status === 409 ? "CONFLICT" : "FORBIDDEN",
    data,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy.mockResolvedValue({
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts: [inReview],
      mayPublishWithoutReview: false,
    },
  });
});

async function panel(): Promise<HTMLElement> {
  render(<ReviewSection document={post} />);
  return screen.findByRole("region", { name: "Review" });
}

describe("a refused step, said in place", () => {
  it("names the fields an approval covers that the reviewer can't read, and who could approve", async () => {
    stepSpy.mockRejectedValue(
      refused(403, "You don't have permission to perform this action.", {
        reason: "field-hidden",
        fields: ["price"],
        approvers: [
          { kind: "user", id: "u-rita", name: "Rita" },
          { kind: "user", id: "u-omar", name: "Omar" },
        ],
      })
    );
    const section = await panel();

    await userEvent.click(
      within(section).getByRole("button", { name: "Approve" })
    );

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "You can't approve this: it changes a field you can't read (price). It can be approved by Rita and Omar."
    );
  });

  it("says when no one who can read the fields may approve", async () => {
    stepSpy.mockRejectedValue(
      refused(403, "You don't have permission to perform this action.", {
        reason: "field-hidden",
        fields: ["price", "cost"],
        approvers: [],
      })
    );
    const section = await panel();

    await userEvent.click(
      within(section).getByRole("button", { name: "Approve" })
    );

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "You can't approve this: it changes fields you can't read (price, cost). No one who can read them may approve it yet."
    );
  });

  it("says someone else must approve one's own submission, and is dismissed", async () => {
    stepSpy.mockRejectedValue(
      refused(403, "You don't have permission to perform this action.", {
        reason: "self-approval",
      })
    );
    const section = await panel();

    await userEvent.click(
      within(section).getByRole("button", { name: "Approve" })
    );
    const alert = await within(section).findByRole("alert");
    expect(alert).toHaveTextContent(
      "You can't approve your own submission: someone else needs to."
    );

    await userEvent.click(
      within(alert).getByRole("button", { name: "Dismiss" })
    );
    expect(within(section).queryByRole("alert")).toBeNull();
  });

  it("keeps a refused request for changes in its dialog, with the comment", async () => {
    stepSpy.mockRejectedValue(
      refused(403, "You don't have permission to perform this action.", {
        reason: "no-permission",
        permission: "send-back-posts",
      })
    );
    const section = await panel();

    await userEvent.click(
      within(section).getByRole("button", { name: "Request changes" })
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("Comment"),
      "Shorten the intro."
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Request changes" })
    );

    await waitFor(() => expect(stepSpy).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You need the “send-back-posts” permission for “Request changes”."
    );
    expect(within(dialog).getByLabelText("Comment")).toHaveValue(
      "Shorten the intro."
    );
  });
});
