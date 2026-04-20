/**
 * @nextly/storage-s3
 *
 * AWS S3 storage adapter for Nextly CMS.
 * Also works with S3-compatible services like Cloudflare R2, MinIO, and DigitalOcean Spaces.
 *
 * @example Basic usage with AWS S3
 * ```typescript
 * import { s3Storage } from '@nextly/storage-s3'
 * import { defineConfig } from '@revnixhq/nextly/config'
 *
 * export default defineConfig({
 *   storage: [
 *     s3Storage({
 *       bucket: process.env.S3_BUCKET!,
 *       region: process.env.AWS_REGION!,
 *       accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *       secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *       collections: {
 *         media: true
 *       }
 *     })
 *   ]
 * })
 * ```
 *
 * @example With Cloudflare R2
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
 * @example With MinIO
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
 *
 * @packageDocumentation
 */

// ============================================================
// S3 Storage Plugin Export (Primary API)
// ============================================================

export { s3Storage } from "./plugin";

// ============================================================
// S3 Storage Adapter Export
// ============================================================

export { S3StorageAdapter } from "./adapter";

// ============================================================
// S3 Types Export
// ============================================================

export type {
  S3StorageConfig,
  S3ObjectACL,
  S3CollectionConfig,
  S3CollectionStorageMap,
  ResolvedS3Config,
} from "./types";

// ============================================================
// Package Metadata
// ============================================================

export const PACKAGE_NAME = "@nextly/storage-s3";
export const PACKAGE_VERSION = "0.1.0";
