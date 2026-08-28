/**
 * The comparison page. Three things it must not do, each of which reads as
 * working software while being wrong:
 *
 * paint one document's comparison under another document's heading; send a
 * viewer who may only READ the document to a page their permission refuses; and
 * nest a second primary landmark inside the one the dashboard shell provides.
 */
import { useEffect, useRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

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
    // The props as they were at MOUNT, held in a ref so the effect below needs
    // no dependency on them. A ref is stable, so the empty dependency list is
    // honest rather than suppressed — and mount-time props are exactly what a
    // remount counter should record.
    const mounted = useRef(props);
    useEffect(() => {
      diffMountMock(mounted.current);
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

import { VersionComparePage, versionsHref } from "../VersionComparePage";

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

describe("VersionComparePage — why there is nothing to compare", () => {
  it("MUST NOT tell a document with no versions that it has one", () => {
    // The rail says "No versions yet" in this state. The pane used to say
    // "There is only one version so far" beside it, because both were derived
    // from the same empty pair — two claims about the same document, one false.
    useVersionsMock.mockReturnValue(listing([]));

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/a"
        readOnlyHref="/list"
      />
    );

    // Scoped to each surface, because the point is that they say DIFFERENT
    // things: the rail reports the history, the pane reports the comparison.
    const pane = within(screen.getByRole("region", { name: "Comparison" }));
    expect(pane.queryByText(/only one version so far/)).not.toBeInTheDocument();
    expect(pane.getByText(/nothing to compare yet/i)).toBeInTheDocument();
    // The rail still owns that message, and now owns it alone.
    expect(screen.getByText("No versions yet")).toBeInTheDocument();
  });

  it("says a genuine single-version history is exactly that", () => {
    // The control: distinguishing the empty case must not stop this one being
    // reported, which is the ordinary reason a comparison cannot be drawn.
    useVersionsMock.mockReturnValue(listing([row(1)]));

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/a"
        readOnlyHref="/list"
      />
    );

    expect(screen.getByText(/only one version so far/)).toBeInTheDocument();
  });

  it("points at Load more when the predecessor is merely unfetched", () => {
    // Neither "no versions" nor "only one version" is true here, and both send
    // the reader to the wrong conclusion about their own document.
    useVersionsMock.mockReturnValue(listing([row(9)], { hasNextPage: true }));

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/a"
        readOnlyHref="/list"
      />
    );

    expect(screen.getByText(/has not been loaded yet/)).toBeInTheDocument();
    expect(
      screen.queryByText(/only one version so far/)
    ).not.toBeInTheDocument();
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

describe("VersionComparePage — choosing a row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canMock.mockReturnValue(true);
    useVersionsMock.mockReturnValue(listing([row(9), row(8)]));
  });

  /**
   * `navigateTo` skips a push only when its argument equals
   * `window.location.pathname`, and a target carrying `?from=&to=` never does.
   * So choosing the row already on screen pushed another identical entry, and
   * Back then walked through indistinguishable copies of one comparison
   * before leaving the page — which reads as a stuck Back button.
   */
  it("does not push a second entry for the comparison already shown", async () => {
    window.history.replaceState(
      null,
      "",
      "/admin/collections/posts/e1/versions?from=8&to=9"
    );

    const user = (await import("@testing-library/user-event")).default.setup();
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        from={8}
        to={9}
      />
    );

    await user.click(screen.getByRole("button", { name: /Version 9/ }));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  /**
   * The control, and it has to be capable of the other answer: a row naming a
   * DIFFERENT pair still navigates. Without it the assertion above would pass
   * on a page whose rows no longer do anything at all.
   */
  it("still navigates when a different pair is chosen", async () => {
    window.history.replaceState(
      null,
      "",
      "/admin/collections/posts/e1/versions?from=8&to=9"
    );
    useVersionsMock.mockReturnValue(listing([row(9), row(8), row(7)]));

    const user = (await import("@testing-library/user-event")).default.setup();
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        from={8}
        to={9}
      />
    );

    await user.click(screen.getByRole("button", { name: /Version 8/ }));
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });
});

describe("VersionComparePage — a failed next page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canMock.mockReturnValue(true);
  });

  /**
   * An infinite query flips to `isError` when a LATER page fails, while
   * keeping the pages it already has. Passing that aggregate state to the rail
   * discarded every row the reader already had — and the Load more control
   * that would have retried it — for a failure that lost nothing.
   */
  it("keeps the rows it already has when another page fails to load", () => {
    useVersionsMock.mockReturnValue(
      listing([row(9), row(8)], { isError: true, hasNextPage: true })
    );

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    expect(
      screen.getByRole("button", { name: /Version 9/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Version 8/ })
    ).toBeInTheDocument();
  });

  /**
   * The control. A failure with NOTHING loaded is a genuine load failure and
   * must still replace the rail — otherwise the assertion above would be
   * satisfied by a rail that ignores errors entirely.
   */
  it("still reports a failure that left nothing on screen", () => {
    useVersionsMock.mockReturnValue(listing([], { isError: true }));

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    expect(
      screen.queryByRole("button", { name: /Version/ })
    ).not.toBeInTheDocument();
  });
});

describe("versionsHref — the address carries the language", () => {
  const scope = { kind: "collection" as const, slug: "posts", entryId: "e1" };

  /**
   * The locale travels with the pair. A link shared from a French history has
   * to open the French comparison, named in French, for a reader whose editor
   * was last in English — the destination cannot recover the language from
   * `from` and `to` alone.
   */
  it("carries the locale beside the pair", () => {
    const href = versionsHref(scope, { from: 8, to: 9 }, "fr");
    expect(href).toContain("from=8");
    expect(href).toContain("to=9");
    expect(href).toContain("locale=fr");
  });

  /**
   * The control, and it decides the shape: a non-localized document must carry
   * NO locale rather than an empty one, which would read as a language that
   * failed to resolve rather than one never asked for.
   */
  it("omits the locale entirely when there is none", () => {
    const href = versionsHref(scope, { from: 8, to: 9 }, null);
    expect(href).toContain("from=8");
    expect(href).not.toContain("locale");
  });

  it("still addresses a history with no pair chosen", () => {
    expect(versionsHref(scope)).not.toContain("?");
    expect(versionsHref(scope, undefined, "fr")).toContain("locale=fr");
  });
});
