/**
 * Image Size Generation Pipeline Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ImageSizeVariant } from "../../types/media";
import {
  generateImageSizes,
  deleteImageSizes,
  type ImageSizeConfig,
  type UploadFn,
} from "../image-sizes";

// Shared mock processor so tests can inspect calls
const mockResizeWithFocalPoint = vi.fn(
  async (_buffer: Buffer, options: any) => {
    const width = options.width ?? 100;
    const height = options.height ?? 100;
    const format =
      options.format === "auto" ? "webp" : (options.format ?? "jpeg");
    return {
      buffer: Buffer.from(`resized-${width}x${height}`),
      width,
      height,
      format,
      size: 1024 * (width / 100),
    };
  }
);

const mockProcessor = { resizeWithFocalPoint: mockResizeWithFocalPoint };

vi.mock("../image-processor", () => ({
  getImageProcessor: vi.fn(() => mockProcessor),
}));

describe("generateImageSizes", () => {
  let mockUploadFn: UploadFn;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock upload function that returns predictable URLs
    mockUploadFn = vi.fn(async (_buffer, options) => ({
      url: `/uploads/2026/04/${options.filename}`,
      path: `2026/04/${options.filename}`,
    }));
  });

  it("should generate variants for each configured size", async () => {
    const sizes: ImageSizeConfig[] = [
      {
        name: "thumbnail",
        width: 150,
        height: 150,
        fit: "cover",
        quality: 80,
        format: "webp",
      },
      {
        name: "medium",
        width: 768,
        height: null,
        fit: "inside",
        quality: 80,
        format: "auto",
      },
    ];

    const result = await generateImageSizes(
      Buffer.from("original-image"),
      "photo.jpg",
      sizes,
      mockUploadFn
    );

    expect(Object.keys(result)).toHaveLength(2);
    expect(result.thumbnail).toBeDefined();
    expect(result.medium).toBeDefined();
    expect(mockUploadFn).toHaveBeenCalledTimes(2);
  });

  it("should use size name as filename suffix", async () => {
    const sizes: ImageSizeConfig[] = [
      {
        name: "thumbnail",
        width: 150,
        height: 150,
        fit: "cover",
        quality: 80,
        format: "webp",
      },
    ];

    const result = await generateImageSizes(
      Buffer.from("test"),
      "vacation-photo.jpg",
      sizes,
      mockUploadFn
    );

    // Filename should be original-sizename.ext
    expect(result.thumbnail.filename).toBe("vacation-photo-thumbnail.webp");
  });

  it("should store correct metadata per variant", async () => {
    const sizes: ImageSizeConfig[] = [
      {
        name: "large",
        width: 1200,
        height: null,
        fit: "inside",
        quality: 80,
        format: "webp",
      },
    ];

    const result = await generateImageSizes(
      Buffer.from("test"),
      "photo.jpg",
      sizes,
      mockUploadFn
    );

    expect(result.large).toEqual({
      url: expect.stringContaining("photo-large.webp"),
      path: expect.stringContaining("photo-large.webp"),
      width: 1200,
      height: 100, // Mock returns height as-is when only width specified
      filesize: expect.any(Number),
      mimeType: "image/webp",
      filename: "photo-large.webp",
    });
  });

  it("should pass focal point to processor", async () => {
    mockResizeWithFocalPoint.mockClear();

    const sizes: ImageSizeConfig[] = [
      {
        name: "thumb",
        width: 200,
        height: 200,
        fit: "cover",
        quality: 80,
        format: "jpeg",
      },
    ];

    await generateImageSizes(
      Buffer.from("test"),
      "photo.jpg",
      sizes,
      mockUploadFn,
      { focalX: 75, focalY: 40 }
    );

    expect(mockResizeWithFocalPoint).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        focalX: 75,
        focalY: 40,
        fit: "cover",
      })
    );
  });

  it("should return empty object when no sizes configured", async () => {
    const result = await generateImageSizes(
      Buffer.from("test"),
      "photo.jpg",
      [],
      mockUploadFn
    );

    expect(result).toEqual({});
    expect(mockUploadFn).not.toHaveBeenCalled();
  });

  it("should skip sizes with no dimensions", async () => {
    const sizes: ImageSizeConfig[] = [
      {
        name: "empty",
        width: null,
        height: null,
        fit: "inside",
        quality: 80,
        format: "auto",
      },
      {
        name: "valid",
        width: 500,
        height: null,
        fit: "inside",
        quality: 80,
        format: "auto",
      },
    ];

    const result = await generateImageSizes(
      Buffer.from("test"),
      "photo.jpg",
      sizes,
      mockUploadFn
    );

    expect(Object.keys(result)).toHaveLength(1);
    expect(result.valid).toBeDefined();
    expect(result.empty).toBeUndefined();
  });

  it("should continue if one size fails", async () => {
    // Make upload fail for the first call, succeed for the second
    const failingUpload: UploadFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Upload failed"))
      .mockResolvedValueOnce({
        url: "/uploads/ok.webp",
        path: "ok.webp",
      }) as any;

    const sizes: ImageSizeConfig[] = [
      {
        name: "fail",
        width: 100,
        height: 100,
        fit: "cover",
        quality: 80,
        format: "webp",
      },
      {
        name: "succeed",
        width: 200,
        height: null,
        fit: "inside",
        quality: 80,
        format: "webp",
      },
    ];

    const result = await generateImageSizes(
      Buffer.from("test"),
      "photo.jpg",
      sizes,
      failingUpload
    );

    // First size fails, second succeeds
    expect(result.fail).toBeUndefined();
    expect(result.succeed).toBeDefined();
  });

  it("should handle format auto correctly", async () => {
    const sizes: ImageSizeConfig[] = [
      {
        name: "auto",
        width: 500,
        height: null,
        fit: "inside",
        quality: 80,
        format: "auto",
      },
    ];

    const result = await generateImageSizes(
      Buffer.from("test"),
      "photo.jpg",
      sizes,
      mockUploadFn
    );

    // 'auto' should convert to webp (mocked processor returns webp for auto)
    expect(result.auto.mimeType).toBe("image/webp");
    expect(result.auto.filename).toBe("photo-auto.webp");
  });
});

describe("deleteImageSizes", () => {
  it("should delete all variant paths", async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const sizes: Record<string, ImageSizeVariant> = {
      thumbnail: {
        url: "/uploads/thumb.webp",
        path: "2026/04/thumb.webp",
        width: 150,
        height: 150,
        filesize: 1024,
        mimeType: "image/webp",
        filename: "thumb.webp",
      },
      medium: {
        url: "/uploads/medium.webp",
        path: "2026/04/medium.webp",
        width: 768,
        height: 512,
        filesize: 4096,
        mimeType: "image/webp",
        filename: "medium.webp",
      },
    };

    await deleteImageSizes(sizes, mockDelete);

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith("2026/04/thumb.webp");
    expect(mockDelete).toHaveBeenCalledWith("2026/04/medium.webp");
  });

  it("should handle null/undefined sizes gracefully", async () => {
    const mockDelete = vi.fn();

    await deleteImageSizes(null, mockDelete);
    await deleteImageSizes(undefined, mockDelete);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("should continue if one delete fails", async () => {
    const mockDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error("Delete failed"))
      .mockResolvedValueOnce(undefined);

    const sizes: Record<string, ImageSizeVariant> = {
      a: {
        url: "",
        path: "a.webp",
        width: 1,
        height: 1,
        filesize: 1,
        mimeType: "",
        filename: "",
      },
      b: {
        url: "",
        path: "b.webp",
        width: 1,
        height: 1,
        filesize: 1,
        mimeType: "",
        filename: "",
      },
    };

    // Should not throw
    await expect(deleteImageSizes(sizes, mockDelete)).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });
});
