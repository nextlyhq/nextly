/**
 * Media Storage Types
 *
 * Defines interfaces and types for the unified media storage system.
 * Supports cloud storage adapters via plugins.
 *
 * Storage Backends:
 * - AWS S3 / Cloudflare R2 / MinIO (via @nextlyhq/storage-s3)
 * - Vercel Blob (via @nextlyhq/storage-vercel-blob)
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
/**
 * Bounds for a read that pulls an object into memory.
 *
 * Reading a stored object means BUFFERING it, so its size is the caller's
 * problem whether or not the caller says so. Left unbounded, a large object
 * consumes as much process memory as it happens to occupy, and a stalled
 * backend holds the request until something further out gives up.
 *
 * OPTIONAL, with the defaults living in the fetch layer rather than being
 * restated per adapter — a second set of numbers agrees today and drifts. What
 * this type exists for is the caller that already knows its own limit: the
 * email attachment path caps a read at the configured attachment size, so an
 * oversized object fails as a size error rather than after it has been read.
 */
export interface StorageReadOptions {
  /** Refuse once this many bytes have arrived. Defaults to the fetch cap. */
  maxBytes?: number;
  /** Give up after this long. Defaults to the fetch deadline. */
  timeoutMs?: number;
}

export interface StorageAdapterInfo {
  /** Storage type identifier */
  type: StorageType;
  /** Human-readable adapter name */
  name: string;
  /** Whether this adapter supports signed URLs for private access */
  supportsSignedUrls: boolean;
  /** Whether this adapter supports client-side (direct) uploads */
  supportsClientUploads: boolean;
  /**
   * Whether files written through the private calls (`putPrivate`,
   * `getPrivateUploadUrl`) can be reached only through Nextly: no public
   * address serves them. An adapter says so only when it is configured that
   * way, for example with no public URL in front of its bucket. Absent means
   * no, so a collection of private files is never stored where it may be
   * public.
   *
   * @experimental
   */
  supportsPrivateFiles?: boolean;
}

/**
 * What a storage says about an object it holds, read without its bytes.
 *
 * @experimental
 */
export interface StoredObjectHead {
  /** The object's size in bytes, as stored. */
  size: number;
  /** The type it was stored with, where the storage keeps one. */
  contentType?: string;
  /** When it was last written, where the storage says. */
  lastModified?: Date;
}

/**
 * Bounds for a read handed back as a stream.
 *
 * @experimental
 */
export interface StorageStreamOptions {
  /**
   * Give up when the storage has not started answering after this long. The
   * transfer itself is not bounded: its reader decides how long it takes.
   */
  timeoutMs?: number;
}

/**
 * A short-lived link to a private file, as the private download call takes it.
 *
 * @experimental
 */
export interface PrivateDownloadUrlOptions {
  /** How long the link lasts, in seconds, within the adapter's own cap. */
  expiresIn: number;
  /** The Content-Disposition the storage answers the link with. */
  contentDisposition: string;
  /** The Content-Type the storage answers the link with. */
  contentType?: string;
}

/**
 * A direct upload of a private file, as the private upload call takes it.
 *
 * @experimental
 */
export interface PrivateUploadUrlOptions {
  /** The file's exact size in bytes; storage refuses a body of another length. */
  contentLength: number;
  /** How long the URL lasts, in seconds, within the adapter's own cap. */
  expiresIn: number;
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
 * // From @nextlyhq/storage-s3
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
   * Called when clientUploads is enabled for a collection, for a file whose
   * name, type and size the upload checks have already allowed. The URL must
   * bind the type and `options.size`, so storage refuses a different file:
   * its bytes never pass Nextly's checks.
   */
  getClientUploadUrl?: (
    filename: string,
    mimeType: string,
    collection: string,
    options: ClientUploadOptions
  ) => Promise<ClientUploadData>;
  /**
   * Handler for generating signed download URLs.
   * Called when signedDownloads is enabled for a collection.
   */
  getSignedDownloadUrl?: (path: string, expiresIn?: number) => Promise<string>;
}

// ============================================================
// Client Upload Types

/** What a signed client upload is bound to, besides its key and type. */
export interface ClientUploadOptions {
  /** The file's exact size in bytes; storage refuses a body of another length. */
  size: number;
  /** How long the URL lasts, in seconds, within the adapter's own cap. */
  expiresIn?: number;
}
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
/** A file a storage holds, as {@link IStorageAdapter.list} names it. */
export interface StoredFileEntry {
  /** The stored path, as `upload` returned it and `delete` takes it. */
  path: string;
  /** When it was stored, where the storage says. */
  lastModified?: Date;
  /**
   * The name it was uploaded under, where the storage keeps that apart from
   * its path: UploadThing's keys carry no name. Elsewhere the name is the
   * path's last segment.
   */
  name?: string;
}

export interface BulkDeleteResult {
  successful: string[];
  failed: Array<{ filePath: string; error: string }>;
}

export interface IStorageAdapter {
  /** Upload file buffer to storage */
  upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult>;

  /**
   * Store bytes at exactly `filePath`, replacing anything there (optional).
   *
   * Core calls it only with a key it derived from a file this storage already
   * holds, to keep a file made from that one, such as a resized copy of an
   * image, beside it. A storage without it cannot keep such files, and core
   * serves the original instead. `upload` stays the way new files are
   * stored, since it is the storage that chooses their keys.
   *
   * @experimental
   */
  uploadAt?(
    filePath: string,
    buffer: Buffer,
    options: { mimeType: string }
  ): Promise<UploadResult>;

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
  read?(filePath: string, options?: StorageReadOptions): Promise<Buffer | null>;

  /** Get adapter info including capabilities (optional but recommended) */
  getInfo?(): StorageAdapterInfo;

  /** Get file metadata (optional - not all adapters support this) */
  getMetadata?(filePath: string): Promise<FileMetadata | null>;

  /** Generate signed URL for temporary private access (optional) */
  getSignedUrl?(filePath: string, expiresIn?: number): Promise<string>;

  /**
   * Generate pre-signed upload URL for client-side uploads (optional). With
   * `options.contentLength`, the signature binds the body's exact length.
   */
  getPresignedUploadUrl?(
    key: string,
    mimeType: string,
    expiresIn?: number,
    options?: { contentLength?: number }
  ): Promise<ClientUploadData>;

  /**
   * Every file the storage holds, a page at a time (optional). Used to find
   * files no record refers to; a storage without it cannot be searched for
   * them, which is said rather than taken as "none".
   */
  list?(): AsyncIterable<StoredFileEntry>;

  /**
   * What the storage holds at `filePath`, its size and type, without reading
   * it (optional); `null` when nothing is there.
   *
   * @experimental
   */
  head?(filePath: string): Promise<StoredObjectHead | null>;

  /**
   * The file's bytes as a stream, for a response that should not hold the
   * whole file in memory (optional); `null` when nothing is there.
   *
   * @experimental
   */
  readStream?(
    filePath: string,
    options?: StorageStreamOptions
  ): Promise<ReadableStream<Uint8Array> | null>;

  /**
   * Store a private file at exactly `key` (optional). Unlike `upload`, the key
   * is core's (it names no file and no person), no public address is formed,
   * the original file name is kept nowhere in the storage, and the object is
   * marked never to be cached. Required, with the two calls below, for a
   * collection of private files.
   *
   * @experimental
   */
  putPrivate?(
    key: string,
    buffer: Buffer,
    options: { mimeType: string }
  ): Promise<void>;

  /**
   * A pre-signed URL a browser sends one private file to, at exactly `key`
   * (optional). Like `getPresignedUploadUrl`, it binds the type and exact
   * length; unlike it, the object it writes is private and never cached.
   *
   * @experimental
   */
  getPrivateUploadUrl?(
    key: string,
    mimeType: string,
    options: PrivateUploadUrlOptions
  ): Promise<ClientUploadData>;

  /**
   * A link to a private file that lasts `options.expiresIn` seconds and is
   * answered as an attachment that is never cached (optional). Only Nextly's
   * checked download hands one out, after the caller's access was checked.
   *
   * @experimental
   */
  getPrivateDownloadUrl?(
    key: string,
    options: PrivateDownloadUrlOptions
  ): Promise<string>;
}
