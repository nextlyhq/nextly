/**
 * Image Processor
 *
 * Uses Sharp for high-performance image processing:
 * - Extract metadata (width, height, format)
 * - Generate the admin thumbnail (the whole image fitted inside 480x480)
 * - Optimize images (compression, WebP conversion)
 *
 * Sharp is 4-5x faster than ImageMagick/GraphicsMagick
 *
 * NOTE: Sharp is lazy-loaded to work with Next.js serverExternalPackages
 */

import type { default as SharpDefault } from "sharp";

import { isAnimatedPng } from "./animated-png";
import { loadSharp } from "./sharp-loader";
import type { ImageMetadata, ProcessedImage } from "./types";

type SharpModule = typeof SharpDefault;

/**
 * Whether a buffer is an image, or whether this install could not tell.
 *
 * `unknown` exists because "no image processing here" and "not an image" have
 * different remedies and only one of them is the uploader's problem.
 */
export type ImageValidity = "valid" | "invalid" | "unknown";

/**
 * Whether a validity finding is grounds to REFUSE an upload.
 *
 * Extracted from the upload path so the decision has one home and can be
 * tested on its own. It is the decision that produced the defect this three
 * state type exists for: only a positive "invalid" is a statement about the
 * file. "unknown" means this install has no image processing, which says
 * nothing about what was uploaded, and the magic-byte gate has already run.
 */
export function refusesUpload(validity: ImageValidity): boolean {
  return validity === "invalid";
}

/**
 * Dependencies an ImageProcessor may be built with.
 *
 * `loader` is injected so a test can model an install without sharp without
 * touching the filesystem. Production constructs the class with no argument
 * and it reaches the shared loader.
 */
export interface ImageProcessorDeps {
  loader?: () => Promise<SharpModule | null>;
  /**
   * The most pixels an original may have for a resized copy to be made of
   * it. Injected so a test can reach the limit with a small image.
   */
  copyPixelLimit?: number;
}

/** The square, in pixels, the admin thumbnail is fitted inside. */
const THUMBNAIL_BOX = 480;

/**
 * The most pixels an original may have for a copy to be made of it: 50
 * million, past a full-frame camera's 45. A copy is made while a visitor
 * waits, and decoding takes about four bytes a pixel, so the limit is what
 * keeps one request from taking hundreds of megabytes. Lower than sharp's own
 * default of about 268 million, which is set for batch work.
 */
const COPY_PIXEL_LIMIT = 50_000_000;

/** A format a resized copy is written in. */
export type ImageCopyFormat = "avif" | "webp" | "jpeg" | "png";

/**
 * What asking for a resized copy came to: the copy's bytes; `unavailable`
 * when this install has no image processing; `refused` when the original
 * could not be read as an image within the pixel limit.
 */
export type ImageCopyResult =
  | { kind: "made"; bytes: Buffer }
  | { kind: "unavailable" }
  | { kind: "refused" };

export class ImageProcessor {
  constructor(private readonly deps: ImageProcessorDeps = {}) {}

  /** The library, or null when this install does not have it. */
  private sharp(): Promise<SharpModule | null> {
    return (this.deps.loader ?? loadSharp)();
  }

  /**
   * Whether this install can process images at all.
   *
   * Exposed so a caller can decide BEFORE doing work, and so the admin can say
   * what is missing once rather than letting each operation fail separately.
   */
  async canProcess(): Promise<boolean> {
    // DERIVED from the same loader every operation uses, rather than asking
    // resolution a second time. A separate synchronous probe answers a
    // different question from the one the work depends on -- an injected or
    // shimmed loader can yield nothing while resolution succeeds, and the two
    // would disagree silently.
    return (await this.sharp()) !== null;
  }

  /**
   * Get image metadata without loading full image
   */
  async getMetadata(buffer: Buffer): Promise<ImageMetadata | null> {
    const sharp = await this.sharp();
    // No processing available on this install: the file is still stored, it
    // simply has no derived data. Callers read null as "not generated", never
    // as a failure, so an upload proceeds without it.
    if (!sharp) return null;
    const metadata = await sharp(buffer).metadata();

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || "unknown",
      size: buffer.length,
    };
  }

  /**
   * Generate the admin thumbnail: the whole image fitted inside a square of
   * `size` pixels (480 by default), keeping its proportions and never
   * enlarging it.
   *
   * Fitted rather than cropped, so a wide or tall picture keeps the edges a
   * person recognises it by. 480 stays sharp at twice the density of the
   * largest tile the admin draws (about 220 CSS pixels) and is still a small
   * file.
   */
  async generateThumbnail(
    buffer: Buffer,
    size: number = THUMBNAIL_BOX
  ): Promise<ProcessedImage | null> {
    const sharp = await this.sharp();
    // No processing available on this install: the file is still stored, it
    // simply has no derived data. Callers read null as "not generated", never
    // as a failure, so an upload proceeds without it.
    if (!sharp) return null;
    const processed = await sharp(buffer)
      .resize(size, size, {
        fit: "inside",
        withoutEnlargement: true,
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
  ): Promise<ProcessedImage | null> {
    const sharp = await this.sharp();
    // No processing available on this install: the file is still stored, it
    // simply has no derived data. Callers read null as "not generated", never
    // as a failure, so an upload proceeds without it.
    if (!sharp) return null;
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
   * A copy of an image at `width` CSS pixels wide, in `format`.
   *
   * Turned upright first, as its camera recorded it, because the copy carries
   * no orientation for a browser to apply. Never enlarged: an original
   * narrower than `width` keeps its own width, since a larger copy would be
   * more bytes with no more detail. Metadata is not carried over, so a
   * photo's location never reaches a copy.
   *
   * An original past the pixel limit, an animated one, or bytes that are not
   * an image, are `refused` rather than thrown: the caller answers with the
   * original instead, and a bad file must not take the request down.
   *
   * @experimental
   */
  async copyAtWidth(
    buffer: Buffer,
    width: number,
    format: ImageCopyFormat
  ): Promise<ImageCopyResult> {
    const sharp = await this.sharp();
    if (!sharp) return { kind: "unavailable" };
    try {
      const limits = {
        limitInputPixels: this.deps.copyPixelLimit ?? COPY_PIXEL_LIMIT,
      };
      // An animated original (WebP or PNG with several frames) would come out
      // as its first frame alone, so it is sent as it is instead. The library
      // counts an animated WebP's frames but reads an APNG as one, so an APNG
      // is told by its own animation chunk.
      if (
        isAnimatedPng(buffer) ||
        ((await sharp(buffer, limits).metadata()).pages ?? 1) > 1
      ) {
        return { kind: "refused" };
      }
      const resized = sharp(buffer, limits)
        .rotate()
        .resize({ width, withoutEnlargement: true });
      const encoded =
        format === "avif"
          ? // A low effort: the copy is made while someone waits, and the
            // higher efforts cost several times the time for a few percent.
            resized.avif({ quality: 50, effort: 2 })
          : format === "webp"
            ? resized.webp({ quality: 75, effort: 4 })
            : format === "jpeg"
              ? resized.jpeg({ quality: 80, progressive: true, mozjpeg: true })
              : resized.png({ compressionLevel: 9 });
      return { kind: "made", bytes: await encoded.toBuffer() };
    } catch {
      return { kind: "refused" };
    }
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
  ): Promise<ProcessedImage | null> {
    const sharp = await this.sharp();
    // No processing available on this install: the file is still stored, it
    // simply has no derived data. Callers read null as "not generated", never
    // as a failure, so an upload proceeds without it.
    if (!sharp) return null;
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
   * Check if buffer is a valid image
   */
  async isValidImage(buffer: Buffer): Promise<ImageValidity> {
    const sharp = await this.sharp();
    // THREE states, not two. `catch { return false }` reported "not an image"
    // when the library was merely absent, and the upload route turns that into
    // a 400 blaming the user's file. "unknown" says the check did not run,
    // which is not grounds to refuse an upload the magic-byte gate passed.
    if (!sharp) return "unknown";

    try {
      await sharp(buffer).metadata();
      return "valid";
    } catch {
      return "invalid";
    }
  }

  /**
   * Get image dimensions quickly (without full processing)
   */
  async getDimensions(
    buffer: Buffer
  ): Promise<{ width: number; height: number } | null> {
    try {
      const sharp = await this.sharp();
      // No processing available on this install: the file is still stored, it
      // simply has no derived data. Callers read null as "not generated", never
      // as a failure, so an upload proceeds without it.
      if (!sharp) return null;
      const metadata = await sharp(buffer).metadata();
      // As the picture is shown, upright: a photo whose camera recorded it
      // turned a quarter (EXIF orientation 5 to 8) is stored on its side, and
      // every browser, resized copy and layout reads it turned back.
      const shown = metadata.autoOrient ?? metadata;
      if (shown.width && shown.height) {
        return { width: shown.width, height: shown.height };
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
