/**
 * The comparison page. Three things it must not do, each of which reads as
 * working software while being wrong:
 *
 * paint one document's comparison under another document's heading; send a
 * viewer who may only READ the document to a page their permission refuses; and
 * nest a second primary landmark inside the one the dashboard shell provides.
 * The two versions are chosen by name in one card, "Compare" and "with".
 */
import userEvent from "@testing-library/user-event";
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
  // Read only for a version a refused baseline names; none is refused here.
  useVersion: () => ({ data: undefined }),
  // No baseline is named in these tests: the server is never asked.
  useBaselineDiff: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  scopeKey: (s: { kind: string; slug: string; entryId?: string }) => [
    s.kind,
    s.slug,
    s.entryId ?? "",
  ],
}));

// Marking a version seen is the page's own concern, tested beside its choices.
vi.mock("../useMarkVersionSeen", () => ({ useMarkVersionSeen: vi.fn() }));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (...a: unknown[]) => canMock(...a) as boolean,
}));

vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (...a: unknown[]) => navigateMock(...a),
}));

import { VersionComparePage } from "../VersionComparePage";
import { versionsHref } from "../versions-href";

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

describe("VersionComparePage — the way back", () => {
  it("leads back to the document when the viewer can edit it", () => {
    canMock.mockReturnValue(true);
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        documentTitle="Launch notes"
        listCrumb={{ label: "Posts", href: "/admin/collections/posts" }}
      />
    );

    const trail = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(trail).getByRole("link", { name: "Posts" })).toHaveAttribute(
      "href",
      "/admin/collections/posts"
    );
    expect(
      within(trail).getByRole("link", { name: "Launch notes" })
    ).toHaveAttribute("href", "/admin/collections/posts/e1");
    expect(within(trail).getByText("Compare")).toBeInTheDocument();
  });

  it("MUST NOT send a read-only viewer to a page their permission refuses", () => {
    // Reading a history needs `read-posts`; the editor needs `update-posts`. A
    // colleague can open a shared comparison, read it, and be sent to
    // permission-denied by the one way back always on screen.
    canMock.mockReturnValue(false);
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        documentTitle="Launch notes"
      />
    );

    expect(screen.getByRole("link", { name: "Launch notes" })).toHaveAttribute(
      "href",
      "/admin/collections/posts"
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
    // "There is only one version so far" was once said of an empty history,
    // because both were derived from the same empty pair.
    useVersionsMock.mockReturnValue(listing([]));

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/a"
        readOnlyHref="/list"
      />
    );

    const pane = within(screen.getByRole("region", { name: "Comparison" }));
    expect(pane.queryByText(/only one version so far/)).not.toBeInTheDocument();
    expect(pane.getByText(/nothing to compare yet/i)).toBeInTheDocument();
    // With nothing to choose, the choice is not offered.
    expect(screen.getByRole("combobox", { name: "with" })).toBeDisabled();
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

  it("points at Load older versions when the predecessor is merely unfetched", () => {
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
    // And the control it points at is there.
    expect(
      screen.getByRole("button", { name: "Load older versions" })
    ).toBeInTheDocument();
  });
});

describe("VersionComparePage — a failed history is not an empty one", () => {
  it("does not call a history that failed to load an empty one", () => {
    // React Query clears `isLoading` on failure while the list stays empty, so
    // an empty history's answer could stand beside the failure.
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

    expect(screen.queryByText(/nothing to compare yet/i)).toBeNull();
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

    expect(screen.getByText(/nothing to compare yet/i)).toBeInTheDocument();
  });
});

describe("VersionComparePage — choosing the two versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canMock.mockReturnValue(true);
    useVersionsMock.mockReturnValue(listing([row(9), row(8), row(7)]));
  });

  /**
   * `navigateTo` skips a push only when its argument equals
   * `window.location.pathname`, and a target carrying `?from=&to=` never does.
   * So choosing the version already on screen pushed another identical entry,
   * and Back then walked through indistinguishable copies of one comparison
   * before leaving the page — which reads as a stuck Back button.
   */
  it("does not push a second entry for the comparison already shown", async () => {
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        from={8}
        to={9}
      />
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "with" }),
      "9"
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Compare" }),
      "8"
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  /**
   * The control, and it has to be capable of the other answer: a DIFFERENT
   * pair still navigates. Without it the assertion above would pass on a page
   * whose choices no longer do anything at all.
   */
  it("compares with the older version chosen, keeping the newer one", async () => {
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        from={8}
        to={9}
      />
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Compare" }),
      "7"
    );
    expect(navigateMock).toHaveBeenCalledWith(
      versionsHref(collection("e1"), { from: 7, to: 9 })
    );
  });

  it("keeps the older version when the newer one chosen pairs with it", async () => {
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        from={7}
        to={8}
      />
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "with" }),
      "9"
    );
    expect(navigateMock).toHaveBeenCalledWith(
      versionsHref(collection("e1"), { from: 7, to: 9 })
    );
  });

  it("swaps the two versions, so the change reads the other way", async () => {
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        from={7}
        to={9}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Swap the two versions" })
    );
    expect(navigateMock).toHaveBeenCalledWith(
      versionsHref(collection("e1"), { from: 9, to: 7 })
    );
  });

  it("offers older versions only in the newer one's language", () => {
    useVersionsMock.mockReturnValue(
      listing([row(9, "fr"), row(8, "de"), row(7, "fr")])
    );
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        from={7}
        to={9}
      />
    );

    const older = within(screen.getByRole("combobox", { name: "Compare" }));
    expect(
      older.getByRole("option", { name: /^Version 7/ })
    ).toBeInTheDocument();
    // A pair across two languages is one the server refuses.
    expect(older.queryByRole("option", { name: /^Version 8/ })).toBeNull();
  });
});

describe("VersionComparePage — a failed next page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canMock.mockReturnValue(true);
  });

  /**
   * An infinite query flips to `isError` when a LATER page fails, while
   * keeping the pages it already has. Treating that aggregate state as the
   * history failing would discard every version the reader already had for a
   * failure that lost nothing.
   */
  it("keeps the versions it already has when another page fails to load", () => {
    useVersionsMock.mockReturnValue(
      listing([row(9), row(8)], {
        isError: true,
        isFetchNextPageError: true,
        hasNextPage: true,
      })
    );

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    const newer = within(screen.getByRole("combobox", { name: "with" }));
    expect(
      newer.getByRole("option", { name: /^Version 9/ })
    ).toBeInTheDocument();
    expect(
      newer.getByRole("option", { name: /^Version 8/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Older versions could not be loaded/
    );
  });

  /**
   * The control. A failure with NOTHING loaded is a genuine load failure and
   * must still be said as one — otherwise the assertion above would be
   * satisfied by a page that ignores errors entirely.
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
      screen.queryByRole("option", { name: /^Version/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("This document's history could not be loaded.")
    ).toBeInTheDocument();
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

describe("VersionComparePage — choosing a version keeps its language", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canMock.mockReturnValue(true);
  });

  /**
   * The address is what the page is named from, so a navigation that drops the
   * locale sends the reader to a comparison headed in another language. A
   * history with no language filter lists every language, so the version
   * chosen is routinely not in the language on screen — which is why the
   * CHOSEN version's locale decides, rather than the current address's.
   */
  it("writes the chosen version's locale into the address", async () => {
    useVersionsMock.mockReturnValue(
      listing([row(9, "fr"), row(8, "fr"), row(7, "fr")])
    );

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "with" }),
      "8"
    );
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]?.[0]).toContain("locale=fr");
  });

  /**
   * The control. A document with no locale must produce no parameter — an
   * empty one reads as a language that failed to resolve rather than one never
   * asked for, and without this the assertion above would pass on a page that
   * always appended something.
   */
  it("writes no locale for a document that has none", async () => {
    useVersionsMock.mockReturnValue(listing([row(9), row(8), row(7)]));

    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "with" }),
      "8"
    );
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]?.[0]).not.toContain("locale");
  });
});

describe("VersionComparePage — the language its address names", () => {
  it("lists the versions of that language", () => {
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
        locale="de"
      />
    );

    expect(useVersionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "de" })
    );
  });

  it("lists every language when the address names none", () => {
    render(
      <VersionComparePage
        scope={collection("e1")}
        documentHref="/admin/collections/posts/e1"
        readOnlyHref="/admin/collections/posts"
      />
    );

    const calls = useVersionsMock.mock.calls as unknown as [
      { locale?: string },
    ][];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0].locale).toBeUndefined();
  });
});
