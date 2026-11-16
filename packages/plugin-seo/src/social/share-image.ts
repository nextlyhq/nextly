/**
 * Making a share image: a copy of a picture at the size every network shows
 * in full, 1200 × 630, as a JPEG small enough for every network to fetch.
 *
 * The copy is cut to the card's shape around the picture's focal point, so
 * the subject a person marked stays in frame, and a picture smaller than the
 * card is enlarged to fill it. The picture itself is never changed.
 *
 * Image work uses `sharp`, an optional dependency the site installs once for
 * its media library; without it, making a share image is refused with the
 * command that installs it.
 *
 * @module social/share-image
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { default as SharpModule } from "sharp";

import { SHARE_IMAGE } from "./contract";

/** Where the subject of a picture is, in whole percent from the top left. */
export interface FocalPoint {
  x: number;
  y: number;
}

/** A part of a picture, in pixels. */
export interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A made share image. */
export interface MadeShareImage {
  data: Buffer;
  width: number;
  height: number;
}

/** `value` held between `low` and `high`. */
const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/** A focal percentage as a fraction; the middle where none is usable. */
function fractionOf(percent: number | undefined): number {
  return typeof percent === "number" && Number.isFinite(percent)
    ? clamp(percent, 0, 100) / 100
    : 0.5;
}

/**
 * The largest part of a `width` × `height` picture in the card's shape,
 * centred on `focal` as nearly as the picture's edges allow.
 */
export function cardRegion(
  width: number,
  height: number,
  focal?: Partial<FocalPoint>
): Region {
  const shape = SHARE_IMAGE.width / SHARE_IMAGE.height;
  const cutWidth = Math.min(width, Math.round(height * shape));
  const cutHeight = Math.min(height, Math.round(cutWidth / shape));
  const centre = (size: number, cut: number, at: number) =>
    clamp(Math.round(size * at - cut / 2), 0, size - cut);
  return {
    left: centre(width, cutWidth, fractionOf(focal?.x)),
    top: centre(height, cutHeight, fractionOf(focal?.y)),
    width: cutWidth,
    height: cutHeight,
  };
}

/**
 * The JPEG quality made at. Even random noise, the hardest picture to
 * compress, comes to about 430 KB at this size and quality, so every share
 * image is under the limit with room to spare; the limit is still checked.
 */
const QUALITY = 82;

/** The command that installs `sharp`, for the refusal without it. */
const SHARP_INSTALL = "npm install sharp";

type Sharp = typeof SharpModule;

/** `sharp`, or nothing where the site has not installed it. */
async function loadSharp(): Promise<Sharp | null> {
  try {
    const loaded = (await import("sharp")) as unknown as {
      default?: unknown;
    };
    const factory = loaded.default ?? loaded;
    return typeof factory === "function" ? (factory as Sharp) : null;
  } catch {
    return null;
  }
}

/** `sharp`, or a refusal naming the command that installs it. */
async function sharpOrRefuse(): Promise<Sharp> {
  const sharp = await loadSharp();
  if (sharp !== null) return sharp;
  throw NextlyError.serviceUnavailable({
    publicMessage: `Making a share image needs the sharp image library. Install it with "${SHARP_INSTALL}" and restart the site.`,
    logMessage: "sharp could not be loaded",
  });
}

/** A picture the library cannot read, refused as the caller's input. */
function unreadable(cause: unknown): NextlyError {
  return NextlyError.invalidInput({
    message: "This file could not be read as a picture.",
    logContext: {
      reason: "share-image-unreadable",
      error: cause instanceof Error ? cause.message : String(cause),
    },
  });
}

/**
 * `source` as a share image: 1200 × 630, cut around `focal`, as a JPEG under
 * {@link SHARE_IMAGE.maxBytes}. Transparent areas are filled white, since a
 * JPEG has none, and a moving picture gives its first frame.
 */
export async function makeShareImage(
  source: Uint8Array,
  focal?: Partial<FocalPoint>
): Promise<MadeShareImage> {
  const sharp = await sharpOrRefuse();
  let pixels: {
    data: Buffer;
    info: { width: number; height: number; channels: number };
  };
  try {
    // Turned upright first, so the focal point and the cut are read on the
    // picture as people see it.
    pixels = await sharp(source, { failOn: "none" })
      .rotate()
      .flatten({ background: "#ffffff" })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw unreadable(error);
  }
  const { width, height, channels } = pixels.info;
  const data = await sharp(pixels.data, {
    raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
  })
    .extract(cardRegion(width, height, focal))
    .resize(SHARE_IMAGE.width, SHARE_IMAGE.height, { fit: "fill" })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();
  if (data.length >= SHARE_IMAGE.maxBytes) {
    throw NextlyError.internal({
      logContext: { reason: "share-image-too-large", bytes: data.length },
    });
  }
  return { data, width: SHARE_IMAGE.width, height: SHARE_IMAGE.height };
}
