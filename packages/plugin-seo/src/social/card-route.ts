/**
 * The route serving the share cards the plugin makes by itself
 * (`social/share-card`): `GET /share-card/<media id>/<version>.jpg`, public,
 * since networks fetch a card with no session.
 *
 * The card is cut when its address is fetched, from the picture as the site
 * serves it publicly, and answered with a year's cache, which the browser and
 * any CDN in front of the site keep: the address names the picture's version,
 * so a picture changed is a new address, never a cached card gone stale.
 * Nothing is stored, so nothing is left behind when the picture is deleted.
 * An address naming an earlier version is sent on to the current card, so a
 * head cached before the change still shows the picture as it is now.
 *
 * Only a picture the site serves to anyone is cut: one its storage refuses
 * to an anonymous reader is refused here too, as the make action refuses it,
 * so the route shows nobody a picture they could not fetch themselves.
 *
 * @module social/card-route
 */
import {
  NextlyError,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import { readPicture } from "./route";
import {
  cardAddressOf,
  cardVersionOf,
  SHARE_CARD_ROUTE_PATH,
} from "./share-card";
import { makeShareImage } from "./share-image";

/** How long a card is kept by the browser and any CDN: a year, in seconds. */
const KEPT_FOR = 365 * 24 * 60 * 60;

/** How many cards one client may have cut a minute, past any CDN. */
const CUTS_PER_MINUTE = 60;

/** A card's file name: its version, as hex, then `.jpg`. */
const CARD_FILE = /^([0-9a-f]{8})\.jpg$/;

/** The picture an address names, or none where it names no picture. */
async function pictureNamed(ctx: PluginRouteContext, id: string) {
  try {
    const media = await ctx.services.media.findById(id, {});
    return ctx.services.media.isImage(media.mimeType) ? media : undefined;
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return undefined;
    throw error;
  }
}

const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Answers a card, cut now, or sends an earlier version on to the current. */
async function handle(
  req: Request,
  ctx: PluginRouteContext,
  baseUrl: string | undefined
): Promise<Response> {
  const id = ctx.params.media ?? "";
  const version = CARD_FILE.exec(ctx.params.file ?? "")?.[1];
  const picture =
    version === undefined ? undefined : await pictureNamed(ctx, id);
  if (picture === undefined) throw NextlyError.notFound();
  const current = cardVersionOf(picture);
  if (current !== version) {
    // Briefly kept, since the picture may change again.
    return new Response(null, {
      status: 302,
      headers: {
        location: cardAddressOf(picture.id, current),
        "cache-control": "public, max-age=60",
      },
    });
  }
  const origin = baseUrl ?? new URL(req.url).origin;
  const card = await makeShareImage(await readPicture(picture.url, origin), {
    x: numberOr(picture.focalX, 50),
    y: numberOr(picture.focalY, 50),
  });
  return new Response(new Uint8Array(card.data), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(card.data.length),
      "cache-control": `public, max-age=${KEPT_FOR}, immutable`,
    },
  });
}

/**
 * The public route serving share cards. A picture stored with a path from
 * the root is read from `baseUrl` where the site sets one, or else from the
 * address the request came to, as the make action reads it.
 */
export function shareCardRoute(baseUrl: string | undefined): PluginRoute {
  return {
    method: "GET",
    path: `${SHARE_CARD_ROUTE_PATH}/:media/:file`,
    public: true,
    // Each cut reads and resizes a picture, so one client is held to a
    // budget; a CDN in front of the site answers repeats without the route.
    rateLimit: { max: CUTS_PER_MINUTE, windowMs: 60_000 },
    handler: (req, ctx) => handle(req, ctx, baseUrl),
  };
}
