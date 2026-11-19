/**
 * The document panel's Review section, as the editor draws it: its steps wait
 * for what holds the header's (unsaved edits, a save on its way), and say why.
 *
 * The plausible broken panel: one that offers the side panel's steps while the
 * page holds unsaved edits, so a step approves the stored content while other
 * content is on screen.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { PartReview } from "@admin/types/workflows";

import { EntryLocaleProvider } from "../../../EntryLocaleContext";
import { DocumentPanel, type DocumentPanelProps } from "../DocumentPanel";

const api = vi.hoisted(() => ({
  fetchReviewState: vi.fn(),
  takeStep: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: api.fetchReviewState,
  takeWorkflowStep: api.takeStep,
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/hooks/queries/useReleasesContaining", () => ({
  useReleasesContaining: () => ({
    data: { items: [] },
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useHasPermission", () => ({
  useHasPermission: () => () => false,
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => "me",
}));

const releaseDocument = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

const IN_REVIEW: PartReview = {
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

function panel(props: Partial<DocumentPanelProps> = {}) {
  return render(
    <EntryLocaleProvider
      value={{
        locale: undefined,
        rtl: false,
        collectionLocalized: false,
        isNonDefaultLocale: false,
      }}
    >
      <DocumentPanel
        mode="edit"
        entry={{ id: "e1", createdAt: "2026-10-01T09:00:00Z" }}
        hasStatus
        documentStatus={{ status: "draft", hasWorkingDraft: false }}
        releaseDocument={releaseDocument}
        {...props}
      />
    </EntryLocaleProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchReviewState.mockResolvedValue({
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts: [IN_REVIEW],
      mayPublishWithoutReview: false,
    },
  });
  api.takeStep.mockResolvedValue({ message: "Step taken.", item: {} });
});

describe("the document panel's Review section", () => {
  it("holds its steps while the editor holds the header's, saying why", async () => {
    panel({ reviewHold: "Save your changes first." });
    const review = await screen.findByRole("region", { name: "Review" });
    const approve = within(review).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    expect(review).toHaveTextContent("Save your changes first.");
    await userEvent.click(approve);
    expect(api.takeStep).not.toHaveBeenCalled();
  });

  it("offers its steps where nothing holds them", async () => {
    panel();
    const review = await screen.findByRole("region", { name: "Review" });
    expect(
      within(review).getByRole("button", { name: "Approve" })
    ).toBeEnabled();
  });
});
