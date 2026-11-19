/**
 * The shared fields' approval, held where the reviewer can't read every
 * language: their newest version may be one the reviewer can't see, while the
 * step would approve it. A reviewer who reads every language is not held.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { PartReview, ReviewStateAnswer } from "@admin/types/workflows";

import { ReviewSection } from "../ReviewSection";
import { SHARED_APPROVAL_HELD } from "../shared-hold";
import { useEditorReview } from "../useEditorReview";

const { fetchSpy } = vi.hoisted(() => ({ fetchSpy: vi.fn() }));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    defaultLocale: "en",
    locales: [
      { code: "en", label: "English" },
      { code: "fr", label: "French" },
    ],
    getLocale: (code: string) => ({ code, label: code.toUpperCase() }),
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));
vi.mock("@admin/hooks/useHasPermission", () => ({
  useHasPermission: () => () => false,
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));

const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

/** A part in review whose approval this person may give. */
function waiting(code: string | null): PartReview {
  return {
    part: code,
    stage: "inReview",
    stageLabel: "In review",
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 1,
    version: `t-${code ?? "shared"}`,
    steps: [
      {
        name: "approve",
        label: "Approve",
        kind: "approve",
        to: "approved",
        mayTake: true,
        primary: true,
        commentRequired: false,
      },
    ],
    waitingFor: null,
    lastMove: null,
  };
}

function answering(...parts: PartReview[]): void {
  const answer: ReviewStateAnswer = {
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts,
      mayPublishWithoutReview: false,
    },
  };
  fetchSpy.mockResolvedValue(answer);
}

/** The header's hold and approve-all's, as the editor reads them. */
function Probe() {
  const review = useEditorReview({
    document: post,
    locale: "en",
    isDirty: false,
    storedStamp: "s1",
  });
  return (
    <div>
      <p data-testid="header">
        {review.binding === undefined
          ? "reading"
          : (review.binding.state.stepReason ?? "free")}
      </p>
      <p data-testid="approve-all">{review.hold ?? "free"}</p>
    </div>
  );
}

describe("the shared fields' approval where a language is hidden", () => {
  it("is held in the header, approve-all and the side panel when the reviewer can't read French", async () => {
    answering(waiting("en"), waiting(null));

    render(
      <>
        <Probe />
        <ReviewSection document={post} locale="en" />
      </>
    );

    await waitFor(() =>
      expect(screen.getByTestId("header")).toHaveTextContent(
        SHARED_APPROVAL_HELD
      )
    );
    expect(screen.getByTestId("approve-all")).toHaveTextContent(
      SHARED_APPROVAL_HELD
    );
    const shared = document.querySelector('[data-review-part=""]');
    expect(shared).not.toBeNull();
    expect(
      within(shared as HTMLElement).getByRole("button", { name: "Approve" })
    ).toBeDisabled();
    expect(
      within(shared as HTMLElement).getByText(SHARED_APPROVAL_HELD)
    ).toBeInTheDocument();
  });

  it("is not held for a reviewer who reads every language, which is the control", async () => {
    answering(waiting("en"), waiting("fr"), waiting(null));

    render(
      <>
        <Probe />
        <ReviewSection document={post} locale="en" />
      </>
    );

    await waitFor(() =>
      expect(screen.getByTestId("header")).toHaveTextContent("free")
    );
    expect(screen.getByTestId("approve-all")).toHaveTextContent("free");
    const shared = document.querySelector('[data-review-part=""]');
    expect(
      within(shared as HTMLElement).getByRole("button", { name: "Approve" })
    ).toBeEnabled();
  });
});
