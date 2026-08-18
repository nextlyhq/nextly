import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  ImageProcessor,
  getImageProcessor,
  resetImageProcessor,
} from "../image-processor";

// Mock sharp module to work with dynamic imports
vi.mock("sharp", () => ({
  default: vi.fn(),
}));

/**
 * The result of an operation that now returns null when this install has no
 * image processing. Every test here mocks sharp, so a null is a real failure
 * rather than the degraded path, and asserting it here says so once.
 */
function nonNull<T>(value: T | null): T {
  if (value === null) throw new Error("expected a processed result, got null");
  return value;
}

describe("ImageProcessor", () => {
  let processor: ImageProcessor;
  let mockSharpFunction: any;

  beforeEach(async () => {
    processor = new ImageProcessor();
    vi.clearAllMocks();

    // Get the mocked sharp function
    const sharpModule = await import("sharp");
    mockSharpFunction = sharpModule.default;
  });

  describe("getMetadata", () => {
    it("should extract image metadata", async () => {
      const mockMetadata = {
        width: 1920,
        height: 1080,
        format: "jpeg",
      };

      mockSharpFunction.mockReturnValue({
        metadata: vi.fn().mockResolvedValue(mockMetadata),
      });

      const buffer = Buffer.from("fake image data");
      const result = await processor.getMetadata(buffer);

      expect(result).toEqual({
        width: 1920,
        height: 1080,
        format: "jpeg",
        size: buffer.length,
      });
    });

    it("should handle missing metadata gracefully", async () => {
      mockSharpFunction.mockReturnValue({
        metadata: vi.fn().mockResolvedValue({}),
      });

      const buffer = Buffer.from("fake image");
      const result = await processor.getMetadata(buffer);

      expect(nonNull(result).width).toBe(0);
      expect(nonNull(result).height).toBe(0);
      expect(nonNull(result).format).toBe("unknown");
    });
  });

  describe("generateThumbnail", () => {
    it("should generate 300x300 thumbnail by default", async () => {
      const mockProcessed = {
        data: Buffer.from("thumbnail data"),
        info: {
          width: 300,
          height: 300,
          format: "jpeg",
        },
      };

      const mockSharp = {
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(mockProcessed),
      };

      mockSharpFunction.mockReturnValue(mockSharp);

      const buffer = Buffer.from("original image");
      const result = await processor.generateThumbnail(buffer);

      expect(mockSharp.resize).toHaveBeenCalledWith(300, 300, {
        fit: "cover",
        position: "center",
      });
      expect(mockSharp.jpeg).toHaveBeenCalledWith({
        quality: 80,
        progressive: true,
      });
      expect(nonNull(result).buffer).toBe(mockProcessed.data);
      expect(nonNull(result).metadata.width).toBe(300);
      expect(nonNull(result).metadata.height).toBe(300);
    });

    it("should accept custom thumbnail size", async () => {
      const mockProcessed = {
        data: Buffer.from("thumbnail"),
        info: {
          width: 150,
          height: 150,
          format: "jpeg",
        },
      };

      const mockSharp = {
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(mockProcessed),
      };

      mockSharpFunction.mockReturnValue(mockSharp);

      await processor.generateThumbnail(Buffer.from("image"), 150);

      expect(mockSharp.resize).toHaveBeenCalledWith(
        150,
        150,
        expect.any(Object)
      );
    });
  });

  describe("optimize", () => {
    it("should convert to WebP with quality 80", async () => {
      const mockMetadata = { format: "jpeg" };
      const mockProcessed = {
        data: Buffer.from("optimized"),
        info: {
          width: 1920,
          height: 1080,
          format: "webp",
        },
      };

      const mockSharp = {
        metadata: vi.fn().mockResolvedValue(mockMetadata),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(mockProcessed),
      };

      mockSharpFunction.mockReturnValue(mockSharp);

      const buffer = Buffer.from("original");
      const result = await processor.optimize(buffer);

      expect(mockSharp.webp).toHaveBeenCalledWith({
        quality: 80,
        effort: 4,
      });
      expect(nonNull(result).metadata.format).toBe("webp");
    });

    it("should skip optimization for small WebP images", async () => {
      const smallBuffer = Buffer.alloc(50 * 1024); // 50KB
      const mockMetadata = { format: "webp", width: 800, height: 600 };

      const mockSharp = {
        metadata: vi.fn().mockResolvedValue(mockMetadata),
      };

      mockSharpFunction.mockReturnValue(mockSharp);

      const result = await processor.optimize(smallBuffer);

      expect(nonNull(result).buffer).toBe(smallBuffer);
      expect(nonNull(result).metadata.format).toBe("webp");
    });

    it("should accept custom quality parameter", async () => {
      const mockMetadata = { format: "jpeg" };
      const mockProcessed = {
        data: Buffer.from("optimized"),
        info: {
          width: 1920,
          height: 1080,
          format: "webp",
        },
      };

      const mockSharp = {
        metadata: vi.fn().mockResolvedValue(mockMetadata),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(mockProcessed),
      };

      mockSharpFunction.mockReturnValue(mockSharp);

      await processor.optimize(Buffer.from("image"), 90);

      expect(mockSharp.webp).toHaveBeenCalledWith({
        quality: 90,
        effort: 4,
      });
    });
  });

  describe("resize", () => {
    it("should resize image to fit within dimensions", async () => {
      const mockProcessed = {
        data: Buffer.from("resized"),
        info: {
          width: 800,
          height: 600,
          format: "jpeg",
        },
      };

      const mockSharp = {
        resize: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockResolvedValue(mockProcessed),
      };

      mockSharpFunction.mockReturnValue(mockSharp);

      const result = await processor.resize(Buffer.from("image"), 800, 600);

      expect(mockSharp.resize).toHaveBeenCalledWith(800, 600, {
        fit: "inside",
        withoutEnlargement: true,
      });
      expect(nonNull(result).metadata.width).toBe(800);
      expect(nonNull(result).metadata.height).toBe(600);
    });
  });

  describe("isValidImage", () => {
    it("reports 'valid' for an image the library reads", async () => {
      mockSharpFunction.mockReturnValue({
        metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
      });

      const validity = await processor.isValidImage(Buffer.from("valid image"));

      expect(validity).toBe("valid");
    });

    it("reports 'invalid' when the library REFUSES the buffer", async () => {
      mockSharpFunction.mockReturnValue({
        metadata: vi.fn().mockRejectedValue(new Error("Invalid image")),
      });

      const validity = await processor.isValidImage(
        Buffer.from("not an image")
      );

      // "invalid" rather than "unknown": the library ran and rejected it,
      // which is a verdict about the FILE and the only case that may refuse
      // an upload.
      expect(validity).toBe("invalid");
    });
  });

  describe("getDimensions", () => {
    it("should extract width and height", async () => {
      mockSharpFunction.mockReturnValue({
        metadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
      });

      const dimensions = await processor.getDimensions(Buffer.from("image"));

      expect(dimensions).toEqual({ width: 1920, height: 1080 });
    });

    it("should return null for images without dimensions", async () => {
      mockSharpFunction.mockReturnValue({
        metadata: vi.fn().mockResolvedValue({}),
      });

      const dimensions = await processor.getDimensions(Buffer.from("image"));

      expect(dimensions).toBeNull();
    });

    it("should return null on error", async () => {
      mockSharpFunction.mockReturnValue({
        metadata: vi.fn().mockRejectedValue(new Error("Failed")),
      });

      const dimensions = await processor.getDimensions(Buffer.from("invalid"));

      expect(dimensions).toBeNull();
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance on multiple calls", () => {
      const instance1 = getImageProcessor();
      const instance2 = getImageProcessor();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getImageProcessor();
      resetImageProcessor();
      const instance2 = getImageProcessor();

      expect(instance1).not.toBe(instance2);
    });
  });
});
