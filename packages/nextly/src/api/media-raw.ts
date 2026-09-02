/**
 * Serve a stored media object's bytes from this site's own origin.
 *
 * It exists because a `@font-face` may not name another host — a product rule
 * the styling engine enforces rather than suggests, on the grounds that a font
 * URL pointing elsewhere makes every visitor's browser announce its IP address
 * to that server before a word of the page is readable. A font uploaded to S3,
 * Vercel Blob or UploadThing is therefore unusable at its own address, and
 * needs one on this origin.
 *
 * WHAT IT WILL SERVE IS THE WHOLE OF ITS ACCESS CONTROL. Every other media
 * route is gated by `requireAuth`, which cannot work here: the browser asking
 * for a font carries no session, so on a locked-down install a gated font route
 * would answer 401 and the page would render in a fallback face. Running it
 * ungated instead is only safe because it refuses to serve anything outside
 * `PUBLIC_SERVE_MIME_TYPES` — the gate is the mime type, not the caller, and
 * widening that set widens what any anonymous caller can read.
 *
 * A record outside the set answers 404 rather than 403, so the route cannot be
 * used to ask whether a private object exists.
 *
 * @module api/media-raw
 */
import { getService } from "../di";
import { NextlyError } from "../errors/nextly-error";
import type { RequestContext } from "../services/shared";
import { canonicalMimeType } from "../services/upload-validation/mime";
import {
  matchesWebFontSignature,
  WEB_FONT_MIME_TYPES,
} from "../services/upload-validation/web-fonts";
import { DEFAULT_READ_MAX_BYTES } from "../storage/fetch-stored-bytes";
import { readStoredMediaBytes } from "../storage/read-stored-media";
import { getMediaStorage } from "../storage/storage";

/**
 * The only types this route hands to an unauthenticated caller.
 *
 * Web font formats and nothing else. It is not a list of things that are
 * harmless to serve — it is the list of things a page cannot work without
 * serving, which is a much smaller question and the only one this route has an
 * answer to. Adding an entry here makes every stored object of that type world
 * readable by id.
 */
export const PUBLIC_SERVE_MIME_TYPES: ReadonlySet<string> = new Set(
  WEB_FONT_MIME_TYPES
);

/**
 * A year, and `immutable` alongside it.
 *
 * Sound for exactly the types above: a font is written once and never
 * regenerated, unlike an image, whose bytes a focal-point change rewrites in
 * place under the same id. If this set ever grows to cover a type that IS
 * rewritten, this header stops being true before the new type does.
 */
const IMMUTABLE_FOR_A_YEAR = "public, max-age=31536000, immutable";

/**
 * The collection whose adapter serves these bytes.
 *
 * Named rather than passed as `undefined`, because the manager resolves an
 * adapter FROM it — and an install routing media to S3 while everything else
 * stays local gets the wrong backend from an omitted argument, not a default.
 */
const MEDIA_COLLECTION = "media";

/** The response for a record this route will not talk about. */
function notFound(): Response {
  return new Response(null, { status: 404 });
}

/**
 * Serve one media object's bytes, if its type is publicly servable.
 *
 * @param mediaId - The record to serve
 * @returns The bytes with their content type, or 404
 */
export async function handleServeMediaBytes(
  mediaId: string
): Promise<Response> {
  const mediaService = getService("mediaService");
  const context: RequestContext = {};

  let media;
  try {
    media = await mediaService.findById(mediaId, context);
  } catch (error) {
    /*
     * Only an ABSENT record becomes 404. `findById` deliberately tells a
     * missing row apart from a database that could not be reached, and folding
     * the second into the first would answer a visitor "no such font" during an
     * outage — a cache could then hold that answer long after the outage ended.
     */
    if (error instanceof NextlyError && error.code === "NOT_FOUND") {
      return notFound();
    }
    throw error;
  }

  /*
   * Canonicalised before the lookup, through the same helper the validator
   * uses, because a stored row need not be spelled the way this table is.
   * Uploads store the canonical type now, but nothing rewrites rows written
   * before that: `Font/WOFF2` differs only in case, and `application/font-woff`
   * and its x- variant were what some clients sent. An exact match would refuse
   * to serve a font this product has served for as long as it has existed.
   */
  const servedType = canonicalMimeType(media.mimeType);
  if (!PUBLIC_SERVE_MIME_TYPES.has(servedType)) {
    return notFound();
  }

  /*
   * The media collection's ADAPTER, not the manager that routes to it. The
   * manager implements no `read` at all, so handing it over takes the URL
   * fallback every time — and its `getPublicUrl` needs the collection to pick
   * an adapter, so called without one it answers from the local default and
   * produces a relative path that `safeFetch` refuses. Every backend fails,
   * including the local one this route was supposed to work on first.
   */
  const bytes = await readStoredMediaBytes(
    getMediaStorage().getAdapterForCollection(MEDIA_COLLECTION),
    media.filename,
    DEFAULT_READ_MAX_BYTES
  );
  // The row outlived its object. Same answer as a row that never existed,
  // because from outside they are the same thing: there is no font here.
  if (bytes === null) return notFound();

  /*
   * THE BYTES DECIDE, at serve time, not only at upload time.
   *
   * This route makes a stored MIME type confer anonymous access, and that
   * metadata was not always trustworthy: the published server action reaches
   * the legacy service, which persisted whatever type a client sent without
   * comparing it to the content. So an installation upgrading into this feature
   * can already hold a row labelled `font/woff2` carrying anything at all, and
   * the upload-side signature check does not reach back and rewrite it.
   *
   * Checked here rather than migrated, because the bytes are already in hand
   * and the comparison is four of them — a migration would have to be run,
   * would have to be run everywhere, and would still leave this route trusting
   * a label. Refused as 404 rather than an error, for the same reason the type
   * gate above is: the route says nothing about objects it will not serve.
   */
  if (!matchesWebFontSignature(bytes, servedType)) {
    return notFound();
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      // The CANONICAL type, so a row stored under a legacy spelling is served
      // under the name a browser expects.
      "Content-Type": servedType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": IMMUTABLE_FOR_A_YEAR,
      /*
       * The type is already one of two known font types, so there is nothing
       * for a browser to guess at — but a route that serves stored bytes should
       * say so regardless, because the header stops being redundant the moment
       * the set above changes.
       */
      "X-Content-Type-Options": "nosniff",
    },
  });
}
