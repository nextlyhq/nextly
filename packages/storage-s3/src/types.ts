/**
 * S3 Storage Types
 *
 * Type definitions for the @nextly/storage-s3 package.
 * Supports AWS S3 and S3-compatible services (Cloudflare R2, MinIO, DigitalOcean Spaces).
 *
 * @packageDocumentation
 */

import type { S3ClientConfig } from "@aws-sdk/client-s3";
import type {
  StoragePluginConfig,
  CollectionStorageConfig,
} from "@revnixhq/nextly/storage";

// ============================================================
// S3 Storage Configuration
// ============================================================

/**
 * S3 storage adapter configuration.
 *
 * Extends the base storage plugin config with S3-specific options.
 * Supports AWS S3 and S3-compatible services like Cloudflare R2, MinIO, and DigitalOcean Spaces.
 *
 * @example AWS S3
 * ```typescript
 * s3Storage({
 *   bucket: process.env.S3_BUCKET!,
 *   region: process.env.AWS_REGION!,
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *   collections: {
 *     media: true
 *   }
 * })
 * ```
 *
 * @example Cloudflare R2
 * ```typescript
 * s3Storage({
 *   bucket: process.env.R2_BUCKET!,
 *   region: 'auto',
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
 *   endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 *   publicUrl: process.env.R2_PUBLIC_URL,
 *   collections: { media: true }
 * })
 * ```
 *
 * @example MinIO (self-hosted)
 * ```typescript
 * s3Storage({
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   accessKeyId: process.env.MINIO_ACCESS_KEY!,
 *   secretAccessKey: process.env.MINIO_SECRET_KEY!,
 *   endpoint: 'http://localhost:9000',
 *   forcePathStyle: true,
 *   collections: { media: true }
 * })
 * ```
 */
export interface S3StorageConfig extends StoragePluginConfig {
  /** Enable/disable this storage plugin (default: true). */
  enabled?: boolean;

  /** Collections this plugin handles. */
  collections: Record<string, boolean | CollectionStorageConfig>;

  /**
   * S3 bucket name.
   * Must be an existing bucket that the credentials have access to.
   */
  bucket: string;

  /**
   * AWS region (e.g., 'us-east-1', 'eu-west-1').
   * Use 'auto' for Cloudflare R2.
   */
  region: string;

  /**
   * AWS SDK S3 client configuration.
   * Use this for advanced configuration like custom retry strategies,
   * request handlers, or middleware.
   *
   * Note: `region`, `endpoint`, `credentials`, and `forcePathStyle` can be
   * specified either here or via the dedicated config properties. The dedicated
   * properties take precedence if both are specified.
   */
  config?: Omit<S3ClientConfig, "region">;

  /**
   * AWS Access Key ID.
   * Can also be provided via `config.credentials` or environment variables
   * (AWS_ACCESS_KEY_ID).
   */
  accessKeyId?: string;

  /**
   * AWS Secret Access Key.
   * Can also be provided via `config.credentials` or environment variables
   * (AWS_SECRET_ACCESS_KEY).
   */
  secretAccessKey?: string;

  /**
   * Custom endpoint for S3-compatible services.
   * Required for Cloudflare R2, MinIO, DigitalOcean Spaces, etc.
   *
   * @example Cloudflare R2
   * ```typescript
   * endpoint: `https://${accountId}.r2.cloudflarestorage.com`
   * ```
   *
   * @example MinIO
   * ```typescript
   * endpoint: 'http://localhost:9000'
   * ```
   *
   * @example DigitalOcean Spaces
   * ```typescript
   * endpoint: 'https://nyc3.digitaloceanspaces.com'
   * ```
   */
  endpoint?: string;

  /**
   * Force path-style URLs instead of virtual-hosted-style.
   *
   * When true: `https://endpoint/bucket/key`
   * When false: `https://bucket.endpoint/key`
   *
   * Required for MinIO and some S3-compatible services.
   *
   * @default false
   */
  forcePathStyle?: boolean;

  /**
   * Access Control List (ACL) for uploaded objects.
   * Determines who can access the uploaded files.
   *
   * Common values:
   * - `'public-read'`: Anyone can read (for public media)
   * - `'private'`: Only authenticated users (use with signed URLs)
   * - `'bucket-owner-full-control'`: Bucket owner has full control
   *
   * Note: Cloudflare R2 ignores ACL settings. Configure public access
   * in the R2 dashboard instead.
   *
   * @default 'public-read'
   */
  acl?: S3ObjectACL;

  /**
   * Public URL override for accessing uploaded files.
   * Use this when serving files through a CDN or custom domain.
   *
   * If not set, uses the standard S3 URL format:
   * `https://{bucket}.s3.{region}.amazonaws.com/{key}`
   *
   * Required for Cloudflare R2 (which doesn't have default public URLs).
   *
   * @example CDN URL
   * ```typescript
   * publicUrl: 'https://cdn.example.com'
   * ```
   *
   * @example R2 Public Bucket
   * ```typescript
   * publicUrl: 'https://pub-abc123.r2.dev'
   * ```
   */
  publicUrl?: string;

  /**
   * Enable signed download URLs for private file access.
   * When enabled, `getSignedUrl()` can generate temporary access URLs.
   *
   * Can be overridden per-collection in the collections map.
   *
   * @default false
   */
  signedDownloads?: boolean;

  /**
   * Default expiry time for signed URLs in seconds.
   * Applies to both download and upload URLs.
   *
   * Can be overridden per-collection in the collections map.
   *
   * @default 3600 (1 hour)
   */
  signedUrlExpiresIn?: number;

  /**
   * Cache-Control header for uploaded files.
   * Controls browser and CDN caching behavior.
   *
   * @default 'public, max-age=31536000' (1 year)
   */
  cacheControl?: string;

  /**
   * Content-Disposition header mode for uploaded files.
   * Controls how browsers handle file downloads.
   *
   * - `'inline'`: Display in browser if possible
   * - `'attachment'`: Always prompt for download
   * - `undefined`: Don't set header (use S3/browser defaults)
   */
  contentDisposition?: "inline" | "attachment";
}

// ============================================================
// S3 ACL Type
// ============================================================

/**
 * S3 Object Access Control List (ACL) values.
 * Defines who can access uploaded objects.
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/acl-overview.html#canned-acl
 */
export type S3ObjectACL =
  | "private"
  | "public-read"
  | "public-read-write"
  | "authenticated-read"
  | "aws-exec-read"
  | "bucket-owner-read"
  | "bucket-owner-full-control";

// ============================================================
// S3 Collection Configuration
// ============================================================

/**
 * S3-specific collection storage configuration.
 * Extends base collection config with S3-specific options.
 *
 * @example
 * ```typescript
 * s3Storage({
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   collections: {
 *     // Simple enable with defaults
 *     media: true,
 *
 *     // Full configuration
 *     'private-documents': {
 *       prefix: 'docs/',
 *       acl: 'private',
 *       signedDownloads: true,
 *       signedUrlExpiresIn: 900, // 15 minutes
 *       clientUploads: true,
 *       cacheControl: 'private, max-age=0'
 *     }
 *   }
 * })
 * ```
 */
export interface S3CollectionConfig extends CollectionStorageConfig {
  /**
   * Override ACL for this collection.
   * If not set, uses the adapter-level ACL setting.
   */
  acl?: S3ObjectACL;

  /**
   * Override Cache-Control header for this collection.
   * If not set, uses the adapter-level cacheControl setting.
   */
  cacheControl?: string;

  /**
   * Override Content-Disposition for this collection.
   * If not set, uses the adapter-level contentDisposition setting.
   */
  contentDisposition?: "inline" | "attachment";
}

// ============================================================
// S3 Collection Map Type
// ============================================================

/**
 * Type-safe collection storage map for S3.
 * Maps collection slugs to S3-specific configurations.
 */
export type S3CollectionStorageMap = Record<
  string,
  boolean | S3CollectionConfig
>;

// ============================================================
// Internal Types
// ============================================================

/**
 * Resolved S3 configuration after applying defaults.
 * Used internally by the adapter.
 *
 * @internal
 */
export interface ResolvedS3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  acl: S3ObjectACL;
  publicUrl?: string;
  cacheControl: string;
  contentDisposition?: "inline" | "attachment";
  signedUrlExpiresIn: number;
}
