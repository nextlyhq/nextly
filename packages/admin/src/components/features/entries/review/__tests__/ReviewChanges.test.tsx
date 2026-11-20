/**
 * The changes a reviewer judges, on the document: shown where the part waits
 * for this person's approval, compared with the right version of the same
 * part, the published one resolved by the server from the part's whole
 * history.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { VersionMeta } from "@admin/services/versionApi";
import type { PartReview } from "@admin/types/workflows";

const { versionsMock, baselineSpy } = vi.hoisted(() => ({
  versionsMock: vi.fn(),
  baselineSpy: vi.fn(),
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
  VersionDiffView: ({
    from,
    to,
    part,
  }: {
    from: number;
    to: number;
    part?: string;
  }) => (
    <p>
      comparing {from} with {to}
      {part === undefined ? "" : ` (${part})`}
    </p>
  ),
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    getLocale: (code: string | undefined) =>
      code === "en"
        ? { code: "en", label: "English" }
        : code === "fr"
          ? { code: "fr", label: "French" }
          : undefined,
  }),
}));

import { ReviewChanges } from "../ReviewChanges";

const SCOPE = { kind: "collection", slug: "posts", entryId: "e1" } as const;

function version(
  versionNo: number,
  status = "draft",
  locale: string | null = "en"
): VersionMeta {
  return {
    id: `v${versionNo}`,
    versionNo,
    status,
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
    reviewedVersionNo: null,
    ...over,
  } as PartReview;
}

/** What the server holds as published in each part, by language ("" for the shared part). */
let published: Record<string, number> = {};
/** The version each part was last approved at, as the server keeps it, by language. */
let approvedPins: Record<string, number> = {};

beforeEach(() => {
  vi.clearAllMocks();
  // No versions listed unless a case lists them.
  listing([]);
  published = { en: 5, es: 6, "": 2 };
  approvedPins = {};
  // The server's `published` baseline, in the part the request names.
  baselineSpy.mockImplementation(
    (
      _scope: unknown,
      baseline: string,
      opts: { to?: number; locale?: string; part?: string }
    ) => {
      // A named version carries its own language, as the server takes it:
      // version 8 is a Spanish save. The shared part is asked for by name.
      const part =
        opts.part === "shared"
          ? ""
          : opts.locale === undefined && opts.to === 8
            ? "es"
            : (opts.locale ?? "");
      const from =
        baseline === "since-approved"
          ? approvedPins[part]
          : baseline === "published"
            ? published[part]
            : undefined;
      if (from === undefined) {
        return Promise.reject(
          Object.assign(new Error("Validation failed."), {
            status: 400,
            code: "VALIDATION_ERROR",
            data: {
              errors: [
                {
                  path: "baseline",
                  code: "UNAVAILABLE",
                  message:
                    "No published version of this part of the document is kept, so there is nothing published to compare with.",
                },
              ],
            },
          })
        );
      }
      return Promise.resolve({
        from,
        to: opts.to,
        locale: opts.locale ?? null,
        hasChanges: true,
        baseline: { name: baseline, versionNo: from },
        fields: [],
      });
    }
  );
});

function listing(items: VersionMeta[]) {
  versionsMock.mockReturnValue({
    data: { pages: [{ items, meta: {} }] },
    isError: false,
  });
}

describe("ReviewChanges", () => {
  it("shows a reviewer the changes since the published version, in its language", async () => {
    listing([version(7), version(5, "published")]);

    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);

    expect(await screen.findByText("comparing 5 with 7")).toBeInTheDocument();
    expect(
      screen.getByText("Changes since the published version.")
    ).toBeInTheDocument();
    expect(versionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: SCOPE, enabled: true, locale: "en" })
    );
  });

  it("finds the published version past the first page of the history", async () => {
    // The page holds only drafts: the server resolves what is published from
    // the part's whole history.
    listing([version(7), version(6)]);

    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);

    expect(await screen.findByText("comparing 5 with 7")).toBeInTheDocument();
    expect(baselineSpy).toHaveBeenCalledWith(SCOPE, "published", {
      to: 7,
      locale: "en",
    });
  });

  it("says why there is nothing to compare where nothing is published in the part", async () => {
    published = {};
    listing([version(7), version(6)]);

    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);

    expect(
      await screen.findByText(
        "No published version of this part of the document is kept, so there is nothing published to compare with."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/^comparing/)).toBeNull();
  });

  it("compares with the last approval where the part has one", async () => {
    approvedPins = { en: 8 };
    listing([version(9), version(8), version(5, "published")]);

    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[inReview({ approval: { versionNo: 8, by: "rita", at: "x" } })]}
      />
    );

    expect(await screen.findByText("comparing 8 with 9")).toBeInTheDocument();
    expect(
      screen.getByText("Changes since the approved version.")
    ).toBeInTheDocument();
    expect(baselineSpy).not.toHaveBeenCalledWith(
      SCOPE,
      "published",
      expect.anything()
    );
  });

  it("never compares a language with a newer shared-fields version", async () => {
    approvedPins = { en: 6 };
    // A language's list holds the shared fields' versions too.
    listing([version(9, "draft", null), version(7), version(6)]);

    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[inReview({ approval: { versionNo: 6, by: "rita", at: "x" } })]}
      />
    );

    expect(await screen.findByText("comparing 6 with 7")).toBeInTheDocument();
    expect(screen.queryByText("comparing 6 with 9")).toBeNull();
  });

  it("compares with the approval an edit withdrew, which the server keeps", async () => {
    // The review state says no approval after an edit; the server still
    // answers since the version last approved.
    approvedPins = { en: 6 };
    listing([version(7), version(6), version(5, "published")]);

    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);

    expect(await screen.findByText("comparing 6 with 7")).toBeInTheDocument();
    expect(
      screen.getByText("Changes since the approved version.")
    ).toBeInTheDocument();
    expect(screen.queryByText("comparing 5 with 7")).toBeNull();
  });

  it("hides the comparison and shows it again", async () => {
    listing([version(7), version(5, "published")]);
    const user = userEvent.setup();
    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);
    await screen.findByText("comparing 5 with 7");

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

  it("shows the shared fields' changes beside the language's where both wait", async () => {
    versionsMock.mockImplementation(({ locale }: { locale?: string }) => ({
      data: {
        pages: [
          {
            items:
              locale === "en"
                ? [version(7), version(5, "published")]
                : [version(4, "draft", null), version(2, "published", null)],
            meta: {},
          },
        ],
      },
      isError: false,
    }));

    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[
          inReview(),
          inReview({ part: null, version: "s4", reviewedVersionNo: 4 }),
        ]}
      />
    );

    expect(screen.getByRole("heading", { name: "English" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Shared fields" })
    ).toBeVisible();
    expect(await screen.findByText("comparing 5 with 7")).toBeInTheDocument();
    // The shared part is compared as the server's shared part.
    expect(
      await screen.findByText("comparing 2 with 4 (shared)")
    ).toBeInTheDocument();
  });

  it("compares the shared fields alone across languages, from their approval to the version under review", async () => {
    // A shared change saved in English after the approval, then a French save:
    // the version under review is French 11, compared from the approval (7)
    // over the shared fields alone, whatever language each was saved in.
    approvedPins = { "": 7 };

    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[
          inReview({
            part: null,
            version: "s11",
            reviewedVersionNo: 11,
            approval: {
              versionNo: 7,
              by: "rita",
              at: "2026-11-19T10:00:00.000Z",
            },
          }),
        ]}
      />
    );

    expect(
      await screen.findByText("comparing 7 with 11 (shared)")
    ).toBeInTheDocument();
    expect(baselineSpy).toHaveBeenCalledWith(SCOPE, "since-approved", {
      to: 11,
      part: "shared",
    });
    expect(
      screen.getByText("Changes since the approved version.")
    ).toBeVisible();
    // Nothing is said about a language compared within: there is none.
    expect(screen.queryByText(/Compared within/)).toBeNull();
    // The shared part's comparison reads no versions list.
    expect(versionsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });

  it("compares the shared fields from the last publish where they were never approved", async () => {
    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[inReview({ part: null, version: "s9", reviewedVersionNo: 9 })]}
      />
    );

    expect(
      await screen.findByText("comparing 2 with 9 (shared)")
    ).toBeInTheDocument();
    expect(baselineSpy).toHaveBeenCalledWith(SCOPE, "published", {
      to: 9,
      part: "shared",
    });
    expect(
      screen.getByText("Changes since the published version.")
    ).toBeVisible();
  });

  it("shows the shared fields' version whole where nothing was approved or published", async () => {
    published = { en: 5 };

    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[inReview({ part: null, version: "s8", reviewedVersionNo: 8 })]}
      />
    );

    expect(
      await screen.findByText(
        "No published version of this part of the document is kept, so there is nothing published to compare with."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/^comparing/)).toBeNull();
  });

  it("says nothing changed where the shared fields' version under review is the one approved", () => {
    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[
          inReview({
            part: null,
            version: "s7",
            reviewedVersionNo: 7,
            approval: {
              versionNo: 7,
              by: "rita",
              at: "2026-11-19T10:00:00.000Z",
            },
          }),
        ]}
      />
    );

    expect(
      screen.getByText("Nothing changed since it was approved.")
    ).toBeVisible();
    expect(baselineSpy).not.toHaveBeenCalled();
  });

  it("names the shared fields when they alone wait for this person under a language's editor", async () => {
    versionsMock.mockImplementation(({ locale }: { locale?: string }) => ({
      data: {
        pages: [
          {
            items:
              locale === "en"
                ? [version(7), version(5, "published")]
                : [version(4, "draft", null), version(2, "published", null)],
            meta: {},
          },
        ],
      },
      isError: false,
    }));
    // English is on screen but is not this person's to approve.
    const english = inReview({
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

    render(
      <ReviewChanges
        scope={SCOPE}
        parts={[
          english,
          inReview({ part: null, version: "s4", reviewedVersionNo: 4 }),
        ]}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Shared fields" })
    ).toBeVisible();
    expect(
      await screen.findByText("comparing 2 with 4 (shared)")
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "English" })).toBeNull();
  });

  it("offers no approval of every language where only one part waits", () => {
    listing([version(7), version(5, "published")]);

    render(<ReviewChanges scope={SCOPE} parts={[inReview()]} />);

    expect(
      screen.queryByRole("button", { name: "Approve all languages…" })
    ).not.toBeInTheDocument();
  });
});
