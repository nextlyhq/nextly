/**
 * Storage Environment Configuration
 *
 * Auto-detects and configures storage plugins based on environment variables.
 * This simplifies the user's nextly.config.ts by handling the storage setup internally.
 *
 * @example
 * ```typescript
 * // In nextly.config.ts
 * import { defineConfig } from "@revnixhq/nextly/config";
 * import { getStorageFromEnv } from "@revnixhq/nextly/storage";
 *
 * export default defineConfig({
 *   storage: getStorageFromEnv(),
 * });
 * ```
 */

import type { StoragePlugin } from "./types";

// Try to load dotenv for config file execution context
async function ensureEnvLoaded(): Promise<void> {
  // Only load dotenv in Node.js environment (not edge runtime)
  if (typeof process !== "undefined" && !process.env._NEXTLY_ENV_LOADED) {
    try {
      const dotenv = await import("dotenv");
      dotenv.config();
      process.env._NEXTLY_ENV_LOADED = "true";
    } catch {
      // dotenv not available, environment should be loaded by the runtime
    }
  }
}

/**
 * Get storage plugins based on environment variables.
 *
 * Uses a cascade detection approach (first match wins):
 * 1. BLOB_READ_WRITE_TOKEN → Vercel Blob
 * 2. S3_BUCKET → S3 (also covers R2, MinIO, Supabase)
 * 3. UPLOADTHING_TOKEN → Uploadthing
 * 4. Nothing detected → Local disk (zero-config default)
 *
 * For Vercel Blob:
 * - `BLOB_READ_WRITE_TOKEN`: Required token
 *
 * For S3/R2/MinIO:
 * - `S3_BUCKET`: Required bucket name
 * - `S3_REGION`: Required region
 * - `AWS_ACCESS_KEY_ID`: Required access key
 * - `AWS_SECRET_ACCESS_KEY`: Required secret key
 * - `S3_ENDPOINT`: Optional custom endpoint (for R2, MinIO)
 * - `S3_PUBLIC_URL`: Optional public URL prefix
 * - `S3_FORCE_PATH_STYLE`: Optional "true" for path-style URLs (MinIO)
 *
 * For Uploadthing:
 * - `UPLOADTHING_TOKEN`: Required API token
 *
 * @returns Array of configured storage plugins (always returns at least local storage)
 */
export async function getStorageFromEnv(): Promise<StoragePlugin[]> {
  // Ensure environment variables are loaded
  await ensureEnvLoaded();

  // --- Cascade 1: Vercel Blob ---
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken) {
    try {
      const pkg = "@revnixhq/storage-vercel-blob";
      const { vercelBlobStorage } = await import(/* webpackIgnore: true */ pkg);
      console.log(
        "[Nextly] Storage: Vercel Blob (auto-detected from BLOB_READ_WRITE_TOKEN)"
      );
      return [
        vercelBlobStorage({ token: blobToken, collections: { media: true } }),
      ];
    } catch {
      console.warn(
        "[Nextly] BLOB_READ_WRITE_TOKEN set but @revnixhq/storage-vercel-blob not installed. Run: pnpm add @revnixhq/storage-vercel-blob"
      );
    }
  }

  // --- Cascade 2: S3 (also R2, MinIO, Supabase, DigitalOcean Spaces) ---
  const s3Bucket = process.env.S3_BUCKET;
  if (s3Bucket) {
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!region || !accessKeyId || !secretAccessKey) {
      const missing = [];
      if (!region) missing.push("S3_REGION");
      if (!accessKeyId) missing.push("AWS_ACCESS_KEY_ID");
      if (!secretAccessKey) missing.push("AWS_SECRET_ACCESS_KEY");
      console.warn(
        `[Nextly] S3_BUCKET set but missing: ${missing.join(", ")}. Falling back to local storage.`
      );
    } else {
      try {
        const pkg = "@revnixhq/storage-s3";
        const { s3Storage } = await import(/* webpackIgnore: true */ pkg);
        console.log("[Nextly] Storage: S3 (auto-detected from S3_BUCKET)");
        return [
          s3Storage({
            bucket: s3Bucket,
            region,
            accessKeyId,
            secretAccessKey,
            endpoint: process.env.S3_ENDPOINT,
            publicUrl: process.env.S3_PUBLIC_URL,
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
            collections: { media: true },
          }),
        ];
      } catch {
        console.warn(
          "[Nextly] S3_BUCKET set but @revnixhq/storage-s3 not installed. Run: pnpm add @revnixhq/storage-s3"
        );
      }
    }
  }

  // --- Cascade 3: Uploadthing ---
  const uploadthingToken = process.env.UPLOADTHING_TOKEN;
  if (uploadthingToken) {
    try {
      const pkg = "@revnixhq/storage-uploadthing";
      const { uploadthingStorage } = await import(
        /* webpackIgnore: true */ pkg
      );
      console.log(
        "[Nextly] Storage: Uploadthing (auto-detected from UPLOADTHING_TOKEN)"
      );
      return [
        uploadthingStorage({
          token: uploadthingToken,
          collections: { media: true },
        }),
      ];
    } catch {
      console.warn(
        "[Nextly] UPLOADTHING_TOKEN set but @revnixhq/storage-uploadthing not installed. Run: pnpm add @revnixhq/storage-uploadthing"
      );
    }
  }

  // --- Cascade 4: Local disk (default fallback) ---
  // No cloud storage env vars detected — use local filesystem.
  // This enables zero-config development: just run `pnpm dev` and uploads work.
  const { localStorage } = await import("./adapters/local-plugin");
  console.log(
    "[Nextly] Storage: Local disk (no cloud env vars detected, using ./public/uploads)"
  );
  return [localStorage({ collections: { media: true } })];
}
