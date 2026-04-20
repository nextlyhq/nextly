/**
 * S3 Storage Adapter
 *
 * Stores files on AWS S3 or S3-compatible services (Cloudflare R2, MinIO, DigitalOcean Spaces).
 * Uses AWS SDK v3 with automatic multipart upload for large files (>5MB).
 *
 * Features:
 * - Automatic multipart upload via @aws-sdk/lib-storage
 * - Pre-signed URL generation for client-side uploads
 * - Signed URL generation for private file access
 * - Cloudflare R2 support (S3-compatible API)
 * - Custom endpoint support (MinIO, DigitalOcean Spaces)
 * - CDN URL override support
 * - File metadata retrieval
 *
 * @example AWS S3
 * ```typescript
 * const adapter = new S3StorageAdapter({
 *   bucket: 'my-media-bucket',
 *   region: 'us-east-1',
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *   collections: { media: true }
 * });
 * ```
 *
 * @example Cloudflare R2
 * ```typescript
 * const adapter = new S3StorageAdapter({
 *   bucket: 'my-media',
 *   region: 'auto',
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
 *   endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
 *   publicUrl: 'https://pub-abc.r2.dev',
 *   collections: { media: true }
 * });
 * ```
 *
 * @example MinIO (self-hosted)
 * ```typescript
 * const adapter = new S3StorageAdapter({
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   accessKeyId: process.env.MINIO_ACCESS_KEY!,
 *   secretAccessKey: process.env.MINIO_SECRET_KEY!,
 *   endpoint: 'http://localhost:9000',
 *   forcePathStyle: true,
 *   collections: { media: true }
 * });
 * ```
 */

import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  IStorageAdapter,
  UploadOptions,
  UploadResult,
  StorageAdapterInfo,
  ClientUploadData,
  FileMetadata,
  BulkDeleteResult,
} from "@revnixhq/nextly/storage";

import type { S3StorageConfig, ResolvedS3Config, S3ObjectACL } from "./types";

// ============================================================
// S3 Storage Adapter
// ============================================================

/**
 * S3 Storage Adapter
 *
 * Implements the IStorageAdapter interface for AWS S3 and S3-compatible services.
 * Provides full support for uploads, downloads, signed URLs, and client-side uploads.
 */
export class S3StorageAdapter implements IStorageAdapter {
  private client: S3Client;
  private resolvedConfig: ResolvedS3Config;
  private isR2: boolean;

  /**
   * Create a new S3 storage adapter.
   *
   * @param config - S3 storage configuration
   * @throws Error if bucket or region is not provided
   */
  constructor(private config: S3StorageConfig) {
    // Validate required config
    if (!config.bucket) {
      throw new Error("@nextly/storage-s3: bucket is required");
    }
    if (!config.region) {
      throw new Error("@nextly/storage-s3: region is required");
    }

    // Detect if this is Cloudflare R2
    this.isR2 = config.endpoint?.includes("r2.cloudflarestorage.com") ?? false;

    // Resolve config with defaults
    this.resolvedConfig = {
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? false,
      acl: config.acl ?? "public-read",
      publicUrl: config.publicUrl,
      cacheControl: config.cacheControl ?? "public, max-age=31536000",
      contentDisposition: config.contentDisposition,
      signedUrlExpiresIn: config.signedUrlExpiresIn ?? 3600,
    };

    // Build credentials
    const credentials = this.buildCredentials();

    // Initialize S3 client
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials,
      forcePathStyle: this.resolvedConfig.forcePathStyle,
      ...config.config,
    });
  }

  /**
   * Build AWS credentials from config.
   * Supports explicit credentials or falls back to SDK default chain.
   */
  private buildCredentials():
    | { accessKeyId: string; secretAccessKey: string }
    | undefined {
    if (this.config.accessKeyId && this.config.secretAccessKey) {
      return {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      };
    }

    // Check if credentials are in the config object
    if (this.config.config?.credentials) {
      return undefined; // Let SDK use the provided config.credentials
    }

    // Fall back to SDK default credential chain (env vars, IAM roles, etc.)
    return undefined;
  }

  // ============================================================
  // Core IStorageAdapter Methods
  // ============================================================

  /**
   * Upload file to S3.
   *
   * Uses AWS SDK v3's Upload class from @aws-sdk/lib-storage which:
   * - Automatically handles multipart upload for large files (>5MB)
   * - Provides progress tracking capability
   * - Includes retry logic
   * - Optimizes upload performance
   *
   * @param buffer - File content as Buffer
   * @param options - Upload options (filename, mimeType, folder, collection)
   * @returns Upload result with URL and storage path
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    const key = this.generateKey(options.filename, options.folder);

    // Build upload parameters
    const uploadParams: Record<string, unknown> = {
      Bucket: this.resolvedConfig.bucket,
      Key: key,
      Body: buffer,
      ContentType: options.contentType || options.mimeType,
      CacheControl: this.resolvedConfig.cacheControl,
    };

    // Add ACL if not R2 (R2 ignores ACL settings)
    if (!this.isR2) {
      uploadParams.ACL = this.resolvedConfig.acl;
    }

    // Add Content-Disposition: per-file override takes priority, then global config
    const disposition =
      options.contentDisposition ?? this.resolvedConfig.contentDisposition;
    if (disposition) {
      const filename = this.sanitizeFilename(options.filename);
      uploadParams.ContentDisposition =
        disposition === "attachment"
          ? `attachment; filename="${filename}"`
          : "inline";
    }

    // Store original filename in metadata for later retrieval
    uploadParams.Metadata = {
      "original-filename": options.filename,
    };

    // Use Upload for automatic multipart handling
    const upload = new Upload({
      client: this.client,
      params: uploadParams as any,
    });

    await upload.done();

    return {
      url: this.getPublicUrl(key),
      path: key,
    };
  }

  /**
   * Delete file from S3.
   *
   * @param filePath - Storage path/key to delete
   */
  async delete(filePath: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.resolvedConfig.bucket,
      Key: filePath,
    });

    await this.client.send(command);
  }

  /**
   * Bulk delete files from S3 using a single API call per 1000 keys.
   *
   * Uses AWS SDK v3's DeleteObjectsCommand which supports up to 1000 keys per
   * request. Automatically batches larger arrays and collects per-key results.
   *
   * @param filePaths - Storage paths/keys to delete
   * @returns Object with arrays of successful and failed deletions
   */
  async bulkDelete(filePaths: string[]): Promise<BulkDeleteResult> {
    const successful: string[] = [];
    const failed: Array<{ filePath: string; error: string }> = [];
    const maxBatchSize = 1000; // AWS limit

    for (let i = 0; i < filePaths.length; i += maxBatchSize) {
      const batch = filePaths.slice(i, i + maxBatchSize);
      const command = new DeleteObjectsCommand({
        Bucket: this.resolvedConfig.bucket,
        Delete: {
          Objects: batch.map(key => ({ Key: key })),
          Quiet: false,
        },
      });

      const response = await this.client.send(command);

      if (response.Errors && response.Errors.length > 0) {
        for (const err of response.Errors) {
          if (err.Key) {
            failed.push({
              filePath: err.Key,
              error: err.Message ?? "Unknown S3 delete error",
            });
          }
        }
      }

      if (response.Deleted) {
        for (const del of response.Deleted) {
          if (del.Key) {
            successful.push(del.Key);
          }
        }
      }
    }

    return { successful, failed };
  }

  /**
   * Check if file exists in S3.
   *
   * Uses HeadObject command which is more efficient than GetObject
   * for existence checks (doesn't download the file).
   *
   * @param filePath - Storage path/key to check
   * @returns true if file exists, false otherwise
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: filePath,
      });

      await this.client.send(command);
      return true;
    } catch (error: unknown) {
      // HeadObject returns 404 if object doesn't exist
      if (this.isNotFoundError(error)) {
        return false;
      }
      // Re-throw other errors (permissions, network, etc.)
      throw error;
    }
  }

  /**
   * Get public URL for S3 file.
   *
   * Priority order:
   * 1. Custom publicUrl (CDN or custom domain) if configured
   * 2. Standard S3 URL based on region and bucket
   *
   * For R2: Requires publicUrl configuration (R2 has no default public URLs).
   *
   * @param filePath - Storage path/key
   * @returns Public URL to access the file
   * @throws Error if R2 is used without publicUrl configuration
   */
  getPublicUrl(filePath: string): string {
    // Use custom CDN/public URL if configured
    if (this.resolvedConfig.publicUrl) {
      const baseUrl = this.resolvedConfig.publicUrl.replace(/\/$/, "");
      return `${baseUrl}/${filePath}`;
    }

    // R2 requires custom domain or public bucket URL
    if (this.isR2) {
      throw new Error(
        "@nextly/storage-s3: Cloudflare R2 requires publicUrl configuration.\n\n" +
          "R2 does not have default public URLs like AWS S3. Configure one of:\n" +
          "1. Public bucket URL: publicUrl: 'https://pub-xxx.r2.dev'\n" +
          "2. Custom domain: publicUrl: 'https://cdn.example.com'\n\n" +
          "Set up public access in the Cloudflare R2 dashboard."
      );
    }

    // Standard S3 URL format
    // https://bucket.s3.region.amazonaws.com/key
    return `https://${this.resolvedConfig.bucket}.s3.${this.resolvedConfig.region}.amazonaws.com/${filePath}`;
  }

  /**
   * Get storage type identifier.
   *
   * Returns "s3" for all S3-compatible services (AWS S3, R2, MinIO, etc.)
   * as they all use the S3 API.
   */
  getType(): "s3" {
    return "s3";
  }

  // ============================================================
  // Optional IStorageAdapter Methods
  // ============================================================

  /**
   * Get adapter info including capabilities.
   *
   * @returns Adapter info with type, name, and capability flags
   */
  getInfo(): StorageAdapterInfo {
    return {
      type: "s3",
      name: "S3StorageAdapter",
      supportsSignedUrls: true,
      supportsClientUploads: true,
    };
  }

  /**
   * Get file metadata from S3.
   *
   * Retrieves file information including size, content type, and timestamps
   * using the HeadObject command.
   *
   * @param filePath - Storage path/key
   * @returns File metadata or null if file not found
   */
  async getMetadata(filePath: string): Promise<FileMetadata | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.resolvedConfig.bucket,
        Key: filePath,
      });

      const response = await this.client.send(command);
      const filename = filePath.split("/").pop() || filePath;

      return {
        id: filePath,
        filename,
        originalFilename: response.Metadata?.["original-filename"] || filename,
        mimeType: response.ContentType || "application/octet-stream",
        size: response.ContentLength || 0,
        url: this.getPublicUrl(filePath),
        createdAt:
          response.LastModified?.toISOString() || new Date().toISOString(),
      };
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Generate signed URL for temporary private file access.
   *
   * Creates a pre-signed GetObject URL that grants temporary read access
   * to private files. Useful for serving files from private buckets.
   *
   * @param filePath - Storage path/key
   * @param expiresIn - URL validity duration in seconds (default: 3600)
   * @returns Pre-signed URL for downloading the file
   */
  async getSignedUrl(filePath: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.resolvedConfig.bucket,
      Key: filePath,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresIn ?? this.resolvedConfig.signedUrlExpiresIn,
    });
  }

  /**
   * Generate pre-signed URL for client-side uploads.
   *
   * Creates a pre-signed PutObject URL that allows direct uploads from
   * the browser to S3, bypassing server-side upload limits (e.g., Vercel's 4.5MB).
   *
   * @param key - Storage path/key for the upload
   * @param mimeType - MIME type of the file being uploaded
   * @param expiresIn - URL validity duration in seconds (default: 3600)
   * @returns Client upload data with URL, method, and headers
   */
  async getPresignedUploadUrl(
    key: string,
    mimeType: string,
    expiresIn?: number
  ): Promise<ClientUploadData> {
    const expiration = expiresIn ?? this.resolvedConfig.signedUrlExpiresIn;

    // Build PutObject command parameters
    const commandParams: Record<string, unknown> = {
      Bucket: this.resolvedConfig.bucket,
      Key: key,
      ContentType: mimeType,
      CacheControl: this.resolvedConfig.cacheControl,
    };

    // Add ACL if not R2
    if (!this.isR2) {
      commandParams.ACL = this.resolvedConfig.acl;
    }

    const command = new PutObjectCommand(commandParams as any);

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: expiration,
    });

    return {
      uploadUrl,
      path: key,
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
      },
      expiresAt: new Date(Date.now() + expiration * 1000),
    };
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Generate a unique storage key with date-based prefix.
   *
   * Creates keys in format: {folder}/{year}/{month}/{uuid}-{sanitized-filename}
   *
   * @param filename - Original filename (will be sanitized)
   * @param folder - Optional folder/prefix for organizing uploads
   * @returns Generated storage key
   */
  private generateKey(filename: string, folder?: string): string {
    const sanitized = this.sanitizeFilename(filename);
    const uuid = crypto.randomUUID();
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");

    const prefix = folder ? `${folder}/${year}/${month}` : `${year}/${month}`;

    return `${prefix}/${uuid}-${sanitized}`;
  }

  /**
   * Sanitize filename to prevent directory traversal and S3 key issues.
   *
   * @param filename - Original filename
   * @returns Sanitized filename safe for S3 keys
   */
  private sanitizeFilename(filename: string): string {
    const basename = filename.split(/[/\\]/).pop() || filename;
    return basename.replace(/[^a-zA-Z0-9._-]/g, "-");
  }

  /**
   * Check if an error is a "not found" error from S3.
   *
   * @param error - Error to check
   * @returns true if error indicates file not found
   */
  private isNotFoundError(error: unknown): boolean {
    if (error && typeof error === "object") {
      const e = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      return e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
    }
    return false;
  }

  // ============================================================
  // Public Accessors
  // ============================================================

  /**
   * Get the S3 client instance.
   * Useful for advanced operations not covered by the adapter interface.
   */
  getClient(): S3Client {
    return this.client;
  }

  /**
   * Get the bucket name.
   */
  getBucket(): string {
    return this.resolvedConfig.bucket;
  }

  /**
   * Get the AWS region.
   */
  getRegion(): string {
    return this.resolvedConfig.region;
  }

  /**
   * Check if this adapter is configured for Cloudflare R2.
   */
  isCloudflareR2(): boolean {
    return this.isR2;
  }
}
