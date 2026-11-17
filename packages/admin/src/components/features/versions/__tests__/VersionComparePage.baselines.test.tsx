/**
 * The comparison page's choices: a baseline the server resolves, named in the
 * address; "Compare with", which rewrites the address; the view, inline or
 * side by side, from the address; the newer version marked as seen; and
 * "Restore…", which hands the version to the editor, in its language.
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const {
  useVersionsMock,
  baselineMock,
  canMock,
  navigateMock,
  seenMock,
  diffMountMock,
  drawn,
  versionMock,
} = vi.hoisted(() => ({
  useVersionsMock: vi.fn(),
  baselineMock: vi.fn(),
  canMock: vi.fn(),
  navigateMock: vi.fn(),
  seenMock: vi.fn(),
  diffMountMock: vi.fn(),
  // The language of the comparison the stand-in view draws.
  drawn: { locale: null as string | null },
  versionMock: vi.fn(),
}));

// A stand-in for a comparison that has arrived and is drawn: it reports its
// pair, and the language its answer names, once on screen, as the real view
// does once its fields are.
vi.mock("../diff/VersionDiffView", async () => {
  const { useEffect } = await import("react");
  return {
    VersionDiffView: (props: {
      from: number;
      to: number;
      view?: string;
      onViewChange?: (layout: "inline" | "split") => void;
      onShown?: (
        pair: { from: number; to: number; locale: string | null } | null
      ) => void;
    }) => {
      diffMountMock(props);
      const { from, to, onShown } = props;
      useEffect(() => {
        onShown?.({ from, to, locale: drawn.locale });
      }, [from, to, onShown]);
      return <div data-testid="diff-view">{`${from}-${to}`}</div>;
    },
  };
});

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersions: (...a: unknown[]) => useVersionsMock(...a),
  useBaselineDiff: (...a: unknown[]) => baselineMock(...a),
  // One stored version, read for the language of a version the page names
  // but has no comparison of.
  useVersion: (...a: unknown[]) => versionMock(...a),
  // Each comparison has arrived and is drawn, with no field an editor wrote,
  // so the page may mark what it shows and the rail draws no summary line.
  useVersionDiff: () => ({
    data: { fields: [] },
    isSuccess: true,
    isPlaceholderData: false,
    isLoading: false,
    isError: false,
  }),
  scopeKey: (s: { kind: string; slug: string; entryId?: string }) => [
    s.kind,
    s.slug,
    s.entryId ?? "",
  ],
}));

vi.mock("../useMarkVersionSeen", () => ({
  useMarkVersionSeen: (...a: unknown[]) => seenMock(...a),
}));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (...a: unknown[]) => canMock(...a) as boolean,
}));

vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (...a: unknown[]) => navigateMock(...a),
}));

import { VersionComparePage } from "../VersionComparePage";
import { versionsHref } from "../versions-href";

const scope = { kind: "collection" as const, slug: "posts", entryId: "e1" };

const row = (versionNo: number) => ({
  id: `v${versionNo}`,
  versionNo,
  status: "draft" as const,
  isAutosave: false,
  label: null,
  locale: null,
  sourceVersionNo: null,
  createdBy: "u1",
  author: { id: "u1", name: "Ada Lovelace" },
  createdAt: new Date("2026-01-01").toISOString(),
  updatedAt: new Date("2026-01-01").toISOString(),
});

function renderPage(props: Record<string, unknown> = {}) {
  return render(
    <VersionComparePage
      scope={scope}
      documentHref="/admin/collections/posts/e1"
      readOnlyHref="/admin/collections/posts"
      {...props}
    />
  );
}

describe("VersionComparePage, its choices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drawn.locale = null;
    versionMock.mockReturnValue({ data: undefined });
    canMock.mockReturnValue(true);
    useVersionsMock.mockReturnValue({
      data: { pages: [{ items: [row(5), row(4), row(3)] }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    baselineMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
  });

  it("compares with a baseline the server resolves, and draws the versions it chose", () => {
    baselineMock.mockReturnValue({
      data: { from: 3, to: 5, baseline: { name: "published", versionNo: 3 } },
      isLoading: false,
      isError: false,
    });

    renderPage({ from: "published", to: 5 });

    expect(baselineMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseline: "published", to: 5 })
    );
    expect(screen.getByTestId("diff-view")).toHaveTextContent("3-5");
    expect(
      screen.getByText(/what is published \(version 3\)/i)
    ).toBeInTheDocument();
  });

  it("says when the version last looked at is gone, and which one stands in", () => {
    baselineMock.mockReturnValue({
      data: {
        from: 2,
        to: 5,
        baseline: { name: "last-viewed", versionNo: 2, replaces: 1 },
      },
      isLoading: false,
      isError: false,
    });

    renderPage({ from: "last-viewed", to: 5 });

    expect(
      screen.getByText(
        /version 1, the one you last looked at, is no longer kept\. compared with version 2 instead/i
      )
    ).toBeInTheDocument();
  });

  it("says why there is nothing to compare with, as the server put it", () => {
    const refusal = Object.assign(new Error("Validation failed."), {
      status: 400,
      code: "VALIDATION_ERROR",
      data: {
        errors: [
          {
            path: "baseline",
            code: "NO_BASELINE",
            message: "This part of the document has no current draft.",
          },
        ],
      },
    });
    baselineMock.mockReturnValue({
      data: undefined,
      error: refusal,
      isLoading: false,
      isError: true,
    });

    renderPage({ from: "draft", to: 5 });

    expect(
      screen.getByText("This part of the document has no current draft.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This comparison could not be loaded.")
    ).toBeNull();
  });

  it("calls any other failure a comparison that could not be loaded", () => {
    baselineMock.mockReturnValue({
      data: undefined,
      error: Object.assign(new Error("Internal error"), { status: 500 }),
      isLoading: false,
      isError: true,
    });

    renderPage({ from: "draft", to: 5 });

    expect(
      screen.getByText("This comparison could not be loaded.")
    ).toBeInTheDocument();
  });

  it("rewrites the address when the reader compares with another baseline", async () => {
    renderPage({ from: 4, to: 5 });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Compare with" }),
      "published"
    );

    expect(navigateMock).toHaveBeenCalledWith(
      versionsHref(scope, { from: "published", to: 5 })
    );
  });

  it("draws the view the address names, and rewrites the address when the reader switches it", () => {
    renderPage({ from: 4, to: 5, view: "inline" });

    const props = diffMountMock.mock.calls.at(-1)?.[0] as {
      view?: string;
      onViewChange?: (layout: "inline" | "split") => void;
    };
    expect(props.view).toBe("inline");
    props.onViewChange?.("split");

    expect(navigateMock).toHaveBeenCalledWith(
      versionsHref(scope, { from: 4, to: 5 }, undefined, "side")
    );
  });

  it("keeps a baseline the server pairs with its own choice of version without one when the view changes", () => {
    // Pinned to the version it chose, "the version last looked at" would be
    // asked again with that version as the target, after the page had marked
    // it seen: the server then has nothing earlier to compare with.
    baselineMock.mockReturnValue({
      data: { from: 3, to: 5, baseline: { name: "last-viewed", versionNo: 3 } },
      isLoading: false,
      isError: false,
    });
    renderPage({ from: "last-viewed", view: "inline" });

    const props = diffMountMock.mock.calls.at(-1)?.[0] as {
      onViewChange?: (layout: "inline" | "split") => void;
    };
    props.onViewChange?.("split");

    expect(navigateMock).toHaveBeenLastCalledWith(
      versionsHref(scope, { from: "last-viewed" }, undefined, "side")
    );
  });

  it("leaves the server its own choice of version when the reader compares with another baseline", async () => {
    baselineMock.mockReturnValue({
      data: { from: 3, to: 5, baseline: { name: "last-viewed", versionNo: 3 } },
      isLoading: false,
      isError: false,
    });
    renderPage({ from: "last-viewed" });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Compare with" }),
      "published"
    );

    expect(navigateMock).toHaveBeenLastCalledWith(
      versionsHref(scope, { from: "published" })
    );
  });

  it("keeps the version on screen when the reader asks for the change it made", async () => {
    // "The version before" is drawn on the client from the version it ends
    // at, so it needs that version named.
    baselineMock.mockReturnValue({
      data: { from: 3, to: 5, baseline: { name: "last-viewed", versionNo: 3 } },
      isLoading: false,
      isError: false,
    });
    renderPage({ from: "last-viewed" });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Compare with" }),
      "previous"
    );

    expect(navigateMock).toHaveBeenLastCalledWith(
      versionsHref(scope, { from: "previous", to: 5 })
    );
  });

  it("marks the newer of the two versions seen, whichever side it is on", () => {
    renderPage({ from: 4, to: 5 });
    expect(seenMock).toHaveBeenLastCalledWith(scope, expect.any(String), 5);

    seenMock.mockClear();
    renderPage({ from: 5, to: 3 });
    expect(seenMock).toHaveBeenLastCalledWith(scope, expect.any(String), 5);
  });

  it("hands the version to the editor to restore from, rather than writing", async () => {
    renderPage({ from: 4, to: 5 });

    await userEvent.click(screen.getByRole("button", { name: "Restore…" }));

    expect(navigateMock).toHaveBeenCalledWith(
      "/admin/collections/posts/e1?history=1&version=5&restore=1"
    );
  });

  it("hands a comparison in another language to the editor in that language", async () => {
    // The editor offers a version's restore only when it is open in that
    // version's language, so an editor opened in its default language would
    // take the hand-off and never show the restore list.
    useVersionsMock.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              { ...row(5), locale: "de" },
              { ...row(4), locale: "de" },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });

    drawn.locale = "de";
    renderPage({ from: 4, to: 5, locale: "de" });

    await userEvent.click(screen.getByRole("button", { name: "Restore…" }));

    const target = new URL(
      String(navigateMock.mock.calls.at(-1)?.[0]),
      "http://admin.test"
    );
    expect(target.pathname).toBe("/admin/collections/posts/e1");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      history: "1",
      version: "5",
      restore: "1",
      locale: "de",
    });
  });

  it("offers no restore to a reader who may not edit the document", () => {
    canMock.mockReturnValue(false);

    renderPage({ from: 4, to: 5 });

    expect(screen.queryByRole("button", { name: "Restore…" })).toBeNull();
  });

  it("hands the comparison's own language to the editor when the address names none", async () => {
    // A numbered address need not name its language: the server finds the
    // part from the version, and the comparison it answers says which it is.
    drawn.locale = "fr";
    renderPage({ from: 4, to: 5 });

    await userEvent.click(screen.getByRole("button", { name: "Restore…" }));

    const target = new URL(
      String(navigateMock.mock.calls.at(-1)?.[0]),
      "http://admin.test"
    );
    expect(target.searchParams.get("locale")).toBe("fr");
  });

  it("asks a baseline that names no version in the page's language", () => {
    renderPage({ from: "published", locale: "fr" });

    expect(baselineMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseline: "published", locale: "fr" })
    );
  });

  it("draws a baseline comparison from the answer the baseline already gave", () => {
    baselineMock.mockReturnValue({
      data: { from: 3, to: 5, baseline: { name: "published", versionNo: 3 } },
      isLoading: false,
      isError: false,
    });

    renderPage({ from: "published", to: 5 });

    expect(diffMountMock.mock.calls.at(-1)?.[0]).toMatchObject({
      from: 3,
      to: 5,
      seededBy: "published",
    });
  });

  it("offers to try a comparison that failed to load again", async () => {
    const refetch = vi.fn();
    baselineMock.mockReturnValue({
      data: undefined,
      error: Object.assign(new Error("Internal error"), { status: 500 }),
      isLoading: false,
      isError: true,
      refetch,
    });

    renderPage({ from: "draft", to: 5 });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("offers no retry for a baseline the server refused, which would answer the same", () => {
    baselineMock.mockReturnValue({
      data: undefined,
      error: Object.assign(new Error("Validation failed."), {
        status: 400,
        code: "VALIDATION_ERROR",
        data: {
          errors: [
            {
              path: "baseline",
              code: "INVALID_VALUE",
              message:
                '"prev" is not a comparison baseline. Known baselines: previous, published.',
            },
          ],
        },
      }),
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });

    renderPage({ from: "prev", to: 5 });

    expect(
      screen.getByText(/"prev" is not a comparison baseline/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("names a baseline another feature registered in Compare with", () => {
    baselineMock.mockReturnValue({
      data: {
        from: 3,
        to: 5,
        baseline: { name: "since-approved", versionNo: 3 },
      },
      isLoading: false,
      isError: false,
    });

    renderPage({ from: "since-approved", to: 5 });

    const select = screen.getByRole("combobox", { name: "Compare with" });
    expect(select).toHaveValue("since-approved");
    expect(
      screen.getByRole("option", { name: "Since approved" })
    ).toBeInTheDocument();
  });

  it("offers to restore the version named while there is nothing to compare it with", async () => {
    // Nothing to compare with is no reason to withhold the version itself:
    // its restore list compares it with the editor, not with a baseline.
    useVersionsMock.mockReturnValue({
      data: {
        pages: [{ items: [{ ...row(5), locale: "de" }, row(4), row(3)] }],
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    baselineMock.mockReturnValue({
      data: undefined,
      error: Object.assign(new Error("Validation failed."), {
        status: 400,
        code: "VALIDATION_ERROR",
        data: {
          errors: [
            {
              path: "baseline",
              code: "NO_BASELINE",
              message: "This part of the document has no current draft.",
            },
          ],
        },
      }),
      isLoading: false,
      isError: true,
    });

    versionMock.mockReturnValue({ data: { versionNo: 5, locale: "de" } });

    renderPage({ from: "draft", to: 5 });
    await userEvent.click(screen.getByRole("button", { name: "Restore…" }));

    const target = new URL(
      String(navigateMock.mock.calls.at(-1)?.[0]),
      "http://admin.test"
    );
    expect(Object.fromEntries(target.searchParams)).toEqual({
      history: "1",
      version: "5",
      restore: "1",
      locale: "de",
    });
  });

  it("offers to restore the version named beyond the loaded history, in its own language", async () => {
    // The history is paged: the version a refused baseline names can sit
    // behind many newer ones, and its own record still says its language.
    useVersionsMock.mockReturnValue({
      data: { pages: [{ items: [row(9), row(8), row(7)] }] },
      isLoading: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    versionMock.mockImplementation(
      ({ versionNo }: { versionNo: number | null }) =>
        versionNo === 5
          ? { data: { versionNo: 5, locale: "fr" } }
          : { data: undefined }
    );
    baselineMock.mockReturnValue({
      data: undefined,
      error: Object.assign(new Error("Validation failed."), {
        status: 400,
        code: "VALIDATION_ERROR",
        data: {
          errors: [
            {
              path: "baseline",
              code: "NO_BASELINE",
              message: "This is the version that is published.",
            },
          ],
        },
      }),
      isLoading: false,
      isError: true,
    });

    renderPage({ from: "published", to: 5 });
    await userEvent.click(screen.getByRole("button", { name: "Restore…" }));

    const target = new URL(
      String(navigateMock.mock.calls.at(-1)?.[0]),
      "http://admin.test"
    );
    expect(target.searchParams.get("version")).toBe("5");
    expect(target.searchParams.get("locale")).toBe("fr");
  });
});
