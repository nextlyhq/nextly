/**
 * A bulk delete across pages, on the whole page with only the network
 * stubbed: two pages selected in the list view make a selection of 150,
 * which is sent as one request, so the server marks it whole or not at all,
 * and offered back by one Undo, which is one request too.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";

const api = vi.hoisted(() => ({
  fetchMedia: vi.fn(),
  mediaFetchJson: vi.fn(),
}));
vi.mock("@admin/services/mediaApi", () => ({
  fetchMedia: (...a: unknown[]) => api.fetchMedia(...a),
  listRootFolders: vi.fn(() => Promise.resolve([])),
  listSubfolders: vi.fn(() => Promise.resolve([])),
  getFolderContents: vi.fn(),
  updateMedia: vi.fn(),
  bulkDeleteMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaById: vi.fn(),
  uploadMedia: vi.fn(),
  createFolder: vi.fn(),
  getFolderById: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveMediaToFolder: vi.fn(),
  mediaFetchJson: (...a: unknown[]) => api.mediaFetchJson(...a),
}));

const toasts = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: toasts.toast,
}));

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

import { MediaProvider } from "@admin/context/providers/MediaProvider";

import { MediaLibrary } from "..";

const COUNT = 150;
/** An item an earlier delete had already marked. */
const EARLIER = "m5";
/** The list's first page; the rest are on the second. */
const PAGE = 96;

function item(n: number) {
  return {
    id: `m${n}`,
    filename: `photo-${n}.jpg`,
    originalFilename: `photo-${n}.jpg`,
    mimeType: "image/jpeg",
    size: 1000,
    width: 1600,
    height: 900,
    url: `/uploads/photo-${n}.jpg`,
    altText: `Photo ${n}`,
    folderId: null,
    uploadedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    uploadedBy: "u1",
  };
}

/** The ids each request to `path` named, in order. */
function sentTo(path: string): string[][] {
  return api.mediaFetchJson.mock.calls
    .filter(([url]) => url === path)
    .map(
      ([, init]) =>
        (JSON.parse(String((init as RequestInit).body)) as { ids: string[] })
          .ids
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem("nextly:admin:media:view-mode", "list");
  // Two pages of the list, whatever page size is asked for.
  api.fetchMedia.mockImplementation((params: { page?: number }) => {
    const first = params.page !== 2;
    const from = first ? 0 : PAGE;
    const to = first ? PAGE : COUNT;
    return Promise.resolve({
      data: Array.from({ length: to - from }, (_, n) => item(from + n)),
      meta: { total: COUNT, page: first ? 1 : 2, limit: PAGE, totalPages: 2 },
    });
  });
  api.mediaFetchJson.mockImplementation((url: string, init?: RequestInit) => {
    const sent = init?.body
      ? (JSON.parse(String(init.body)) as { ids: string[] }).ids
      : [];
    if (url === "/admin/api/media/deletions") {
      return Promise.resolve({
        ids: sent,
        // `m5` was already waiting to be deleted, from an earlier delete.
        marked: sent.filter(id => id !== EARLIER),
        deleteAfter: new Date(Date.now() + 10_000).toISOString(),
        markedDeleteAfter: new Date(Date.now() + 10_000).toISOString(),
      });
    }
    if (url === "/admin/api/media/deletions/undo") {
      return Promise.resolve({ restored: sent, gone: [] });
    }
    return Promise.resolve({ items: [], meta: {} });
  });
});

describe("a bulk delete of more than one page of items", () => {
  it("sends the selection as one request, with one Undo for what it marked", async () => {
    renderWithProviders(
      <MediaProvider>
        <MediaLibrary />
      </MediaProvider>
    );
    // Every item of the first page, then every item of the second.
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select all" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() =>
      expect(api.fetchMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 })
      )
    );
    await screen.findAllByText("photo-149.jpg");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(
      screen.getByRole("button", { name: `Delete ${COUNT} selected items` })
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        button => button.textContent === "Delete"
      )!
    );

    const all = Array.from({ length: COUNT }, (_, n) => `m${n}`);
    await waitFor(() =>
      expect(sentTo("/admin/api/media/deletions")).toEqual([all])
    );
    // One toast, whose Undo is for the whole selection.
    await waitFor(() => expect(toasts.toast).toHaveBeenCalledTimes(1));
    expect(toasts.toast).toHaveBeenCalledWith(
      `${COUNT} files deleted`,
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      })
    );

    const [, options] = toasts.toast.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    act(() => options.action.onClick());

    await waitFor(() =>
      // Only what this delete marked: the earlier delete is left alone.
      expect(sentTo("/admin/api/media/deletions/undo")).toEqual([
        all.filter(id => id !== EARLIER),
      ])
    );
    await waitFor(() =>
      expect(toasts.toast.success).toHaveBeenCalledWith(
        `${COUNT} files restored`
      )
    );
    // Two pages of rows rendered in the list take longer than the default.
  }, 60_000);
});
