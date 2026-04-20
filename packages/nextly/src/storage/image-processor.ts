/**
 * Image Processor
 *
 * Uses Sharp for high-performance image processing:
 * - Extract metadata (width, height, format)
 * - Generate thumbnails (300x300, cropped to center)
 * - Optimize images (compression, WebP conversion)
 *
 * Sharp is 4-5x faster than ImageMagick/GraphicsMagick
 *
 * NOTE: Sharp is lazy-loaded to work with Next.js serverExternalPackages
 */

import type { ImageMetadata, ProcessedImage } from "./types";

// Lazy-load sharp to avoid Next.js module resolution issues
let sharpModule: typeof import("sharp") | null = null;
async function getSharp() {
  if (!sharpModule) {
    sharpModule = (await import("sharp")).default;
  }
  return sharpModule;
}

export class ImageProcessor {
  /**
   * Get image metadata without loading full image
   */
  async getMetadata(buffer: Buffer): Promise<ImageMetadata> {
    const sharp = await getSharp();
    const metadata = await sharp(buffer).metadata();

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || "unknown",
      size: buffer.length,
    };
  }

  /**
   * Generate thumbnail (300x300 by default, cropped to center)
   *
   * Uses "cover" fit to fill the entire 300x300 area while maintaining aspect ratio
   */
  async generateThumbnail(
    buffer: Buffer,
    size: number = 300
  ): Promise<ProcessedImage> {
    const sharp = await getSharp();
    const processed = await sharp(buffer)
      .resize(size, size, {
        fit: "cover", // Crop to fill entire area
        position: "center", // Crop from center
      })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: processed.data,
      metadata: {
        width: processed.info.width,
        height: processed.info.height,
        format: processed.info.format,
        size: processed.data.length,
      },
    };
  }

  /**
   * Optimize image (compress, convert to WebP if beneficial)
   *
   * Strategy:
   * - Small images (<100KB) and already WebP: return as-is
   * - Otherwise: convert to WebP with quality 80
   */
  async optimize(
    buffer: Buffer,
    quality: number = 80
  ): Promise<ProcessedImage> {
    const sharp = await getSharp();
    const metadata = await sharp(buffer).metadata();

    // If already small and WebP, return as-is
    if (buffer.length < 100 * 1024 && metadata.format === "webp") {
      return {
        buffer,
        metadata: {
          width: metadata.width || 0,
          height: metadata.height || 0,
          format: metadata.format,
          size: buffer.length,
        },
      };
    }

    // Optimize and convert to WebP
    const processed = await sharp(buffer)
      .webp({ quality, effort: 4 }) // effort: 4 is good balance of speed/compression
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: processed.data,
      metadata: {
        width: processed.info.width,
        height: processed.info.height,
        format: "webp",
        size: processed.data.length,
      },
    };
  }

  /**
   * Resize image to specific dimensions
   *
   * @param maxWidth Maximum width (maintains aspect ratio)
   * @param maxHeight Maximum height (maintains aspect ratio)
   */
  async resize(
    buffer: Buffer,
    maxWidth?: number,
    maxHeight?: number
  ): Promise<ProcessedImage> {
    const sharp = await getSharp();
    const processed = await sharp(buffer)
      .resize(maxWidth, maxHeight, {
        fit: "inside", // Fit within bounds, maintaining aspect ratio
        withoutEnlargement: true, // Don't upscale small images
      })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: processed.data,
      metadata: {
        width: processed.info.width,
        height: processed.info.height,
        format: processed.info.format,
        size: processed.data.length,
      },
    };
  }

  /**
   * Resize an image with focal point awareness and format conversion.
   *
   * When fit is 'cover' and a focal point is set, the crop anchors at that
   * point instead of center. Supports format conversion ('auto' outputs webp
   * for jpeg/png/tiff sources, keeps original for gif).
   */
  async resizeWithFocalPoint(
    buffer: Buffer,
    options: {
      width?: number;
      height?: number;
      fit: "cover" | "inside" | "contain" | "fill";
      quality?: number;
      format?: "auto" | "webp" | "jpeg" | "png" | "avif";
      focalX?: number; // 0-100, percentage from left
      focalY?: number; // 0-100, percentage from top
    }
  ): Promise<{
    buffer: Buffer;
    width: number;
    height: number;
    format: string;
    size: number;
  }> {
    const sharp = await getSharp();
    const quality = options.quality ?? 80;

    // Get original metadata to determine output format
    const metadata = await sharp(buffer).metadata();
    const originalFormat = metadata.format || "jpeg";

    // Determine output format
    // 'auto' converts to webp for jpeg/png/tiff, keeps gif (to preserve animation)
    let outputFormat: string = originalFormat;
    if (options.format && options.format !== "auto") {
      outputFormat = options.format;
    } else if (options.format === "auto") {
      const convertibleFormats = ["jpeg", "png", "tiff", "jpg"];
      if (convertibleFormats.includes(originalFormat)) {
        outputFormat = "webp";
      }
    }

    // Build the Sharp pipeline
    let pipeline = sharp(buffer);

    // For 'cover' fit with a focal point, use extract() to crop around
    // the focal point at the target aspect ratio, then resize to exact dimensions.
    // Sharp's resize({ position }) only accepts gravity strings (e.g. "center", "north"),
    // not arbitrary percentage values.
    const hasFocalPoint =
      options.fit === "cover" &&
      (options.focalX !== undefined || options.focalY !== undefined) &&
      options.width &&
      options.height &&
      metadata.width &&
      metadata.height;

    if (hasFocalPoint) {
      const srcW = metadata.width!;
      const srcH = metadata.height!;
      const tgtW = options.width!;
      const tgtH = options.height!;
      const fx = (options.focalX ?? 50) / 100; // 0-1
      const fy = (options.focalY ?? 50) / 100; // 0-1

      // Calculate the largest crop region at the target aspect ratio
      const tgtAspect = tgtW / tgtH;
      let cropW: number;
      let cropH: number;
      if (srcW / srcH > tgtAspect) {
        // Source is wider: constrain by height
        cropH = srcH;
        cropW = Math.round(srcH * tgtAspect);
      } else {
        // Source is taller: constrain by width
        cropW = srcW;
        cropH = Math.round(srcW / tgtAspect);
      }

      // Center the crop region on the focal point, clamped to image bounds
      let left = Math.round(fx * srcW - cropW / 2);
      let top = Math.round(fy * srcH - cropH / 2);
      left = Math.max(0, Math.min(srcW - cropW, left));
      top = Math.max(0, Math.min(srcH - cropH, top));

      pipeline = pipeline
        .extract({ left, top, width: cropW, height: cropH })
        .resize(tgtW, tgtH, { fit: "fill" });
    } else {
      // Standard resize without focal-point-aware cropping
      pipeline = pipeline.resize(
        options.width || undefined,
        options.height || undefined,
        {
          fit: options.fit,
          position: "center",
          withoutEnlargement: true,
        }
      );
    }

    // Apply format conversion with quality
    switch (outputFormat) {
      case "webp":
        pipeline = pipeline.webp({ quality, effort: 4 });
        break;
      case "jpeg":
      case "jpg":
        pipeline = pipeline.jpeg({ quality, progressive: true });
        outputFormat = "jpeg";
        break;
      case "png":
        pipeline = pipeline.png({ quality });
        break;
      case "avif":
        pipeline = pipeline.avif({ quality });
        break;
      default:
        // Keep original format
        break;
    }

    const result = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      buffer: result.data,
      width: result.info.width,
      height: result.info.height,
      format: outputFormat,
      size: result.data.length,
    };
  }

  /**
   * Check if buffer is a valid image
   */
  async isValidImage(buffer: Buffer): Promise<boolean> {
    try {
      const sharp = await getSharp();
      await sharp(buffer).metadata();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get image dimensions quickly (without full processing)
   */
  async getDimensions(
    buffer: Buffer
  ): Promise<{ width: number; height: number } | null> {
    try {
      const sharp = await getSharp();
      const metadata = await sharp(buffer).metadata();
      if (metadata.width && metadata.height) {
        return { width: metadata.width, height: metadata.height };
      }
      return null;
    } catch {
      return null;
    }
  }
}

// Singleton instance
let processorInstance: ImageProcessor | null = null;

/**
 * Get singleton ImageProcessor instance
 */
export function getImageProcessor(): ImageProcessor {
  if (!processorInstance) {
    processorInstance = new ImageProcessor();
  }
  return processorInstance;
}

/**
 * Reset processor singleton (for testing)
 */
export function resetImageProcessor(): void {
  processorInstance = null;
}
