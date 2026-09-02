/**
 * Local Disk Storage Adapter
 *
 * Stores files on the local filesystem. Used as the default storage adapter
 * for development when no cloud storage env vars are detected.
 *
 * Files are stored in `./public/uploads/` by default and served via
 * Next.js static file serving at `/uploads/...`.
 *
 * @example
 * ```typescript
 * const adapter = new LocalStorageAdapter({
 *   basePath: './public/uploads',
 *   baseUrl: '/uploads',
 * });
 *
 * const result = await adapter.upload(buffer, {
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 * });
 * // result.url = '/uploads/2026/04/abc-photo.jpg'
 * // result.path = '2026/04/abc-photo.jpg'
 * // File on disk: ./public/uploads/2026/04/abc-photo.jpg
 * ```
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { resolveReadBounds } from "../fetch-stored-bytes";
import { StorageReadTooLargeError } from "../read-errors";
import type {
  UploadOptions,
  UploadResult,
  BulkDeleteResult,
  StorageReadOptions,
} from "../types";

import { BaseStorageAdapter } from "./base-adapter";

// ============================================================
// Configuration
// ============================================================

export interface LocalAdapterConfig {
  /** Directory to store files (default: ./public/uploads) */
  basePath: string;
  /** URL prefix for serving files (default: /uploads) */
  baseUrl: string;
}

// Track whether we've already added to .gitignore this session
let gitignoreUpdated = false;

// ============================================================
// Adapter Implementation
// ============================================================

export class LocalStorageAdapter extends BaseStorageAdapter {
  private readonly basePath: string;
  private readonly baseUrl: string;

  constructor(config: LocalAdapterConfig) {
    super();
    // Resolve basePath to absolute to prevent traversal issues
    this.basePath = path.resolve(config.basePath);
    // Ensure baseUrl has no trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  /**
   * Upload file to local disk.
   * Creates directories as needed and writes the file buffer.
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    // Generate a unique key using the base class helper
    const key = this.generateKey(options.filename, options.folder);

    // Resolve full path and verify it's within basePath
    const fullPath = this.resolveAndValidate(key);

    // Create parent directories
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write the file
    await fs.writeFile(fullPath, buffer);

    // Auto-add uploads dir to .gitignore on first upload
    await this.ensureGitignore();

    return {
      url: this.getPublicUrl(key),
      path: key,
    };
  }

  /**
   * Delete file from local disk.
   * Silently succeeds if the file doesn't exist.
   */
  async delete(filePath: string): Promise<void> {
    // Validate the path is within basePath before deleting
    let fullPath: string;
    try {
      fullPath = this.resolveAndValidate(filePath);
    } catch {
      // Path traversal attempt or invalid path - silently ignore
      return;
    }

    try {
      await fs.unlink(fullPath);
    } catch (err) {
      // ENOENT = file not found - that's fine, it's already gone
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  /**
   * Bulk delete files from local disk.
   * Uses parallel unlinks with Promise.allSettled for best performance.
   */
  async bulkDelete(filePaths: string[]): Promise<BulkDeleteResult> {
    const results = await Promise.allSettled(
      filePaths.map(async filePath => {
        await this.delete(filePath);
        return filePath;
      })
    );

    const successful: string[] = [];
    const failed: Array<{ filePath: string; error: string }> = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        successful.push(filePaths[index]);
      } else {
        failed.push({
          filePath: filePaths[index],
          error: result.reason?.message || "Unknown error",
        });
      }
    });

    return { successful, failed };
  }

  /**
   * Check if file exists on local disk.
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveAndValidate(filePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get public URL for a file.
   * Returns baseUrl + relative path for Next.js static file serving.
   */
  getPublicUrl(filePath: string): string {
    const cleanPath = filePath.replace(/^\/+/, "");
    return `${this.baseUrl}/${cleanPath}`;
  }

  /**
   * Get storage type identifier.
   */
  getType(): string {
    return "local";
  }

  /**
   * Read file contents from local disk.
   *
   * Returns the file buffer, or `null` if the file is not found.
   *
   * Honours the caller's cap, which matters MORE here than anywhere else: this
   * is the default backend, so a bound the cloud adapters keep and this one
   * ignores is a bound that does nothing in the commonest deployment. Checked
   * against the file's size before reading, because `readFile` buffers the
   * whole thing — a cap enforced afterwards has already spent the memory it
   * exists to save.
   */
  async read(
    filePath: string,
    options?: StorageReadOptions
  ): Promise<Buffer | null> {
    let fullPath: string;
    try {
      fullPath = this.resolveAndValidate(filePath);
    } catch {
      // A path escaping the storage directory, which is a refusal rather than
      // an absence — but this method's contract has no way to say so, and its
      // callers have always read a traversal attempt as "no such file".
      return null;
    }

    /*
     * The DEFAULTS apply here too, which is the whole reason this goes through
     * the shared resolver. A caller naming no cap still gets one — the media
     * pipeline reads without options — and before this the URL-backed adapters
     * inherited a bound from `safeFetch` while this one, the default backend,
     * had none at all.
     */
    const bounds = resolveReadBounds(options);

    let size: number;
    try {
      size = (await fs.stat(fullPath)).size;
    } catch {
      return null;
    }

    /*
     * Thrown rather than returned as `null`, because refusing a file that IS
     * there is not the same answer as not finding one — and a caller told
     * `null` would go on to treat a present file as missing.
     */
    if (size > bounds.maxBytes) {
      throw new StorageReadTooLargeError(filePath, bounds.maxBytes, size);
    }

    try {
      return await fs.readFile(fullPath);
    } catch {
      return null;
    }
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Resolve a relative file path to an absolute path within basePath.
   * Throws if the resolved path would escape basePath (path traversal attack).
   */
  private resolveAndValidate(filePath: string): string {
    // Sanitize: remove any leading slashes or traversal sequences
    const sanitized = filePath.replace(/^[/\\]+/, "").replace(/\.\.[/\\]/g, "");
    const fullPath = path.resolve(this.basePath, sanitized);

    // Verify the resolved path is still within basePath
    if (!fullPath.startsWith(this.basePath)) {
      throw new Error(
        `Path traversal detected: ${filePath} resolves outside of storage directory`
      );
    }

    return fullPath;
  }

  /**
   * Auto-add the uploads directory to .gitignore on first upload.
   * Prevents accidentally committing uploaded files to git.
   */
  private async ensureGitignore(): Promise<void> {
    if (gitignoreUpdated) return;
    gitignoreUpdated = true;

    try {
      // Find .gitignore relative to basePath (go up to find project root)
      // basePath is typically ./public/uploads, so project root is ../../
      const projectRoot = path.resolve(this.basePath, "..", "..");
      const gitignorePath = path.join(projectRoot, ".gitignore");

      let content = "";
      try {
        content = await fs.readFile(gitignorePath, "utf-8");
      } catch {
        // .gitignore doesn't exist, we'll create it
      }

      // Check if uploads dir is already ignored
      const uploadsDirRelative = path.relative(projectRoot, this.basePath);
      const ignorePattern = uploadsDirRelative + "/";

      if (!content.includes(ignorePattern)) {
        const newEntry = `\n# Nextly local uploads (auto-added)\n${ignorePattern}\n`;
        await fs.writeFile(gitignorePath, content + newEntry, "utf-8");
      }
    } catch {
      // Non-critical: if we can't update .gitignore, uploads still work
    }
  }
}

/**
 * Reset gitignore tracking (for testing)
 */
export function resetLocalAdapterState(): void {
  gitignoreUpdated = false;
}
