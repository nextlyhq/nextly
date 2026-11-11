/**
 * The one action that fixes a share image of the wrong size: a copy of the
 * picture made at 1200 × 630, added to the media library beside it. The
 * picture itself, and every page that shows it, are left as they were; the
 * SEO tab sets the copy as the page's share image, and saving the page keeps
 * it.
 *
 * @module social/route
 */
import {
  NextlyError,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import type { MadeShareImageItem } from "./contract";
import { SHARE_IMAGE_ROUTE_PATH } from "./contract";
import { makeShareImage } from "./share-image";

/** The largest picture read to make a copy from, in bytes. */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

/** How long reading the picture may take, in milliseconds. */
const READ_TIMEOUT_MS = 20_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The media item the request names, or a refusal saying what is missing. */
async function requested(req: Request): Promise<string> {
  const body: unknown = await req.json().catch(() => undefined);
  const media = isRecord(body) ? body.media : undefined;
  if (typeof media !== "string" || media.trim() === "") {
    throw NextlyError.invalidInput({
      message: "Name the media library item to make a share image from.",
    });
  }
  return media;
}

/** A refusal for a picture that could not be read from where it is kept. */
function notRead(logContext: Record<string, unknown>): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage:
      "The picture could not be read from the media library. Try again in a moment.",
    logContext: { reason: "share-image-source-unread", ...logContext },
  });
}

/** Every byte of `response`'s body, refusing one past the limit. */
async function bodyOf(
  response: Response,
  address: string
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (reader === undefined) throw notRead({ address, cause: "no body" });
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function tooLarge(): NextlyError {
  return NextlyError.invalidInput({
    message: "This picture is too large to make a share image from.",
  });
}

/**
 * The bytes of the picture at `url`, as the media library serves it: a path
 * from the root is read from `origin`, where the site serves its uploads.
 */
async function readPicture(url: string, origin: string): Promise<Uint8Array> {
  let address: URL;
  try {
    address = new URL(url, `${origin}/`);
  } catch {
    throw notRead({ url });
  }
  if (address.protocol !== "http:" && address.protocol !== "https:") {
    throw notRead({ url });
  }
  let response: Response;
  try {
    response = await fetch(address, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (error) {
    throw notRead({
      address: address.href,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    throw notRead({ address: address.href, status: response.status });
  }
  return bodyOf(response, address.href);
}

/** The copy's file name: the picture's own, marked as its share image. */
function copyName(filename: string): string {
  const stem = filename
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `share-${stem === "" ? "image" : stem}.jpg`;
}

const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

type MediaItem = Awaited<
  ReturnType<PluginRouteContext["services"]["media"]["findById"]>
>;

/** The picture the request names, or a refusal where it is no picture. */
async function pictureOf(
  ctx: PluginRouteContext,
  id: string
): Promise<MediaItem> {
  const source = await ctx.services.media.findById(id, {});
  if (!ctx.services.media.isImage(source.mimeType)) {
    throw NextlyError.invalidInput({
      message: "A share image can only be made from a picture.",
    });
  }
  return source;
}

/** The copy as the action answers it. */
function itemOf(copy: MediaItem, made: { width: number; height: number }) {
  const item: MadeShareImageItem = {
    id: copy.id,
    url: copy.url,
    filename: copy.filename,
    mimeType: copy.mimeType,
    size: copy.size,
    width: numberOr(copy.width, made.width),
    height: numberOr(copy.height, made.height),
  };
  return copy.altText ? { ...item, altText: copy.altText } : item;
}

/** Makes the share image the request names, as the signed-in person. */
async function handle(
  req: Request,
  ctx: PluginRouteContext,
  baseUrl: string | undefined
): Promise<Response> {
  const user = ctx.user;
  // Reading the picture is a read of the library, which the route's own
  // permission, adding to it, does not include.
  if (user === null || !(await ctx.caller?.can("read", "media"))) {
    throw NextlyError.forbidden();
  }
  const source = await pictureOf(ctx, await requested(req));
  const picture = await readPicture(
    source.url,
    baseUrl ?? new URL(req.url).origin
  );
  const made = await makeShareImage(picture, {
    x: numberOr(source.focalX, 50),
    y: numberOr(source.focalY, 50),
  });
  // Added as the person, so the media library judges and records the
  // upload as theirs.
  const copy = await ctx.services.media.upload(
    {
      buffer: made.data,
      filename: copyName(source.originalFilename || source.filename),
      mimeType: "image/jpeg",
      size: made.data.length,
      altText: source.altText ?? undefined,
      folderId: source.folderId ?? null,
    },
    { as: "user", user, request: req }
  );
  return Response.json(itemOf(copy, made), { status: 201 });
}

/**
 * The route that makes a share image: for a person who may add to the media
 * library and read it. A picture stored with a path from the root is read
 * from `baseUrl` where the site sets one, or else from the address the
 * request came to.
 */
export function shareImageRoute(baseUrl: string | undefined): PluginRoute {
  return {
    method: "POST",
    path: SHARE_IMAGE_ROUTE_PATH,
    requiredPermission: "create-media",
    handler: (req, ctx) => handle(req, ctx, baseUrl),
  };
}
