/**
 * The document panel's Review section, as the editor draws it: the steps it
 * offers (those of a part the header does not move, here the shared fields
 * waiting in another stage than the language on screen) wait for what holds
 * the header's (unsaved edits, a save on its way), and say why; and it is a
 * part of the panel of its own, kept where a plugin replaces Status.
 *
 * The plausible broken panels: one that offers the side panel's steps while
 * the page holds unsaved edits, so a step approves the stored content while
 * other content is on screen; and one that draws Review inside the Status
 * section, so a plugin replacing Status takes the workflow's steps with it.
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
  reviewedVersionNo: null,
  stage: "inReview",
  stageLabel: "In review",
  stageColour: null,
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

/**
 * The language on screen, drafting with no step this person holds: the
 * header moves it, so the panel offers only the shared fields' Approve.
 */
const EN_DRAFTING: PartReview = {
  ...IN_REVIEW,
  part: "en",
  stage: "drafting",
  stageLabel: "Drafting",
  steps: [],
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
      parts: [EN_DRAFTING, IN_REVIEW],
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

  it("stays in the panel, with its steps, where a plugin replaces the Status section", async () => {
    // A contribution that replaces Status arrives in Status' place, and Status is not in the
    // order; the panel has nothing to draw it with here, so only the built-ins remain.
    panel({
      panelOrder: [
        { kind: "builtIn", name: "publishing" },
        { kind: "builtIn", name: "details" },
      ],
    });
    const review = await screen.findByRole("region", { name: "Review" });
    expect(
      within(review).getByRole("button", { name: "Approve" })
    ).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Status" })).toBeNull();
  });

  it("follows the Status section where Status is drawn", async () => {
    panel();
    await screen.findByRole("region", { name: "Review" });
    const titles = screen
      .getAllByRole("region", { hidden: true })
      .map(region => region.getAttribute("data-panel-section") ?? "");
    expect(titles.indexOf("Review")).toBe(titles.indexOf("Status") + 1);
  });

  it("offers its steps where nothing holds them", async () => {
    panel();
    const review = await screen.findByRole("region", { name: "Review" });
    expect(
      within(review).getByRole("button", { name: "Approve" })
    ).toBeEnabled();
  });
});
