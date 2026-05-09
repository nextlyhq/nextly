/**
 * Image Size Generation Pipeline
 *
 * Generates named image size variants for uploaded images.
 * Uses Sharp (via ImageProcessor) for resizing and format conversion.
 * Each variant is uploaded to the same storage adapter as the original.
 */

import type { ImageSizeVariant } from "../types/media";

import { getImageProcessor } from "./image-processor";
import type { UploadResult } from "./types";

// ============================================================
// Types
// ============================================================

/**
 * Configuration for a single image size.
 * Matches the image_sizes DB table structure.
 */
export interface ImageSizeConfig {
  name: string;
  width?: number | null;
  height?: number | null;
  fit: "cover" | "inside" | "contain" | "fill";
  quality: number;
  format: "auto" | "webp" | "jpeg" | "png" | "avif";
}

/**
 * Options for generating image sizes.
 */
export interface GenerateImageSizesOptions {
  /** Focal point X (0-100, percentage from left) */
  focalX?: number | null;
  /** Focal point Y (0-100, percentage from top) */
  focalY?: number | null;
  /** Collection slug for storage routing */
  collection?: string;
  /** Storage folder/prefix */
  folder?: string;
}

/**
 * Function signature for uploading a buffer to storage.
 * Passed in to decouple from MediaStorage singleton.
 */
export type UploadFn = (
  buffer: Buffer,
  options: {
    filename: string;
    mimeType: string;
    folder?: string;
    collection?: string;
  }
) => Promise<UploadResult>;

// ============================================================
// Format Helpers
// ============================================================

/** Get file extension for a format */
function getExtensionForFormat(format: string): string {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "jpg";
    case "webp":
      return "webp";
    case "png":
      return "png";
    case "avif":
      return "avif";
    default:
      return format;
  }
}

/** Get MIME type for a format */
function getMimeTypeForFormat(format: string): string {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    case "avif":
      return "image/avif";
    default:
      return `image/${format}`;
  }
}

/**
 * Build the variant filename from the original filename and size name.
 * Example: "abc-photo.jpg" + "thumbnail" → "abc-photo-thumbnail.webp"
 */
function buildVariantFilename(
  originalFilename: string,
  sizeName: string,
  format: string
): string {
  // Remove the extension from the original
  const lastDot = originalFilename.lastIndexOf(".");
  const baseName =
    lastDot > 0 ? originalFilename.substring(0, lastDot) : originalFilename;
  const ext = getExtensionForFormat(format);
  return `${baseName}-${sizeName}.${ext}`;
}

// ============================================================
// Main Generation Function
// ============================================================

/**
 * Generate all configured image size variants for an uploaded image.
 *
 * For each size config:
 * 1. Resize/crop the original buffer using ImageProcessor
 * 2. Upload the variant via the provided upload function
 * 3. Collect metadata (url, path, width, height, filesize, mimeType, filename)
 *
 * @param originalBuffer - The original image file buffer
 * @param originalFilename - The original filename (used to derive variant filenames)
 * @param sizes - Array of image size configurations
 * @param uploadFn - Function to upload each variant to storage
 * @param options - Focal point and routing options
 * @returns Map of size name → variant metadata
 */
export async function generateImageSizes(
  originalBuffer: Buffer,
  originalFilename: string,
  sizes: ImageSizeConfig[],
  uploadFn: UploadFn,
  options: GenerateImageSizesOptions = {}
): Promise<Record<string, ImageSizeVariant>> {
  if (sizes.length === 0) return {};

  const processor = getImageProcessor();
  const results: Record<string, ImageSizeVariant> = {};

  // Process each size sequentially to avoid memory pressure from
  // multiple Sharp instances processing large images simultaneously
  for (const sizeConfig of sizes) {
    try {
      // Skip sizes that have no dimensions specified
      if (!sizeConfig.width && !sizeConfig.height) continue;

      // Resize with focal point awareness
      const resized = await processor.resizeWithFocalPoint(originalBuffer, {
        width: sizeConfig.width ?? undefined,
        height: sizeConfig.height ?? undefined,
        fit: sizeConfig.fit,
        quality: sizeConfig.quality,
        format: sizeConfig.format,
        focalX: options.focalX ?? undefined,
        focalY: options.focalY ?? undefined,
      });

      // Build the variant filename
      const variantFilename = buildVariantFilename(
        originalFilename,
        sizeConfig.name,
        resized.format
      );
      const mimeType = getMimeTypeForFormat(resized.format);

      // Upload the variant to storage
      const uploadResult = await uploadFn(resized.buffer, {
        filename: variantFilename,
        mimeType,
        folder: options.folder,
        collection: options.collection,
      });

      // Store the variant metadata
      results[sizeConfig.name] = {
        url: uploadResult.url,
        path: uploadResult.path,
        width: resized.width,
        height: resized.height,
        filesize: resized.size,
        mimeType,
        filename: variantFilename,
      };
    } catch (error) {
      // Log but don't fail the entire upload if one size generation fails
      console.warn(
        `[ImageSizes] Failed to generate size "${sizeConfig.name}":`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return results;
}

/**
 * Delete all size variants for a media item from storage.
 *
 * @param sizes - The sizes JSONB object from the media record
 * @param deleteFn - Function to delete a file by its storage path
 */
export async function deleteImageSizes(
  sizes: Record<string, ImageSizeVariant> | null | undefined,
  deleteFn: (path: string) => Promise<void>
): Promise<void> {
  if (!sizes) return;

  const paths = Object.values(sizes)
    .map(v => v.path)
    .filter(Boolean);

  // Delete in parallel
  await Promise.allSettled(paths.map(path => deleteFn(path)));
}
