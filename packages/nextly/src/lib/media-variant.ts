/**
 * Media variant helpers
 *
 * Public-facing utility for picking a sized image variant URL from a Media
 * record. Consumers (admin UI, public Next.js apps reading the API) call
 * `getMediaVariant(media, "card")` instead of cracking open the
 * `media.sizes` JSON themselves.
 *
 * Selection rules (in order):
 *   1. If `media.sizes[name]` exists, return its URL.
 *   2. If `media.sizes[fallbackName]` exists, return its URL (when caller
 *      passes one).
 *   3. If the asset isn't an image OR no sizes are present, fall back to
 *      `media.url` (the original).
 *
 * The shape of `media` here is intentionally narrow so the helper works
 * for both the full Media row and any subset that callers pass through
 * the API.
 */

export interface MediaLike {
  url: string;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  sizes?: Record<
    string,
    { url: string; width?: number; height?: number; filesize?: number }
  > | null;
}

export interface GetMediaVariantOptions {
  /**
   * If the requested `name` isn't present, try this name next. Useful for
   * progressive fallback: `getMediaVariant(m, "card", { fallback: "thumbnail" })`.
   */
  fallback?: string;
  /**
   * If true (default), fall through to `media.thumbnailUrl` when neither the
   * requested variant nor the fallback variant exists. Set false to skip
   * straight to `media.url`.
   */
  preferThumbnail?: boolean;
}

/**
 * Return the URL for a named image-size variant, or fall back to the
 * thumbnail / original URL.
 *
 * Returns `undefined` only when `media` is null/undefined. Otherwise always
 * returns a string URL.
 */
export function getMediaVariant(
  media: MediaLike | null | undefined,
  name: string,
  options: GetMediaVariantOptions = {}
): string | undefined {
  if (!media) return undefined;

  const { fallback, preferThumbnail = true } = options;
  const sizes = media.sizes ?? null;

  if (sizes) {
    const direct = sizes[name];
    if (direct?.url) return direct.url;

    if (fallback) {
      const fb = sizes[fallback];
      if (fb?.url) return fb.url;
    }
  }

  if (preferThumbnail && media.thumbnailUrl) return media.thumbnailUrl;

  return media.url;
}

/**
 * Convenience: pick the smallest available variant URL. Useful for grid
 * thumbnails where bandwidth matters more than which exact name is used.
 *
 * Walks the variants by `width * height` and returns the smallest. Falls
 * back to `thumbnailUrl` then `url`.
 */
export function getSmallestMediaVariant(
  media: MediaLike | null | undefined
): string | undefined {
  if (!media) return undefined;
  const sizes = media.sizes ?? null;

  if (sizes) {
    const entries = Object.values(sizes).filter(
      v => v?.url && v.width && v.height
    );
    if (entries.length > 0) {
      const smallest = entries.reduce((acc, cur) =>
        (cur.width ?? 0) * (cur.height ?? 0) <
        (acc.width ?? 0) * (acc.height ?? 0)
          ? cur
          : acc
      );
      return smallest.url;
    }
  }

  return media.thumbnailUrl ?? media.url;
}
