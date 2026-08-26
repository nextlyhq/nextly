/**
 * The comparison page. Three things it must not do, each of which reads as
 * working software while being wrong:
 *
 * paint one document's comparison under another document's heading; send a
 * viewer who may only READ the document to a page their permission refuses; and
 * nest a second primary landmark inside the one the dashboard shell provides.
 */
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { useVersionsMock, canMock, navigateMock, diffMountMock } = vi.hoisted(
  () => ({
    useVersionsMock: vi.fn(),
    canMock: vi.fn(),
    navigateMock: vi.fn(),
    diffMountMock: vi.fn(),
  })
);

// Stubbed so these tests stay about the page. The real view fetches a diff of
// its own; what matters here is whether it is asked to START OVER.
//
// It records MOUNTS, not renders, and the distinction is the whole test. React
// re-renders a reused instance with the new props, so a stub recording renders
// sees the new document either way and cannot tell a remount from a reuse —
// which is the broken behaviour it exists to catch.
vi.mock("../diff/VersionDiffView", () => ({
  VersionDiffView: (props: Record<string, unknown>) => {
    useEffect(() => {
      diffMountMock(props);
      // Mount only: an empty dependency list is what makes this a remount
      // counter rather than a render counter.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="diff-view" />;
  },
}));

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersions: (...a: unknown[]) => useVersionsMock(...a),
  // The rail's summary lines fetch one of these each. They are not what these
  // tests are about, so they answer nothing and stay quiet.
  useVersionDiff: () => ({ data: undefined, isLoading: false, isError: false }),
  scopeKey: (s: { kind: string; slug: string; entryId?: string }) => [
    s.kind,
    s.slug,
    s.entryId ?? "",
  ],
}));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (...a: unknown[]) => canMock(...a) as boolean,
}));

vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (...a: unknown[]) => navigateMock(...a),
}));

import { VersionComparePage } from "../VersionComparePage";

const row = (versionNo: number, locale: string | null = null) => ({
  id: `v${versionNo}`,
  versionNo,
  status: "draft" as const,
  isAutosave: false,
  label: null,
  locale,
  sourceVersionNo: null,
  createdBy: "u1",
  author: { id: "u1", name: "Ada Lovelace" },
  createdAt: new Date("2026-01-01").toISOString(),
  updatedAt: new Date("2026-01-01").toISOString(),
});

function listing(items: ReturnType<typeof row>[], overrides = {}) {
  return {
    data: { pages: [{ items }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

const collection = (entryId: string) => ({
  kind: "collection" as const,
  slug: "posts",
  entryId,
});

beforeEach(() => {
  vi.clearAllMocks();
  canMock.mockReturnValue(true);
  useVersionsMock.mockReturnValue(listing([row(9), row(8)]));
});

describe("VersionComparePage — landmarks", () => {
  it("does not nest a second primary landmark", () => {
    // `DashboardLayout` already wraps every private page in the document's one
    // `main`. A second inside it makes landmark navigation announce two
    // primary regions on every comparison.
    const { container } = render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    expect(container.querySelectorAll("main")).toHaveLength(0);
    expect(
      screen.getByRole("region", { name: "Comparison" })
    ).toBeInTheDocument();
  });
});

describe("VersionComparePage — the back control", () => {
  it("returns to the document when the viewer can edit it", () => {
    canMock.mockReturnValue(true);
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    screen.getByRole("button", { name: "Back to the document" }).click();
    expect(navigateMock).toHaveBeenCalledWith("/admin/collections/posts/e1");
  });

  it("MUST NOT send a read-only viewer to a page their permission refuses", () => {
    // Reading a history needs `read-posts`; the editor needs `update-posts`. A
    // colleague can open a shared comparison, read it, and be sent to
    // permission-denied by the one control always on screen.
    canMock.mockReturnValue(false);
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    screen.getByRole("button", { name: "Back" }).click();
    expect(navigateMock).toHaveBeenCalledWith("/admin/collections/posts");
    expect(navigateMock).not.toHaveBeenCalledWith(
      "/admin/collections/posts/e1"
    );
  });

  it("asks about the permission the edit route actually guards", () => {
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );
    expect(canMock).toHaveBeenCalledWith("update-posts");
  });
});

describe("VersionComparePage — one comparison never paints under another", () => {
  it("starts over when the DOCUMENT changes under the same pair", () => {
    // Two entries' histories can carry the same version numbers, and the diff
    // query keeps previous data while the next one loads. Without the document
    // in the key the previous entry's comparison stays on screen under the new
    // entry's heading.
    const { rerender } = render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/a"
        readOnlyHref="/list"
        from={8}
        to={9}
      />
    );
    expect(diffMountMock).toHaveBeenCalledTimes(1);

    rerender(
      <VersionComparePage
        scope={collection("e2")}
        documentHref="/b"
        readOnlyHref="/list"
        from={8}
        to={9}
      />
    );

    // A second MOUNT is the evidence. Reusing the instance would leave the
    // previous document's diff painted while the new one loads.
    expect(diffMountMock).toHaveBeenCalledTimes(2);
    const scopes = (
      diffMountMock.mock.calls as [{ scope: { entryId: string } }][]
    ).map(([props]) => props.scope.entryId);
    expect(scopes).toEqual(["e1", "e2"]);
  });
});

describe("VersionComparePage — a failed history is not an empty one", () => {
  it("does not tell the reader to save their first version when the read failed", () => {
    // React Query clears `isLoading` on failure while the list stays empty, so
    // the rail's empty state renders beside a pane correctly reporting that the
    // history could not be loaded.
    useVersionsMock.mockReturnValue(
      listing([], { isError: true, data: undefined })
    );

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/a"
        readOnlyHref="/list"
      />
    );

    expect(screen.queryByText("No versions yet")).not.toBeInTheDocument();
    expect(
      screen.getByText("This document's history could not be loaded.")
    ).toBeInTheDocument();
  });

  it("still shows the empty state for a document that genuinely has no history", () => {
    // The control: suppressing the empty state on failure must not suppress it
    // when the document really is new.
    useVersionsMock.mockReturnValue(listing([]));

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/a"
        readOnlyHref="/list"
      />
    );

    expect(screen.getByText("No versions yet")).toBeInTheDocument();
  });
});
