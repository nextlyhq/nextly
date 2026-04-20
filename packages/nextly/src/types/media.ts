/**
 * Media Types and Schemas
 *
 * Type-safe definitions for media management with Zod validation
 */

import { z } from "zod";

// ========================================
// MEDIA TYPE ENUM
// ========================================

export const MediaTypeSchema = z.enum([
  "image",
  "video",
  "audio",
  "document",
  "other",
]);

export type MediaType = z.infer<typeof MediaTypeSchema>;

// ========================================
// IMAGE SIZE VARIANT
// ========================================

/**
 * Metadata for a single generated image size variant.
 * Stored in the media.sizes JSONB field, keyed by size name.
 */
export interface ImageSizeVariant {
  url: string;
  path: string;
  width: number;
  height: number;
  filesize: number;
  mimeType: string;
  filename: string;
}

export const ImageSizeVariantSchema = z.object({
  url: z.string(),
  path: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  filesize: z.number().int().positive(),
  mimeType: z.string(),
  filename: z.string(),
});

// ========================================
// MEDIA RECORD SCHEMA
// ========================================

export const MediaSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  size: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  duration: z.number().int().positive().nullable(),
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  focalX: z.number().int().min(0).max(100).nullable().optional(),
  focalY: z.number().int().min(0).max(100).nullable().optional(),
  sizes: z.record(z.string(), ImageSizeVariantSchema).nullable().optional(),
  altText: z.string().nullable(),
  caption: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  folderId: z.string().nullable().optional(),
  uploadedBy: z.string().nullable(),
  uploadedAt: z.date(),
  updatedAt: z.date(),
});

export type Media = z.infer<typeof MediaSchema>;

// ========================================
// INPUT SCHEMAS (VALIDATION)
// ========================================

export const UploadMediaInputSchema = z.object({
  file: z.instanceof(Buffer),
  filename: z.string().min(1, "Filename is required"),
  mimeType: z.string().min(1, "MIME type is required"),
  size: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, "File too large (max 10MB)"),
  // Nullable: CLI seeds, data imports, and other system-context uploads
  // may not have a user to attribute the upload to.
  uploadedBy: z.string().uuid("Invalid user ID").nullable(),
  folderId: z.string().uuid("Invalid folder ID").optional(),
});

export type UploadMediaInput = z.infer<typeof UploadMediaInputSchema>;

export const UpdateMediaInputSchema = z.object({
  altText: z.string().optional(),
  caption: z.string().optional(),
  tags: z.array(z.string()).optional(),
  focalX: z.number().int().min(0).max(100).optional(),
  focalY: z.number().int().min(0).max(100).optional(),
});

export type UpdateMediaInput = z.infer<typeof UpdateMediaInputSchema>;

// ========================================
// QUERY PARAMETERS SCHEMA
// ========================================

export const MediaParamsSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(24),
  search: z.string().optional(),
  type: MediaTypeSchema.optional(),
  folderId: z.string().optional(), // Filter by folder (null = root, string = folder ID)
  sortBy: z.enum(["filename", "uploadedAt", "size"]).default("uploadedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type MediaParams = z.infer<typeof MediaParamsSchema>;

// ========================================
// SERVICE RESPONSE TYPES
// ========================================

export interface MediaListResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: Media[] | null;
  meta?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface MediaResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: Media | null;
}

export interface DeleteMediaResponse {
  success: boolean;
  statusCode: number;
  message: string;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get media type from MIME type
 */
export function getMediaTypeFromMime(mimeType: string): MediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("text") ||
    mimeType.includes("word") ||
    mimeType.includes("sheet") ||
    mimeType.includes("presentation")
  ) {
    return "document";
  }
  return "other";
}

/**
 * Check if MIME type is an image
 */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/**
 * Check if MIME type is a video
 */
export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

/**
 * Validate file size (in bytes)
 */
export function validateFileSize(
  size: number,
  maxSize: number = 10 * 1024 * 1024
): { valid: boolean; error?: string } {
  if (size <= 0) {
    return { valid: false, error: "File size must be greater than 0" };
  }
  if (size > maxSize) {
    const maxMB = Math.round(maxSize / (1024 * 1024));
    return { valid: false, error: `File too large (max ${maxMB}MB)` };
  }
  return { valid: true };
}

/**
 * Format file size for display (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
