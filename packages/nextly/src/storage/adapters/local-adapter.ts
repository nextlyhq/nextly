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

import { consoleLogger } from "../../shared/types";
import {
  deadlineSignal,
  resolveReadBounds,
  withDeadline,
} from "../fetch-stored-bytes";
import { StorageReadTooLargeError } from "../read-errors";
import type {
  IStorageAdapter,
  UploadOptions,
  UploadResult,
  BulkDeleteResult,
  StorageReadOptions,
  StoredFileEntry,
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

/**
 * A stored file opened for sending to a client, as {@link LocalStorageAdapter.openForServing}
 * returns it. The caller owns `handle` and closes it, directly or by reading
 * it through a stream that closes it at the end.
 */
export interface OpenedStoredFile {
  /** The open descriptor every byte of the response is read from. */
  handle: fs.FileHandle;
  /** Its size, from the same descriptor. */
  size: number;
  /** When it was last written, from the same descriptor. */
  modified: Date;
}

/**
 * Failures that mean "there is no servable file at this path" rather than
 * "the disk could not be read": a missing name, a name through something that
 * is not a folder, a name too long or looping through links, and a name the
 * platform refuses outright (a NUL byte).
 */
const ABSENT_FILE_CODES = new Set([
  "ENOENT",
  "ENOTDIR",
  "ENAMETOOLONG",
  "ELOOP",
  "ERR_INVALID_ARG_VALUE",
  "ERR_INVALID_ARG_TYPE",
]);

function isAbsentFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && ABSENT_FILE_CODES.has(code);
}

/**
 * Opening never waits on the file: a FIFO placed in the folder would
 * otherwise hold a threadpool slot until something wrote to it. It changes
 * nothing for a regular file, and the platforms without the flag get 0.
 */
const OPEN_FOR_SERVING = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0);

/**
 * The marker a route serving local uploads sets when it loads, on the global
 * object so a second copy of this module in another server bundle sees it.
 */
const UPLOADS_ROUTE_LOADED = Symbol.for("nextly.local-uploads-route-loaded");

/** Whether the unserved-upload warning has been given in this process. */
let unservedWarningGiven = false;

/** Where serving local uploads, and the route it needs, are explained. */
const LOCAL_UPLOADS_DOCS_URL =
  "https://nextlyhq.com/docs/guides/media-storage#how-local-uploads-are-served";

/**
 * Record that a route serving local uploads has loaded in this process, so
 * an upload made in production is not warned about.
 */
export function markLocalUploadsRouteLoaded(): void {
  Reflect.set(globalThis, UPLOADS_ROUTE_LOADED, true);
}

function localUploadsRouteLoaded(): boolean {
  return Reflect.get(globalThis, UPLOADS_ROUTE_LOADED) === true;
}

/**
 * Warn, once per process, when a production server stores a file locally and
 * no route serving local uploads has loaded.
 *
 * Next.js reads `public/` once when `next start` begins and serves only what
 * was there, so without the route a file uploaded afterwards answers 404
 * until the server restarts. Asked at upload time rather than at boot:
 * Next.js loads route modules after the instrumentation hook has run, so at
 * boot the route has not loaded yet even where it exists, and by the first
 * upload it has, unless the app turned `preloadEntriesOnStart` off.
 *
 * @param publicUrl - The URL the stored file was given
 * @param baseUrl - This adapter's URL prefix, for the route's location
 */
function warnIfUploadUnserved(publicUrl: string, baseUrl: string): void {
  if (process.env.NODE_ENV !== "production") return;
  if (unservedWarningGiven || localUploadsRouteLoaded()) return;
  unservedWarningGiven = true;
  consoleLogger.warn(
    `[Nextly] ${publicUrl} was stored on local disk, but no route serving ${baseUrl}/ has loaded in this server, ` +
      "so Next.js answers 404 for it until the server restarts. " +
      `Add app${baseUrl}/[...path]/route.ts exporting GET and HEAD from createUploadsHandlers (nextly/api/uploads): ` +
      LOCAL_UPLOADS_DOCS_URL
  );
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

/**
 * Whether `candidate` names `base` itself or something below it.
 *
 * Asked of the relative path between the two rather than of a string prefix,
 * because a prefix also matches a SIBLING whose name starts with the base's:
 * `public/uploads-private` begins with `public/uploads`. Every check that a
 * path stays inside the storage folder goes through this one test.
 *
 * @param base - An absolute, resolved folder
 * @param candidate - An absolute, resolved path
 */
function isWithin(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
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

    const url = this.getPublicUrl(key);
    warnIfUploadUnserved(url, this.baseUrl);

    return { url, path: key };
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
   * Every file under the uploads folder, by its stored path (relative, with
   * `/`), and when it was last written. The `.gitignore` the adapter writes
   * there is its own, not a stored file.
   */
  async *list(): AsyncIterable<StoredFileEntry> {
    const entries = await fs
      .readdir(this.basePath, { recursive: true, withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        // No uploads folder yet: nothing is stored.
        if (error.code === "ENOENT") return [];
        throw error;
      });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.parentPath, entry.name);
      const relative = path
        .relative(this.basePath, full)
        .split(path.sep)
        .join("/");
      if (relative === ".gitignore") continue;
      // A file removed since the folder was read (a delete running at the
      // same time) is no longer stored: skipped, and the listing goes on.
      // Any other failure to read it still ends the listing.
      const stats = await fs
        .stat(full)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (!stats) continue;
      yield { path: relative, lastModified: stats.mtime };
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
   * The URL prefix this adapter's files are served under, without a trailing
   * slash, as {@link getPublicUrl} builds URLs from it.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * The stored path a request path names, or null when it is not under this
   * adapter's `baseUrl`. The inverse of {@link getPublicUrl}: the request
   * path arrives percent-encoded, so each segment is decoded, and one that
   * does not decode names nothing. An absolute `baseUrl` (another host)
   * answers on no path of this server.
   *
   * @param urlPath - A request's path, such as `/uploads/2026/04/x.png`
   */
  storedPathForUrl(urlPath: string): string | null {
    if (!this.baseUrl.startsWith("/") && this.baseUrl !== "") return null;
    const prefix = `${this.baseUrl}/`;
    if (!urlPath.startsWith(prefix)) return null;
    const rest = urlPath.slice(prefix.length);
    if (rest === "") return null;
    try {
      return rest.split("/").map(decodeURIComponent).join("/");
    } catch {
      return null;
    }
  }

  /**
   * Open a stored file to send to a client, or null when there is no file
   * this adapter would serve at that path.
   *
   * The same containment check as every other operation decides the path,
   * and then the REAL path, links resolved, must still sit inside the real
   * storage folder, so a link placed in the folder cannot hand out a file
   * from elsewhere on the disk. Names with a segment starting with `.` are
   * never served: no generated key has one, and the folder may hold files
   * of its own such as a `.gitignore`.
   *
   * Opened once and described from that descriptor, so the size and date a
   * response states belong to the bytes it sends. Nothing is read here: the
   * caller streams from the handle, which is what lets a file larger than
   * {@link read}'s cap be served without holding it in memory.
   *
   * A missing file is null; a disk that cannot be read throws, so a caller
   * does not answer "no such file" during an outage.
   *
   * @param filePath - A stored path, relative to the storage folder
   */
  async openForServing(filePath: string): Promise<OpenedStoredFile | null> {
    let fullPath: string;
    try {
      fullPath = this.resolveAndValidate(filePath);
    } catch {
      return null;
    }
    const relative = path.relative(this.basePath, fullPath);
    if (
      relative === "" ||
      relative.split(path.sep).some(part => part.startsWith("."))
    ) {
      return null;
    }

    let realPath: string;
    try {
      const [realBase, realFile] = await Promise.all([
        fs.realpath(this.basePath),
        fs.realpath(fullPath),
      ]);
      if (!isWithin(realBase, realFile)) return null;
      realPath = realFile;
    } catch (error) {
      if (isAbsentFileError(error)) return null;
      throw error;
    }

    let handle: fs.FileHandle;
    try {
      handle = await fs.open(realPath, OPEN_FOR_SERVING);
    } catch (error) {
      if (isAbsentFileError(error)) return null;
      throw error;
    }
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        await handle.close();
        return null;
      }
      return { handle, size: stats.size, modified: stats.mtime };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
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
    if (!isWithin(this.basePath, fullPath)) {
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
 * The adapter as a {@link LocalStorageAdapter}, or null when it is not one.
 *
 * Judged by the adapter's type and the methods serving needs rather than by
 * `instanceof`, because a route bundle and the storage it reads can each
 * hold a copy of this module, and `instanceof` is false across two copies of
 * one class.
 *
 * @param adapter - Any storage adapter, or nothing
 */
export function asLocalStorageAdapter(
  adapter: IStorageAdapter | null | undefined
): LocalStorageAdapter | null {
  if (!adapter || adapter.getType() !== "local") return null;
  if (adapter instanceof LocalStorageAdapter) return adapter;
  const candidate = adapter as Partial<LocalStorageAdapter>;
  return typeof candidate.storedPathForUrl === "function" &&
    typeof candidate.openForServing === "function"
    ? (adapter as LocalStorageAdapter)
    : null;
}

/**
 * Reset the once-per-process state: gitignore tracking, the unserved-upload
 * warning and the route marker (for testing)
 */
export function resetLocalAdapterState(): void {
  gitignoreUpdated = false;
  unservedWarningGiven = false;
  Reflect.deleteProperty(globalThis, UPLOADS_ROUTE_LOADED);
}
