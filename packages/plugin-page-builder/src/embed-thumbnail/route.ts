/**
 * The editor's "Use the video's thumbnail": copy the picture a video's
 * provider shows for it into the site's media library, so a poster drawn
 * from it never sends a visitor's browser to the provider.
 *
 * The request names the Embed's link and nothing else. Which picture to
 * fetch, and from where, comes from the block's own provider table
 * (`detectEmbed`): YouTube's picture host, or Vimeo's oEmbed answer naming a
 * picture on Vimeo's picture host. No address the caller chose is ever
 * fetched, so the route cannot be pointed at the server's own network.
 *
 * - **Who may.** Copying stores a file, so the route asks `create-media`
 *   before it reads the request, and the upload runs as the caller, so the
 *   library judges the write as it judges any upload of theirs.
 * - **Once.** The copy is named for the video (`youtube-<id>-thumbnail`), and
 *   an existing file of that name is answered instead of fetching again.
 * - **Bounded.** Each fetch follows no redirect, gives up after a few
 *   seconds, and reads at most a few megabytes; a picture must say it is a
 *   JPEG, PNG or WebP.
 *
 * @module @nextlyhq/plugin-page-builder/embed-thumbnail/route
 */
import {
  detectEmbed,
  type ThumbnailSource,
} from "@nextlyhq/blocks-react";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { readBodyWith } from "../composition-route-kit";
import { asServiceCaller } from "../library-route";

import {
  EMBED_THUMBNAIL_ROUTE_PATH,
  type EmbedThumbnailResult,
} from "./contract";

/** The most a picture may weigh. A provider's largest is well under it. */
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/** The most an oEmbed answer may weigh: a few hundred bytes of JSON. */
const MAX_OEMBED_BYTES = 64 * 1024;

/** How long one fetch may take before it is given up. */
const FETCH_TIMEOUT_MS = 10_000;

/** The pictures taken, by the type the provider says, and their extension. */
const PICTURE_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The request: the Embed's link as stored. */
const COPY_BODY = z.object({ link: z.string().trim().min(1).max(2048) }).strict();

/** The part of an oEmbed answer read: where its picture is. */
const OEMBED_ANSWER = z.object({ thumbnail_url: z.string().url() });

/** How the route fetches: the platform's own, or a test's. */
export type ThumbnailFetch = (
  address: string,
  init: RequestInit
) => Promise<Response>;

/** What the handler reads of the route context. */
export type EmbedThumbnailContext = Pick<
  PluginRouteContext,
  "user" | "authenticatedScope" | "services"
>;

/** A fetched picture: its bytes and its type. */
interface Picture {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/** The refusal for a link that names no video with a picture to copy. */
function noThumbnail(): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "link",
        code: "INVALID_VALUE",
        message: "This link has no video thumbnail to copy.",
      },
    ],
  });
}

/** The refusal for a provider that did not hand over a usable picture. */
function notFetched(reason: string): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage: "The video's thumbnail couldn't be fetched. Try again later.",
    logMessage: "Embed thumbnail fetch failed",
    logContext: { reason },
  });
}

/**
 * The body of an answer, read a chunk at a time and abandoned once it passes
 * `limit`, so a provider cannot make the server hold an answer of any size.
 */
async function boundedBytes(
  answer: Response,
  limit: number
): Promise<Uint8Array> {
  const stated = Number(answer.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > limit) {
    throw notFetched("too-large");
  }
  const reader = answer.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > limit) {
      void reader.cancel().catch(() => undefined);
      throw notFetched("too-large");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * One fetch from a provider's fixed address: no redirect followed (a
 * redirect is refused, so the answer is always the fixed host's own), no
 * cookies or credentials sent, and a time limit.
 */
function fetchFixed(
  fetchFrom: ThumbnailFetch,
  address: string
): Promise<Response> {
  return fetchFrom(address, {
    method: "GET",
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw notFetched(error instanceof Error ? error.name : "fetch-failed");
  });
}

/** A picture fetched from `address`, or `undefined` when there is none there. */
async function pictureAt(
  fetchFrom: ThumbnailFetch,
  address: string
): Promise<Picture | undefined> {
  const answer = await fetchFixed(fetchFrom, address);
  if (answer.status === 404) return undefined;
  if (!answer.ok) throw notFetched(`status-${String(answer.status)}`);
  const mimeType = (answer.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (mimeType === undefined || PICTURE_TYPES[mimeType] === undefined) {
    throw notFetched("not-a-picture");
  }
  const bytes = await boundedBytes(answer, MAX_PICTURE_BYTES);
  if (bytes.byteLength === 0) return undefined;
  return { bytes, mimeType };
}

/** The picture a thumbnail source names, fetched from its fixed host. */
async function fetchThumbnail(
  fetchFrom: ThumbnailFetch,
  source: ThumbnailSource
): Promise<Picture> {
  if (source.kind === "direct") {
    // Best first; the next where a size is missing for this video.
    for (const address of source.addresses) {
      const picture = await pictureAt(fetchFrom, address);
      if (picture !== undefined) return picture;
    }
    throw notFetched("no-picture");
  }
  const answer = await fetchFixed(fetchFrom, source.address);
  if (!answer.ok) throw notFetched(`oembed-status-${String(answer.status)}`);
  let parsed: z.infer<typeof OEMBED_ANSWER>;
  try {
    const text = new TextDecoder().decode(
      await boundedBytes(answer, MAX_OEMBED_BYTES)
    );
    parsed = OEMBED_ANSWER.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof NextlyError) throw error;
    throw notFetched("oembed-unreadable");
  }
  // The answer names the picture; it is fetched only from the provider's
  // picture host, over https, so an answer cannot send the server elsewhere.
  const named = new URL(parsed.thumbnail_url);
  if (named.protocol !== "https:" || named.hostname !== source.pictureHost) {
    throw notFetched("picture-host-refused");
  }
  const picture = await pictureAt(fetchFrom, named.href);
  if (picture === undefined) throw notFetched("no-picture");
  return picture;
}

/** The file name a video's copied picture is stored and found by. */
function copyName(key: string): string {
  return `${key}-thumbnail`;
}

/**
 * An earlier copy of this video's picture, found by its name. Only a file
 * whose original name is exactly the copy's, with a picture extension, is
 * taken: the library's search matches parts of names.
 */
async function earlierCopy(
  ctx: EmbedThumbnailContext,
  key: string
): Promise<EmbedThumbnailResult | undefined> {
  const name = copyName(key);
  const extensions = new Set(Object.values(PICTURE_TYPES));
  const isCopy = (filename: string): boolean => {
    const [base, extension, ...rest] = filename.split(".");
    return (
      rest.length === 0 &&
      base === name &&
      extension !== undefined &&
      extensions.has(extension)
    );
  };
  // Every page of the search, not its first: the search also matches other
  // names, alt text and captions holding these words, newest first, so an
  // older copy can sit behind newer files that only mention the name.
  for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
    const { data, pagination } = await ctx.services.media.listMedia(
      { search: name, type: "image", limit: SEARCH_PAGE, page },
      {}
    );
    const found = data.find(file => isCopy(file.originalFilename));
    if (found !== undefined) {
      return {
        id: found.id,
        url: found.url,
        filename: found.originalFilename,
        reused: true,
      };
    }
    if (!pagination.hasMore) return undefined;
  }
  return undefined;
}

/** How many files one page of the copy's search reads. */
const SEARCH_PAGE = 50;

/** The most pages of the search read before copying anyway. */
const MAX_SEARCH_PAGES = 20;

/**
 * The copies in progress in this server, by the video they are of: a second
 * request for the same video while one is copying (a double press, a retry)
 * waits for that copy and answers it, rather than making another. Copies in
 * two servers at once can still both upload, since the library holds no
 * unique name to refuse the second.
 */
export type CopiesInFlight = Map<string, Promise<EmbedThumbnailResult>>;

/** Copy the link's video picture into the library, or answer the copy made. */
export async function copyEmbedThumbnail(
  req: Request,
  ctx: EmbedThumbnailContext,
  fetchFrom: ThumbnailFetch,
  inFlight: CopiesInFlight = new Map()
): Promise<EmbedThumbnailResult> {
  const { link } = await readBodyWith(req, COPY_BODY, "thumbnail copy");
  const source = detectEmbed(link)?.thumbnail;
  if (source === undefined) throw noThumbnail();
  const pending = inFlight.get(source.key);
  if (pending !== undefined) {
    return { ...(await pending), reused: true };
  }
  const copying = copyOnce(ctx, fetchFrom, source);
  inFlight.set(source.key, copying);
  try {
    return await copying;
  } finally {
    inFlight.delete(source.key);
  }
}

/** The picture's earlier copy, or a new one fetched and uploaded. */
async function copyOnce(
  ctx: EmbedThumbnailContext,
  fetchFrom: ThumbnailFetch,
  source: ThumbnailSource
): Promise<EmbedThumbnailResult> {
  const earlier = await earlierCopy(ctx, source.key);
  if (earlier !== undefined) return earlier;

  const picture = await fetchThumbnail(fetchFrom, source);
  const filename = `${copyName(source.key)}.${PICTURE_TYPES[picture.mimeType] ?? "jpg"}`;
  // As the caller, so the library judges this upload as any upload of theirs
  // (its types, its size, their right to add files) and records them as the
  // uploader.
  const made = await ctx.services.media.upload(
    {
      buffer: Buffer.from(picture.bytes),
      filename,
      mimeType: picture.mimeType,
      size: picture.bytes.byteLength,
    },
    asServiceCaller(ctx)
  );
  return {
    id: String(made.id),
    url: made.url,
    filename: made.originalFilename || filename,
    reused: false,
  };
}

/**
 * The route declaration: a write, gated on `create-media` before the handler
 * runs, answering the canonical mutation envelope.
 */
export function embedThumbnailRoute(
  deps: { readonly fetch?: ThumbnailFetch } = {}
): {
  method: "POST";
  path: string;
  requiredPermission: "create-media";
  handler: (req: Request, ctx: EmbedThumbnailContext) => Promise<Response>;
} {
  const fetchFrom: ThumbnailFetch =
    deps.fetch ?? ((address, init) => fetch(address, init));
  const inFlight: CopiesInFlight = new Map();
  return {
    method: "POST",
    path: EMBED_THUMBNAIL_ROUTE_PATH,
    requiredPermission: "create-media",
    handler: async (req, ctx) => {
      const item = await copyEmbedThumbnail(req, ctx, fetchFrom, inFlight);
      return Response.json({
        message: item.reused
          ? "The video's thumbnail is already in the media library."
          : "The video's thumbnail was copied to the media library.",
        item,
      });
    },
  };
}
