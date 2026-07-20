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
  mutateMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useVersionsMock: vi.fn(),
  useVersionMock: vi.fn(),
  restoreMock: vi.fn(),
  mutateMock: vi.fn(),
  toastErrorMock: vi.fn(),
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
}));

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
    <VersionHistorySheet
      open
      onOpenChange={vi.fn()}
      scope={scope}
      fields={fields}
    />
  );
}

describe("VersionHistorySheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVersionsMock.mockReturnValue(listState());
    useVersionMock.mockReturnValue(detailState());
    restoreMock.mockReturnValue({ mutate: mutateMock, isPending: false });
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

    expect(
      screen.getByText(/No versions recorded for this document yet/)
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
    expect(screen.queryByText(/No versions recorded/)).not.toBeInTheDocument();
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

  it("opens a version and states plainly that it is not live", async () => {
    useVersionsMock.mockReturnValue(
      listState({
        data: { pages: [{ items: [version(3)], meta: { hasNext: false } }] },
      })
    );
    useVersionMock.mockReturnValue(
      detailState({ data: { snapshot: { title: "Old title" } } })
    );

    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: /Version 3/ }));

    expect(screen.getByText(/Viewing version 3/)).toBeInTheDocument();
    expect(screen.getByText("Old title")).toBeInTheDocument();
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
      <VersionHistorySheet
        open
        onOpenChange={vi.fn()}
        scope={scope}
        fields={fields}
      />
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
        fields={fields}
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
        fields={fields}
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
        fields={fields}
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
        fields={fields}
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
        fields={fields}
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
        fields={fields}
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
      <VersionHistorySheet
        open={false}
        onOpenChange={vi.fn()}
        scope={scope}
        fields={fields}
      />
    );

    // Mounted but idle: the panel exists in the header regardless of state, so
    // it must not fetch a document's history until asked for.
    expect(useVersionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });
});
