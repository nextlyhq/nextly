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

import {
  deadlineSignal,
  resolveReadBounds,
  withDeadline,
} from "../fetch-stored-bytes";
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
// Reading
// ============================================================

/** How much of a file one `read` syscall pulls into memory. */
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Buffer an open file, refusing it once more than `maxBytes` has arrived.
 *
 * Counted as it ARRIVES rather than taken from the size the descriptor
 * reported, because the two disagree exactly where the cap matters: a file
 * still being appended to answers honestly about its size and grows anyway,
 * and a path whose metadata cannot describe its contents at all — a FIFO
 * reports zero bytes and delivers as many as its writer sends — passes any
 * cap on the strength of that zero.
 *
 * @param handle - An open descriptor, whose position this advances
 * @param filePath - The caller's path, carried only in the refusal
 * @param maxBytes - The cap this read runs under
 */
async function readCounted(
  handle: fs.FileHandle,
  filePath: string,
  maxBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let received = 0;

  for (;;) {
    /*
     * Checked before each syscall, so a read the caller has already given up on
     * stops asking for more. It cannot cancel the one in flight — no filesystem
     * call takes a signal — but it bounds the abandoned work to a SINGLE chunk
     * rather than the whole file, which is the difference between one blocked
     * threadpool slot and one held for as long as the file is long.
     */
    if (signal.aborted) throw signal.reason as Error;

    const { bytesRead } = await handle.read(chunk, 0, READ_CHUNK_BYTES, null);
    if (bytesRead === 0) break;

    received += bytesRead;
    if (received > maxBytes) {
      throw new StorageReadTooLargeError(filePath, maxBytes, received);
    }
    // Copied, because the next iteration reads back into the same buffer.
    chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
  }

  return Buffer.concat(chunks);
}

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
   * Honours the caller's bounds, which matters MORE here than anywhere else:
   * this is the default backend, so a bound the cloud adapters keep and this
   * one ignores is a bound that does nothing in the commonest deployment.
   *
   * Both bounds are enforced against ONE open descriptor. Resolving the name,
   * asking for its size and then reading it again by name resolves the same
   * name three times: a file replaced in between is read under a cap measured
   * on the file it displaced, and one appended to in between is buffered whole
   * however small it was when asked. The descriptor settles the first, and
   * counting the bytes as they arrive settles the second.
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

    /*
     * RACED rather than cancelled, which is the only bound available to it: a
     * filesystem call runs on the libuv threadpool and takes no signal, so a
     * `basePath` on an unresponsive network mount blocks `open` and `read`
     * with nothing to interrupt them. The work below keeps running and closes
     * its own descriptor whichever side wins; what the race buys is that
     * `read` answers within the deadline it advertised instead of holding its
     * caller for as long as the mount stays down.
     */
    const deadline = deadlineSignal(bounds.timeoutMs, filePath);
    const work = this.readWithinCap(
      fullPath,
      filePath,
      bounds.maxBytes,
      deadline.signal
    );
    /*
     * A lost race rejects the caller from `withDeadline` and leaves this
     * promise to settle with nobody attached — an unhandled rejection for a
     * read whose outcome has already been reported.
     */
    void work.catch(() => undefined);
    try {
      return await withDeadline(work, deadline.signal);
    } finally {
      /*
       * Whichever side won. If the deadline fired, clearing is a no-op; if the
       * read finished first, this is what stops a timer per read sitting on the
       * heap for the whole timeout with nobody left to answer.
       */
      deadline.cancel();
    }
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Read one opened file, refusing it the moment it exceeds the cap.
   *
   * Split out so the whole descriptor lifetime — open, size, read, close —
   * sits inside a single promise the caller can race, and so the close in its
   * `finally` still runs when that race has already answered the caller.
   *
   * @param fullPath - Absolute path, already validated against `basePath`
   * @param filePath - The caller's path, carried only in the refusal
   * @param maxBytes - The cap this read runs under
   */
  private async readWithinCap(
    fullPath: string,
    filePath: string,
    maxBytes: number,
    signal: AbortSignal
  ): Promise<Buffer | null> {
    const handle = await fs.open(fullPath, "r").catch(() => null);
    // A missing file, and every other reason opening one fails — the same
    // answer this method gave when it resolved the name a second time.
    if (handle === null) return null;

    try {
      /*
       * A cheap refusal from the descriptor's OWN metadata, so an oversized
       * file costs one fstat rather than a walk up to the cap. It cannot stand
       * alone, which is why the counting below is not redundant with it.
       */
      /*
       * Checked before the fstat, not only inside the chunk loop below. An
       * `open` that completes AFTER the deadline has already answered the
       * caller would otherwise spend a second filesystem call — on the same
       * stalled mount, blocking another threadpool slot — for a result nobody
       * is waiting for. The `finally` still closes the descriptor.
       */
      if (signal.aborted) throw signal.reason as Error;

      const { size } = await handle.stat();
      if (size > maxBytes) {
        /*
         * Thrown rather than returned as `null`, because refusing a file that
         * IS there is not the same answer as not finding one — and a caller
         * told `null` would go on to treat a present file as missing.
         */
        throw new StorageReadTooLargeError(filePath, maxBytes, size);
      }
      return await readCounted(handle, filePath, maxBytes, signal);
    } catch (error) {
      // The refusal is an answer about a file that exists, so it travels;
      // everything else keeps reading as absence, unchanged.
      if (error instanceof StorageReadTooLargeError) throw error;
      return null;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

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
