/**
 * Where no workflow is attached, the editor's side panel is the one it has
 * always been: the review state is asked once, answers "not attached", and no
 * Review section, language stage or status line is drawn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import type { PartReview } from "@admin/types/workflows";

import { DocumentPanel } from "../../EntryForm/panels/DocumentPanel";
import { EntryLocaleProvider } from "../../EntryLocaleContext";

const { fetchSpy } = vi.hoisted(() => ({ fetchSpy: vi.fn() }));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
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
  useHasPermission: () => () => true,
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

function renderPanel() {
  return render(
    <EntryLocaleProvider
      value={{
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
        releaseDocument={post}
      />
    </EntryLocaleProvider>
  );
}

/** The sections the panel drew, by heading, in order. */
function sections(): string[] {
  return [...document.querySelectorAll("[data-panel-section]")].map(
    section => section.getAttribute("data-panel-section") ?? ""
  );
}

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
  revision: 1,
  version: "v1",
  steps: [],
  waitingFor: null,
  lastMove: null,
};

describe("a document with no workflow attached", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the side panel's sections as they were", async () => {
    fetchSpy.mockResolvedValue({ attached: false });
    renderPanel();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Settled on the answer, with nothing of the review drawn.
    await waitFor(() =>
      expect(sections()).toEqual(["Status", "Publishing", "Details"])
    );
    expect(document.querySelector("[data-review-part]")).toBeNull();
  });

  it("adds the Review section after Status once a workflow holds it", async () => {
    // The same panel with a workflow, so the case above is known to reach
    // the place a Review section would be drawn.
    fetchSpy.mockResolvedValue({
      attached: true,
      review: {
        workflow: { slug: "review", label: "Review" },
        parts: [inReview],
      },
    });
    renderPanel();
    expect(await screen.findByRole("region", { name: "Review" })).toBeVisible();
    expect(sections()).toEqual(["Status", "Review", "Publishing", "Details"]);
  });
});
