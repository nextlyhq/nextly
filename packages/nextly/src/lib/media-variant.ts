import { getBaseUrl } from "./get-base-url";

/**
 * Media variant helpers
 *
 * Public-facing utilities for working with Media URLs in API responses:
 *
 *   - `getMediaVariant(media, "card")` — pick a sized image variant URL
 *     from a Media record without cracking open the `sizes` JSON.
 *   - `toAbsoluteMediaUrl(url)` / `absolutizeMediaUrls(row)` — prefix
 *     storage-relative URLs (`/uploads/...` from the local adapter) with
 *     `NEXT_PUBLIC_APP_URL` so API consumers (mobile clients, external
 *     services, edge workers) can resolve them. Cloud-adapter URLs
 *     (S3/Vercel Blob/R2) are already absolute and pass through unchanged.
 *
 * Variant selection rules (in order):
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

// ────────────────────────────────────────────────────────────────────────────
// URL absolutization
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the base URL used to absolutize relative media URLs. Thin
 * wrapper around the shared `getBaseUrl` helper so this module re-exports
 * a domain-named alias for callers reasoning about media specifically.
 */
export function getMediaBaseUrl(): string {
  return getBaseUrl();
}

/**
 * Return `true` when the URL is already absolute (`http(s)://`) or
 * protocol-relative (`//`). These come from cloud storage adapters and
 * must not be re-prefixed.
 */
function isAbsoluteUrl(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);
}

/**
 * Prefix a relative media URL with `baseUrl`. Absolute / protocol-relative
 * URLs are returned unchanged. `null` / `undefined` / `""` pass through.
 */
export function toAbsoluteMediaUrl<T extends string | null | undefined>(
  url: T,
  baseUrl: string = getMediaBaseUrl()
): T {
  if (!url) return url;
  if (isAbsoluteUrl(url)) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${baseUrl}${path}` as T;
}

type MediaSizes = Record<
  string,
  { url?: string | null; [key: string]: unknown }
> | null;

/**
 * Apply `toAbsoluteMediaUrl` to every URL field on a media row, including
 * the nested `sizes` variants. Returns a new object — does not mutate.
 */
export function absolutizeMediaUrls<
  T extends {
    url?: string | null;
    thumbnailUrl?: string | null;
    sizes?: MediaSizes;
  },
>(row: T, baseUrl: string = getMediaBaseUrl()): T {
  const sizes = row.sizes;
  let absolutizedSizes: MediaSizes = sizes ?? null;
  if (sizes && typeof sizes === "object") {
    absolutizedSizes = Object.fromEntries(
      Object.entries(sizes).map(([name, variant]) => [
        name,
        variant && typeof variant === "object"
          ? {
              ...variant,
              url: toAbsoluteMediaUrl(variant.url ?? null, baseUrl),
            }
          : variant,
      ])
    );
  }

  return {
    ...row,
    url: toAbsoluteMediaUrl(row.url ?? null, baseUrl),
    thumbnailUrl: toAbsoluteMediaUrl(row.thumbnailUrl ?? null, baseUrl),
    ...(sizes !== undefined ? { sizes: absolutizedSizes } : {}),
  };
}
