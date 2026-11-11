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
