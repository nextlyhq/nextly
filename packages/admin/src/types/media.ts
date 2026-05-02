/**
 * Media Library Types
 *
 * Type definitions for the Media Library feature.
 * These types align with the database schema defined in the research phase.
 */

/**
 * Media type enum (backend/API types)
 *
 * Represents actual media file types stored in the database.
 * Does not include "all" - that's a UI-only filter option.
 */
export type MediaType = "image" | "video" | "document" | "audio" | "other";

/**
 * Media type filter (UI filter types)
 *
 * Extends MediaType with "all" option for UI filter dropdowns.
 * Use this type for UI state, MediaType for API params.
 */
export type MediaTypeFilter = "all" | MediaType;

/**
 * Media item interface
 *
 * Represents a single media file in the library.
 *
 * @example
 * ```tsx
 * const media: Media = {
 *   id: "1",
 *   filename: "logo.png",
 *   originalFilename: "company-logo.png",
 *   mimeType: "image/png",
 *   size: 245760,
 *   width: 1200,
 *   height: 630,
 *   url: "/uploads/logo.png",
 *   thumbnailUrl: "/uploads/thumbnails/logo.png",
 *   altText: "Company logo",
 *   tags: ["logo", "branding"],
 *   uploadedBy: "user-1",
 *   uploadedAt: new Date("2025-01-15T10:30:00Z"),
 *   updatedAt: new Date("2025-01-15T10:30:00Z"),
 * };
 * ```
 */
/**
 * Metadata for a single generated image size variant.
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

export interface Media {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number; // Size in bytes
  width?: number | null; // Image/video width in pixels
  height?: number | null; // Image/video height in pixels
  duration?: number | null; // Video/audio duration in seconds
  url: string;
  thumbnailUrl?: string | null;
  focalX?: number | null; // Crop point X (0-100, percentage from left)
  focalY?: number | null; // Crop point Y (0-100, percentage from top)
  sizes?: Record<string, ImageSizeVariant> | null; // Generated image size variants
  altText?: string | null;
  caption?: string | null;
  tags?: string[] | null;
  folderId?: string | null;
  // Nullable: CLI seeds and other system-context uploads have no user.
  uploadedBy: string | null;
  uploadedAt: Date;
  updatedAt: Date;
}

/**
 * Media folder interface
 *
 * Represents a folder for organizing media files.
 */
export interface MediaFolder {
  id: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create folder input
 */
export interface CreateFolderInput {
  name: string;
  description?: string;
  parentId?: string; // Parent folder ID (null = root)
}

/**
 * Update folder input
 */
export interface UpdateFolderInput {
  name?: string;
  description?: string;
  parentId?: string;
}

/**
 * Folder list response
 */
export interface FolderListResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: MediaFolder[];
}

/**
 * Folder response (single folder with breadcrumbs)
 */
export interface FolderResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: MediaFolder & {
    breadcrumbs: Array<{ id: string; name: string }>;
  };
}

/**
 * Folder contents response
 */
export interface FolderContentsResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: {
    folder: MediaFolder | null; // null for root
    subfolders: MediaFolder[];
    mediaFiles: Media[];
    breadcrumbs: Array<{ id: string; name: string }>;
  };
}

/**
 * Media filter parameters
 *
 * Used for filtering and searching media items.
 *
 * @example
 * ```tsx
 * const params: MediaParams = {
 *   page: 1,
 *   limit: 24,
 *   search: "logo",
 *   type: "image",
 *   sortBy: "uploadedAt",
 *   sortOrder: "desc",
 * };
 * ```
 */
export interface MediaParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: MediaType;
  sortBy?: "filename" | "uploadedAt" | "size";
  sortOrder?: "asc" | "desc";
  folderId?: string | null;
}

/**
 * Media list response
 *
 * Response format for paginated media list queries.
 * Matches the backend API response structure from nextly.
 */
export interface MediaListResponse {
  success: boolean;
  statusCode: number;
  message: string;
  data: Media[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Upload progress tracking
 *
 * Used for tracking multi-file upload progress.
 *
 * @example
 * ```tsx
 * const progress: UploadProgress = {
 *   file: new File(["content"], "logo.png", { type: "image/png" }),
 *   filename: "logo.png",
 *   status: "uploading",
 *   progress: 45,
 * };
 * ```
 */
export interface UploadProgress {
  file: File;
  filename: string;
  status: "pending" | "uploading" | "success" | "error";
  progress?: number; // 0-100
  error?: string;
  mediaId?: string; // Set on success
}

/**
 * File with preview (for react-dropzone)
 *
 * Extends File with preview URL for displaying thumbnails during upload.
 */
export interface FileWithPreview extends File {
  preview?: string;
}

/**
 * Media update input
 *
 * Data for updating media metadata.
 */
export interface MediaUpdateInput {
  filename?: string;
  altText?: string;
  caption?: string;
  tags?: string[];
  folderId?: string | null;
  focalX?: number;
  focalY?: number;
}
