/**
 * The shared fields' approval, held where their version under review is hidden
 * from the reviewer: it was last saved in a language they can't read, so their
 * history's newest version is an older one. A reviewer who can see the version
 * under review is not held.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { VersionMeta } from "@admin/services/versionApi";
import type { PartReview, ReviewStateAnswer } from "@admin/types/workflows";

import { ReviewSection } from "../ReviewSection";
import { SHARED_APPROVAL_HELD } from "../shared-hold";
import { useEditorReview } from "../useEditorReview";

const { fetchSpy, listSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  listSpy: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
}));
vi.mock("@admin/services/versionApi", async importOriginal => {
  const original =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return { ...original, versionApi: { ...original.versionApi, list: listSpy } };
});
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
function waiting(code: string | null, reviewedVersionNo: number): PartReview {
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
    reviewedVersionNo,
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

/** A saved version in `locale`. */
function saved(versionNo: number, locale: string): VersionMeta {
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "draft",
    isAutosave: false,
    label: null,
    locale,
    sourceVersionNo: null,
    createdBy: null,
    author: null,
    createdAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-19T09:00:00.000Z",
  };
}

/**
 * The review state (English and the shared fields wait; French is not this
 * reviewer's to read) and the history they can see, newest first.
 */
function answering(sharedReviewed: number, visible: VersionMeta[]): void {
  const answer: ReviewStateAnswer = {
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts: [waiting("en", 8), waiting(null, sharedReviewed)],
      mayPublishWithoutReview: false,
    },
  };
  fetchSpy.mockResolvedValue(answer);
  listSpy.mockResolvedValue({ items: visible, meta: {} });
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

function renderBoth() {
  render(
    <>
      <Probe />
      <ReviewSection document={post} locale="en" />
    </>
  );
}

describe("the shared fields' approval and their version under review", () => {
  it("is held in the header, approve-all and the side panel when French, which the reviewer can't read, was saved last", async () => {
    // The shared fields' version under review is French v9; the reviewer sees English v8 newest.
    answering(9, [saved(8, "en"), saved(7, "en")]);

    renderBoth();

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

  it("is not held for the same reviewer when English was saved last, which is the control", async () => {
    // The version under review is English v9, which the reviewer sees.
    answering(9, [saved(9, "en"), saved(8, "en")]);

    renderBoth();

    await waitFor(() =>
      expect(screen.getByTestId("header")).toHaveTextContent("free")
    );
    await waitFor(() =>
      expect(screen.getByTestId("approve-all")).toHaveTextContent("free")
    );
    const shared = document.querySelector('[data-review-part=""]');
    expect(
      within(shared as HTMLElement).getByRole("button", { name: "Approve" })
    ).toBeEnabled();
  });
});
