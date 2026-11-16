/**
 * A comparison marks what the reader has seen: the newer of its two versions,
 * once per visit, however often the page draws while it is on screen, and
 * whichever side the reader put the newer version on. A baseline comparison
 * marks only a pair resolved for the document on screen, and stays the pair
 * it resolved once that mark has moved the baseline it was resolved from.
 */
import { focusManager, onlineManager } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { act, render, screen, waitFor } from "@admin/__tests__/utils";

const { useVersionsMock, markSeenMock, baselineDiffMock } = vi.hoisted(() => ({
  useVersionsMock: vi.fn(),
  markSeenMock: vi.fn(() =>
    Promise.resolve({ message: "Marked as seen.", item: {} })
  ),
  baselineDiffMock: vi.fn(),
}));

vi.mock("../diff/VersionDiffView", () => ({
  VersionDiffView: () => <div data-testid="diff-view" />,
}));

// The baseline comparison is the real hook, so what it keeps and refetches is
// what these tests watch; only the API beneath it is replaced.
vi.mock("@admin/hooks/queries/useVersions", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/hooks/queries/useVersions")>();
  return {
    useVersions: (...a: unknown[]) => useVersionsMock(...a),
    useBaselineDiff: actual.useBaselineDiff,
    useVersionDiff: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
    }),
    scopeKey: actual.scopeKey,
  };
});

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { markSeen: markSeenMock, diffFromBaseline: baselineDiffMock },
}));

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

import type { ServerBaseline } from "../version-pairing";
import { VersionComparePage } from "../VersionComparePage";

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

function page(from: number, to: number) {
  return (
    <VersionComparePage
      scope={scope}
      documentHref="/admin/collections/posts/e1"
      readOnlyHref="/admin/collections/posts"
      from={from}
      to={to}
    />
  );
}

describe("VersionComparePage, what it marks as seen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVersionsMock.mockReturnValue({
      data: { pages: [{ items: [row(5), row(4), row(3)] }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
  });

  it("marks the newer version once, however often the page draws", () => {
    const { rerender } = render(page(4, 5));
    rerender(page(4, 5));
    rerender(page(4, 5));

    expect(markSeenMock).toHaveBeenCalledTimes(1);
    expect(markSeenMock).toHaveBeenCalledWith(scope, 5);
  });

  it("marks the newer version when the reader put it on the left", () => {
    render(page(5, 3));

    expect(markSeenMock).toHaveBeenCalledTimes(1);
    expect(markSeenMock).toHaveBeenCalledWith(scope, 5);
  });
});

describe("VersionComparePage, a baseline comparison it marks as seen", () => {
  const other = { kind: "collection" as const, slug: "posts", entryId: "e2" };

  // Both documents are collection entries, so each has an editor address.
  function baselinePage(pageScope: typeof scope, baseline: ServerBaseline) {
    return (
      <VersionComparePage
        scope={pageScope}
        documentHref={`/admin/collections/posts/${pageScope.entryId}`}
        readOnlyHref="/admin/collections/posts"
        from={baseline}
        to={5}
      />
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useVersionsMock.mockReturnValue({
      data: { pages: [{ items: [row(5), row(4), row(3)] }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
  });
  // Focus and connection are global singletons; reset them so a simulated
  // return in one test does not carry into the next.
  afterEach(() => {
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });

  it("marks nothing for another document while that document's comparison loads", async () => {
    // The first document resolves; the second never answers, so whatever the
    // page shows for it can only have been carried over from the first.
    baselineDiffMock.mockImplementation((asked: { entryId: string }) =>
      asked.entryId === "e1"
        ? Promise.resolve({
            from: 3,
            to: 5,
            locale: null,
            hasChanges: true,
            fields: [],
            baseline: { name: "published", versionNo: 3 },
          })
        : new Promise(() => {})
    );

    const { rerender } = render(baselinePage(scope, "published"));
    await waitFor(() => expect(markSeenMock).toHaveBeenCalledWith(scope, 5));

    rerender(baselinePage(other, "published"));
    await waitFor(() =>
      expect(baselineDiffMock).toHaveBeenCalledWith(other, "published", 5)
    );

    expect(screen.queryByTestId("diff-view")).toBeNull();
    expect(screen.getByText("Loading comparison…")).toBeInTheDocument();
    expect(markSeenMock).not.toHaveBeenCalledWith(other, expect.anything());
  });

  it("keeps the version last looked at as the baseline after marking the newer one seen", async () => {
    // Once version 5 is marked, "the version last looked at" is version 5
    // itself, and asking again is refused for want of anything to compare.
    const refusal = Object.assign(new Error("Validation failed."), {
      status: 400,
      code: "VALIDATION_ERROR",
      data: {
        errors: [
          {
            path: "baseline",
            code: "NO_BASELINE",
            message: "There is no earlier visit to compare with.",
          },
        ],
      },
    });
    baselineDiffMock
      .mockResolvedValueOnce({
        from: 3,
        to: 5,
        locale: null,
        hasChanges: true,
        fields: [],
        baseline: { name: "last-viewed", versionNo: 3 },
      })
      .mockRejectedValue(refusal);

    render(baselinePage(scope, "last-viewed"));
    await waitFor(() => expect(markSeenMock).toHaveBeenCalledWith(scope, 5));
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();

    // The reader returns to the tab, and then the network comes back.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });

    // Given the chance to refetch: a refetch would have asked again by now.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(baselineDiffMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    expect(
      screen.queryByText("There is no earlier visit to compare with.")
    ).toBeNull();
  });
});
