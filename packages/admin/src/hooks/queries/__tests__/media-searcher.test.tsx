/**
 * The media library's image search for a picker outside a dialog: images
 * only, the newest twelve, by name only when a name is typed, through the
 * library's own list read, and a failure said rather than answered as an
 * empty library.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchMedia: vi.fn() }));
vi.mock("@admin/services/mediaApi", () => ({
  fetchMedia: (...a: unknown[]) => api.fetchMedia(...a),
  bulkDeleteMedia: vi.fn(),
  deleteMedia: vi.fn(),
  getMediaById: vi.fn(),
  updateMedia: vi.fn(),
  uploadMedia: vi.fn(),
  createFolder: vi.fn(),
  getFolderById: vi.fn(),
  listRootFolders: vi.fn(),
  listSubfolders: vi.fn(),
  getFolderContents: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveMediaToFolder: vi.fn(),
}));

import { useMediaSearcher } from "@admin/hooks/queries/useMedia";

let client: QueryClient;
function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SPRING = { id: "m1", filename: "spring-banner.jpg" };

function listOf(items: readonly unknown[]) {
  return {
    data: items,
    meta: { total: items.length, page: 1, limit: 12, totalPages: 1 },
    success: true,
    statusCode: 200,
    message: "",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("the media library's image search", () => {
  it("asks for the newest twelve images, with no name, when the search is empty", async () => {
    api.fetchMedia.mockResolvedValue(listOf([SPRING]));
    const { result } = renderHook(() => useMediaSearcher(), {
      wrapper: Wrapper,
    });
    await expect(result.current("  ")).resolves.toEqual([SPRING]);
    // The exact params: an empty `search` key would be a different query
    // from the newest images', and a missing `type` would offer PDFs.
    expect(api.fetchMedia.mock.calls).toEqual([
      [
        {
          page: 1,
          limit: 12,
          type: "image",
          sortBy: "uploadedAt",
          sortOrder: "desc",
        },
      ],
    ]);
  });

  it("asks by name once one is typed, trimmed", async () => {
    // The control for the case above: the same read, now carrying the name.
    api.fetchMedia.mockResolvedValue(listOf([SPRING]));
    const { result } = renderHook(() => useMediaSearcher(), {
      wrapper: Wrapper,
    });
    await result.current(" spring ");
    expect(api.fetchMedia).toHaveBeenCalledTimes(1);
    expect(api.fetchMedia.mock.calls[0]?.[0]).toEqual({
      page: 1,
      limit: 12,
      search: "spring",
      type: "image",
      sortBy: "uploadedAt",
      sortOrder: "desc",
    });
  });

  it("rejects when the library cannot be read, rather than answering none", async () => {
    api.fetchMedia.mockRejectedValue(new Error("Forbidden"));
    const { result } = renderHook(() => useMediaSearcher(), {
      wrapper: Wrapper,
    });
    await expect(result.current("spring")).rejects.toThrow("Forbidden");
  });

  it("rejects a search whose signal aborts before it answers", async () => {
    let answer: (value: unknown) => void = () => {};
    api.fetchMedia.mockReturnValue(
      new Promise(resolve => {
        answer = resolve;
      })
    );
    const { result } = renderHook(() => useMediaSearcher(), {
      wrapper: Wrapper,
    });
    const controller = new AbortController();
    const pending = result.current("spring", controller.signal);
    controller.abort();
    answer(listOf([SPRING]));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("is the same function on every render", () => {
    const { result, rerender } = renderHook(() => useMediaSearcher(), {
      wrapper: Wrapper,
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
