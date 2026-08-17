/**
 * The history panel. What matters is that each state says something true: no
 * history yet is not an error, a failed load is not an empty document, and
 * previewing a version never implies it is the live one.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

const {
  useVersionsMock,
  useVersionMock,
  restoreMock,
  setLabelMock,
  mutateMock,
  toastErrorMock,
  compareDialogMock,
} = vi.hoisted(() => ({
  useVersionsMock: vi.fn(),
  useVersionMock: vi.fn(),
  restoreMock: vi.fn(),
  setLabelMock: vi.fn(),
  mutateMock: vi.fn(),
  toastErrorMock: vi.fn(),
  compareDialogMock: vi.fn(),
}));

// Stubbed so these tests stay about the panel. The real dialog fetches a diff
// of its own, which the panel neither requests nor knows about; its own suite
// covers what it renders.
vi.mock("../VersionCompareDialog", () => ({
  VersionCompareDialog: (props: Record<string, unknown>) => {
    compareDialogMock(props);
    return <div data-testid="compare-dialog" />;
  },
}));

vi.mock("@admin/components/ui", async () => {
  const actual = await vi.importActual<typeof import("@admin/components/ui")>(
    "@admin/components/ui"
  );
  return {
    ...actual,
    toast: { success: vi.fn(), error: toastErrorMock },
  };
});

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersions: (...a: unknown[]) => useVersionsMock(...a),
  useVersion: (...a: unknown[]) => useVersionMock(...a),
  useRestoreVersion: (...a: unknown[]) => restoreMock(...a),
  useSetVersionLabel: (...a: unknown[]) => setLabelMock(...a),
}));

import { DocumentHistoryContext } from "../document-history-context";
import { VersionHistorySheet } from "../VersionHistorySheet";

const scope = { kind: "collection" as const, slug: "posts", entryId: "e1" };
const fields = [
  { name: "title", type: "text", label: "Title" },
] as FieldConfig[];

function listState(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items: [], meta: { hasNext: false } }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    error: null,
    ...overrides,
  };
}

function detailState(overrides: Record<string, unknown> = {}) {
  return { data: undefined, isLoading: false, error: null, ...overrides };
}

function version(versionNo: number) {
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "published",
    isAutosave: false,
    label: null,
    locale: null,
    sourceVersionNo: null,
    createdBy: "u1",
    author: { id: "u1", name: "Ada" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function renderSheet() {
  return render(
    <VersionHistorySheet open onOpenChange={vi.fn()} scope={scope} />
  );
}

/**
 * Whether an element is reachable to assistive technology: present, and with no
 * ancestor withdrawing it from the accessibility tree. A modal surface marks
 * everything outside itself this way, so this is the property that separates a
 * panel the document sits beside from one the document hides behind.
 */
function reachable(element: Element | null): boolean {
  if (!element) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (node.hasAttribute("inert")) return false;
  }
  return true;
}

describe("VersionHistorySheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVersionsMock.mockReturnValue(listState());
    useVersionMock.mockReturnValue(detailState());
    restoreMock.mockReturnValue({ mutate: mutateMock, isPending: false });
    setLabelMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("lists the versions it received", () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: {
          pages: [
            { items: [version(2), version(1)], meta: { hasNext: false } },
          ],
        },
      })
    );

    renderSheet();

    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("Version 1")).toBeInTheDocument();
  });

  it("says a document with no history has none, rather than erroring", () => {
    renderSheet();

    // A heading, not a paragraph: it is the only content in an empty panel, so
    // it has to be something assistive technology can land on.
    expect(
      screen.getByRole("heading", { name: /No versions yet/ })
    ).toBeInTheDocument();
  });

  it("offers a retry when history could not be loaded", () => {
    // A failed load must not render as an empty history, which would claim the
    // document has never been saved.
    useVersionsMock.mockReturnValue(listState({ isError: true }));

    renderSheet();

    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Try again/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /No versions yet/ })
    ).toBeNull();
  });

  it("offers a retry when a background refresh fails after history has loaded", async () => {
    // A focus or mount head revalidation can fail with rows already on screen.
    // They stay (possibly stale), so the freshness gate holds compare + load
    // more; without this control the only recovery is reopening the panel.
    const refetch = vi.fn();
    useVersionsMock.mockReturnValue(
      listState({
        data: {
          pages: [
            { items: [version(2), version(1)], meta: { hasNext: false } },
          ],
        },
        isError: true,
        isRefetchError: true,
        refetch,
      })
    );

    renderSheet();

    // The loaded rows are kept, not replaced by the full-panel load error.
    expect(screen.getByText("Version 2")).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Couldn't refresh this history/)
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("disables the retry while a refresh is already in flight", () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(2)], meta: { hasNext: false } }] },
        isRefetchError: true,
        isRefetching: true,
      })
    );

    renderSheet();

    expect(screen.getByRole("button", { name: /Retrying/ })).toBeDisabled();
  });

  it("shows the full-panel error, not the stale-history banner, when nothing loaded", () => {
    // With no rows the failure is a load error, not a stale refresh: the
    // full-panel message owns that state and the banner must stay out of it.
    useVersionsMock.mockReturnValue(
      listState({ isError: true, isRefetchError: true })
    );

    renderSheet();

    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument();
  });

  it("keeps a retry reachable from a preview when the head refresh fails", async () => {
    // In preview the freshness gate hides "Compare with current"; the retry has
    // to remain reachable or the comparison cannot recover without a reopen.
    const refetch = vi.fn();
    useVersionsMock.mockReturnValue(
      listState({
        data: {
          pages: [
            { items: [version(3), version(2)], meta: { hasNext: false } },
          ],
        },
        isError: true,
        isRefetchError: true,
        refetch,
      })
    );
    useVersionMock.mockReturnValue(detailState({ data: { snapshot: {} } }));

    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /Version 2/ }));

    expect(
      screen.queryByRole("button", { name: /Compare with current/ })
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it("opens the compare dialog with the pair, without replacing the panel", async () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: {
          pages: [
            { items: [version(3), version(2)], meta: { hasNext: false } },
          ],
        },
      })
    );
    useVersionMock.mockReturnValue(detailState({ data: { snapshot: {} } }));

    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /Version 2/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Compare with current/ })
    );

    // Older on the left: "compare with current" reads version 2 against the
    // head, so the chosen version is `from` and the head is `to`.
    expect(compareDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: true, from: 2, to: 3 })
    );
    // The preview stays underneath rather than being swapped out, which is what
    // makes dismissing the dialog a return rather than a navigation.
    expect(
      screen.getByRole("button", { name: /Back to history/ })
    ).toBeInTheDocument();
  });

  it("compares against the next older version of the same locale", async () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: {
          pages: [
            { items: [version(3), version(2)], meta: { hasNext: false } },
          ],
        },
      })
    );
    useVersionMock.mockReturnValue(detailState({ data: { snapshot: {} } }));

    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Compare with previous/ })
    );

    expect(compareDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: 2, to: 3 })
    );
  });

  it("leaves the document reachable while its history is open", () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(1)], meta: { hasNext: false } }] },
      })
    );

    render(
      <>
        <input aria-label="Title" defaultValue="the live document" />
        <VersionHistorySheet open onOpenChange={vi.fn()} scope={scope} />
      </>
    );

    // The panel and the document are both on screen, which is the point: an
    // editor reads a version against what is live. A modal surface withdraws
    // everything outside itself from the accessibility tree, so the document
    // being present is not enough — it has to still be reachable.
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    expect(reachable(screen.getByLabelText("Title"))).toBe(true);
  });

  it("mounts no compare dialog until one is asked for", () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(1)], meta: { hasNext: false } }] },
      })
    );

    renderSheet();

    // The assertion above is only meaningful if the stub is absent by default;
    // a dialog mounted from the start would satisfy it without any click.
    expect(screen.queryByTestId("compare-dialog")).toBeNull();
    expect(compareDialogMock).not.toHaveBeenCalled();
  });

  it("offers more only when another page exists", () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(1)], meta: { hasNext: false } }] },
        hasNextPage: false,
      })
    );
    const { unmount } = renderSheet();
    expect(
      screen.queryByRole("button", { name: /Load more/ })
    ).not.toBeInTheDocument();
    unmount();

    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(1)], meta: { hasNext: true } }] },
        hasNextPage: true,
      })
    );
    renderSheet();
    expect(
      screen.getByRole("button", { name: /Load more/ })
    ).toBeInTheDocument();
  });

  it("hands the chosen version to the document rather than previewing it", async () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(
      detailState({ data: { snapshot: { title: "Old title" }, locale: null } })
    );

    const setViewing = vi.fn();
    render(
      <DocumentHistoryContext.Provider
        value={{
          viewing: null,
          setViewing,
          restore: null,
          setRestore: vi.fn(),
        }}
      >
        <VersionHistorySheet open onOpenChange={vi.fn()} scope={scope} />
      </DocumentHistoryContext.Provider>
    );
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));

    // The panel no longer draws the version: a 480px column cannot show a page
    // as it read, so the document does it and the panel stays a timeline.
    await waitFor(() =>
      expect(setViewing).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNo: 3,
          snapshot: { title: "Old title" },
        })
      )
    );
    expect(screen.queryByText(/Viewing version/)).toBeNull();
  });

  it("returns to the list from a preview", async () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(detailState({ data: { snapshot: {} } }));

    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Back to history/ })
    );

    expect(screen.queryByText(/Viewing version/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Version 3/ })
    ).toBeInTheDocument();
  });

  it("offers restore only to a caller who may write the document", async () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(detailState({ data: { snapshot: {} } }));

    const { unmount } = render(
      <VersionHistorySheet open onOpenChange={vi.fn()} scope={scope} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));
    expect(
      screen.queryByRole("button", { name: /Restore this version/ })
    ).not.toBeInTheDocument();
    unmount();

    render(
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        canRestore
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));
    expect(
      screen.getByRole("button", { name: /Restore this version/ })
    ).toBeInTheDocument();
  });

  it("confirms before restoring rather than writing on the first click", async () => {
    // Restore writes the live document, so a single misclick must not do it.
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(detailState({ data: { snapshot: {} } }));

    render(
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        canRestore
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Restore this version/ })
    );

    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Restore version 3\?/)).toBeInTheDocument();
  });

  it("tells the editor when a restore was refused", async () => {
    // Without a message the spinner simply stops, which reads as the click not
    // having registered rather than as a refusal.
    let onErrorHandler: ((e: Error) => void) | undefined;
    restoreMock.mockImplementation((opts: { onError?: (e: Error) => void }) => {
      onErrorHandler = opts.onError;
      return { mutate: mutateMock, isPending: false };
    });

    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(detailState({ data: { snapshot: {} } }));

    render(
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        canRestore
      />
    );

    expect(onErrorHandler).toBeDefined();
    onErrorHandler?.(new Error("nope"));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
  });

  it("does not offer restore until the version is on screen", async () => {
    // Restore is offered from the preview so the choice follows seeing what the
    // version holds; a skeleton or an error is not that.
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(detailState({ isLoading: true }));

    const { unmount } = render(
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        canRestore
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));
    expect(
      screen.getByRole("button", { name: /Restore this version/ })
    ).toBeDisabled();
    unmount();

    useVersionMock.mockReturnValue(detailState({ data: { snapshot: {} } }));
    render(
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        canRestore
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));
    expect(
      screen.getByRole("button", { name: /Restore this version/ })
    ).toBeEnabled();
  });

  it("warns from the live document's status, not the version's", async () => {
    // The selected version's status describes the past; whether this change is
    // publicly visible depends on the document as it stands now.
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(
      detailState({ data: { snapshot: {}, status: "draft" } })
    );

    render(
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        canRestore
        liveStatus="published"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Restore this version/ })
    );

    expect(screen.getByText(/the document is published/)).toBeInTheDocument();
  });

  it("does not query while closed", () => {
    render(
      <VersionHistorySheet open={false} onOpenChange={vi.fn()} scope={scope} />
    );

    // Mounted but idle: the panel exists in the header regardless of state, so
    // it must not fetch a document's history until asked for.
    expect(useVersionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });
});

describe("VersionHistorySheet — renaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(detailState());
    restoreMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    setLabelMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("does not offer renaming to a caller who may not write the document", () => {
    // Renaming writes to history and needs the same permission restoring does.
    // Offering it otherwise opens a dialog whose save the route rejects.
    render(
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        canRestore={false}
      />
    );

    expect(
      screen.queryByRole("button", { name: /name version/i })
    ).not.toBeInTheDocument();
  });

  it("offers renaming to a caller who may", () => {
    render(
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        canRestore
      />
    );

    expect(
      screen.getAllByRole("button", { name: /name version/i }).length
    ).toBeGreaterThan(0);
  });
});

describe("VersionHistorySheet — what it publishes to the document", () => {
  function renderWithDocument(canRestore = true) {
    const setViewing = vi.fn();
    const setRestore = vi.fn();
    render(
      <DocumentHistoryContext.Provider
        value={{ viewing: null, setViewing, restore: null, setRestore }}
      >
        <VersionHistorySheet
          open
          onOpenChange={vi.fn()}
          scope={scope}
          canRestore={canRestore}
        />
      </DocumentHistoryContext.Provider>
    );
    return { setViewing, setRestore };
  }

  beforeEach(() => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(
      detailState({ data: { snapshot: { title: "Old" }, locale: null } })
    );
  });

  it("offers restoring to the document only when the caller may write", async () => {
    const { setRestore } = renderWithDocument(false);
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));

    await waitFor(() =>
      expect(setRestore).toHaveBeenCalledWith(
        expect.objectContaining({ canRestore: false })
      )
    );
  });

  it("returns to the live document THROUGH the panel, clearing its own row", async () => {
    const { setRestore } = renderWithDocument();
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));

    await waitFor(() => expect(setRestore).toHaveBeenCalled());
    const published = setRestore.mock.calls.at(-1)?.[0] as {
      returnToCurrent: () => void;
    };

    // The banner cannot clear this panel's selection itself, so it asks. Going
    // back must leave no row marked active for a version off screen.
    expect(screen.getByRole("button", { name: /Version 3/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
    // ONLY the published callback — clicking "Back to history" as well would
    // clear the selection by itself and the assertion would pass whether or not
    // `returnToCurrent` does anything.
    published.returnToCurrent();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Version 3/ })
      ).not.toHaveAttribute("aria-current", "true")
    );
  });
});
