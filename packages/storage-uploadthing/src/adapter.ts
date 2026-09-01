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

import { BaseStorageAdapter } from "nextly/storage";
import type {
  UploadOptions,
  UploadResult,
  BulkDeleteResult,
  StorageReadOptions,
} from "nextly/storage";
import { fetchStoredBytes } from "nextly/storage/fetch-stored-bytes";
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

    // uploadFiles returns UploadFileResult[] — one result per file.
    // Default contentDisposition flipped from "inline" to "attachment".
    // An "inline" disposition lets the browser render the file
    // in-context (HTML, SVG, PDF with embedded JS) which can land as
    // XSS or drive-by; "attachment" forces the download dialog so the
    // user has to opt in to opening it. Adopters who genuinely want
    // inline rendering can still pass `contentDisposition: "inline"`
    // explicitly.
    const results = await this.utapi.uploadFiles([file], {
      contentDisposition: options.contentDisposition ?? "attachment",
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
    } catch (error: unknown) {
      // If bulk delete fails entirely, report all as failed
      const message =
        error instanceof Error ? error.message : "Bulk delete failed";
      return {
        successful: [],
        failed: filePaths.map(fp => ({
          filePath: fp,
          error: message,
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
   * Read a stored file back as bytes, or `null` when it is not there.
   *
   * A NETWORK round trip for the same reason as the Vercel adapter: the bytes
   * live on UploadThing's CDN. A caller serving these from its own origin has
   * to cache, or it pays the fetch on every request.
   *
   * The URL comes from `getFileUrls` rather than being assembled, because the
   * service owns the address and this adapter never chose it.
   *
   * @param filePath - File key
   * @returns The file's bytes, or `null` when no such key exists
   */
  async read(
    filePath: string,
    options?: StorageReadOptions
  ): Promise<Buffer | null> {
    /*
     * NOT wrapped in a catch. This is a batch lookup, so a key that is not
     * there comes back as an EMPTY `data` array — the branch below — rather
     * than as a rejection. What a rejection means instead is an invalid token,
     * an outage or a dropped connection, none of which say the file was
     * deleted; folding those into `null` would let a caller overwrite a file
     * that is still there.
     *
     * Stated as the reasoning rather than as a verified fact: the shape of a
     * missing-key response is not pinned by the SDK's types, so if this service
     * does reject for an absent key, `read` throws where the contract promises
     * `null`. That direction is the safe one to be wrong in — a caller sees an
     * error instead of a false "deleted" — which is why the uncertainty is
     * resolved toward propagating rather than toward swallowing.
     */
    /*
     * ONE deadline for both phases, started before the lookup — the key lookup
     * can stall as readily as the fetch, and it runs first.
     */
    const deadline =
      options?.timeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(options.timeoutMs);

    const result = await this.utapi.getFileUrls([filePath], {
      keyType: "fileKey",
      ...(deadline === undefined ? {} : { signal: deadline }),
    });
    const target = Array.from(result.data)[0]?.url;
    if (target === undefined) return null;

    /*
     * Outside the catch, as in the Vercel adapter, and through the same shared
     * helper: a fetch that fails after the key resolved is a transport failure,
     * and reporting it as absence would let a caller treat a live file as
     * deleted.
     */
    return await fetchStoredBytes(
      target,
      filePath,
      "UploadThing",
      options,
      deadline
    );
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
