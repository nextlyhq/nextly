/**
 * The media read a drawn page resolves its images with: every image asked for
 * together goes in one request whatever their number, an answer is kept for
 * the editing session rather than for a minute, and the library's own
 * invalidation of media is what drops it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getMediaById: vi.fn(),
  getMediaByIds: vi.fn(),
}));
vi.mock("@admin/services/mediaApi", () => ({
  getMediaById: (...a: unknown[]) => api.getMediaById(...a),
  getMediaByIds: (...a: unknown[]) => api.getMediaByIds(...a),
  fetchMedia: vi.fn(),
  bulkDeleteMedia: vi.fn(),
  deleteMedia: vi.fn(),
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

import { useMediaResolver } from "@admin/hooks/queries/useMedia";

let client: QueryClient;
function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const item = (id: string) => ({ id, filename: `${id}.png`, url: `/u/${id}` });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${String(i)}`);

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.getMediaByIds.mockImplementation(async (asked: readonly string[]) =>
    asked.filter(id => id !== "gone").map(item)
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function resolver() {
  return renderHook(() => useMediaResolver(), { wrapper: Wrapper }).result
    .current;
}

describe("the media read a drawn page resolves its images with", () => {
  it.each([1, 16])(
    "reads %i images asked for together in one request",
    async count => {
      const read = resolver();
      const asked = ids(count);
      const answers = await Promise.all(asked.map(id => read(id)));

      expect(api.getMediaByIds).toHaveBeenCalledTimes(1);
      expect(api.getMediaByIds).toHaveBeenCalledWith(asked);
      expect(api.getMediaById).not.toHaveBeenCalled();
      expect(answers.map(answer => answer?.id)).toEqual(asked);
    }
  );

  it("answers an image it could not read with nothing, and the rest with theirs", async () => {
    const read = resolver();
    const [found, gone] = await Promise.all([read("m1"), read("gone")]);
    expect(found?.id).toBe("m1");
    expect(gone).toBeNull();
  });

  it("asks nothing again after a minute, or when the same image is drawn again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const read = resolver();
    await Promise.all(ids(3).map(id => read(id)));
    expect(api.getMediaByIds).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const again = await Promise.all(ids(3).map(id => read(id)));

    expect(api.getMediaByIds).toHaveBeenCalledTimes(1);
    expect(again.map(answer => answer?.id)).toEqual(ids(3));
  });

  it("reads again, in one request, once the library invalidates media", async () => {
    const read = resolver();
    await Promise.all(ids(4).map(id => read(id)));
    await client.invalidateQueries({ queryKey: ["media"] });
    await Promise.all(ids(4).map(id => read(id)));

    expect(api.getMediaByIds).toHaveBeenCalledTimes(2);
    expect(api.getMediaByIds).toHaveBeenLastCalledWith(ids(4));
  });

  it("answers an id the read cannot name with nothing on its own, and still reads the rest", async () => {
    const read = resolver();
    const tooLong = "x".repeat(65);
    const [first, long, comma, last] = await Promise.all([
      read("m1"),
      read(tooLong),
      read("a,b"),
      read("m2"),
    ]);
    expect([first?.id, long, comma, last?.id]).toEqual([
      "m1",
      null,
      null,
      "m2",
    ]);
    expect(api.getMediaByIds).toHaveBeenCalledTimes(1);
    expect(api.getMediaByIds).toHaveBeenCalledWith(["m1", "m2"]);
  });

  it("answers every image with nothing when the read fails, so the page still draws", async () => {
    api.getMediaByIds.mockRejectedValue(new Error("offline"));
    const read = resolver();
    await expect(Promise.all([read("a"), read("b")])).resolves.toEqual([
      null,
      null,
    ]);
  });
});
