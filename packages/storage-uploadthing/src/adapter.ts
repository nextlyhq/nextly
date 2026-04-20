/**
 * Uploadthing Storage Adapter
 *
 * Implements the Nextly storage adapter interface using Uploadthing's UTApi
 * for server-side file operations. Files are served via Uploadthing's CDN.
 *
 * @example
 * ```typescript
 * const adapter = new UploadthingStorageAdapter({ token: process.env.UPLOADTHING_TOKEN });
 * const result = await adapter.upload(buffer, {
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 * });
 * // result.url = 'https://utfs.io/f/abc123-photo.jpg'
 * ```
 */

import { BaseStorageAdapter } from "@revnixhq/nextly/storage";
import type {
  UploadOptions,
  UploadResult,
  BulkDeleteResult,
} from "@revnixhq/nextly/storage";
import { UTApi } from "uploadthing/server";

// ============================================================
// Adapter Implementation
// ============================================================

export class UploadthingStorageAdapter extends BaseStorageAdapter {
  private readonly utapi: UTApi;

  constructor(config: { token?: string }) {
    super();
    // UTApi reads UPLOADTHING_TOKEN from env if not provided
    this.utapi = new UTApi({
      ...(config.token ? { token: config.token } : {}),
    });
  }

  /**
   * Upload file to Uploadthing.
   * Creates a File object from the buffer and uploads via UTApi.
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    const sanitized = this.sanitizeFilename(options.filename);

    // UTApi.uploadFiles expects File objects
    // Cast buffer to BlobPart to satisfy TS 5.9 strict ArrayBuffer typing
    const file = new File([buffer as unknown as BlobPart], sanitized, {
      type: options.mimeType,
    });

    // uploadFiles returns UploadFileResult[] — one result per file
    const results = await this.utapi.uploadFiles([file], {
      contentDisposition: options.contentDisposition ?? "inline",
    });

    // results is an array of { data: { key, url, ... } | null, error: ... | null }
    const result = results[0] as {
      data: { key: string; url: string } | null;
      error: { message: string } | null;
    };

    if (!result?.data) {
      const errorMsg = result?.error?.message ?? "Unknown error";
      throw new Error(`Uploadthing upload failed: ${errorMsg}`);
    }

    return {
      url: result.data.url,
      // Use the file key as the storage path (needed for deletion)
      path: result.data.key,
    };
  }

  /**
   * Delete file from Uploadthing by its file key.
   */
  async delete(filePath: string): Promise<void> {
    try {
      await this.utapi.deleteFiles([filePath], { keyType: "fileKey" });
    } catch {
      // Silently ignore deletion errors (file may already be gone)
    }
  }

  /**
   * Bulk delete files from Uploadthing.
   * UTApi natively supports batch deletion.
   */
  async bulkDelete(filePaths: string[]): Promise<BulkDeleteResult> {
    try {
      await this.utapi.deleteFiles(filePaths, { keyType: "fileKey" });
      return {
        successful: filePaths,
        failed: [],
      };
    } catch (error: any) {
      // If bulk delete fails entirely, report all as failed
      return {
        successful: [],
        failed: filePaths.map(fp => ({
          filePath: fp,
          error: error?.message ?? "Bulk delete failed",
        })),
      };
    }
  }

  /**
   * Check if file exists on Uploadthing.
   * Uses getFileUrls - if it returns data with URLs, the file exists.
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const result = await this.utapi.getFileUrls([filePath], {
        keyType: "fileKey",
      });
      // getFileUrls returns { data: readonly [{ url, key }] }
      const items = Array.from(result.data);
      return items.length > 0 && !!items[0]?.url;
    } catch {
      return false;
    }
  }

  /**
   * Get public URL for a file.
   * Uploadthing files are served from utfs.io CDN.
   * The URL is stored at upload time, so this reconstructs it from the key.
   */
  getPublicUrl(filePath: string): string {
    // Uploadthing URLs follow the pattern: https://utfs.io/f/{fileKey}
    return `https://utfs.io/f/${filePath}`;
  }

  /**
   * Get storage type identifier.
   */
  getType(): string {
    return "uploadthing";
  }

  /**
   * Keep filename sanitization local so this adapter remains stable
   * even if upstream base adapter type declarations drift.
   */
  protected sanitizeFilename(filename: string): string {
    const basename = filename.split(/[/\\]/).pop() || filename;
    return basename.replace(/[^a-zA-Z0-9._-]/g, "-");
  }
}
