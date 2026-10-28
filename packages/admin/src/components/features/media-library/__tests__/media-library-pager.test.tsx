/**
 * The media page's pager can't act on totals from a result that is being
 * replaced.
 *
 * While the next page, search or page size loads, the list keeps showing the
 * current rows, and they carry the old result's page count. A pager left live
 * over them could send the reader to a page the new result doesn't have, which
 * undoes the reset to page one and leaves an empty view with no pager. So the
 * pager is held, every control disabled, until the new result arrives.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@admin/__tests__/utils";

const api = vi.hoisted(() => ({ fetchMedia: vi.fn() }));
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
}));

import { MediaProvider } from "@admin/context/providers/MediaProvider";

import { MediaLibrary } from "..";

function pageOf(n: number) {
  return {
    data: [
      {
        id: `m${n}`,
        filename: `photo-${n}.jpg`,
        originalFilename: `photo-${n}.jpg`,
        mimeType: "image/jpeg",
        size: 1000,
        url: `/uploads/photo-${n}.jpg`,
        uploadedAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        uploadedBy: "u1",
      },
    ],
    meta: { total: 72, page: n, limit: 24, totalPages: 3 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the media page's pager", () => {
  it("holds its controls while the next page loads", async () => {
    api.fetchMedia
      .mockResolvedValueOnce(pageOf(1))
      .mockReturnValueOnce(new Promise(() => {}));

    renderWithProviders(
      <MediaProvider>
        <MediaLibrary />
      </MediaProvider>
    );
    const pager = await screen.findByRole("navigation", {
      name: "Media list pagination",
    });
    const next = within(pager).getByRole("button", { name: /next page/i });
    // POPULATION CONTROL: with a settled result the pager is live.
    expect(next).toBeEnabled();

    fireEvent.click(next);

    await waitFor(() => expect(api.fetchMedia).toHaveBeenCalledTimes(2));
    // The request starts before the render that holds the pager, so the held
    // state is awaited too; asserting it at once raced that render on a busy
    // machine. The second request never settles, so the old result's live
    // pager can't satisfy this by being drawn again.
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("navigation", { name: "Media list pagination" })
        ).getByRole("button", { name: /next page/i })
      ).toBeDisabled()
    );
  });
});
