/**
 * How the SEO tab writes an answer's values on screen: the address as a
 * results page shows it, text cut where Google cuts it, and an image's file
 * name. Pure, so the tab and its tests share one reading.
 *
 * @module tab/display
 */
import { SHARE_IMAGE, shareImageSizeProblem } from "../social/contract";

/**
 * An address as a person reads it: a path from the site's root is put under
 * the site's origin; an address that is already whole is kept.
 */
export function absoluteAddress(origin: string, address: string): string {
  if (!address.startsWith("/") || address.startsWith("//")) return address;
  return `${origin.replace(/\/+$/, "")}${address}`;
}

/** An address as a results page writes it: `https://acme.com › blog › post`. */
export function resultsAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  const segments = url.pathname
    .split("/")
    .filter(segment => segment !== "")
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  return [`${url.protocol}//${url.host}`, ...segments].join(" › ");
}

/** The host of an origin, as a shared card names the site. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** `text` cut to about `limit` characters, as a results page cuts it. */
export function cutAt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()} …`;
}

/** The file name an image's address ends in. */
export function fileNameOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  const name =
    path
      .split("/")
      .filter(part => part !== "")
      .pop() ?? path;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** `width × height`, as the tab writes a size. */
const sizeText = (width: number, height: number) => `${width} × ${height}`;

/** How a share image fits the card networks show, as the preview says it. */
export interface ShareImageFit {
  text: string;
  /** Whether every network shows it in full. */
  fits: boolean;
  /** Whether the card cuts it at the top and bottom. */
  cutTopAndBottom: boolean;
}

/**
 * How a picture fits the shared card: whether it shows in full is the share
 * image check's own answer; where it does not, the sentence says why, from
 * its shape against the card's. Nothing where its size is not known.
 */
export function shareImageFit(
  image: { width?: number; height?: number } | undefined
): ShareImageFit | undefined {
  const width = image?.width;
  const height = image?.height;
  if (width === undefined || height === undefined || height <= 0) {
    return undefined;
  }
  const size = sizeText(width, height);
  const fix = "Fix it under Advanced, Share image.";
  const shape = width / height;
  const cutTopAndBottom = shape < SHARE_IMAGE.minRatio;
  if (shareImageSizeProblem({ width, height }) === undefined) {
    const exact = width === SHARE_IMAGE.width && height === SHARE_IMAGE.height;
    return {
      text: `The image is ${size}, ${exact ? "the" : "a"} size every network shows in full.`,
      fits: true,
      cutTopAndBottom,
    };
  }
  let why = `is smaller than the ${sizeText(SHARE_IMAGE.width, SHARE_IMAGE.height)} networks show in full`;
  if (cutTopAndBottom) why = "is cut at the top and bottom to fit";
  else if (shape > SHARE_IMAGE.maxRatio) why = "is cut at the sides to fit";
  return {
    text: `This ${size} image ${why}. ${fix}`,
    fits: false,
    cutTopAndBottom,
  };
}
