/**
 * Serve files stored by the local disk adapter, at the URLs it hands out.
 *
 * The local adapter writes into `public/uploads` and gives each file a URL
 * under `/uploads`, which Next.js serves as a static file. But `next start`
 * reads `public/` ONCE, when it starts, and serves only the files that were
 * there: a file uploaded afterwards answers 404 until the server restarts.
 * `next dev` reads the folder on every request, which is why the gap shows
 * only in production.
 *
 * Mounted at the adapter's URL as a catch-all route, this answers exactly the
 * requests Next.js has no static file for, since Next.js checks `public/`
 * before any dynamic route. So a file present at start is still served by
 * Next.js, and one uploaded since is served here, at the same URL.
 *
 * ```typescript
 * // src/app/uploads/[...path]/route.ts
 * import { createUploadsHandlers } from "nextly/api/uploads";
 *
 * import nextlyConfig from "@nextly-config";
 *
 * const handlers = createUploadsHandlers({ config: nextlyConfig });
 *
 * export const GET = handlers.GET;
 * export const HEAD = handlers.HEAD;
 * ```
 *
 * It serves ONLY from a local adapter Nextly is configured with, and only
 * below that adapter's `baseUrl`. With S3, Vercel Blob or UploadThing storing
 * media, every request here is 404: those files have their own URLs on their
 * own hosts and never pass through this route.
 *
 * Uploaded media is public, as it is when Next.js serves it, so this asks for
 * no session. It is mounted outside `/admin` on purpose: the admin's session
 * cookie is scoped to `/admin`, and public assets should neither carry it nor
 * share the admin API's rate limits.
 *
 * @module api/uploads
 */
import type { SanitizedNextlyConfig } from "../collections/config/define-config";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly, getNextly } from "../init";
import { DEFAULT_ACCEPTED_FORMATS } from "../services/upload-validation/mime";
import { isGeneratedStorageKey } from "../storage/adapters/base-adapter";
import {
  asLocalStorageAdapter,
  markLocalUploadsRouteLoaded,
  type LocalStorageAdapter,
  type OpenedStoredFile,
} from "../storage/adapters/local-adapter";
import { getMediaStorage } from "../storage/storage";
import { getSvgSecurityHeaders, isSvgMimeType } from "../storage/svg-security";

import { buildErrorResponse } from "./error-response";
import { readOrGenerateRequestId } from "./request-id";
import { withErrorHandler } from "./with-error-handler";

// ============================================================
// Types
// ============================================================

/** Options for {@link createUploadsHandlers}. */
export interface UploadsHandlerOptions {
  /**
   * The Nextly config. Passed so the storage this route reads from is set
   * up on a worker the instrumentation hook did not start.
   */
  config?: SanitizedNextlyConfig;
}

// ============================================================
// Content type
// ============================================================

/**
 * The type each accepted extension is served as, DERIVED from the formats
 * an upload is accepted in, so a format added there is served with its own
 * type here.
 */
const TYPE_BY_EXTENSION: ReadonlyMap<string, string> = new Map(
  DEFAULT_ACCEPTED_FORMATS.flatMap(format =>
    format.extensions.map(extension => [extension, format.mimeType] as const)
  )
);

/** How a stored file is labelled: its type, and whether it downloads rather than displays. */
interface ServedType {
  contentType: string;
  attachment: boolean;
}

/**
 * The type a stored file is served as, by its extension, as Next.js serves
 * a static file. A file of a type the default formats do not name (an
 * install can accept more) is sent as a download of unknown type, so a
 * browser never renders bytes this route cannot vouch for.
 *
 * @param storedPath - The stored path, whose last extension decides
 */
function servedTypeFor(storedPath: string): ServedType {
  const name = storedPath.slice(storedPath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const known =
    dot > 0 ? TYPE_BY_EXTENSION.get(name.slice(dot).toLowerCase()) : undefined;
  return known
    ? { contentType: known, attachment: false }
    : { contentType: "application/octet-stream", attachment: true };
}

// ============================================================
// Caching
// ============================================================

/**
 * A generated key names bytes written once (see `isGeneratedStorageKey`),
 * so a year and `immutable` is true of it. Anything else in the folder can
 * change under the same name, so it is revalidated on every use.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";

/**
 * A validator from the descriptor's own size and modification time, as
 * Next.js's static serving builds one. Strong rather than weak, because a
 * range request may only be resumed against a strong validator.
 */
function entityTag(file: OpenedStoredFile): string {
  return `"${file.size.toString(16)}-${Math.floor(file.modified.getTime()).toString(16)}"`;
}

/** Whether an `If-None-Match` list names this tag (or is `*`). */
function noneMatchHits(header: string, tag: string): boolean {
  return header
    .split(",")
    .map(part => part.trim().replace(/^W\//, ""))
    .some(part => part === "*" || part === tag);
}

/**
 * Whether the client's copy is current, by `If-None-Match` when it sent one
 * and by `If-Modified-Since` only when it did not, as HTTP orders them.
 */
function notModified(request: Request, tag: string, modified: Date): boolean {
  const noneMatch = request.headers.get("if-none-match");
  if (noneMatch !== null) return noneMatchHits(noneMatch, tag);
  const since = Date.parse(request.headers.get("if-modified-since") ?? "");
  if (Number.isNaN(since)) return false;
  // HTTP dates carry whole seconds, so the file's time is compared at that grain.
  return Math.floor(modified.getTime() / 1000) <= Math.floor(since / 1000);
}

// ============================================================
// Ranges
// ============================================================

/** The answer to a `Range` header: a span to send, a span that cannot be sent, or the whole file. */
type RangeAnswer =
  | { kind: "whole" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Read a `Range` header against a file of `size` bytes.
 *
 * One span is honoured, in any of its three spellings: `bytes=0-99`,
 * `bytes=100-` and the suffix `bytes=-100`. Media players ask for one span at
 * a time. A header asking for several, or one that does not parse, is
 * answered with the whole file, which HTTP permits for any range request.
 * A span starting past the end is the one refusal, 416.
 */
function readRange(header: string | null, size: number): RangeAnswer {
  if (header === null) return { kind: "whole" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "whole" };
  const [, from, to] = match;
  if (from === "" && to === "") return { kind: "whole" };

  if (from === "") {
    const suffix = Number(to);
    if (suffix === 0) return { kind: "unsatisfiable" };
    if (size === 0) return { kind: "unsatisfiable" };
    return {
      kind: "partial",
      start: Math.max(0, size - suffix),
      end: size - 1,
    };
  }

  const start = Number(from);
  if (start >= size) return { kind: "unsatisfiable" };
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (end < start) return { kind: "whole" };
  return { kind: "partial", start, end };
}

/**
 * Whether a range request may be answered with a range: always without
 * `If-Range`, and with it only while the client's validator still names
 * this file, so a resumed download never splices two versions together.
 */
function rangeStillApplies(
  request: Request,
  tag: string,
  modified: Date
): boolean {
  const ifRange = request.headers.get("if-range");
  if (ifRange === null) return true;
  if (ifRange.startsWith('"')) return ifRange === tag;
  const date = Date.parse(ifRange);
  return (
    !Number.isNaN(date) &&
    Math.floor(modified.getTime() / 1000) === Math.floor(date / 1000)
  );
}

// ============================================================
// Responses
// ============================================================

/** The one answer for every file this route will not send. */
function notFound(request: Request): Response {
  return buildErrorResponse(NextlyError.notFound(), {
    requestId: readOrGenerateRequestId(request),
  });
}

/**
 * The headers every answer about a found file carries, 304 included.
 * `nosniff` on all of them, so a browser takes the stated type rather than
 * guessing one from the bytes; and an SVG, which a browser runs scripts in
 * when it is opened directly, gets the policy that forbids them.
 */
function fileHeaders(
  storedPath: string,
  file: OpenedStoredFile,
  tag: string
): Headers {
  const type = servedTypeFor(storedPath);
  const headers = new Headers({
    "Content-Type": type.contentType,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ETag: tag,
    "Last-Modified": file.modified.toUTCString(),
    "Cache-Control": isGeneratedStorageKey(storedPath) ? IMMUTABLE : REVALIDATE,
  });
  if (isSvgMimeType(type.contentType)) {
    for (const [name, value] of Object.entries(getSvgSecurityHeaders())) {
      headers.set(name, value);
    }
  }
  if (type.attachment) headers.set("Content-Disposition", "attachment");
  return headers;
}

/**
 * The bytes from `start` to `end` inclusive, read from the open descriptor
 * as the client takes them, and the descriptor closed when the last one is
 * sent or the client goes away. Memory holds one chunk at a time, whatever
 * the file's size.
 */
function bodyStream(
  file: OpenedStoredFile,
  start: number,
  end: number
): ReadableStream<Uint8Array> {
  const stream = file.handle.createReadStream({ start, end, autoClose: true });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: Buffer | string) => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(bytes));
        // Paused until the client asks for more, so a slow reader is not
        // fed the file faster than it can take it.
        if ((controller.desiredSize ?? 0) <= 0) stream.pause();
      });
      stream.once("end", () => controller.close());
      stream.once("error", error => controller.error(error));
    },
    pull() {
      stream.resume();
    },
    cancel() {
      stream.destroy();
    },
  });
}

/**
 * The local adapter whose `baseUrl` a request path is under, and the stored
 * path it names; or null when no local adapter answers it.
 *
 * Asked of the media collection's adapter, which every upload is written
 * through, and of any local storage plugin besides it. Only a LOCAL one is
 * asked: a cloud adapter's files are not on this disk, and its URLs never
 * name this server.
 */
function findStoredPath(
  urlPath: string
): { adapter: LocalStorageAdapter; storedPath: string } | null {
  const storage = getMediaStorage();
  const candidates = [
    storage.getAdapterForCollection("media"),
    ...storage.getPlugins().map(plugin => plugin.adapter),
  ];
  for (const candidate of candidates) {
    const adapter = asLocalStorageAdapter(candidate);
    const storedPath = adapter?.storedPathForUrl(urlPath) ?? null;
    if (adapter && storedPath !== null) return { adapter, storedPath };
  }
  return null;
}

/** The span a range answer sends, the whole file when it names none. */
function spanOf(
  range: RangeAnswer,
  size: number
): { start: number; end: number; partial: boolean } {
  return range.kind === "partial"
    ? { start: range.start, end: range.end, partial: true }
    : { start: 0, end: size - 1, partial: false };
}

/** Close the file and answer with headers only. */
async function headersOnly(
  file: OpenedStoredFile,
  status: number,
  headers: Headers
): Promise<Response> {
  await file.handle.close();
  return new Response(null, { status, headers });
}

/**
 * Answer a request for an opened file: 304 for a current copy, 416 for a
 * span past its end, otherwise the file or the asked-for span of it.
 *
 * @param withBody - False for HEAD, which states the headers and sends nothing
 */
async function answerWithFile(
  request: Request,
  storedPath: string,
  file: OpenedStoredFile,
  withBody: boolean
): Promise<Response> {
  const tag = entityTag(file);
  const headers = fileHeaders(storedPath, file, tag);

  if (notModified(request, tag, file.modified)) {
    headers.delete("Content-Type");
    return headersOnly(file, 304, headers);
  }

  const range: RangeAnswer = rangeStillApplies(request, tag, file.modified)
    ? readRange(request.headers.get("range"), file.size)
    : { kind: "whole" };
  if (range.kind === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${file.size}`);
    headers.delete("Content-Type");
    return headersOnly(file, 416, headers);
  }

  const { start, end, partial } = spanOf(range, file.size);
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (partial) {
    headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
  }
  const status = partial ? 206 : 200;

  // An empty file, or a HEAD request: the headers say everything.
  if (!withBody || file.size === 0) return headersOnly(file, status, headers);
  return new Response(bodyStream(file, start, end), { status, headers });
}

/**
 * Answer one request for a stored file.
 *
 * @param request - The incoming request; its path decides the file
 * @param withBody - False for HEAD, which states the headers and sends nothing
 */
async function serveStoredFile(
  request: Request,
  withBody: boolean
): Promise<Response> {
  const found = findStoredPath(new URL(request.url).pathname);
  if (found === null) return notFound(request);
  const file = await found.adapter.openForServing(found.storedPath);
  if (file === null) return notFound(request);
  return answerWithFile(request, found.storedPath, file, withBody);
}

// ============================================================
// Handlers
// ============================================================

/**
 * Create the GET and HEAD handlers for the route that serves local uploads.
 *
 * Creating them also records that this server has the route, which is what
 * stops a production upload being warned about as unserved.
 *
 * @param options - The Nextly config, for a worker the instrumentation hook did not start
 */
export function createUploadsHandlers(options: UploadsHandlerOptions = {}) {
  markLocalUploadsRouteLoaded();
  const { config } = options;

  async function ensureStorage(): Promise<void> {
    // Storage is set up as Nextly starts; on a worker it has not started on,
    // the config passed here starts it.
    if (config) await getNextly({ config });
    else await getCachedNextly();
  }

  return {
    GET: withErrorHandler(async (request: Request): Promise<Response> => {
      await ensureStorage();
      return serveStoredFile(request, true);
    }),
    HEAD: withErrorHandler(async (request: Request): Promise<Response> => {
      await ensureStorage();
      return serveStoredFile(request, false);
    }),
  };
}
