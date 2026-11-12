/**
 * A comparison marks what the reader has seen: the newer of its two versions,
 * once per visit, however often the page draws while it is on screen, and
 * whichever side the reader put the newer version on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const { useVersionsMock, markSeenMock } = vi.hoisted(() => ({
  useVersionsMock: vi.fn(),
  markSeenMock: vi.fn(() =>
    Promise.resolve({ message: "Marked as seen.", item: {} })
  ),
}));

vi.mock("../diff/VersionDiffView", () => ({
  VersionDiffView: () => <div data-testid="diff-view" />,
}));

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersions: (...a: unknown[]) => useVersionsMock(...a),
  useBaselineDiff: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  useVersionDiff: () => ({ data: undefined, isLoading: false, isError: false }),
  scopeKey: (s: { kind: string; slug: string; entryId?: string }) => [
    s.kind,
    s.slug,
    s.entryId ?? "",
  ],
}));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { markSeen: markSeenMock },
}));

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

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
