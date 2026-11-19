/**
 * The changes a reviewer judges, on the document: shown where the part waits
 * for this person's approval, compared with the right version.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { VersionMeta } from "@admin/services/versionApi";
import type { PartReview } from "@admin/types/workflows";

const versionsMock = vi.fn();
vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersions: (...args: unknown[]) => versionsMock(...args),
}));
vi.mock("@admin/components/features/versions/diff/VersionDiffView", () => ({
  VersionDiffView: ({ from, to }: { from: number; to: number }) => (
    <p>
      comparing {from} with {to}
    </p>
  ),
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    getLocale: (code: string | undefined) =>
      code === "en" ? { code: "en", label: "English" } : undefined,
  }),
}));

import { ReviewChanges } from "../ReviewChanges";

const SCOPE = { kind: "collection", slug: "posts", entryId: "e1" } as const;

function version(versionNo: number, status = "draft"): VersionMeta {
  return {
    id: `v${versionNo}`,
    versionNo,
    status,
    isAutosave: false,
    label: null,
    locale: "en",
    sourceVersionNo: null,
    createdBy: null,
    author: null,
    createdAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-19T09:00:00.000Z",
  };
}

function inReview(over: Partial<PartReview> = {}): PartReview {
  return {
    part: "en",
    stage: "inReview",
    stageLabel: "In review",
    publishable: false,
    enteredAt: null,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    revision: 2,
    version: "t7",
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
    ...over,
  } as PartReview;
}

function listing(items: VersionMeta[]) {
  versionsMock.mockReturnValue({
    data: { pages: [{ items, meta: {} }] },
    isError: false,
  });
}

describe("ReviewChanges", () => {
  it("shows a reviewer the changes since the published version, in its language", () => {
    listing([version(7), version(5, "published")]);

    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);

    expect(
      screen.getByText("Changes since the published version.")
    ).toBeInTheDocument();
    expect(screen.getByText("comparing 5 with 7")).toBeInTheDocument();
    expect(versionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: SCOPE, enabled: true, locale: "en" })
    );
  });

  it("compares with the last approval where the part has one", () => {
    listing([version(9), version(8), version(5, "published")]);

    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[inReview({ approval: { versionNo: 8, by: "rita", at: "x" } })]}
      />
    );

    expect(
      screen.getByText("Changes since the approved version.")
    ).toBeInTheDocument();
    expect(screen.getByText("comparing 8 with 9")).toBeInTheDocument();
  });

  it("hides the comparison and shows it again", async () => {
    listing([version(7), version(5, "published")]);
    const user = userEvent.setup();
    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);

    await user.click(screen.getByRole("button", { name: "Hide changes" }));
    expect(screen.queryByText("comparing 5 with 7")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show changes" }));
    expect(screen.getByText("comparing 5 with 7")).toBeInTheDocument();
  });

  it("shows nothing to a person the part does not wait for", () => {
    listing([version(7), version(5, "published")]);
    const writer = inReview({
      steps: [
        {
          name: "approve",
          label: "Approve",
          kind: "approve",
          to: "approved",
          mayTake: false,
          primary: true,
          commentRequired: false,
        },
      ],
    } as Partial<PartReview>);

    const { container } = render(
      <ReviewChanges scope={SCOPE} parts={[writer]} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the shared fields' changes beside the language's where both wait", () => {
    versionsMock.mockImplementation(({ locale }: { locale?: string }) => ({
      data: {
        pages: [
          {
            items:
              locale === "en"
                ? [version(7), version(5, "published")]
                : [version(4), version(2, "published")],
            meta: {},
          },
        ],
      },
      isError: false,
    }));

    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[inReview(), inReview({ part: null, version: "s4" })]}
      />
    );

    expect(screen.getByRole("heading", { name: "English" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Shared fields" })
    ).toBeVisible();
    expect(screen.getByText("comparing 5 with 7")).toBeInTheDocument();
    // The shared part's versions are the document's, read in no language.
    expect(screen.getByText("comparing 2 with 4")).toBeInTheDocument();
    expect(versionsMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ locale: expect.anything() })
    );
  });

  it("offers no approval of every language where only one part waits", () => {
    listing([version(7), version(5, "published")]);

    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);

    expect(
      screen.queryByRole("button", { name: "Approve all languages…" })
    ).not.toBeInTheDocument();
  });
});
