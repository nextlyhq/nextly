/**
 * What the SEO plugin's server and the admin's screens agree on about share
 * images: the size a card shows in full, why a picture does not, and the
 * action that makes one. It imports nothing, so an admin screen reads it
 * without bringing any server code along.
 *
 * @module social/contract
 */

/** What a share image is: its size, shape and largest file. */
export const SHARE_IMAGE: {
  readonly width: 1200;
  readonly height: 630;
  /** The narrowest shape networks show in full, width divided by height. */
  readonly minRatio: 1.8;
  /** The widest shape networks show in full, width divided by height. */
  readonly maxRatio: 2;
  /** The largest file made, in bytes: under 600 KB. */
  readonly maxBytes: 600_000;
} = {
  width: 1200,
  height: 630,
  minRatio: 1.8,
  maxRatio: 2,
  maxBytes: 600_000,
};

/** `width × height`, as the problem list writes a size. */
const sizeOf = (width: number, height: number) => `${width} × ${height}`;

/**
 * Why a picture of this size does not show in full on a card: narrower than
 * 1200 pixels, or a shape outside 1.8 to 2.0 times as wide as it is tall.
 * Nothing where it does, or where its size is not known.
 */
export function shareImageSizeProblem(image: {
  width?: number;
  height?: number;
}): string | undefined {
  const { width, height } = image;
  if (width === undefined || height === undefined || height <= 0) {
    return undefined;
  }
  const shape = width / height;
  if (shape < SHARE_IMAGE.minRatio || shape > SHARE_IMAGE.maxRatio) {
    return `${sizeOf(width, height)}, LinkedIn will crop it`;
  }
  if (width < SHARE_IMAGE.width) {
    return `${sizeOf(width, height)}, smaller than the ${sizeOf(SHARE_IMAGE.width, SHARE_IMAGE.height)} networks show in full`;
  }
  return undefined;
}

/**
 * The picture formats some networks don't show on a card, by file type, and
 * what the problem list says of each. X's cards take JPEG, PNG, WebP and
 * GIF; an SVG is shown by none of the networks, and AVIF and WebP by fewer
 * apps than JPEG and PNG, which every network shows.
 */
const FORMATS_NOT_SHOWN: Readonly<Record<string, string>> = {
  svg: "An SVG image, which networks don't show on a card",
  avif: "An AVIF image, which X and many apps don't show on a card",
  webp: "A WebP image, which some apps don't show on a card",
};

/**
 * Why a picture at `url` may not show on a card: its file type, read from
 * the address's last segment, is one some networks don't show. Nothing for
 * a JPEG, PNG or GIF, or an address that names no file type, such as an
 * image a route draws (`/og?title=...`).
 */
export function shareImageFormatProblem(url: string): string | undefined {
  const format = imageFormatOf(url);
  return format === undefined ? undefined : FORMATS_NOT_SHOWN[format];
}

/**
 * A picture's file type, in lower case, read from the last segment of its
 * address: nothing where the address names none, such as an image a route
 * draws (`/og?title=...`).
 */
export function imageFormatOf(url: string): string | undefined {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  const last = path.slice(path.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot <= 0 ? undefined : last.slice(dot + 1).toLowerCase();
}

/** Where the action answers, under the plugin's routes. */
export const SHARE_IMAGE_ROUTE_PATH = "/share-image";

/** What the action is sent: the media library item to make a copy of. */
export interface MakeShareImageRequest {
  media: string;
}

/** What the action answers: the copy, as the media library holds it. */
export interface MadeShareImageItem {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  altText?: string;
}
