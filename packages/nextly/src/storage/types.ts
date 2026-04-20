/**
 * Media Storage Types
 *
 * Defines interfaces and types for the unified media storage system.
 * Supports cloud storage adapters via plugins.
 *
 * Storage Backends:
 * - AWS S3 / Cloudflare R2 / MinIO (via @revnixhq/plugin-storage-s3)
 * - Vercel Blob (via @revnixhq/plugin-storage-vercel-blob)
 */

// ============================================================
// Core Upload Types
// ============================================================

export interface UploadOptions {
  /** Original filename from user */
  filename: string;
  /** MIME type (e.g., 'image/png', 'video/mp4') */
  mimeType: string;
  /** Optional content type override */
  contentType?: string;
  /** Optional folder/prefix for organizing uploads */
  folder?: string;
  /** Collection slug this upload belongs to (for collection-specific storage) */
  collection?: string;
  /** Optional Content-Disposition header value (e.g., 'attachment' for SVG security) */
  contentDisposition?: "inline" | "attachment";
}

export interface UploadResult {
  /** Public URL to access the file */
  url: string;
  /** Storage path/key (for deletion and metadata retrieval) */
  path: string;
}

// ============================================================
// File Metadata Types
// ============================================================

/**
 * Extended file metadata returned by getMetadata()
 *
 * Contains comprehensive information about an uploaded file,
 * including dimensions for images and creation timestamps.
 */
export interface FileMetadata {
  /** Unique identifier (typically the storage path/key) */
  id: string;
  /** Storage filename (may differ from original) */
  filename: string;
  /** Original filename as uploaded by user */
  originalFilename: string;
  /** MIME type (e.g., 'image/jpeg', 'application/pdf') */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Public URL to access the file */
  url: string;
  /** Thumbnail URL for images (if generated) */
  thumbnailUrl?: string;
  /** Image width in pixels (for images only) */
  width?: number;
  /** Image height in pixels (for images only) */
  height?: number;
  /** ISO timestamp when file was uploaded */
  createdAt: string;
  /** ISO timestamp when file was last modified */
  updatedAt?: string;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
}

export interface ProcessedImage {
  buffer: Buffer;
  metadata: ImageMetadata;
}

// ============================================================
// Storage Configuration Types
// ============================================================

/**
 * Storage type identifier.
 * - "s3": AWS S3 or S3-compatible services (R2, MinIO, DigitalOcean Spaces)
 * - "vercel-blob": Vercel Blob Storage
 * - "local": Local disk storage (default for development)
 * - "uploadthing": Uploadthing cloud storage
 */
export type StorageType = "s3" | "vercel-blob" | "local" | "uploadthing";

/**
 * Information about a storage adapter's capabilities.
 * Returned by adapter.getInfo() method.
 */
export interface StorageAdapterInfo {
  /** Storage type identifier */
  type: StorageType;
  /** Human-readable adapter name */
  name: string;
  /** Whether this adapter supports signed URLs for private access */
  supportsSignedUrls: boolean;
  /** Whether this adapter supports client-side (direct) uploads */
  supportsClientUploads: boolean;
}

// ============================================================
// Collection Storage Configuration
// ============================================================

/**
 * Per-collection storage configuration.
 * Allows customizing storage behavior for specific upload collections.
 */
export interface CollectionStorageConfig {
  /** Prefix/folder for this collection's uploads */
  prefix?: string;
  /** Enable client-side uploads (for serverless platforms with body size limits) */
  clientUploads?: boolean;
  /** Generate signed URLs for downloads (for private buckets) */
  signedDownloads?: boolean;
  /** Signed URL expiry time in seconds (default: 3600) */
  signedUrlExpiresIn?: number;
}

/**
 * Collection storage map - maps collection slugs to their config.
 * Used in storage plugin configuration.
 *
 * @example
 * ```typescript
 * {
 *   media: true,  // Use default config
 *   'private-docs': {
 *     prefix: 'private/',
 *     signedDownloads: true,
 *     signedUrlExpiresIn: 900
 *   }
 * }
 * ```
 */
export type CollectionStorageMap = Record<
  string,
  boolean | CollectionStorageConfig
>;

// ============================================================
// Storage Plugin Types
// ============================================================

/**
 * Base configuration for storage plugins.
 * Extended by specific adapter configs (S3StorageConfig, etc.)
 */
export interface StoragePluginConfig {
  /** Enable/disable the plugin (default: true) */
  enabled?: boolean;
  /** Collections to apply this storage adapter to */
  collections: CollectionStorageMap;
}

/**
 * Storage plugin returned by adapter plugin functions.
 * These are processed during Nextly initialization.
 *
 * @example
 * ```typescript
 * // From @revnixhq/plugin-storage-s3
 * const plugin = s3Storage({
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   collections: { media: true }
 * });
 * // plugin implements StoragePlugin
 * ```
 */
export interface StoragePlugin {
  /** Plugin name for identification */
  name: string;
  /** Storage type */
  type: StorageType;
  /** Collections this plugin handles */
  collections: CollectionStorageMap;
  /** The storage adapter instance */
  adapter: IStorageAdapter;
  /**
   * Handler for generating client-side upload URLs.
   * Called when clientUploads is enabled for a collection.
   */
  getClientUploadUrl?: (
    filename: string,
    mimeType: string,
    collection: string
  ) => Promise<ClientUploadData>;
  /**
   * Handler for generating signed download URLs.
   * Called when signedDownloads is enabled for a collection.
   */
  getSignedDownloadUrl?: (path: string, expiresIn?: number) => Promise<string>;
}

// ============================================================
// Client Upload Types
// ============================================================

/**
 * Data returned for client-side (direct) uploads.
 * Contains pre-signed URL and headers for direct-to-storage uploads.
 *
 * @example
 * ```typescript
 * // Usage in frontend
 * const uploadData = await fetch('/api/nextly/storage/upload-url', {
 *   method: 'POST',
 *   body: JSON.stringify({ filename: 'photo.jpg', mimeType: 'image/jpeg', collection: 'media' })
 * }).then(r => r.json());
 *
 * // Direct upload to storage
 * await fetch(uploadData.uploadUrl, {
 *   method: uploadData.method,
 *   headers: uploadData.headers,
 *   body: file
 * });
 * ```
 */
export interface ClientUploadData {
  /** Pre-signed URL for direct upload */
  uploadUrl: string;
  /** Storage path/key that will be used */
  path: string;
  /** HTTP method to use (usually PUT for S3, POST for some services) */
  method: "PUT" | "POST";
  /** Headers to include in upload request */
  headers?: Record<string, string>;
  /** Form fields for multipart uploads (some services require this) */
  fields?: Record<string, string>;
  /** URL expiry timestamp */
  expiresAt: Date;
}

// ============================================================
// Storage Adapter Interface
// ============================================================

/**
 * Base storage adapter interface.
 * All storage adapters must implement this interface.
 *
 * Core methods (required):
 * - upload: Store file buffer
 * - delete: Remove file from storage
 * - exists: Check if file exists
 * - getPublicUrl: Get public URL for file access
 * - getType: Get storage type identifier
 *
 * Optional methods:
 * - getInfo: Get adapter capabilities (recommended)
 * - getMetadata: Retrieve file metadata
 * - getSignedUrl: Generate temporary signed URLs for private access
 * - getPresignedUploadUrl: Generate pre-signed URL for client uploads
 */
export interface BulkDeleteResult {
  successful: string[];
  failed: Array<{ filePath: string; error: string }>;
}

export interface IStorageAdapter {
  /** Upload file buffer to storage */
  upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult>;

  /** Delete file from storage */
  delete(filePath: string): Promise<void>;

  /** Bulk delete files from storage. Optional — adapters that support batch operations should implement this. */
  bulkDelete?(filePaths: string[]): Promise<BulkDeleteResult>;

  /** Check if file exists in storage */
  exists(filePath: string): Promise<boolean>;

  /** Get public URL for file */
  getPublicUrl(filePath: string): string;

  /** Get storage type identifier */
  getType(): string;

  /** Read file contents from storage (optional - not all adapters support this) */
  read?(filePath: string): Promise<Buffer | null>;

  /** Get adapter info including capabilities (optional but recommended) */
  getInfo?(): StorageAdapterInfo;

  /** Get file metadata (optional - not all adapters support this) */
  getMetadata?(filePath: string): Promise<FileMetadata | null>;

  /** Generate signed URL for temporary private access (optional) */
  getSignedUrl?(filePath: string, expiresIn?: number): Promise<string>;

  /** Generate pre-signed upload URL for client-side uploads (optional) */
  getPresignedUploadUrl?(
    key: string,
    mimeType: string,
    expiresIn?: number
  ): Promise<ClientUploadData>;
}

// ============================================================
// Legacy Types (kept for backward compatibility)
// ============================================================

/**
 * Storage configuration (legacy - kept for backward compatibility)
 *
 * @deprecated Use storage plugins instead. Configure storage in defineConfig():
 * ```typescript
 * import { s3Storage } from '@revnixhq/plugin-storage-s3'
 *
 * export default defineConfig({
 *   storage: [
 *     s3Storage({ bucket: '...', collections: { media: true } })
 *   ]
 * })
 * ```
 */
export interface StorageConfig {
  /** Storage type */
  type: StorageType;
  /** Vercel Blob configuration */
  vercelBlob?: {
    /** Token from BLOB_READ_WRITE_TOKEN env var */
    token: string;
  };
  /** S3/R2 configuration */
  s3?: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
    publicUrl?: string;
    forcePathStyle?: boolean;
  };
}
