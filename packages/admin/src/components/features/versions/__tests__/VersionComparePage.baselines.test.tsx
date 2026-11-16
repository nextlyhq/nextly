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
} = vi.hoisted(() => ({
  useVersionsMock: vi.fn(),
  baselineMock: vi.fn(),
  canMock: vi.fn(),
  navigateMock: vi.fn(),
  seenMock: vi.fn(),
  diffMountMock: vi.fn(),
}));

// A stand-in for a comparison that has arrived and is drawn: it reports its
// pair once on screen, as the real view does once its fields are.
vi.mock("../diff/VersionDiffView", async () => {
  const { useEffect } = await import("react");
  return {
    VersionDiffView: (props: {
      from: number;
      to: number;
      view?: string;
      onViewChange?: (layout: "inline" | "split") => void;
      onShown?: (pair: { from: number; to: number } | null) => void;
    }) => {
      diffMountMock(props);
      const { from, to, onShown } = props;
      useEffect(() => {
        onShown?.({ from, to });
      }, [from, to, onShown]);
      return <div data-testid="diff-view">{`${from}-${to}`}</div>;
    },
  };
});

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersions: (...a: unknown[]) => useVersionsMock(...a),
  useBaselineDiff: (...a: unknown[]) => baselineMock(...a),
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
});
