/**
 * Media Domain Types
 *
 * Type definitions for the unified media service layer.
 * These types represent the public API surface for media operations.
 */

/**
 * Media file returned from operations
 */
export interface MediaFile {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  url: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
  caption?: string | null;
  tags?: string[] | null;
  folderId?: string | null;
  uploadedBy?: string | null;
  uploadedAt: Date;
  updatedAt: Date;
}

/**
 * Input for uploading a media file
 */
export interface UploadMediaInput {
  /** File content as Buffer */
  buffer: Buffer;
  /** Original filename */
  filename: string;
  /** MIME type (e.g., 'image/jpeg', 'video/mp4') */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Alternative text for accessibility */
  altText?: string;
  /** Target folder ID (null for root) */
  folderId?: string | null;
}

/**
 * Input for updating media metadata
 */
export interface UpdateMediaInput {
  filename?: string;
  altText?: string | null;
  caption?: string | null;
  tags?: string[];
  folderId?: string | null;
}

/**
 * Media type for filtering
 */
export type MediaType = "image" | "video" | "audio" | "document" | "other";

/**
 * Options for listing media files
 */
export interface ListMediaOptions {
  /** Page number (1-indexed) */
  page?: number;
  /** Items per page */
  pageSize?: number;
  /** Search query (filename, altText) */
  search?: string;
  /** Filter by media type (image, video, audio, document) */
  type?: MediaType;
  /** Filter by folder ID (null or 'root' for root folder) */
  folderId?: string;
  /** Sort field */
  sortBy?: "uploadedAt" | "filename" | "size";
  /** Sort direction */
  sortOrder?: "asc" | "desc";
}

/**
 * Media folder
 */
export interface MediaFolder {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  parentId?: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a folder
 */
export interface CreateFolderInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string | null;
}

/**
 * Input for updating a folder
 */
export interface UpdateFolderInput {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string | null;
}

/**
 * Folder contents (subfolders + files)
 */
export interface FolderContents {
  folder: MediaFolder;
  subfolders: MediaFolder[];
  files: MediaFile[];
  breadcrumbs: Array<{ id: string; name: string }>;
}

/**
 * Bulk operation result
 */
export interface BulkOperationResult {
  totalItems: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    id: string;
    success: boolean;
    error?: string;
  }>;
}
