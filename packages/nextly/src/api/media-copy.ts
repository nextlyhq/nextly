/**
 * Serve a resized copy of a stored image: `GET <media route>/:id/copy/:width`.
 *
 * Answered only after the media route's own read gate, so a copy is served to
 * exactly whoever may read the item, and never for one the caller could not
 * read. The width is snapped to the nearest allowed one, and the format is
 * the best of AVIF, WebP or the original's own that the browser names.
 *
 * Where no copy can be had, the answer is a redirect to the original, so an
 * image on a page still shows. The address's `v` is the original's version:
 * while it is current the copy is cached for a year, and once the file is
 * replaced the old address is answered with the new picture and revalidated.
 *
 * @module api/media-copy
 * @experimental
 */
import { getService } from "../di";
import {
  copyVersionOf,
  parseCopyWidth,
} from "../domains/media/copies/copy-rules";
import {
  copyBytesOf,
  mediaCopyStorage,
} from "../domains/media/copies/media-copies";
import { NextlyError } from "../errors/nextly-error";
import { getImageProcessor } from "../storage/image-processor";

/** Whether the mount answering serves reads to signed-in people only. */
export interface MediaCopyServeOptions {
  /**
   * True on the admin mount: the copy is cached by the browser alone, never
   * by a shared cache, which could hand it to someone the gate never saw.
   */
  privateCache: boolean;
}

/**
 * Serve one copy.
 *
 * @param mediaId - The item, from the route.
 * @param widthSegment - The width, from the route, as written.
 */
export async function handleServeMediaCopy(
  mediaId: string,
  widthSegment: string,
  request: Request,
  options: MediaCopyServeOptions
): Promise<Response> {
  const width = parseCopyWidth(widthSegment);
  // A width that is not plain digits is a path this route does not have.
  if (width === undefined) throw NextlyError.notFound();

  const media = await getService("mediaService").findById(mediaId, {});
  const served = await copyBytesOf(
    media,
    width,
    request.headers.get("accept"),
    {
      storage: mediaCopyStorage(),
      processor: getImageProcessor(),
    }
  );

  const scope = options.privateCache ? "private" : "public";
  if (served.kind === "original") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: media.url,
        // Not kept: a copy that could not be made now may be made next time,
        // once the image library or the storage is back.
        "Cache-Control": "no-store",
        Vary: "Accept",
      },
    });
  }

  const current =
    new URL(request.url).searchParams.get("v") ===
    copyVersionOf(media.filename);
  return new Response(new Uint8Array(served.bytes), {
    status: 200,
    headers: {
      "Content-Type": served.mimeType,
      "Content-Length": String(served.bytes.byteLength),
      "Cache-Control": current
        ? `${scope}, max-age=31536000, immutable`
        : `${scope}, no-cache`,
      // The same address answers AVIF, WebP or the original format by what
      // the browser accepts, so a cache must keep them apart.
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
