/**
 * The share card the plugin makes by itself: where a page's automatic share
 * image, its own content picture, is not the shape or size networks show in
 * full, the head names a 1200 × 630 JPEG cut from it around its focal point,
 * at an address of the plugin's own route.
 *
 * The address names the picture and its version: what the cut is made from,
 * its stored file and focal point. A new file or focal point is a new
 * address, so a card is never served from an earlier picture, and nothing is
 * stored to go stale: the card is made when its address is first fetched,
 * and kept by the browser and any CDN in front of the site for as long as
 * that address stands. Working out the address reads nothing the head does
 * not read already, so naming the card costs a page's head nothing.
 *
 * Only the automatic image is replaced. A share image a person chose for the
 * page, or made by hand, is theirs, and is served as it is.
 *
 * @module social/share-card
 */
import type { PageMetadataImage } from "@nextlyhq/plugin-sdk";

import { SEO_PLUGIN_NAME } from "../settings/contract";

import {
  SHARE_IMAGE,
  shareImageFormatProblem,
  shareImageSizeProblem,
} from "./contract";

/** Where the card route answers, under the plugin's routes. */
export const SHARE_CARD_ROUTE_PATH = "/share-card";

/**
 * Where the site's Nextly handler is mounted, as a scaffolded project mounts
 * it (`src/app/admin/api/[[...params]]/route.ts`): the half of the card's
 * address the plugin's own route path does not say.
 */
const API_MOUNT = "/admin/api";

/** A media item as the card reads it: what it is, and what a cut is made from. */
export interface CardSource {
  id: string;
  url: string;
  /** The stored file: a new upload under the same item is a new file. */
  filename: string;
  mimeType?: string;
  width?: number;
  height?: number;
  focalX?: number | null;
  focalY?: number | null;
  /** Its alt text, read whenever the head is, so the card's follows it. */
  alt?: string;
}

/**
 * A short fingerprint of `text` (FNV-1a, 32 bits, as hex): enough to tell
 * one version of a picture from the next, which is all the address needs.
 */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The version of a picture a card is cut from: its stored file and its focal
 * point, the only inputs to the cut. Its alt text is not among them: the
 * card's alt is read from the picture with the head, so a new alt needs no
 * new card.
 */
export function cardVersionOf(
  source: Pick<CardSource, "filename" | "focalX" | "focalY">
): string {
  const focal = (at: number | null | undefined) =>
    typeof at === "number" ? String(at) : "";
  return fingerprint(
    `${source.filename}|${focal(source.focalX)}|${focal(source.focalY)}`
  );
}

/** The address a card of `id` at `version` is served at. */
export function cardAddressOf(id: string, version: string): string {
  return `${API_MOUNT}/plugins/${SEO_PLUGIN_NAME}${SHARE_CARD_ROUTE_PATH}/${encodeURIComponent(id)}/${version}.jpg`;
}

/**
 * Whether networks would not show a picture in full on a card: the wrong
 * shape or too small, or a file type some networks don't show. A picture
 * whose size is not known is left as it is, since its card could not be
 * said to fit either.
 */
function needsCard(source: CardSource): boolean {
  if (source.width === undefined || source.height === undefined) return false;
  if (source.mimeType !== undefined && !source.mimeType.startsWith("image/")) {
    return false;
  }
  return (
    shareImageSizeProblem(source) !== undefined ||
    shareImageFormatProblem(source.url) !== undefined
  );
}

/**
 * The card the head names in place of `source`, where networks would not
 * show it in full: 1200 × 630, with the picture's own alt text. None where
 * the picture is shown in full already.
 */
export function shareCardOf(source: CardSource): PageMetadataImage | undefined {
  if (!needsCard(source)) return undefined;
  return {
    url: cardAddressOf(source.id, cardVersionOf(source)),
    width: SHARE_IMAGE.width,
    height: SHARE_IMAGE.height,
    ...(source.alt === undefined ? {} : { alt: source.alt }),
  };
}
