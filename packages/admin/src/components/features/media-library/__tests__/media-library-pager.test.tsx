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
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.useRealTimers();
});

const pageOfCall = (call: unknown[]) => (call[0] as { page: number }).page;

describe("the media page's pager", () => {
  it("holds its controls while the next page loads", async () => {
    // Answered by page, not by call order: page one again (a refetch of the
    // settled result) must not take the answer meant for the next page.
    api.fetchMedia.mockImplementation(({ page }: { page: number }) =>
      page === 1 ? Promise.resolve(pageOf(1)) : new Promise(() => {})
    );

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

    await waitFor(() =>
      expect(api.fetchMedia.mock.calls.map(pageOfCall)).toContain(2)
    );
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

  it("keeps the page the reader picked once the search box settles", async () => {
    // Only the timers are faked, so the click is certain to land inside the
    // search box's settle delay however busy the machine is. That window is
    // where an unchanged, empty search used to send the reader back to page
    // one.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    api.fetchMedia.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve(pageOf(page))
    );

    renderWithProviders(
      <MediaProvider>
        <MediaLibrary />
      </MediaProvider>
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Media list pagination" })
      ).getByRole("button", { name: /next page/i })
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    // POPULATION CONTROL: the click reached page two before the delay ran out.
    expect(screen.queryAllByText("photo-2.jpg")).not.toHaveLength(0);

    // Past the delay, in steps so a request it starts gets its answer drawn.
    for (let i = 0; i < 10; i++) {
      await act(() => vi.advanceTimersByTimeAsync(100));
    }

    expect(screen.queryAllByText("photo-2.jpg")).not.toHaveLength(0);
    expect(screen.queryAllByText("photo-1.jpg")).toHaveLength(0);
    expect(api.fetchMedia.mock.calls.map(pageOfCall)).toEqual([1, 2]);
  });
});
