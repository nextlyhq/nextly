/**
 * The history panel. What matters is that each state says something true: no
 * history yet is not an error, a failed load is not an empty document, and
 * previewing a version never implies it is the live one.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { useVersionsMock, useVersionMock } = vi.hoisted(() => ({
  useVersionsMock: vi.fn(),
  useVersionMock: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersions: (...a: unknown[]) => useVersionsMock(...a),
  useVersion: (...a: unknown[]) => useVersionMock(...a),
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
