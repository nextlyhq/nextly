/**
 * @nextly/storage-vercel-blob
 *
 * Vercel Blob storage adapter for Nextly CMS.
 * Optimized for Vercel deployments with client-side upload support
 * to bypass serverless function size limits (4.5MB).
 *
 * @example Basic usage
 * ```typescript
 * import { vercelBlobStorage } from '@nextly/storage-vercel-blob'
 * import { defineConfig } from '@revnixhq/nextly/config'
 *
 * export default defineConfig({
 *   storage: [
 *     vercelBlobStorage({
 *       token: process.env.BLOB_READ_WRITE_TOKEN,
 *       collections: {
 *         media: true
 *       }
 *     })
 *   ]
 * })
 * ```
 *
 * @example With client uploads (recommended for Vercel)
 * ```typescript
 * vercelBlobStorage({
 *   collections: {
 *     media: {
 *       clientUploads: true // Bypass 4.5MB serverless limit
 *     }
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

// ============================================================
// Vercel Blob Storage Plugin Export (Primary API)
// ============================================================

export { vercelBlobStorage } from "./plugin";

// ============================================================
// Vercel Blob Storage Adapter Export
// ============================================================

export { VercelBlobStorageAdapter } from "./adapter";

// ============================================================
// Vercel Blob Types Export
// ============================================================

export type {
  VercelBlobStorageConfig,
  VercelBlobCollectionConfig,
  VercelBlobCollectionStorageMap,
  ResolvedVercelBlobConfig,
} from "./types";

// ============================================================
// Package Metadata
// ============================================================

export const PACKAGE_NAME = "@nextly/storage-vercel-blob";
export const PACKAGE_VERSION = "0.1.0";
