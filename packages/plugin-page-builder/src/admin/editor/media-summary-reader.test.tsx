// @vitest-environment jsdom

/**
 * How the inspector's image fields read a stored media id: through the
 * admin's media read, as the canvas does, giving the file's name, a picture
 * of it and its alt text.
 *
 * @module media-summary-reader.test
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const readMedia = vi.fn<(id: string) => Promise<unknown>>();
const searchMedia =
  vi.fn<(search: string, signal?: AbortSignal) => Promise<unknown[]>>();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useMediaResolver: () => readMedia,
  useMediaSearcher: () => searchMedia,
}));

const { useMediaSearchReader, useMediaSummaryReader } = await import(
  "./media-summary-reader"
);

describe("the inspector's media read", () => {
  it("names the file as uploaded, pictures it by its thumbnail, and gives its alt text", async () => {
    readMedia.mockResolvedValue({
      id: "m1",
      url: "/uploads/hero-1600.jpg",
      thumbnailUrl: "/uploads/hero-thumb.jpg",
      filename: "hero-1600.jpg",
      originalFilename: "Hero shot.jpg",
      altText: "The hero",
    });
    const { result } = renderHook(() => useMediaSummaryReader());
    await expect(result.current("m1")).resolves.toEqual({
      name: "Hero shot.jpg",
      thumbnail: "/uploads/hero-thumb.jpg",
      alt: "The hero",
    });
    expect(readMedia).toHaveBeenCalledWith("m1");
  });

  it("falls back to the stored name and the file itself, and leaves out empty alt text", async () => {
    readMedia.mockResolvedValue({
      id: "m2",
      url: "/uploads/team.jpg",
      thumbnailUrl: null,
      filename: "team.jpg",
      mimeType: "image/jpeg",
      altText: "",
    });
    const { result } = renderHook(() => useMediaSummaryReader());
    await expect(result.current("m2")).resolves.toEqual({
      name: "team.jpg",
      thumbnail: "/uploads/team.jpg",
    });
  });

  it("pictures a file only when it is an image, still naming any file", async () => {
    // A PDF's own address drawn as an <img> is a broken picture.
    readMedia.mockResolvedValue({
      id: "m3",
      url: "/uploads/brochure.pdf",
      thumbnailUrl: null,
      filename: "brochure.pdf",
      mimeType: "application/pdf",
    });
    const { result } = renderHook(() => useMediaSummaryReader());
    await expect(result.current("m3")).resolves.toEqual({
      name: "brochure.pdf",
    });
  });

  it("answers nothing for an item the read cannot find", async () => {
    readMedia.mockResolvedValue(null);
    const { result } = renderHook(() => useMediaSummaryReader());
    await expect(result.current("gone")).resolves.toBeNull();
  });
});

describe("the Fallback picker's library search", () => {
  it("sums up each image found as a stored one is, keyed by its id", async () => {
    searchMedia.mockResolvedValue([
      {
        id: "m1",
        url: "/uploads/spring-1600.jpg",
        thumbnailUrl: "/uploads/spring-thumb.jpg",
        filename: "spring-1600.jpg",
        originalFilename: "spring-banner.jpg",
        altText: "Spring sale",
        mimeType: "image/jpeg",
      },
      {
        id: "m2",
        url: "/uploads/team.jpg",
        thumbnailUrl: null,
        filename: "team.jpg",
        mimeType: "image/jpeg",
        altText: "",
      },
    ]);
    const { result } = renderHook(() => useMediaSearchReader());
    const signal = new AbortController().signal;
    await expect(result.current("spring", signal)).resolves.toEqual([
      {
        id: "m1",
        name: "spring-banner.jpg",
        thumbnail: "/uploads/spring-thumb.jpg",
        alt: "Spring sale",
      },
      { id: "m2", name: "team.jpg", thumbnail: "/uploads/team.jpg" },
    ]);
    // The search and its signal handed on as given, so a newer search can
    // abort this one.
    expect(searchMedia).toHaveBeenCalledWith("spring", signal);
  });

  it("rejects where the library cannot be read, rather than finding none", async () => {
    searchMedia.mockRejectedValue(new Error("Forbidden"));
    const { result } = renderHook(() => useMediaSearchReader());
    await expect(result.current("")).rejects.toThrow("Forbidden");
  });
});
