/**
 * The pages and route responses `next build` wrote to disk, read through
 * Next.js's own file-system cache.
 *
 * nextly's incremental cache handler keeps what it stores in memory, so a new
 * server process starts with nothing in it. Without this, every page the build
 * prerendered (the admin page among them) missed on the first request each
 * process served and was rendered again, reading whatever its layouts read,
 * which during a slow start can outlast the time Next.js gives a render. Next
 * .js's own handler serves those pages from the build's files; this is that
 * same reader, used for a miss.
 *
 * Next.js's `FileSystemCache` is an internal module, loaded by path from the
 * `next` the app runs, so its layout of the build output is never re-derived
 * here. A test pins the path, so a release that moves it fails loudly there.
 *
 * @module runtime/cache/build-output
 */

import { createRequire } from "node:module";

/** What Next.js hands a cache handler as it constructs it. */
export interface CacheHandlerContext {
  fs?: unknown;
  serverDistDir?: string;
  revalidatedTags?: readonly string[];
}

/** One entry as Next.js's file-system cache returns it. */
export interface BuildOutputEntry {
  lastModified: number;
  value: unknown;
  cacheControl?: unknown;
}

interface FileSystemCacheLike {
  get(key: string, ctx: unknown): Promise<BuildOutputEntry | null>;
}

/** Where Next.js keeps its file-system cache handler. */
const NEXT_FILE_SYSTEM_CACHE =
  "next/dist/server/lib/incremental-cache/file-system-cache.js";

/** The kinds of entry the build writes to disk: pages and route responses. */
const BUILD_KINDS = new Set(["APP_PAGE", "APP_ROUTE", "PAGES"]);

/**
 * A reader of the build's output for the handler Next.js constructed with
 * `ctx`, or `undefined` where there is none to read (no build directory, as in
 * development, or a `next` without the module).
 */
export function buildOutputReader(
  ctx: CacheHandlerContext | undefined
):
  | ((
      key: string,
      kind: unknown,
      getCtx: unknown
    ) => Promise<BuildOutputEntry | null>)
  | undefined {
  if (!ctx?.fs || !ctx.serverDistDir) return undefined;
  let reader: FileSystemCacheLike | null | undefined;
  const load = (): FileSystemCacheLike | null => {
    if (reader !== undefined) return reader;
    try {
      // Resolved from the app, which is what installs `next`.
      const required = createRequire(`${process.cwd()}/`)(
        NEXT_FILE_SYSTEM_CACHE
      ) as { default?: new (ctx: unknown) => FileSystemCacheLike };
      const FileSystemCache = required.default;
      reader = FileSystemCache
        ? new FileSystemCache({
            fs: ctx.fs,
            serverDistDir: ctx.serverDistDir,
            revalidatedTags: ctx.revalidatedTags ?? [],
            // Read only: this reader never stores, and keeps no memory copy.
            flushToDisk: false,
            maxMemoryCacheSize: 0,
          })
        : null;
    } catch {
      reader = null;
    }
    return reader;
  };
  return async (key, kind, getCtx) => {
    if (typeof kind !== "string" || !BUILD_KINDS.has(kind)) return null;
    const fileSystem = load();
    if (fileSystem === null) return null;
    try {
      return await fileSystem.get(key, getCtx);
    } catch {
      // An unreadable build file is a miss, as it is for Next.js: the page is
      // rendered and stored as usual.
      return null;
    }
  };
}
