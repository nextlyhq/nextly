/**
 * "Approve all languages" is held when the header's steps are: unsaved edits
 * hold it with "Save your changes first.", and a hold the editor names (a past
 * version on screen, a save on its way) holds it with that reason. Nothing is
 * sent meanwhile.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import type { PartReview } from "@admin/types/workflows";

const { fetchSpy, stepSpy, versionsMock, baselineSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  stepSpy: vi.fn(),
  versionsMock: vi.fn(),
  baselineSpy: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: fetchSpy,
  takeWorkflowStep: stepSpy,
}));
vi.mock("@admin/hooks/queries/useVersions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useVersions")
  >()),
  useVersions: (...args: unknown[]) => versionsMock(...args),
}));
vi.mock("@admin/services/versionApi", async importOriginal => {
  const real =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return {
    ...real,
    versionApi: { ...real.versionApi, diffFromBaseline: baselineSpy },
  };
});
vi.mock("@admin/components/features/versions/diff/VersionDiffView", () => ({
  VersionDiffView: () => null,
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    defaultLocale: "en",
    locales: [
      { code: "en", label: "English" },
      { code: "es", label: "Spanish" },
    ],
    getLocale: (code: string | undefined) =>
      code === "en"
        ? { code, label: "English" }
        : code === "es"
          ? { code, label: "Spanish" }
          : undefined,
  }),
}));

import { ReviewChanges } from "../ReviewChanges";
import { useEditorReview } from "../useEditorReview";

const SCOPE = { kind: "collection", slug: "posts", entryId: "e1" } as const;
const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function inReview(part: string): PartReview {
  return {
    part,
    stage: "inReview",
    stageLabel: "In review",
    stageColour: null,
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 3,
    version: `t-${part}`,
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
    reviewedVersionNo: null,
  };
}

/** The editor's review card, wired as the editors wire it. */
function Editor({
  isDirty,
  held,
}: {
  isDirty: boolean;
  held?: string;
}): ReactElement {
  const review = useEditorReview({
    document: post,
    locale: "en",
    isDirty,
    held,
  });
  return (
    <ReviewChanges
      scope={SCOPE}
      parts={review.onScreen}
      allParts={review.parts}
      hold={review.hold}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy.mockResolvedValue({
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts: [inReview("en"), inReview("es")],
      mayPublishWithoutReview: false,
    },
  });
  versionsMock.mockReturnValue({
    data: { pages: [{ items: [], meta: {} }] },
    isError: false,
  });
});

describe("Approve all languages, held as the header's steps are", () => {
  it("is held while the page has unsaved edits, saying so, and sends nothing", async () => {
    render(<Editor isDirty />);

    const button = await screen.findByRole("button", {
      name: "Approve all languages…",
    });
    expect(button).toBeDisabled();
    expect(screen.getByText("Save your changes first.")).toBeVisible();

    await userEvent.click(button);
    expect(
      screen.queryByRole("dialog", { name: "Approve all languages" })
    ).toBeNull();
    expect(stepSpy).not.toHaveBeenCalled();
  });

  it("is held with the editor's own reason, such as a past version on screen", async () => {
    render(
      <Editor
        isDirty={false}
        held="You are viewing a past version. Return to the current one to make changes."
      />
    );

    expect(
      await screen.findByRole("button", { name: "Approve all languages…" })
    ).toBeDisabled();
    expect(
      screen.getByText(
        "You are viewing a past version. Return to the current one to make changes."
      )
    ).toBeVisible();
  });

  it("opens where nothing holds it", async () => {
    render(<Editor isDirty={false} />);

    const button = await screen.findByRole("button", {
      name: "Approve all languages…",
    });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Approve all languages" })
      ).toBeVisible()
    );
  });
});
